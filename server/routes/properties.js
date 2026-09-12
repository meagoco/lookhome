import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 项目列表（操作员仅见被授权/自建项目）
r.get('/', auth, (req, res) => {
  let cond = '', args = [];
  if (req.user.role !== 'admin') {
    cond = ' AND p.id IN (SELECT property_id FROM property_grants WHERE admin_user_id=?)';
    args = [req.user.id];
  }
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM rooms r WHERE r.property_id=p.id) room_count,
      (SELECT COUNT(*) FROM rooms r WHERE r.property_id=p.id AND r.status='vacant') vacant_count
    FROM properties p WHERE 1=1${cond} ORDER BY p.id DESC`).all(...args);
  res.json(rows);
});

r.post('/', auth, (req, res) => {
  const { name, address, type, remark } = req.body || {};
  if (!name) return res.status(400).json({ error: '项目名必填' });
  const info = db.prepare('INSERT INTO properties (name,address,type,remark) VALUES (?,?,?,?)')
    .run(String(name), address || '', type || 'centralized', remark || '');
  // 操作员自建项目自动授权给自己
  if (req.user.role !== 'admin') {
    db.prepare('INSERT OR IGNORE INTO property_grants (admin_user_id, property_id) VALUES (?,?)')
      .run(req.user.id, info.lastInsertRowid);
  }
  res.json({ id: info.lastInsertRowid });
});

r.put('/:id', auth, (req, res) => {
  if (!canAccessProject(req, req.params.id)) return res.status(403).json({ error: '无权操作该项目' });
  const { name, address, type, remark } = req.body || {};
  db.prepare('UPDATE properties SET name=?,address=?,type=?,remark=? WHERE id=?')
    .run(name || '', address || '', type || 'centralized', remark || '', req.params.id);
  res.json({ ok: true });
});

r.delete('/:id', auth, (req, res) => {
  if (!canAccessProject(req, req.params.id)) return res.status(403).json({ error: '无权操作该项目' });
  const n = db.prepare('SELECT COUNT(*) c FROM rooms WHERE property_id=?').get(req.params.id).c;
  if (n > 0) return res.status(400).json({ error: `该项目下还有 ${n} 个房间，请先处理` });
  db.prepare('DELETE FROM properties WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
