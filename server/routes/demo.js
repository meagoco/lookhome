import { Router } from 'express';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ===== LookHome · 测试沙箱 v3（纯展示用）=====
// 内存 sqlite（:memory:）+ 生产 schema + 虚构种子数据。
// 真实管理后台在「演示模式」下全部 API 走本沙箱，界面与正式一致，但操作不落生产库、不产生实际效果。
// 与小程序测试（/api/demo/data）联动：同一内存库，双向可见。
// 按来源 IP 隔离：IP 变化 → 新沙箱（默认数据）；IP 不变 → 保留该 IP 改动。
// 每日自动清除 + 总占用超上限（默认 500MB）自动清除。登录默认 admin / admin123（仅演示）。

const r = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
const MAX_DEMO_BYTES = (process.env.DEMO_MAX_MB ? Number(process.env.DEMO_MAX_MB) : 500) * 1024 * 1024;
const EST_DB_BYTES = 96 * 1024; // 每个沙箱库估算占用（含 WAL/共享内存，实际远小于此）

const stores = new Map();  // ip -> { db, bytes }
const tokens = new Map();  // token -> ip
let totalBytes = 0;
let lastCleanDate = todayStr();

function todayStr() { return new Date().toISOString().slice(0, 10); }
const clone = (o) => JSON.parse(JSON.stringify(o));

function cleanAll(reason) {
  for (const s of stores.values()) { try { s.db.close(); } catch { /* 忽略 */ } }
  stores.clear();
  tokens.clear();
  totalBytes = 0;
  console.log(`[demo] 测试沙箱已清除（${reason}）`);
}
function dailyCheck() {
  const now = todayStr();
  if (now !== lastCleanDate) { lastCleanDate = now; cleanAll('每日定时清除'); }
}
function sizeCheck() {
  if (totalBytes > MAX_DEMO_BYTES) cleanAll(`超出 ${Math.round(MAX_DEMO_BYTES / 1048576)}MB 上限`);
}

