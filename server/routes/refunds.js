import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

function refundRoomProperty(req, contractId) {
  const c = db.prepare('SELECT room_id FROM contracts WHERE id=?').get(contractId);
  if (!c) return null;
  const room = db.prepare('SELECT property_id FROM rooms WHERE id=?').get(c.room_id);
  return room ? room.property_id : null;
}

// 后台直接退押金（全额/部分，立即完成）
r.post('/', auth, (req, res) => {
  const { contract_id, amount, remark } = req.body || {};
  if (!contract_id || !(amount > 0)) return res.status(400).json({ error: '参数错误' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(contract_id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const pid = refundRoomProperty(req, contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  if (Number(amount) > c.deposit) return res.status(400).json({ error: `退款不能超过押金 ${c.deposit} 元` });
  const paySetting = (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_mchid'`).get() || {}).value;
  const refundMode = paySetting ? 'wechat' : 'manual'; // 预留：配了商户号走原路退回
  const info = db.prepare(`
    INSERT INTO refunds (contract_id,payment_id,tenant_id,amount,refund_mode,source,status,remark,done_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
    .run(contract_id, null, c.tenant_id, Number(amount), refundMode, 'admin', 'done', remark || '');
  res.json({ id: info.lastInsertRowid, refund_mode: refundMode, notice: refundMode === 'manual' ? '已记录手工退款，请线下转账并在支付记录中登记' : '已发起微信原路退回' });
});

// 后台同意退押金：押金退后自动解除合同、房源改为空置
r.post('/:id/approve', auth, (req, res) => {
  const { id } = req.params;
  const rf = db.prepare('SELECT * FROM refunds WHERE id=?').get(id);
  if (!rf) return res.status(404).json({ error: '退款记录不存在' });
  if (rf.status !== 'pending') return res.status(400).json({ error: `该申请当前状态为「${rf.status}」，不可重复审批` });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(rf.contract_id);
  if (!c) return res.status(404).json({ error: '关联合同不存在' });
  const pid = refundRoomProperty(req, rf.contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  if (c.status !== 'active') return res.status(400).json({ error: '该合同已解约/作废，无法随退押金自动解除' });
  const note = (req.body?.note || '').toString().slice(0, 200);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE refunds SET status='done', done_at=datetime('now','localtime'), remark=? WHERE id=?`)
      .run(note || rf.remark || '', id);
    db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime') WHERE id=?`).run(rf.contract_id);
    db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
  });
  tx();
  res.json({ ok: true, notice: '已同意退押金：合同已解除，房间已改为空置' });
});

// 后台驳回退押金申请
r.post('/:id/reject', auth, (req, res) => {
  const { id } = req.params;
  const rf = db.prepare('SELECT * FROM refunds WHERE id=?').get(id);
  if (!rf) return res.status(404).json({ error: '退款记录不存在' });
  if (rf.status !== 'pending') return res.status(400).json({ error: `该申请当前状态为「${rf.status}」，不可重复审批` });
  const pid = refundRoomProperty(req, rf.contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  const reason = (req.body?.reason || '').toString().slice(0, 200);
  if (!reason) return res.status(400).json({ error: '请填写驳回原因' });
  db.prepare(`UPDATE refunds SET status='rejected', remark=? WHERE id=?`).run(reason, id);
  res.json({ ok: true, notice: '已驳回该退押金申请' });
});

// 退款列表（操作员仅见授权项目）
r.get('/', auth, (req, res) => {
  const { cond, args } = grantedScope(req, 'r');
  const rows = db.prepare(`
    SELECT rf.*, t.name AS tenant_name, r.room_no, p.name AS property_name, c.monthly_rent
    FROM refunds rf
    JOIN contracts c ON c.id=rf.contract_id
    JOIN tenants t ON t.id=c.tenant_id
    JOIN rooms r ON r.id=c.room_id
    JOIN properties p ON p.id=r.property_id
    WHERE 1=1${cond}
    ORDER BY rf.id DESC LIMIT 300`).all(...args);
  res.json(rows);
});

export default r;
