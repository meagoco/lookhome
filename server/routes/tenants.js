import { Router } from 'express';
import { db } from '../db.js';
import { auth } from '../middleware/auth.js';

const r = Router();

// 租客可见范围：admin 全部；操作员 = 自己创建的 + 授权项目合同关联的
function tenantScope(req) {
  if (req.user.role === 'admin') return { cond: '', args: [] };
  return {
    cond: ` AND (t.created_by=? OR t.id IN (SELECT DISTINCT c.tenant_id FROM contracts c
      JOIN rooms r ON r.id=c.room_id JOIN property_grants g ON g.property_id=r.property_id
      WHERE g.admin_user_id=?))`,
    args: [req.user.id, req.user.id]
  };
}

// 租客列表
r.get('/', auth, (req, res) => {
  const { verify_status, kw } = req.query;
  const { cond, args } = tenantScope(req);
  let sql = `
    SELECT t.*,
      (SELECT c.id FROM contracts c WHERE c.tenant_id=t.id AND c.status='active' LIMIT 1) AS active_contract_id,
      (SELECT r.room_no FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.tenant_id=t.id AND c.status='active' LIMIT 1) AS room_no,
      (SELECT p.name FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id WHERE c.tenant_id=t.id AND c.status='active' LIMIT 1) AS property_name
    FROM tenants t WHERE 1=1${cond}`;
  if (verify_status && verify_status !== 'all') { sql += ' AND t.verify_status=?'; args.push(verify_status); }
  if (kw) { sql += ' AND (t.name LIKE ? OR t.phone LIKE ? OR t.id_card_enc LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  sql += ' ORDER BY t.id DESC';
  res.json(db.prepare(sql).all(...args));
});

// 新增租客（后台手工录入，记录创建人）
r.post('/', auth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '姓名必填' });
  const info = db.prepare(`
    INSERT INTO tenants (name,phone,id_card_enc,id_card_photo,verify_status,verify_method,remark,created_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    String(b.name), b.phone || '', b.id_card || '', b.id_card_photo || '',
    b.verify_status || 'approved', 'manual', b.remark || '', req.user.id);
  res.json({ id: info.lastInsertRowid });
});

// 身份验证审核（手工模式；预留自动核验开关）
r.post('/:id/verify', auth, (req, res) => {
  if (!canSeeTenant(req, req.params.id)) return res.status(403).json({ error: '无权操作该租客' });
  const { action, remark } = req.body || {};
  if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: '参数错误' });
  const mode = (db.prepare(`SELECT value FROM settings WHERE key='realname_verify_mode'`).get() || {}).value || 'manual';
  db.prepare(`UPDATE tenants SET verify_status=?, verify_remark=?, verify_method=?, verified_by=?, verified_at=datetime('now','localtime') WHERE id=?`)
    .run(action, remark || '', mode, req.user.id, req.params.id);
  res.json({ ok: true });
});

// 校验租客对当前用户可见
function canSeeTenant(req, id) {
  if (req.user.role === 'admin') return true;
  const { cond, args } = tenantScope(req);
  const n = db.prepare(`SELECT COUNT(*) c FROM tenants t WHERE t.id=?${cond}`).get(id, ...args).c;
  return n > 0;
}

r.get('/:id', auth, (req, res) => {
  if (!canSeeTenant(req, req.params.id)) return res.status(403).json({ error: '无权查看该租客' });
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '租客不存在' });
  const contracts = db.prepare(`
    SELECT c.*, r.room_no, p.name AS property_name FROM contracts c
    JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id
    WHERE c.tenant_id=? ORDER BY c.id DESC`).all(req.params.id);
  res.json({ tenant: t, contracts });
});

r.put('/:id', auth, (req, res) => {
  if (!canSeeTenant(req, req.params.id)) return res.status(403).json({ error: '无权操作该租客' });
  const b = req.body || {};
  db.prepare('UPDATE tenants SET name=?,phone=?,id_card_enc=?,id_card_photo=?,remark=? WHERE id=?')
    .run(b.name, b.phone || '', b.id_card || '', b.id_card_photo || '', b.remark || '', req.params.id);
  res.json({ ok: true });
});

// 删除租客：仅存在「正常（在租）合同」时拒绝；退房/作废后可删，历史合同及账单等关联数据一并清理（事务）
r.delete('/:id', auth, (req, res) => {
  if (!canSeeTenant(req, req.params.id)) return res.status(403).json({ error: '无权操作该租客' });
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '租客不存在' });
  const active = db.prepare("SELECT COUNT(*) c FROM contracts WHERE tenant_id=? AND status='active'").get(req.params.id).c;
  if (active > 0) return res.status(400).json({ error: '该租客存在正常（在租）合同，请先退房或作废合同后再删除' });
  const cleaned = db.transaction(() => {
    const contracts = db.prepare('SELECT id FROM contracts WHERE tenant_id=?').all(req.params.id).map(x => x.id);
    let bills = [];
    if (contracts.length) {
      bills = db.prepare(`SELECT id FROM bills WHERE contract_id IN (${contracts.map(() => '?').join(',')})`).all(...contracts).map(x => x.id);
    }
    if (bills.length) db.prepare(`DELETE FROM bill_items WHERE bill_id IN (${bills.map(() => '?').join(',')})`).run(...bills);
    db.prepare('DELETE FROM payments WHERE tenant_id=?').run(req.params.id);
    if (bills.length) db.prepare(`DELETE FROM payments WHERE bill_id IN (${bills.map(() => '?').join(',')})`).run(...bills);
    if (contracts.length) db.prepare(`DELETE FROM refunds WHERE contract_id IN (${contracts.map(() => '?').join(',')})`).run(...contracts);
    if (bills.length) db.prepare(`DELETE FROM bills WHERE id IN (${bills.map(() => '?').join(',')})`).run(...bills);
    if (contracts.length) db.prepare(`DELETE FROM contracts WHERE id IN (${contracts.map(() => '?').join(',')})`).run(...contracts);
    db.prepare('DELETE FROM work_orders WHERE tenant_id=?').run(req.params.id);
    db.prepare('DELETE FROM tenants WHERE id=?').run(req.params.id);
    return { contracts: contracts.length, bills: bills.length };
  })();
  res.json({ ok: true, cleaned });
});

export default r;