// ---------- 种子数据（虚构） ----------
function seed(db) {
  db.prepare('INSERT INTO admin_users (username, password_hash, display_name, role) VALUES (?,?,?,?)')
    .run('admin', bcrypt.hashSync('admin123', 10), '演示管理员', 'admin');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('site_name', 'LookHome');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('site_phone', '138 0013 8000');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('realname_verify_mode', 'manual');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('payment_confirm_mode', 'manual');
  const fees = [['rent','租金',1,1,0],['deposit','押金',1,0,0],['water','水费',1,1,0],['electric','电费',1,1,0],['garbage','垃圾费',1,1,0],['property','物业费',1,1,0],['network','网费',1,1,0],['gas','燃气费',0,1,0],['other','其他',1,1,0]];
  const insFee = db.prepare('INSERT OR IGNORE INTO fee_types (code, name, enabled, is_bill_item, default_rate) VALUES (?,?,?,?,?)');
  for (const f of fees) insFee.run(...f);

  const props = [
    ['阳光公寓', '近地铁1号线', 'centralized', ''],
    ['云锦花园', '精装修', 'centralized', ''],
    ['梧桐里社区', '安静社区', 'centralized', '']
  ];
  const insProp = db.prepare('INSERT INTO properties (name, address, type, remark) VALUES (?,?,?,?)');
  const pids = props.map(p => insProp.run(...p).lastInsertRowid);

  const rooms = [
    [pids[0], '101', '一居室', 32, 1500, 20, 4, 0.9, 1, 1, 'vacant', '随时入住'],
    [pids[0], '102', '一居室', 35, 1600, 20, 4, 0.9, 1, 1, 'rented', ''],
    [pids[0], '103', '两居室', 58, 2400, 25, 4, 0.9, 1, 1, 'vacant', '9月20日'],
    [pids[0], '105', '一居室', 30, 1400, 20, 4, 0.9, 0, 1, 'rented', ''],
    [pids[1], '201', '一居室', 38, 1800, 20, 4.5, 1, 1, 1, 'vacant', '随时入住'],
    [pids[1], '202', '两居室', 62, 2800, 25, 4.5, 1, 1, 1, 'vacant', '10月1日'],
    [pids[1], '203', '一居室', 36, 1700, 20, 4.5, 1, 0, 1, 'rented', ''],
    [pids[2], '301', '单间', 22, 900, 15, 4, 0.85, 0, 0, 'vacant', '随时入住'],
    [pids[2], '302', '一居室', 28, 1100, 15, 4, 0.85, 1, 1, 'rented', ''],
    [pids[2], '303', '两居室', 55, 2200, 20, 4, 0.85, 1, 0, 'vacant', '9月25日']
  ];
  const insRoom = db.prepare('INSERT INTO rooms (property_id, room_no, layout, area, ref_rent, garbage_fee, water_rate, electric_rate, bathroom, window, status, available_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const rids = rooms.map(r => insRoom.run(...r).lastInsertRowid);

  db.prepare('INSERT INTO tenants (name, phone, id_card_enc, verify_status, verify_method, source, status) VALUES (?,?,?,?,?,?,?)')
    .run('张伟', '138****0000', '610102199001011234', 'approved', 'manual', 'admin', 1);
  const tid = 1;

  db.prepare('INSERT INTO contracts (tenant_id, room_id, start_date, end_date, monthly_rent, deposit, rent_cycle, pay_day, status, remark) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(tid, rids[1], '2026-08-01', '2027-08-31', 1600, 3200, 'monthly', 1, 'active', '演示合同');
  const cid = 1;

  // 押金账单（已缴）
  db.prepare('INSERT INTO bills (contract_id, tenant_id, room_id, period, bill_type, title, total, status) VALUES (?,?,?,?,?,?,?,?)')
    .run(cid, tid, rids[1], '2026-07', 'deposit', '押金（102）', 3200, 'paid');
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(1, 'deposit', '押金', 3200);
  // 8月账单（已缴）
  db.prepare('INSERT INTO bills (contract_id, tenant_id, room_id, period, bill_type, title, total, status, paid_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(cid, tid, rids[1], '2026-08', 'monthly', '2026-08 房租·水电·垃圾（102）', 1695, 'paid', '2026-08-12 09:00:00');
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(2, 'rent', '房租', 1600);
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(2, 'water', '水费', 48);
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(2, 'electric', '电费', 27);
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(2, 'garbage', '垃圾费', 20);
  // 9月账单（待缴 + 已提醒）
  db.prepare('INSERT INTO bills (contract_id, tenant_id, room_id, period, bill_type, title, total, status) VALUES (?,?,?,?,?,?,?,?)')
    .run(cid, tid, rids[1], '2026-09', 'monthly', '2026-09 房租·水电·垃圾（102）', 1726, 'unpaid');
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(3, 'rent', '房租', 1600);
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(3, 'water', '水费', 56);
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(3, 'electric', '电费', 50);
  db.prepare('INSERT INTO bill_items (bill_id, fee_code, fee_name, amount) VALUES (?,?,?,?)').run(3, 'garbage', '垃圾费', 20);
  db.prepare('INSERT INTO reminders (tenant_id, bill_id, room_id, kind, remind_type, title, content, status) VALUES (?,?,?,?,?,?,?,?)')
    .run(tid, 3, rids[1], 'manual', 'monthly', '账单提醒', '2026-09 房租水电即将到期', 'pending');
}

function newDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(SCHEMA);
  // 生产扩展表（schema.sql 未覆盖）：支付配置
  db.exec(`CREATE TABLE IF NOT EXISTS payment_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mchid TEXT NOT NULL,
      apiv3_key TEXT, serial_no TEXT, private_key TEXT, notify_url TEXT, appid TEXT,
      scope TEXT DEFAULT 'global', created_by INTEGER DEFAULT 0, status INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS payment_config_bindings (
      config_id INTEGER NOT NULL REFERENCES payment_configs(id),
      property_id INTEGER NOT NULL REFERENCES properties(id),
      PRIMARY KEY (config_id, property_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pcb_property ON payment_config_bindings(property_id);
    CREATE TABLE IF NOT EXISTS payment_config_access (
      config_id INTEGER NOT NULL REFERENCES payment_configs(id),
      admin_user_id INTEGER NOT NULL REFERENCES admin_users(id),
      PRIMARY KEY (config_id, admin_user_id)
    );`);
  seed(db);
  return db;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getStore(ip) {
  dailyCheck();
  let s = stores.get(ip);
  if (!s) {
    s = { db: newDb(), bytes: EST_DB_BYTES };
    stores.set(ip, s);
    totalBytes += EST_DB_BYTES;
  }
  return s;
}
function dropStore(ip) {
  const s = stores.get(ip);
  if (s) { try { s.db.close(); } catch { /* 忽略 */ } stores.delete(ip); totalBytes -= s.bytes; }
}

function demoAuth(req, res, next) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ip = clientIp(req);
  if (tokens.get(auth) !== ip) return res.status(401).json({ error: '测试登录已失效，请重新登录' });
  const s = getStore(ip);
  req.demoDb = s.db;
  req.demoIp = ip;
  next();
}

// ---------- 工具 ----------
const monthNow = () => new Date().toISOString().slice(0, 7);

// ---------- 登录 / 会话 ----------
r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== 'admin' || password !== 'admin123') return res.status(401).json({ error: '账号或密码错误（默认：admin / admin123）' });
  const ip = clientIp(req);
  getStore(ip);
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, ip);
  for (const [k, v] of tokens) if (v === ip && k !== token) tokens.delete(k);
  res.json({ token, notice: '测试登录成功（数据按 IP 隔离；每日自动清除，切换 IP 后自动重置为默认值）' });
});
r.get('/auth/me', demoAuth, (req, res) => {
  res.json({ id: 1, username: 'admin', display_name: '演示管理员', role: 'admin', email: '', created_at: new Date().toISOString().slice(0, 10) });
});
r.post('/auth/logout', demoAuth, (req, res) => {
  tokens.delete((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});
r.post('/reset', demoAuth, (req, res) => {
  dropStore(req.demoIp);
  res.json({ ok: true });
});

// ---------- 小程序测试视图（/data 组装 + 写回，与 sqlite 同源联动） ----------
r.get('/data', demoAuth, (req, res) => {
  const db = req.demoDb;
  const s = getStore(req.demoIp);
  const props = db.prepare('SELECT id, name, address AS tag FROM properties ORDER BY id').all();
  const rooms = db.prepare('SELECT id, property_id AS pid, room_no AS no, layout, area, ref_rent AS rent, garbage_fee AS garbage, water_rate AS water, electric_rate AS elec, bathroom, window, status, available_date AS avail FROM rooms ORDER BY id').all();
  const bills = db.prepare('SELECT id, period, title, total, status, bill_type AS dep FROM bills WHERE tenant_id=1 ORDER BY id DESC').all().map(b => ({ id: b.id, period: b.period, title: b.title, total: b.total, status: b.status, dep: b.dep === 'deposit', reminded: !!db.prepare('SELECT id FROM reminders WHERE bill_id=?').get(b.id), items: db.prepare('SELECT fee_name AS name, amount FROM bill_items WHERE bill_id=?').all(b.id).map(i => [i.name, i.amount]) }));
  const tenant = db.prepare(`SELECT t.name, t.phone, t.verify_status AS verify, r.room_no AS room, c.monthly_rent AS rent, c.deposit, c.end_date AS leaseEnd, p.name AS pname FROM tenants t JOIN contracts c ON c.tenant_id=t.id AND c.status='active' JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id WHERE t.id=1`).get() || { name: '张伟', verify: 'approved' };
  if (tenant.room) tenant.room = tenant.pname + ' · ' + tenant.room;
  const applications = db.prepare(`SELECT a.id, r.room_no AS no, p.name AS pname, a.expected_date AS date, a.status FROM lease_applications a JOIN rooms r ON r.id=a.room_id JOIN properties p ON p.id=r.property_id ORDER BY a.id DESC`).all().map(a => {
    const ex = (s.appsExtra || {})[a.pname + ' · ' + a.no + '室'] || {};
    return { room: a.pname + ' · ' + a.no + '室', date: a.date, status: a.status, rent: ex.rent, deposit: ex.deposit, leaseEnd: ex.leaseEnd };
  });
  const sub = s.sub || { on: false, used: false };
  res.json({ data: { site: { name: 'LookHome', phone: db.prepare(`SELECT value FROM settings WHERE key='site_phone'`).get()?.value || '' }, props, rooms, bills, tenant, applications, sub }, ip: req.demoIp });
});
r.put('/data', demoAuth, (req, res) => {
  const db = req.demoDb;
  const s = getStore(req.demoIp);
  const body = (req.body || {}).data;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: '数据格式不正确' });
  // 订阅演示状态（小程序测试：授权/已提醒标记，随沙箱每日清除）
  if (body.sub && typeof body.sub === 'object') {
    s.sub = { on: !!body.sub.on, used: !!body.sub.used, notified_at: body.sub.notified_at || '' };
  }
  // 房间同步（租金/状态）
  for (const r2 of body.rooms || []) {
    const ex = db.prepare('SELECT id FROM rooms WHERE id=?').get(r2.id);
    if (ex) db.prepare('UPDATE rooms SET ref_rent=?, status=?, available_date=? WHERE id=?').run(r2.rent, r2.status, r2.avail || '', r2.id);
  }
  // 账单状态同步
  for (const b of body.bills || []) {
    if (b.status === 'paid') db.prepare("UPDATE bills SET status='paid', paid_at=datetime('now','localtime') WHERE id=? AND status='unpaid'").run(b.id);
  }
  // 签约申请同步（新增 pending）
  for (const a of body.applications || []) {
    if (a.status !== 'pending') continue;
    s.appsExtra = s.appsExtra || {};
    s.appsExtra[a.room] = { rent: a.rent, deposit: a.deposit, leaseEnd: a.leaseEnd, date: a.date || '' };
    const room = db.prepare('SELECT r.id FROM rooms r JOIN properties p ON p.id=r.property_id WHERE p.name=? AND r.room_no=?').get(a.room.split(' · ')[0], a.room.split(' · ')[1].replace('室', ''));
    if (room) {
      const dup = db.prepare(`SELECT id FROM lease_applications WHERE room_id=? AND status='pending'`).get(room.id);
      if (!dup) db.prepare(`INSERT INTO lease_applications (tenant_id, room_id, tenant_name, tenant_phone, expected_date, status) VALUES (1,?,?,?,?,'pending')`).run(room.id, '张伟', '138****0000', a.date || '');
    }
  }
  sizeCheck();
  res.json({ ok: true });
});

