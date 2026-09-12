import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { auth, adminOnly } from '../middleware/auth.js';

const r = Router();
r.use(auth, adminOnly);

// 后台用户列表（含授权项目数）
r.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, email, display_name, role, status, created_at,
      (SELECT COUNT(*) FROM property_grants g WHERE g.admin_user_id=admin_users.id) grant_count
    FROM admin_users ORDER BY id`).all();
  res.json(rows);
});

// 新增后台用户（默认操作员，可指定管理员）
r.post('/', (req, res) => {
  const { username, password, display_name, role, email } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(String(username))) return res.status(400).json({ error: '用户名需为 3-20 位字母数字下划线' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: '邮箱格式不正确' });
  const exist = db.prepare('SELECT id FROM admin_users WHERE username=?').get(String(username));
  if (exist) return res.status(400).json({ error: '用户名已存在' });
  const info = db.prepare('INSERT INTO admin_users (username, password_hash, display_name, role, email) VALUES (?,?,?,?,?)')
    .run(String(username), bcrypt.hashSync(String(password), 10), display_name || String(username), role === 'admin' ? 'admin' : 'operator', email ? String(email) : '');
  res.json({ id: info.lastInsertRowid });
});

// 用户详情（含已授权项目）
r.get('/:id', (req, res) => {
  const u = db.prepare('SELECT id, username, email, display_name, role, status FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  u.granted = db.prepare('SELECT property_id FROM property_grants WHERE admin_user_id=?').all(req.params.id).map(x => x.property_id);
  res.json(u);
});

// 修改用户（用户名/显示名/角色/状态/密码）
r.put('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const b = req.body || {};
  if (Number(req.params.id) === req.user.id && b.status === 0) return res.status(400).json({ error: '不能停用自己' });
  if (u.role === 'admin' && b.role && b.role !== 'admin' && Number(req.params.id) !== req.user.id) {
    // 允许降级其他管理员？保守：禁止变更 admin 角色
    return res.status(400).json({ error: '主管理员角色不可变更' });
  }
  if (b.username !== undefined && String(b.username) !== u.username) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(String(b.username))) return res.status(400).json({ error: '用户名需为 3-20 位字母数字下划线' });
    const exist = db.prepare('SELECT id FROM admin_users WHERE username=?').get(String(b.username));
    if (exist) return res.status(400).json({ error: '用户名已存在' });
  }
  if (b.email !== undefined && b.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return res.status(400).json({ error: '邮箱格式不正确' });
  db.prepare('UPDATE admin_users SET username=?, display_name=?, role=?, status=?, email=? WHERE id=?')
    .run(b.username !== undefined ? String(b.username) : u.username,
      b.display_name !== undefined ? b.display_name : u.display_name,
      b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'operator') : u.role,
      b.status !== undefined ? Number(b.status) : u.status,
      b.email !== undefined ? String(b.email) : (u.email || ''),
      req.params.id);
  if (b.password && String(b.password).length >= 6) {
    db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(b.password), 10), req.params.id);
  }
  res.json({ ok: true });
});

// 设置授权项目（全量替换）
r.put('/:id/grants', (req, res) => {
  const u = db.prepare('SELECT id FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const ids = Array.isArray((req.body || {}).property_ids) ? (req.body.property_ids.map(Number).filter(n => n > 0)) : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM property_grants WHERE admin_user_id=?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO property_grants (admin_user_id, property_id) VALUES (?,?)');
    for (const pid of ids) ins.run(req.params.id, pid);
  });
  tx();
  res.json({ ok: true, granted: ids.length });
});

// 删除用户（不能删自己、不能删主管理员）
r.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.role === 'admin') return res.status(400).json({ error: '不能删除主管理员' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM property_grants WHERE admin_user_id=?').run(req.params.id);
    db.prepare('DELETE FROM admin_users WHERE id=?').run(req.params.id);
  });
  tx();
  res.json({ ok: true });
});

export default r;
