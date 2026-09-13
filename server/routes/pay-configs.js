import { Router } from 'express';
import { db } from '../db.js';
import { auth, canAccessProject } from '../middleware/auth.js';

const r = Router();
r.use(auth);

// 敏感字段不返回明文
function clean(row) {
  if (!row) return row;
  const c = { ...row };
  c.apiv3_key_set = !!c.apiv3_key;
  c.private_key_set = !!c.private_key;
  delete c.apiv3_key;
  delete c.private_key;
  return c;
}

// 可查看范围：主管理员全部；操作员 = 自己创建的 + 被管理员授权的
function scopeCond(req) {
  if (req.user.role === 'admin') return { cond: '', args: [] };
  return {
    cond: ' WHERE pc.created_by=? OR pc.id IN (SELECT config_id FROM payment_config_access WHERE admin_user_id=?)',
    args: [req.user.id, req.user.id]
  };
}

// 操作员是否可管理（编辑/删除）该配置：仅自己创建的
function canManage(req, cfg) {
  return req.user.role === 'admin' || cfg.created_by === req.user.id;
}

// 校验操作员授权 id 列表（仅主管理员可用；只允许操作员角色）
function resolveOperators(req, ids) {
  const list = [...new Set((ids || []).map(Number).filter((n) => n > 0))];
  if (!list.length) return { list: [] };
  const rows = db.prepare(`SELECT id FROM admin_users WHERE role='operator' AND status=1 AND id IN (${list.map(() => '?').join(',')})`).all(...list);
  return { list: rows.map((x) => x.id) };
}

// 配置列表（含绑定项目、授权操作员）
r.get('/', (req, res) => {
  const { cond, args } = scopeCond(req);
  const rows = db.prepare(`SELECT pc.*, (SELECT COALESCE(display_name, username, '') FROM admin_users au WHERE au.id=pc.created_by) created_by_name
    FROM payment_configs pc${cond} ORDER BY pc.id`).all(...args);
  const binds = db.prepare('SELECT config_id, property_id FROM payment_config_bindings').all();
  const byCfg = {};
  for (const b of binds) (byCfg[b.config_id] ||= []).push(b.property_id);
  const acc = db.prepare('SELECT config_id, admin_user_id FROM payment_config_access').all();
  const byAcc = {};
  for (const a of acc) (byAcc[a.config_id] ||= []).push(a.admin_user_id);
  for (let i = 0; i < rows.length; i++) {
    rows[i].property_ids = byCfg[rows[i].id] || [];
    rows[i].operator_ids = byAcc[rows[i].id] || [];
    // 操作员视角标记：自己创建 vs 被授权共享
    if (req.user.role !== 'admin') rows[i].shared = rows[i].created_by !== req.user.id;
    rows[i] = clean(rows[i]);
  }
  res.json(rows);
});

// 校验并返回可绑定项目列表（过滤冲突：已被其他配置绑定）
function resolveProps(req, props, excludeId) {
  const pids = [...new Set(props.map(Number).filter((n) => n > 0))];
  for (const pid of pids) {
    if (!canAccessProject(req, pid)) return { error: `项目 #${pid} 不在你的权限内` };
  }
  if (pids.length) {
    const ph = pids.map(() => '?').join(',');
    const q = `SELECT property_id FROM payment_config_bindings WHERE property_id IN (${ph})`;
    const clash = excludeId ? db.prepare(`${q} AND config_id<>?`).all(...pids, excludeId) : db.prepare(q).all(...pids);
    if (clash.length) return { error: `项目 #${clash.map((x) => x.property_id).join('、#')} 已绑定其他支付配置` };
  }
  return { pids };
}

// 创建配置（可勾选绑定项目；主管理员可授权给操作员）
r.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '配置名称必填' });
  if (!b.mchid || !String(b.mchid).trim()) return res.status(400).json({ error: '微信支付商户号必填' });
  const check = resolveProps(req, Array.isArray(b.property_ids) ? b.property_ids : [], 0);
  if (check.error) return res.status(400).json({ error: check.error });
  const createdBy = req.user.role === 'admin' ? 0 : req.user.id;
  const scope = req.user.role === 'admin' ? 'global' : 'operator';
  const ops = req.user.role === 'admin' ? resolveOperators(req, b.operator_ids) : { list: [] };
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO payment_configs (name, mchid, apiv3_key, serial_no, private_key, notify_url, appid, scope, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(String(b.name).trim(), String(b.mchid).trim(),
        b.apiv3_key ? String(b.apiv3_key) : '',
        b.serial_no ? String(b.serial_no) : '',
        b.private_key ? String(b.private_key) : '',
        b.notify_url ? String(b.notify_url) : '',
        b.appid ? String(b.appid) : '',
        scope, createdBy);
    const ins = db.prepare('INSERT OR IGNORE INTO payment_config_bindings (config_id, property_id) VALUES (?,?)');
    for (const pid of check.pids) ins.run(info.lastInsertRowid, pid);
    const insAcc = db.prepare('INSERT OR IGNORE INTO payment_config_access (config_id, admin_user_id) VALUES (?,?)');
    for (const op of ops.list) insAcc.run(info.lastInsertRowid, op);
    return info.lastInsertRowid;
  });
  res.json({ id: tx() });
});