// ---------- 管理后台接口（生产形态） ----------
// 房源项目
r.get('/properties', demoAuth, (req, res) => {
  const db = req.demoDb;
  res.json(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM rooms r WHERE r.property_id=p.id) room_count, (SELECT COUNT(*) FROM rooms r WHERE r.property_id=p.id AND r.status='vacant') vacant_count FROM properties p ORDER BY p.id DESC`).all());
});
r.post('/properties', demoAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '项目名必填' });
  const info = req.demoDb.prepare('INSERT INTO properties (name,address,type,remark) VALUES (?,?,?,?)').run(String(b.name), b.address || '', b.type || 'centralized', b.remark || '');
  res.json({ id: info.lastInsertRowid });
});
r.put('/properties/:id', demoAuth, (req, res) => {
  const b = req.body || {};
  req.demoDb.prepare('UPDATE properties SET name=?,address=?,type=?,remark=? WHERE id=?').run(b.name || '', b.address || '', b.type || 'centralized', b.remark || '', req.params.id);
  res.json({ ok: true });
});
r.delete('/properties/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const active = db.prepare("SELECT COUNT(*) c FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE r.property_id=? AND c.status='active'").get(req.params.id).c;
  if (active > 0) return res.status(400).json({ error: '存在生效合同，无法删除' });
  db.prepare('DELETE FROM rooms WHERE property_id=?').run(req.params.id);
  db.prepare('DELETE FROM properties WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 房间
r.get('/rooms', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { property_id, status } = req.query;
  let sql = `SELECT r.*, p.name AS property_name, (SELECT t.name FROM contracts c JOIN tenants t ON t.id=c.tenant_id WHERE c.room_id=r.id AND c.status='active') AS tenant_name FROM rooms r JOIN properties p ON p.id=r.property_id WHERE 1=1`;
  const args = [];
  if (property_id && property_id !== 'all' && property_id !== 'undefined') { sql += ' AND r.property_id=?'; args.push(Number(property_id)); }
  if (status && status !== 'all' && status !== 'undefined') { sql += ' AND r.status=?'; args.push(status); }
  sql += ' ORDER BY r.property_id DESC, r.room_no';
  const rows = db.prepare(sql).all(...args);
  const stat = db.prepare('SELECT r.status, COUNT(*) c FROM rooms r WHERE 1=1 GROUP BY r.status').all();
  res.json({ rows, stat });
});
r.post('/rooms', demoAuth, (req, res) => {
  const b = req.body || {};
  if (!b.property_id || !b.room_no) return res.status(400).json({ error: '项目与房号必填' });
  const info = req.demoDb.prepare(`INSERT INTO rooms (property_id,room_no,layout,area,ref_rent,deposit,bathroom,window,garbage_fee,water_rate,electric_rate,water_factor,electric_factor,status,available_date,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.property_id, String(b.room_no), b.layout || '', b.area || 0, b.ref_rent || 0, b.deposit || 0, b.bathroom ? 1 : 0, b.window ? 1 : 0, b.garbage_fee || 0, b.water_rate || 0, b.electric_rate || 0, b.water_factor || 1, b.electric_factor || 1, b.status || 'vacant', b.available_date || '', b.remark || '');
  res.json({ id: info.lastInsertRowid });
});
r.put('/rooms/:id', demoAuth, (req, res) => {
  const b = req.body || {};
  req.demoDb.prepare(`UPDATE rooms SET room_no=?,layout=?,area=?,ref_rent=?,deposit=?,bathroom=?,window=?,garbage_fee=?,water_rate=?,electric_rate=?,water_factor=?,electric_factor=?,status=?,available_date=?,remark=? WHERE id=?`).run(b.room_no, b.layout || '', b.area || 0, b.ref_rent || 0, b.deposit || 0, b.bathroom ? 1 : 0, b.window ? 1 : 0, b.garbage_fee || 0, b.water_rate || 0, b.electric_rate || 0, b.water_factor || 1, b.electric_factor || 1, b.status || 'vacant', b.available_date || '', b.remark || '', req.params.id);
  res.json({ ok: true });
});
r.delete('/rooms/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const active = db.prepare("SELECT COUNT(*) c FROM contracts WHERE room_id=? AND status='active'").get(req.params.id).c;
  if (active > 0) return res.status(400).json({ error: '存在生效合同，无法删除' });
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
r.get('/rooms/:id/history', demoAuth, (req, res) => {
  const db = req.demoDb;
  res.json(db.prepare(`SELECT c.*, t.name AS tenant_name, t.phone AS tenant_phone, t.id_card_enc AS tenant_id_card, r.room_no, p.name AS property_name, (SELECT COALESCE(SUM(amount),0) FROM refunds rf WHERE rf.contract_id=c.id AND rf.status='done') AS refunded_amount FROM contracts c JOIN tenants t ON t.id=c.tenant_id JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id WHERE c.room_id=? ORDER BY c.id DESC`).all(req.params.id));
});

// 租客
r.get('/tenants', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { verify_status, kw } = req.query;
  let sql = `SELECT t.*, (SELECT c.room_id FROM contracts c WHERE c.tenant_id=t.id AND c.status='active' ORDER BY c.id DESC LIMIT 1) AS active_contract_id FROM tenants t WHERE 1=1`;
  const args = [];
  if (verify_status && verify_status !== 'all') { sql += ' AND t.verify_status=?'; args.push(verify_status); }
  if (kw) { sql += ' AND (t.name LIKE ? OR t.phone LIKE ? OR t.id_card_enc LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  sql += ' ORDER BY t.id DESC';
  const rows = db.prepare(sql).all(...args);
  for (const t of rows) {
    const c = db.prepare(`SELECT r.room_no, p.name AS property_name FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id WHERE c.tenant_id=? AND c.status='active' ORDER BY c.id DESC LIMIT 1`).get(t.id);
    if (c) { t.room_no = c.room_no; t.property_name = c.property_name; }
  }
  res.json(rows);
});
r.post('/tenants', demoAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '姓名必填' });
  const info = req.demoDb.prepare('INSERT INTO tenants (name,phone,id_card_enc,id_card_photo,verify_status,verify_method,remark) VALUES (?,?,?,?,?,?,?)').run(String(b.name), b.phone || '', b.id_card || '', b.id_card_photo || '', b.verify_status || 'approved', 'manual', b.remark || '');
  res.json({ id: info.lastInsertRowid });
});
r.get('/tenants/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '租客不存在' });
  res.json(t);
});
r.put('/tenants/:id', demoAuth, (req, res) => {
  const b = req.body || {};
  req.demoDb.prepare('UPDATE tenants SET name=?,phone=?,id_card_enc=?,id_card_photo=?,remark=? WHERE id=?').run(b.name || '', b.phone || '', b.id_card || '', b.id_card_photo || '', b.remark || '', req.params.id);
  res.json({ ok: true });
});
r.post('/tenants/:id/verify', demoAuth, (req, res) => {
  const { action } = req.body || {};
  if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: '参数错误' });
  req.demoDb.prepare(`UPDATE tenants SET verify_status=?, verify_remark=?, verify_method='manual', verified_at=datetime('now','localtime') WHERE id=?`).run(action, (req.body || {}).remark || '', req.params.id);
  res.json({ ok: true });
});
r.delete('/tenants/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const active = db.prepare("SELECT COUNT(*) c FROM contracts WHERE tenant_id=? AND status='active'").get(req.params.id).c;
  if (active > 0) return res.status(400).json({ error: '存在生效合同，先退房或作废合同后才能删除' });
  db.prepare('DELETE FROM tenants WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 合同
r.get('/contracts', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { status, kw } = req.query;
  let sql = `SELECT c.*, t.name AS tenant_name, t.phone AS tenant_phone, r.room_no, p.name AS property_name, (SELECT SUM(total) FROM bills b WHERE b.contract_id=c.id AND b.status IN ('unpaid','overdue')) AS unpaid_amount, (SELECT SUM(total) FROM bills b WHERE b.contract_id=c.id AND b.bill_type='deposit' AND b.status='paid') AS deposit_paid FROM contracts c JOIN tenants t ON t.id=c.tenant_id JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1`;
  const args = [];
  if (status && status !== 'all') { sql += ' AND c.status=?'; args.push(status); }
  if (kw) { sql += ' AND (t.name LIKE ? OR r.room_no LIKE ? OR p.name LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  sql += ' ORDER BY c.id DESC';
  res.json(db.prepare(sql).all(...args));
});
r.post('/contracts', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  if (!b.tenant_id || !b.room_id || !b.start_date || !b.end_date) return res.status(400).json({ error: '请选择租客和房间，并填写起止日期' });
  const active = db.prepare("SELECT COUNT(*) c FROM contracts WHERE room_id=? AND status='active'").get(b.room_id).c;
  if (active > 0) return res.status(400).json({ error: '该房间已有生效合同' });
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(b.room_id);
  if (!room || room.status === 'rented') return res.status(400).json({ error: '房间已在租' });
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO contracts (tenant_id,room_id,start_date,end_date,monthly_rent,deposit,rent_cycle,pay_day,remark) VALUES (?,?,?,?,?,?,?,?,?)').run(b.tenant_id, b.room_id, b.start_date, b.end_date, Number(b.monthly_rent), Number(b.deposit || 0), b.rent_cycle || 'monthly', b.pay_day || 1, b.remark || '');
    const cid = info.lastInsertRowid;
    db.prepare(`UPDATE rooms SET status='rented', available_date=? WHERE id=?`).run(b.end_date, b.room_id);
    if (Number(b.deposit) > 0) {
      const bi = db.prepare('INSERT INTO bills (contract_id,tenant_id,room_id,period,bill_type,title,total,status) VALUES (?,?,?,?,?,?,?,?)').run(cid, b.tenant_id, b.room_id, b.start_date.slice(0, 7), 'deposit', `押金（${room.room_no}）`, Number(b.deposit), 'unpaid');
      db.prepare('INSERT INTO bill_items (bill_id,fee_code,fee_name,amount) VALUES (?,?,?,?)').run(bi.lastInsertRowid, 'deposit', '押金', Number(b.deposit));
    }
    return cid;
  });
  res.json({ id: tx() });
});
r.put('/contracts/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const b = req.body || {};
  db.prepare('UPDATE contracts SET monthly_rent=?,deposit=?,end_date=?,rent_cycle=?,pay_day=?,remark=? WHERE id=?').run(b.monthly_rent !== undefined ? Number(b.monthly_rent) : c.monthly_rent, b.deposit !== undefined ? Number(b.deposit) : c.deposit, b.end_date || c.end_date, b.rent_cycle || c.rent_cycle, b.pay_day !== undefined ? Number(b.pay_day) : c.pay_day, b.remark !== undefined ? b.remark : c.remark, req.params.id);
  res.json({ ok: true });
});
r.post('/contracts/:id/checkout', demoAuth, (req, res) => {
  const db = req.demoDb;
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  db.prepare(`UPDATE contracts SET status='closed', ended_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
  db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
  res.json({ ok: true });
});
r.post('/contracts/:id/void', demoAuth, (req, res) => {
  const db = req.demoDb;
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  db.prepare(`UPDATE contracts SET status='void', ended_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
  db.prepare(`UPDATE rooms SET status='vacant' WHERE id=? AND status='rented'`).run(c.room_id);
  res.json({ ok: true });
});

// 账单
r.get('/bills', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { period, status, bill_type, kw, remind } = req.query;
  let sql = `SELECT b.*, t.name AS tenant_name, r.room_no, p.name AS property_name, (SELECT c.pay_day FROM contracts c WHERE c.id=b.contract_id) AS due, (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.bill_id=b.id AND pm.confirm_status='confirmed') AS paid_amount FROM bills b JOIN tenants t ON t.id=b.tenant_id JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1`;
  const args = [];
  if (period && period !== 'all') { sql += ' AND b.period=?'; args.push(period); }
  if (status && status !== 'all') { sql += ' AND b.status=?'; args.push(status); }
  if (bill_type && bill_type !== 'all') { sql += ' AND b.bill_type=?'; args.push(bill_type); }
  if (kw) { sql += ' AND (t.name LIKE ? OR r.room_no LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`); }
  if (remind === 'reminded') sql += ' AND EXISTS (SELECT 1 FROM reminders rm WHERE rm.bill_id=b.id)';
  if (remind === 'unreminded') sql += ' AND NOT EXISTS (SELECT 1 FROM reminders rm WHERE rm.bill_id=b.id)';
  sql += ' ORDER BY b.id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...args);
  const ids = rows.map(x => x.id);
  const rmMap = new Map();
  if (ids.length) {
    for (const rm of db.prepare(`SELECT * FROM reminders WHERE bill_id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`).all(...ids)) {
      if (!rmMap.has(rm.bill_id)) rmMap.set(rm.bill_id, { reminded: 1, kind: rm.kind, created_at: rm.created_at, status: rm.status });
    }
  }
  for (const row of rows) row.reminder = rmMap.get(row.id) || { reminded: 0 };
  const stat = db.prepare('SELECT b.status, COUNT(*) c, COALESCE(SUM(b.total),0) v FROM bills b GROUP BY b.status').all();
  res.json({ rows, stat });
});
r.get('/bills/stats', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { start, end } = req.query;
  const mStart = (start || '2026-09-01').slice(0, 7), mEnd = (end || '2026-09-30').slice(0, 7);
  const fees = db.prepare(`SELECT bi.fee_code code, bi.fee_name name, SUM(bi.amount) v FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.period BETWEEN ? AND ? AND b.status!='void' GROUP BY bi.fee_code`).all(mStart, mEnd);
  const feeTotal = fees.reduce((s, f) => s + f.v, 0);
  const trend = db.prepare(`SELECT period, SUM(total) v FROM bills WHERE period BETWEEN ? AND ? AND status!='void' GROUP BY period ORDER BY period`).all(mStart, mEnd);
  const income = db.prepare(`SELECT substr(paid_at,1,7) ym, SUM(total) v FROM bills WHERE status='paid' AND period BETWEEN ? AND ? GROUP BY ym`).all(mStart, mEnd).map(x => ({ period: x.ym, v: x.v }));
  res.json({ fees, fee_total: feeTotal, trend, income });
});
r.post('/bills/generate', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { period } = req.body || {};
  const p = period || monthNow();
  const actives = db.prepare("SELECT * FROM contracts WHERE status='active'").all();
  let n = 0;
  for (const c of actives) {
    const ex = db.prepare('SELECT id FROM bills WHERE contract_id=? AND period=? AND bill_type=?').get(c.id, p, 'monthly');
    if (!ex) {
      db.prepare('INSERT INTO bills (contract_id,tenant_id,room_id,period,bill_type,title,total,status) VALUES (?,?,?,?,?,?,?,?)').run(c.id, c.tenant_id, c.room_id, p, 'monthly', `${p} 房租·水电（${db.prepare('SELECT room_no FROM rooms WHERE id=?').get(c.room_id).room_no}）`, c.monthly_rent, 'unpaid');
      n++;
    }
  }
  res.json({ created: n });
});
r.post('/bills/readings', demoAuth, (req, res) => {
  const db = req.demoDb;
  const rows = (req.body || {}).rows || [];
  let n = 0;
  for (const rw of rows) {
    if (!rw.room_id) continue;
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(rw.room_id);
    if (!room) continue;
    for (const mt of ['water', 'electric']) {
      if (rw[mt] === undefined || rw[mt] === '' || rw[mt] === null) continue;
      const rate = mt === 'water' ? room.water_rate : room.electric_rate;
      const factor = mt === 'water' ? room.water_factor : room.electric_factor;
      const prev = db.prepare('SELECT curr_reading FROM meter_readings WHERE room_id=? AND meter_type=? ORDER BY id DESC LIMIT 1').get(rw.room_id, mt);
      const usage = Math.max(0, Number(rw[mt]) - (prev?.curr_reading || 0));
      const amount = Math.round(usage * rate * factor * 100) / 100;
      db.prepare('INSERT INTO meter_readings (room_id,meter_type,period,prev_reading,curr_reading,usage,amount) VALUES (?,?,?,?,?,?,?)').run(rw.room_id, mt, rw.period || monthNow(), prev?.curr_reading || 0, Number(rw[mt]), usage, amount);
      n++;
    }
  }
  res.json({ created: n });
});
r.get('/bills/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = db.prepare('SELECT * FROM bills WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '账单不存在' });
  b.items = db.prepare('SELECT * FROM bill_items WHERE bill_id=?').all(b.id);
  b.payments = db.prepare('SELECT * FROM payments WHERE bill_id=?').all(b.id);
  b.tenant_name = db.prepare('SELECT name FROM tenants WHERE id=?').get(b.tenant_id)?.name;
  b.room_no = db.prepare('SELECT room_no FROM rooms WHERE id=?').get(b.room_id)?.room_no;
  res.json(b);
});
r.post('/bills/:id/pay-manual', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = db.prepare('SELECT * FROM bills WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '账单不存在' });
  const amount = Number((req.body || {}).amount || b.total);
  db.prepare("INSERT INTO payments (bill_id, tenant_id, amount, pay_mode, confirm_status) VALUES (?,?,?,?,?)").run(b.id, b.tenant_id, amount, 'manual', 'confirmed');
  db.prepare(`UPDATE bills SET status='paid', paid_at=datetime('now','localtime') WHERE id=?`).run(b.id);
  res.json({ ok: true });
});
r.post('/bills/:id/void', demoAuth, (req, res) => {
  req.demoDb.prepare(`UPDATE bills SET status='void' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// 提醒（手动批量）
r.post('/reminders/manual', demoAuth, (req, res) => {
  const db = req.demoDb;
  const ids = (req.body || {}).bill_ids || [];
  let n = 0;
  for (const bid of ids) {
    const b = db.prepare('SELECT * FROM bills WHERE id=?').get(bid);
    if (!b) continue;
    const ex = db.prepare(`SELECT id FROM reminders WHERE bill_id=? AND kind='manual' AND status='pending'`).get(bid);
    if (ex) continue;
    db.prepare("INSERT INTO reminders (tenant_id,bill_id,room_id,kind,remind_type,title,content,status) VALUES (?,?,?,?,?,?,?,?)").run(b.tenant_id, bid, b.room_id, 'manual', 'monthly', '账单提醒', `${b.title} 待缴纳`, 'pending');
    n++;
  }
  res.json({ sent: n });
});

// 签约申请
r.get('/lease-applications', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { status } = req.query;
  let sql = `SELECT a.*, t.name AS tenant_name, t.phone AS tenant_phone, t.verify_status, r.room_no, r.area, r.ref_rent, p.name AS property_name FROM lease_applications a JOIN tenants t ON t.id=a.tenant_id JOIN rooms r ON r.id=a.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1`;
  const args = [];
  if (status && status !== 'all') { sql += ' AND a.status=?'; args.push(status); }
  sql += " ORDER BY (a.status='pending') DESC, a.id DESC";
  res.json(db.prepare(sql).all(...args));
});
r.post('/lease-applications/:id/approve', demoAuth, (req, res) => {
  const db = req.demoDb;
  const a = db.prepare('SELECT * FROM lease_applications WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: '申请不存在' });
  if (a.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(a.room_id);
  const b = req.body || {};
  if (!b.start_date || !b.end_date || !(Number(b.monthly_rent) > 0)) return res.status(400).json({ error: '请填写租期与月租金' });
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO contracts (tenant_id,room_id,start_date,end_date,monthly_rent,deposit,rent_cycle,pay_day,remark) VALUES (?,?,?,?,?,?,?,?,?)').run(a.tenant_id, a.room_id, b.start_date, b.end_date, Number(b.monthly_rent), Number(b.deposit || 0), b.rent_cycle || 'monthly', b.pay_day || 1, a.remark || '');
    db.prepare(`UPDATE rooms SET status='rented', available_date=? WHERE id=?`).run(b.end_date, a.room_id);
    if (Number(b.deposit) > 0) {
      const bi = db.prepare('INSERT INTO bills (contract_id,tenant_id,room_id,period,bill_type,title,total,status) VALUES (?,?,?,?,?,?,?,?)').run(info.lastInsertRowid, a.tenant_id, a.room_id, b.start_date.slice(0, 7), 'deposit', `押金（${room.room_no}）`, Number(b.deposit), 'unpaid');
      db.prepare('INSERT INTO bill_items (bill_id,fee_code,fee_name,amount) VALUES (?,?,?,?)').run(bi.lastInsertRowid, 'deposit', '押金', Number(b.deposit));
    }
    db.prepare(`UPDATE lease_applications SET status='approved', contract_id=?, handled_at=datetime('now','localtime') WHERE id=?`).run(info.lastInsertRowid, a.id);
  });
  tx();
  res.json({ ok: true, notice: '签约已通过，合同已生成' });
});
r.post('/lease-applications/:id/reject', demoAuth, (req, res) => {
  const reason = (req.body || {}).reason || '';
  req.demoDb.prepare(`UPDATE lease_applications SET status='rejected', reject_reason=?, handled_at=datetime('now','localtime') WHERE id=?`).run(reason, req.params.id);
  res.json({ ok: true });
});

// 仪表盘
r.get('/dashboard', demoAuth, (req, res) => {
  const db = req.demoDb;
  const m = monthNow();
  const start = (req.query.start || `${m}-01`).slice(0, 7);
  const end = (req.query.end || `${m}-31`).slice(0, 7);
  const q1 = db.prepare(`SELECT COALESCE(SUM(CASE WHEN b.status IN ('unpaid','overdue') THEN b.total ELSE 0 END),0) AS outstanding, COALESCE(SUM(CASE WHEN b.status='overdue' THEN b.total ELSE 0 END),0) AS overdue, COALESCE(SUM(CASE WHEN b.status='paid' THEN b.total ELSE 0 END),0) AS collected FROM bills b WHERE b.period BETWEEN ? AND ? AND b.status!='void'`).get(start, end);
  const rooms = db.prepare(`SELECT status, COUNT(*) c FROM rooms GROUP BY status`).all();
  const totalRooms = rooms.reduce((s, x) => s + x.c, 0);
  const rented = (rooms.find(x => x.status === 'rented') || {}).c || 0;
  const vacant = (rooms.find(x => x.status === 'vacant') || {}).c || 0;
  const pending = db.prepare(`SELECT COUNT(*) c FROM tenants WHERE verify_status='pending'`).get().c;
  const depositOwed = db.prepare(`SELECT COALESCE(SUM(c.deposit),0) v FROM contracts c WHERE c.status='active' AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.contract_id=c.id AND b.bill_type='deposit' AND b.status='paid')`).get().v;
  const trend = db.prepare(`SELECT substr(paid_at,1,7) ym, SUM(total) v FROM bills WHERE status='paid' AND period BETWEEN ? AND ? GROUP BY ym ORDER BY ym`).all(start, end).map(x => ({ period: x.ym, v: x.v }));
  res.json({
    outstanding: q1.outstanding, overdue: q1.overdue, collected: q1.collected,
    tenant_pending: pending, deposit_owed: depositOwed,
    rooms: { total: totalRooms, rent_rate: totalRooms ? Math.round(rented / totalRooms * 100) : 0, rented, vacant },
    trend
  });
});

// 设置（完整结构，演示沙箱读写）
r.get('/settings', demoAuth, (req, res) => {
  const db = req.demoDb;
  const v = (k) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value;
  res.json({
    site: { site_name: v('site_name') || 'LookHome', site_phone: v('site_phone') || '', site_logo: v('site_logo') || '', site_icp: v('site_icp') || '', site_url: v('site_url') || '' },
    switches: { realname_verify_mode: v('realname_verify_mode') || 'manual', payment_confirm_mode: v('payment_confirm_mode') || 'manual', lease_deposit_mode: v('lease_deposit_mode') || 'auto' },
    wechat_mini: { appid: v('wechat_mini_appid') || '', secret_set: !!v('wechat_mini_secret'), template_pay: v('wechat_template_pay') || '', template_rent: v('wechat_template_rent') || '' },
    wechat_pay: { mchid: v('wechat_pay_mchid') || '', apiv3_key_set: !!v('wechat_pay_apiv3_key'), serial_no_set: !!v('wechat_pay_serial_no'), private_key_set: !!v('wechat_pay_private_key') },
    backup: { remote_type: v('backup_remote_type') || 's3', auto_enabled: v('backup_auto_enabled') || '0', auto_interval_hours: v('backup_auto_interval_hours') || '24', auto_remote: v('backup_auto_remote') || '0', keep: v('backup_keep') || '10',
      s3: { bucket: v('backup_cos_bucket') || '', region: v('backup_cos_region') || '', secret_id: v('backup_cos_secret_id') || '', secret_key_set: !!v('backup_cos_secret_key'), prefix: v('backup_cos_prefix') || '' },
      ftp: { host: v('backup_ftp_host') || '', port: v('backup_ftp_port') || '21', user: v('backup_ftp_user') || '', pass_set: !!v('backup_ftp_pass'), path: v('backup_ftp_path') || '' },
      webdav: { url: v('backup_webdav_url') || '', user: v('backup_webdav_user') || '', pass_set: !!v('backup_webdav_pass'), path: v('backup_webdav_path') || '' },
      onedrive: { client_id: v('backup_od_client_id') || '', client_secret_set: !!v('backup_od_client_secret'), folder: v('backup_od_folder') || '' } },
    tencent: { secret_id: v('tencent_secret_id') || '', secret_key_set: !!v('tencent_secret_key') },
    smtp: { host: v('smtp_host') || '', port: v('smtp_port') || '465', user: v('smtp_user') || '', pass_set: !!v('smtp_pass'), from: v('smtp_from') || '', secure: v('smtp_secure') || '1' }
  });
});
r.put('/settings', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  const set = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const flat = (obj, prefix) => {
    for (const [k, val] of Object.entries(obj || {})) {
      if (val && typeof val === 'object' && !Array.isArray(val)) flat(val, prefix ? prefix + '_' + k : k);
      else if (val !== undefined) set.run(prefix ? prefix + '_' + k : k, String(val));
    }
  };
  flat(b, '');
  res.json({ ok: true });
});

// 费用类型
r.get('/fees', demoAuth, (req, res) => {
  res.json(req.demoDb.prepare('SELECT * FROM fee_types ORDER BY id').all());
});
r.put('/fees/:id', demoAuth, (req, res) => {
  const b = req.body || {};
  if (b.enabled !== undefined) req.demoDb.prepare('UPDATE fee_types SET enabled=? WHERE id=?').run(b.enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// 操作员/后台账号
r.get('/admin-users', demoAuth, (req, res) => {
  res.json(req.demoDb.prepare('SELECT id, username, display_name, email, role, status, created_at FROM admin_users ORDER BY id').all());
});
r.get('/admin-users/:id', demoAuth, (req, res) => {
  const u = req.demoDb.prepare('SELECT id, username, display_name, email, role, status FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  u.granted_property_ids = req.demoDb.prepare('SELECT property_id FROM property_grants WHERE admin_user_id=?').all(req.params.id).map(x => x.property_id);
  res.json(u);
});
r.post('/admin-users', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  if (!b.username || !b.password) return res.status(400).json({ error: '用户名与密码必填' });
  const ex = db.prepare('SELECT id FROM admin_users WHERE username=?').get(b.username);
  if (ex) return res.status(400).json({ error: '用户名已存在' });
  const info = db.prepare('INSERT INTO admin_users (username, password_hash, display_name, email, role, status) VALUES (?,?,?,?,?,?)').run(b.username, bcrypt.hashSync(String(b.password), 10), b.display_name || b.username, b.email || '', b.role || 'operator', 1);
  res.json({ id: info.lastInsertRowid });
});
r.put('/admin-users/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  if (b.password) db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(b.password), 10), req.params.id);
  if (b.username && b.username !== u.username) {
    const ex = db.prepare('SELECT id FROM admin_users WHERE username=? AND id<>?').get(b.username, req.params.id);
    if (ex) return res.status(400).json({ error: '用户名已存在' });
    db.prepare('UPDATE admin_users SET username=? WHERE id=?').run(b.username, req.params.id);
  }
  db.prepare('UPDATE admin_users SET display_name=?, email=? WHERE id=?').run(b.display_name || u.display_name, b.email !== undefined ? b.email : u.email, req.params.id);
  res.json({ ok: true });
});
r.put('/admin-users/:id/grants', demoAuth, (req, res) => {
  const db = req.demoDb;
  const ids = Array.isArray((req.body || {}).property_ids) ? (req.body || {}).property_ids : [];
  db.prepare('DELETE FROM property_grants WHERE admin_user_id=?').run(req.params.id);
  const ins = db.prepare('INSERT OR IGNORE INTO property_grants (admin_user_id, property_id) VALUES (?,?)');
  for (const pid of ids) ins.run(req.params.id, pid);
  res.json({ ok: true });
});
r.delete('/admin-users/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  if (u.role === 'admin') return res.status(400).json({ error: '不能删除主管理员' });
  db.prepare('DELETE FROM admin_users WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM property_grants WHERE admin_user_id=?').run(req.params.id);
  res.json({ ok: true });
});

// 支付配置
r.get('/pay-configs', demoAuth, (req, res) => {
  const db = req.demoDb;
  const rows = db.prepare('SELECT pc.*, (SELECT COALESCE(display_name, username, \'\') FROM admin_users au WHERE au.id=pc.created_by) created_by_name FROM payment_configs pc ORDER BY pc.id').all();
  const binds = db.prepare('SELECT config_id, property_id FROM payment_config_bindings').all();
  const acc = db.prepare('SELECT config_id, admin_user_id FROM payment_config_access').all();
  const byCfg = {}; for (const b of binds) (byCfg[b.config_id] ||= []).push(b.property_id);
  const byAcc = {}; for (const a of acc) (byAcc[a.config_id] ||= []).push(a.admin_user_id);
  for (const row of rows) { row.property_ids = byCfg[row.id] || []; row.access_user_ids = byAcc[row.id] || []; }
  res.json(rows);
});
r.get('/pay-configs/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const row = db.prepare('SELECT * FROM payment_configs WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '配置不存在' });
  row.property_ids = db.prepare('SELECT property_id FROM payment_config_bindings WHERE config_id=?').all(req.params.id).map(x => x.property_id);
  row.access_user_ids = db.prepare('SELECT admin_user_id FROM payment_config_access WHERE config_id=?').all(req.params.id).map(x => x.admin_user_id);
  res.json(row);
});
r.post('/pay-configs', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  if (!b.name || !b.mchid) return res.status(400).json({ error: '名称与商户号必填' });
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO payment_configs (name, mchid, apiv3_key, serial_no, private_key, notify_url, appid, scope, created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(String(b.name).trim(), String(b.mchid).trim(), b.apiv3_key || '', b.serial_no || '', b.private_key || '', b.notify_url || '', b.appid || '', b.scope || 'global', 1);
    const ins = db.prepare('INSERT OR IGNORE INTO payment_config_bindings (config_id, property_id) VALUES (?,?)');
    for (const pid of b.property_ids || []) ins.run(info.lastInsertRowid, pid);
    const insa = db.prepare('INSERT OR IGNORE INTO payment_config_access (config_id, admin_user_id) VALUES (?,?)');
    for (const uid of b.access_user_ids || []) insa.run(info.lastInsertRowid, uid);
    return info.lastInsertRowid;
  });
  res.json({ id: tx() });
});
r.put('/pay-configs/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  const row = db.prepare('SELECT * FROM payment_configs WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '配置不存在' });
  db.prepare('UPDATE payment_configs SET name=?, mchid=?, serial_no=?, notify_url=?, appid=? WHERE id=?').run(b.name || row.name, b.mchid || row.mchid, b.serial_no !== undefined ? b.serial_no : row.serial_no, b.notify_url !== undefined ? b.notify_url : row.notify_url, b.appid !== undefined ? b.appid : row.appid, req.params.id);
  if (b.apiv3_key) db.prepare('UPDATE payment_configs SET apiv3_key=? WHERE id=?').run(b.apiv3_key, req.params.id);
  if (b.private_key) db.prepare('UPDATE payment_configs SET private_key=? WHERE id=?').run(b.private_key, req.params.id);
  db.prepare('DELETE FROM payment_config_bindings WHERE config_id=?').run(req.params.id);
  const ins = db.prepare('INSERT OR IGNORE INTO payment_config_bindings (config_id, property_id) VALUES (?,?)');
  for (const pid of b.property_ids || []) ins.run(req.params.id, pid);
  db.prepare('DELETE FROM payment_config_access WHERE config_id=?').run(req.params.id);
  const insa = db.prepare('INSERT OR IGNORE INTO payment_config_access (config_id, admin_user_id) VALUES (?,?)');
  for (const uid of b.access_user_ids || []) insa.run(req.params.id, uid);
  res.json({ ok: true });
});
r.delete('/pay-configs/:id', demoAuth, (req, res) => {
  const db = req.demoDb;
  db.prepare('DELETE FROM payment_configs WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM payment_config_bindings WHERE config_id=?').run(req.params.id);
  db.prepare('DELETE FROM payment_config_access WHERE config_id=?').run(req.params.id);
  res.json({ ok: true });
});

// 备份（演示：不实际读写远程/磁盘，仅返回占位记录）
r.get('/backups', demoAuth, (req, res) => {
  res.json([]);
});
r.post('/backups', demoAuth, (req, res) => {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  res.json({ file: `lookhome-demo-${stamp}.db` });
});
r.post('/backups/restore', demoAuth, (req, res) => {
  res.json({ ok: true, notice: '演示环境不执行真实恢复' });
});
r.delete('/backups/:file', demoAuth, (req, res) => {
  res.json({ ok: true });
});
r.get('/backups/onedrive/auth', demoAuth, (req, res) => {
  res.json({ url: '' });
});

// 抄表
r.get('/meterings', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { period, project_id } = req.query;
  let sql = `SELECT mr.*, r.room_no, p.name AS property_name FROM meter_readings mr JOIN rooms r ON r.id=mr.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1`;
  const args = [];
  if (period && period !== 'all') { sql += ' AND mr.period=?'; args.push(period); }
  if (project_id && project_id !== 'all') { sql += ' AND r.property_id=?'; args.push(Number(project_id)); }
  sql += ' ORDER BY mr.id DESC';
  const rows = db.prepare(sql).all(...args);
  const stat = db.prepare(`SELECT mr.meter_type, COUNT(*) c, COALESCE(SUM(mr.amount),0) v FROM meter_readings mr WHERE 1=1 GROUP BY mr.meter_type`).all();
  res.json({ rows, stat });
});
r.post('/meterings', demoAuth, (req, res) => {
  const db = req.demoDb;
  const rows = (req.body || {}).rows || [];
  let n = 0;
  for (const rw of rows) {
    if (!rw.room_id || rw.value === undefined || rw.value === '') continue;
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(rw.room_id);
    if (!room) continue;
    const mt = rw.meter_type === 'electric' ? 'electric' : 'water';
    const rate = mt === 'water' ? room.water_rate : room.electric_rate;
    const factor = mt === 'water' ? room.water_factor : room.electric_factor;
    const prev = db.prepare('SELECT curr_reading FROM meter_readings WHERE room_id=? AND meter_type=? ORDER BY id DESC LIMIT 1').get(rw.room_id, mt);
    const usage = Math.max(0, Number(rw.value) - (prev?.curr_reading || 0));
    db.prepare('INSERT INTO meter_readings (room_id, meter_type, period, prev_reading, curr_reading, usage, amount) VALUES (?,?,?,?,?,?,?)').run(rw.room_id, mt, rw.period || monthNow(), prev?.curr_reading || 0, Number(rw.value), usage, Math.round(usage * rate * factor * 100) / 100);
    n++;
  }
  res.json({ created: n });
});
r.get('/meterings/template', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { period, project_id } = req.query;
  let rooms = db.prepare('SELECT r.id, r.room_no, p.name AS property_name FROM rooms r JOIN properties p ON p.id=r.property_id ORDER BY r.id').all();
  if (project_id && project_id !== 'all') rooms = rooms.filter(x => db.prepare('SELECT property_id FROM rooms WHERE id=?').get(x.id).property_id === Number(project_id));
  const ws = XLSX.utils.aoa_to_sheet([['房号', '水表本期读数', '电表本期读数'], ...rooms.map(r => [`${r.property_name} ${r.room_no}`, '', ''])]);
  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '抄表模板');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="meter-template-${period || monthNow()}.xlsx"`);
  res.send(buf);
});
r.post('/meterings/import', demoAuth, (req, res) => {
  res.json({ created: 0, notice: '演示环境可先手动抄表体验' });
});

