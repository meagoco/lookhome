import { Router } from 'express';
import { db } from '../db.js';
import { tenantAuth, signTenantToken } from '../middleware/auth.js';
import { CFG } from './pay.js';

const r = Router();

// 租客注册（实名：姓名+手机号+身份证）
r.post('/register', (req, res) => {
  const { name, phone, id_card } = req.body || {};
  if (!name || !phone || !id_card) return res.status(400).json({ error: '姓名、手机号、身份证号必填' });
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!/^\d{17}[\dXx]$/.test(id_card)) return res.status(400).json({ error: '身份证号格式不正确' });
  const existed = db.prepare('SELECT id, verify_status FROM tenants WHERE phone=?').get(phone);
  if (existed) return res.status(400).json({ error: '该手机号已注册，请直接登录' });

  // 实名核验：默认手工审核（verify_status=pending），配置自动核验后走二要素接口（预留调用点）
  const mode = (db.prepare(`SELECT value FROM settings WHERE key='realname_verify_mode'`).get() || {}).value || 'manual';
  let verifyStatus = 'pending';
  let verifyMethod = 'manual';
  if (mode === 'auto') {
    // TODO: 配置 tencent_secret_id/tencent_secret_key 后调用腾讯云身份证二要素核验
    // const ok = await tencentIdCardVerify(name, id_card);
    // verifyStatus = ok ? 'approved' : 'rejected';
    verifyStatus = 'pending';
    verifyMethod = 'auto';
  }
  const info = db.prepare(`
    INSERT INTO tenants (name,phone,id_card_enc,verify_status,verify_method,source,created_at)
    VALUES (?,?,?,?,?,?,datetime('now','localtime'))`)
    .run(name, phone, id_card, verifyStatus, verifyMethod, 'miniprogram');
  res.json({ id: info.lastInsertRowid, verify_status: verifyStatus, notice: verifyStatus === 'pending' ? '注册成功，房东审核身份后即可查看账单' : '注册成功' });
});

// 租客登录（手机号+身份证；预留微信 code2session 登录）
r.post('/login', async (req, res) => {
  const { phone, id_card, code } = req.body || {};
  let tenant = null;
  if (code && CFG.appid() && CFG.secret()) {
    // TODO: 配置小程序后启用 code2session 换取 openid，按 openid 自动登录/绑定
    // const session = await wxCode2Session(code);
    // tenant = db.prepare('SELECT * FROM tenants WHERE wechat_openid=?').get(session.openid);
    return res.status(400).json({ error: '微信快捷登录待开通，请先用手机号+身份证登录' });
  }
  tenant = db.prepare('SELECT * FROM tenants WHERE phone=?').get(phone || '');
  if (!tenant || String(id_card || '') !== tenant.id_card_enc) return res.status(400).json({ error: '手机号或身份证号不正确' });
  if (tenant.status === 0) return res.status(403).json({ error: '账号已停用' });
  res.json({ token: signTenantToken(tenant), tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, verify_status: tenant.verify_status } });
});

// 我的信息（含当前合同/房间/押金）
r.get('/me', tenantAuth, (req, res) => {
  const t = db.prepare('SELECT id,name,phone,verify_status,verify_method,wechat_openid,created_at FROM tenants WHERE id=?').get(req.tenant.id);
  const contract = db.prepare(`
    SELECT c.*, r.room_no, p.name AS property_name, r.garbage_fee, r.water_rate, r.electric_rate
    FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id
    WHERE c.tenant_id=? AND c.status='active' ORDER BY c.id DESC LIMIT 1`).get(req.tenant.id);
  const unpaidBills = (db.prepare(`
    SELECT COALESCE(SUM(total),0) v FROM bills WHERE tenant_id=? AND status IN ('unpaid','overdue')`).get(req.tenant.id) || {}).v || 0;
  res.json({ tenant: t, contract: contract || null, unpaid_total: unpaidBills });
});

// 我的账单
r.get('/bills', tenantAuth, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT b.*, r.room_no, p.name AS property_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.bill_id=b.id AND pm.confirm_status='confirmed') AS paid_amount
    FROM bills b JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id
    WHERE b.tenant_id=?`;
  const args = [req.tenant.id];
  if (status && status !== 'all') { sql += ' AND b.status=?'; args.push(status); }
  sql += ' ORDER BY b.id DESC';
  res.json(db.prepare(sql).all(...args));
});

// 账单详情（含明细）
r.get('/bills/:id', tenantAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bills WHERE id=? AND tenant_id=?').get(req.params.id, req.tenant.id);
  if (!b) return res.status(404).json({ error: '账单不存在' });
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id=?').all(b.id);
  const payments = db.prepare(`SELECT amount,pay_mode,confirm_status,created_at FROM payments WHERE bill_id=?`).all(b.id);
  res.json({ bill: b, items, payments });
});

// 我的押金退款记录
r.get('/refunds', tenantAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT rf.*, r.room_no, p.name AS property_name
    FROM refunds rf JOIN contracts c ON c.id=rf.contract_id
    JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id
    WHERE c.tenant_id=? ORDER BY rf.id DESC`).all(req.tenant.id);
  res.json(rows);
});

// 租客申请退押金（待房东/管理员后台手工同意；同意后自动解除合同并置空房间）
r.post('/refunds/apply', tenantAuth, (req, res) => {
  const { amount, apply_remark } = req.body || {};
  const c = db.prepare(`
    SELECT c.*, r.room_no, p.name AS property_name FROM contracts c
    JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id
    WHERE c.tenant_id=? AND c.status='active' ORDER BY c.id DESC LIMIT 1`).get(req.tenant.id);
  if (!c) return res.status(400).json({ error: '当前没有生效合同，无法申请退押金' });
  const dup = db.prepare(`SELECT id FROM refunds WHERE contract_id=? AND source='tenant' AND status='pending'`).get(c.id);
  if (dup) return res.status(400).json({ error: '已有一笔待审批的退押金申请，请等待处理' });
  const amt = amount != null && amount !== '' ? Number(amount) : c.deposit;
  if (!(amt > 0)) return res.status(400).json({ error: '退款金额必须大于 0' });
  if (amt > c.deposit) return res.status(400).json({ error: `退款不能超过押金 ${c.deposit} 元` });
  const info = db.prepare(`
    INSERT INTO refunds (contract_id,tenant_id,amount,refund_mode,source,status,apply_remark)
    VALUES (?,?,?,?,?,?,?)`)
    .run(c.id, req.tenant.id, amt, 'manual', 'tenant', 'pending', (apply_remark || '').toString().slice(0, 200));
  res.json({ id: info.lastInsertRowid, status: 'pending', notice: '退押金申请已提交，等待房东确认' });
});

export default r;