// 项目生效配置（供支付对接）：绑定优先，无绑定回退全局默认配置
r.get('/effective', (req, res) => {
  const pid = Number(req.query.property_id);
  let cfg = null;
  if (pid > 0) {
    const b = db.prepare('SELECT config_id FROM payment_config_bindings WHERE property_id=?').get(pid);
    if (b) cfg = db.prepare('SELECT id, name, mchid, apiv3_key, serial_no, private_key, notify_url, appid FROM payment_configs WHERE id=? AND status=1').get(b.config_id);
  }
  if (!cfg) {
    const get = (k) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value || '';
    const mchid = get('wechat_pay_mchid');
    if (mchid) {
      cfg = { id: 0, name: '默认支付配置', mchid, apiv3_key: get('wechat_pay_apiv3_key'), serial_no: get('wechat_pay_serial_no'), private_key: get('wechat_pay_private_key'), notify_url: get('wechat_pay_notify_url'), appid: get('wechat_mini_appid') };
    }
  }
  res.json({ property_id: pid, config: cfg });
});

// 配置详情
r.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM payment_configs WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '配置不存在' });
  const visible = req.user.role === 'admin' || c.created_by === req.user.id ||
    db.prepare('SELECT COUNT(*) c FROM payment_config_access WHERE config_id=? AND admin_user_id=?').get(req.params.id, req.user.id).c > 0;
  if (!visible) return res.status(403).json({ error: '无权查看该配置' });
  c.property_ids = db.prepare('SELECT property_id FROM payment_config_bindings WHERE config_id=?').all(req.params.id).map((x) => x.property_id);
  c.operator_ids = db.prepare('SELECT admin_user_id FROM payment_config_access WHERE config_id=?').all(req.params.id).map((x) => x.admin_user_id);
  res.json(clean(c));
});

// 编辑配置（含绑定项目、授权操作员全量替换）
r.put('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM payment_configs WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '配置不存在' });
  if (!canManage(req, c)) return res.status(403).json({ error: '该配置由主管理员分配，仅可查看，不可修改' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: '配置名称不能为空' });
  if (b.mchid !== undefined && !String(b.mchid).trim()) return res.status(400).json({ error: '商户号不能为空' });
  let props = null;
  if (b.property_ids !== undefined) {
    const check = resolveProps(req, b.property_ids, c.id);
    if (check.error) return res.status(400).json({ error: check.error });
    props = check.pids;
  }
  const ops = req.user.role === 'admin' && b.operator_ids !== undefined ? resolveOperators(req, b.operator_ids) : null;
  const tx = db.transaction(() => {
    db.prepare('UPDATE payment_configs SET name=?, mchid=?, serial_no=?, notify_url=?, appid=? WHERE id=?')
      .run(b.name !== undefined ? String(b.name).trim() : c.name,
        b.mchid !== undefined ? String(b.mchid).trim() : c.mchid,
        b.serial_no !== undefined ? String(b.serial_no) : (c.serial_no || ''),
        b.notify_url !== undefined ? String(b.notify_url) : (c.notify_url || ''),
        b.appid !== undefined ? String(b.appid) : (c.appid || ''),
        c.id);
    if (b.apiv3_key) db.prepare('UPDATE payment_configs SET apiv3_key=? WHERE id=?').run(String(b.apiv3_key), c.id);
    if (b.private_key) db.prepare('UPDATE payment_configs SET private_key=? WHERE id=?').run(String(b.private_key), c.id);
    if (props) {
      db.prepare('DELETE FROM payment_config_bindings WHERE config_id=?').run(c.id);
      const ins = db.prepare('INSERT OR IGNORE INTO payment_config_bindings (config_id, property_id) VALUES (?,?)');
      for (const pid of props) ins.run(c.id, pid);
    }
    if (ops) {
      db.prepare('DELETE FROM payment_config_access WHERE config_id=?').run(c.id);
      const insAcc = db.prepare('INSERT OR IGNORE INTO payment_config_access (config_id, admin_user_id) VALUES (?,?)');
      for (const op of ops.list) insAcc.run(c.id, op);
    }
  });
  tx();
  res.json({ ok: true });
});

// 删除配置（解除全部项目绑定与操作员授权）
r.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM payment_configs WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '配置不存在' });
  if (!canManage(req, c)) return res.status(403).json({ error: '该配置由主管理员分配，不可删除' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM payment_config_bindings WHERE config_id=?').run(c.id);
    db.prepare('DELETE FROM payment_config_access WHERE config_id=?').run(c.id);
    db.prepare('DELETE FROM payment_configs WHERE id=?').run(c.id);
  });
  tx();
  res.json({ ok: true });
});

export default r;
