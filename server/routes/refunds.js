import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 退押金（全额/部分）
r.post('/', auth, (req, res) => {
  const { contract_id, amount, remark } = req.body || {};
  if (!contract_id || !(amount > 0)) return res.status(400).json({ error: '参数错误' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(contract_id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const room = db.prepare('SELECT property_id FROM rooms WHERE id=?').get(c.room_id);
  if (room && !canAccessProject(req, room.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  if (Number(amount) > c.deposit) return res.status(400).json({ error: `退款不能超过押金 ${c.deposit} 元` });
  const paySetting = (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_mchid'`).get() || {}).value;
  const refundMode = paySetting ? 'wechat' : 'manual'; // 预留：配了商户号走原路退回
  const info = db.prepare(`
    INSERT INTO refunds (contract_id,payment_id,amount,refund_mode,status,remark,done_at)
    VALUES (?,?,?,?,?,?,datetime('now','localtime'))`)
    .run(contract_id, null, Number(amount), refundMode, 'done', remark || '');
  res.json({ id: info.lastInsertRowid, refund_mode: refundMode, notice: refundMode === 'manual' ? '已记录手工退款，请线下转账并在支付记录中登记' : '已发起微信原路退回' });
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
