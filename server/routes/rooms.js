import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 房间列表（带项目名、当前租客；操作员仅见授权项目房间）
r.get('/', auth, (req, res) => {
  const { property_id, status, kw } = req.query;
  const { cond, args: condArgs } = grantedScope(req, 'r');
  let sql = `
    SELECT r.*, p.name AS property_name,
      (SELECT t.name FROM contracts c JOIN tenants t ON t.id=c.tenant_id
        WHERE c.room_id=r.id AND c.status='active' LIMIT 1) AS tenant_name
    FROM rooms r JOIN properties p ON p.id=r.property_id WHERE 1=1${cond}`;
  const args = [...condArgs];
  if (property_id) { sql += ' AND r.property_id=?'; args.push(property_id); }
  if (status && status !== 'all') { sql += ' AND r.status=?'; args.push(status); }
  if (kw) { sql += ' AND (r.room_no LIKE ? OR p.name LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`); }
  sql += ' ORDER BY r.id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...args);
  const stat = db.prepare(`SELECT r.status, COUNT(*) c FROM rooms r JOIN properties p ON p.id=r.property_id WHERE 1=1${cond} GROUP BY r.status`).all(...condArgs);
  res.json({ rows, stat });
});

r.post('/', auth, (req, res) => {
  const b = req.body || {};
  if (!b.property_id || !b.room_no) return res.status(400).json({ error: '项目与房号必填' });
  if (!canAccessProject(req, b.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  const info = db.prepare(`
    INSERT INTO rooms (property_id,room_no,layout,orientation,area,ref_rent,garbage_fee,water_rate,electric_rate,water_factor,electric_factor,status,available_date,remark)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.property_id, String(b.room_no), b.layout || '', b.orientation || '', b.area || 0,
    b.ref_rent || 0, b.garbage_fee || 0, b.water_rate || 0, b.electric_rate || 0,
    b.water_factor || 1, b.electric_factor || 1, b.status || 'vacant', b.available_date || '', b.remark || '');
  res.json({ id: info.lastInsertRowid });
});

// 取房间所属项目并校验权限
function roomProjectId(id) {
  const row = db.prepare('SELECT property_id FROM rooms WHERE id=?').get(id);
  return row ? row.property_id : null;
}

r.put('/:id', auth, (req, res) => {
  const pid = roomProjectId(req.params.id);
  if (!pid) return res.status(404).json({ error: '房间不存在' });
  if (!canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  const b = req.body || {};
  // 前置条件：存在正常（在租）合同时，房间状态完全锁定，不允许任何变更
  if (b.status) {
    const active = db.prepare("SELECT COUNT(*) c FROM contracts WHERE room_id=? AND status='active'").get(req.params.id).c;
    const old = db.prepare('SELECT status FROM rooms WHERE id=?').get(req.params.id);
    if (active > 0 && old && old.status !== b.status) {
      return res.status(400).json({ error: `该房间存在 ${active} 份正常（在租）合同，合同生效期间房间状态不可变更` });
    }
  }
  db.prepare(`
    UPDATE rooms SET room_no=?,layout=?,orientation=?,area=?,ref_rent=?,garbage_fee=?,water_rate=?,electric_rate=?,water_factor=?,electric_factor=?,status=?,available_date=?,remark=? WHERE id=?`).run(
    b.room_no, b.layout || '', b.orientation || '', b.area || 0, b.ref_rent || 0, b.garbage_fee || 0,
    b.water_rate || 0, b.electric_rate || 0, b.water_factor || 1, b.electric_factor || 1,
    b.status || 'vacant', b.available_date || '', b.remark || '', req.params.id);
  res.json({ ok: true });
});

r.delete('/:id', auth, (req, res) => {
  const pid = roomProjectId(req.params.id);
  if (!pid) return res.status(404).json({ error: '房间不存在' });
  if (!canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  const n = db.prepare("SELECT COUNT(*) c FROM contracts WHERE room_id=? AND status='active'").get(req.params.id).c;
  if (n > 0) return res.status(400).json({ error: `该房间存在 ${n} 份正常（在租）合同，请先退房或作废合同后再删除` });
  const cleaned = db.transaction(() => {
    const contracts = db.prepare('SELECT id FROM contracts WHERE room_id=?').all(req.params.id).map(x => x.id);
    let bills = [];
    if (contracts.length) {
      bills = db.prepare(`SELECT id FROM bills WHERE contract_id IN (${contracts.map(() => '?').join(',')})`).all(...contracts).map(x => x.id);
    }
    if (bills.length) db.prepare(`DELETE FROM bill_items WHERE bill_id IN (${bills.map(() => '?').join(',')})`).run(...bills);
    if (bills.length) db.prepare(`DELETE FROM payments WHERE bill_id IN (${bills.map(() => '?').join(',')})`).run(...bills);
    if (contracts.length) db.prepare(`DELETE FROM refunds WHERE contract_id IN (${contracts.map(() => '?').join(',')})`).run(...contracts);
    if (bills.length) db.prepare(`DELETE FROM bills WHERE id IN (${bills.map(() => '?').join(',')})`).run(...bills);
    if (contracts.length) db.prepare(`DELETE FROM contracts WHERE id IN (${contracts.map(() => '?').join(',')})`).run(...contracts);
    db.prepare('DELETE FROM meter_readings WHERE room_id=?').run(req.params.id);
    db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
    return { contracts: contracts.length, bills: bills.length };
  })();
  res.json({ ok: true, cleaned });
});

export default r;
