import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 收款记录（操作员仅见授权项目）
r.get('/', auth, (req, res) => {
  const { confirm_status } = req.query;
  const { cond, args } = grantedScope(req, 'r');
  let sql = `
    SELECT pm.*, b.period, b.title AS bill_title, b.bill_type, t.name AS tenant_name, r.room_no,
      a.display_name AS confirmed_by_name
    FROM payments pm
    JOIN bills b ON b.id=pm.bill_id
    JOIN tenants t ON t.id=pm.tenant_id
    JOIN rooms r ON r.id=b.room_id
    LEFT JOIN admin_users a ON a.id=pm.confirmed_by WHERE 1=1${cond}`;
  if (confirm_status && confirm_status !== 'all') { sql += ' AND pm.confirm_status=?'; args.push(confirm_status); }
  sql += ' ORDER BY pm.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});

// 待确认收款（微信回调自动确认后一般无待确认；手工模式直接确认）
r.get('/pending', auth, (req, res) => {
  const { cond, args } = grantedScope(req, 'r');
  const rows = db.prepare(`
    SELECT pm.*, b.title AS bill_title, t.name AS tenant_name, r.room_no
    FROM payments pm JOIN bills b ON b.id=pm.bill_id JOIN tenants t ON t.id=pm.tenant_id JOIN rooms r ON r.id=b.room_id
    WHERE pm.confirm_status='pending'${cond} ORDER BY pm.id DESC`).all(...args);
  res.json(rows);
});

// 确认/驳回
r.post('/:id/:action', auth, (req, res) => {
  const action = req.params.action;
  if (!['confirm', 'reject'].includes(action)) return res.status(400).json({ error: '参数错误' });
  const pm = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!pm) return res.status(404).json({ error: '记录不存在' });
  const b = db.prepare('SELECT * FROM bills WHERE id=?').get(pm.bill_id);
  if (b && !canAccessProject(req, b.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  const newStatus = action === 'confirm' ? 'confirmed' : 'rejected';
  db.prepare(`UPDATE payments SET confirm_status=?, confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?`)
    .run(newStatus, req.user.id, req.params.id);
  if (newStatus === 'confirmed') {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE bill_id=? AND confirm_status='confirmed'`).get(pm.bill_id).v;
    if (b && paid >= b.total - 0.001) db.prepare(`UPDATE bills SET status='paid', paid_at=datetime('now','localtime') WHERE id=?`).run(b.id);
  }
  res.json({ ok: true });
});

export default r;