// 租赁历史查询
r.get('/contracts/history-search', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { name, id_card, phone, property_id } = req.query;
  let sql = `SELECT c.*, t.name AS tenant_name, t.phone AS tenant_phone, t.id_card_enc AS tenant_id_card, r.room_no, p.name AS property_name FROM contracts c JOIN tenants t ON t.id=c.tenant_id JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1`;
  const args = [];
  if (name) { sql += ' AND t.name LIKE ?'; args.push(`%${name}%`); }
  if (id_card) { sql += ' AND t.id_card_enc LIKE ?'; args.push(`%${id_card}%`); }
  if (phone) { sql += ' AND t.phone LIKE ?'; args.push(`%${phone}%`); }
  if (property_id && property_id !== 'all') { sql += ' AND r.property_id=?'; args.push(Number(property_id)); }
  sql += ' ORDER BY c.id DESC';
  res.json(db.prepare(sql).all(...args));
});

// 押金退款
r.get('/refunds', demoAuth, (req, res) => {
  const db = req.demoDb;
  res.json(db.prepare(`SELECT rf.*, t.name AS tenant_name, r.room_no, p.name AS property_name FROM refunds rf LEFT JOIN tenants t ON t.id=rf.tenant_id LEFT JOIN contracts c ON c.id=rf.contract_id LEFT JOIN rooms r ON r.id=c.room_id LEFT JOIN properties p ON p.id=r.property_id ORDER BY rf.id DESC`).all());
});
r.post('/refunds', demoAuth, (req, res) => {
  const db = req.demoDb;
  const b = req.body || {};
  if (!b.contract_id) return res.status(400).json({ error: '请选择合同' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(b.contract_id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const info = db.prepare('INSERT INTO refunds (contract_id, tenant_id, amount, refund_mode, source, status, apply_remark, remark) VALUES (?,?,?,?,?,?,?,?)').run(c.id, c.tenant_id, Number(b.amount || c.deposit), b.refund_mode || 'manual', b.source || 'admin', 'pending', b.apply_remark || '', b.remark || '');
  res.json({ id: info.lastInsertRowid });
});
r.post('/refunds/:id/approve', demoAuth, (req, res) => {
  const db = req.demoDb;
  const rf = db.prepare('SELECT * FROM refunds WHERE id=?').get(req.params.id);
  if (!rf) return res.status(404).json({ error: '记录不存在' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE refunds SET status='done', done_at=datetime('now','localtime') WHERE id=?`).run(rf.id);
    if (rf.contract_id) {
      const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(rf.contract_id);
      if (c && c.status === 'active') {
        db.prepare(`UPDATE contracts SET status='closed', ended_at=datetime('now','localtime') WHERE id=?`).run(c.id);
        db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
      }
    }
  });
  tx();
  res.json({ ok: true, notice: '押金已退，合同已解除，房源已转空置' });
});
r.post('/refunds/:id/reject', demoAuth, (req, res) => {
  req.demoDb.prepare(`UPDATE refunds SET status='rejected', remark=?, done_at=datetime('now','localtime') WHERE id=?`).run((req.body || {}).reason || '', req.params.id);
  res.json({ ok: true });
});

// 收款记录
r.get('/payments', demoAuth, (req, res) => {
  const db = req.demoDb;
  const { confirm_status } = req.query;
  let sql = `SELECT pm.*, b.period, b.title AS bill_title, t.name AS tenant_name, r.room_no FROM payments pm JOIN bills b ON b.id=pm.bill_id LEFT JOIN tenants t ON t.id=pm.tenant_id LEFT JOIN rooms r ON r.id=b.room_id WHERE 1=1`;
  const args = [];
  if (confirm_status && confirm_status !== 'all') { sql += ' AND pm.confirm_status=?'; args.push(confirm_status); }
  sql += ' ORDER BY pm.id DESC';
  const rows = db.prepare(sql).all(...args);
  const stat = db.prepare('SELECT confirm_status, COUNT(*) c, COALESCE(SUM(amount),0) v FROM payments GROUP BY confirm_status').all();
  res.json({ rows, stat });
});

// 账号
r.post('/auth/password', demoAuth, (req, res) => {
  const b = req.body || {};
  if (!b.oldPwd || !b.newPwd) return res.status(400).json({ error: '参数不完整' });
  const u = req.demoDb.prepare('SELECT * FROM admin_users WHERE username=?').get('admin');
  if (!bcrypt.compareSync(String(b.oldPwd), u.password_hash)) return res.status(400).json({ error: '原密码错误' });
  req.demoDb.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(b.newPwd), 10), u.id);
  res.json({ ok: true });
});
r.post('/auth/test-mail', demoAuth, (req, res) => {
  res.json({ ok: true });
});

// 清理定时
setInterval(dailyCheck, 6 * 3600 * 1000);
sizeCheck();

export default r;
