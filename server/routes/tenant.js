import { Router } from 'express';
import { db } from '../db.js';
import { tenantAuth, signTenantToken } from '../middleware/auth.js';
import { CFG } from './pay.js';
import { subscribeConfig } from '../wechat-subscribe.js';
import { idCardVerify, phoneVerify } from '../lib/tencent-idverify.js';
import { encIdCard, decIdCard } from '../enc.js';
import { renderContract, getContractTemplate, PAY_MODES } from '../lib/contract-template.js';

const r = Router();

// 房源展示（小程序首页：空置/已租房间 + 面积 + 参考租金 + 房东联系电话；公开可看）
r.get('/properties', (req, res) => {
  const sitePhone = (db.prepare(`SELECT value FROM settings WHERE key='site_phone'`).get() || {}).value || '';
  const props = db.prepare(`SELECT id, name, address, status,
    (SELECT COUNT(*) FROM rooms r WHERE r.property_id=p.id) room_count,
    (SELECT COUNT(*) FROM rooms r WHERE r.property_id=p.id AND r.status='vacant') vacant_count
    FROM properties p WHERE p.status=1 ORDER BY p.id DESC`).all();
  const rooms = db.prepare(`
    SELECT r.id, r.property_id, r.room_no, r.layout, r.area, r.ref_rent, r.deposit, r.bathroom, r.window,
           r.garbage_fee, r.water_rate, r.electric_rate, r.status, r.available_date, p.name AS property_name
    FROM rooms r JOIN properties p ON p.id=r.property_id WHERE p.status=1 ORDER BY r.property_id DESC, r.room_no`).all();
  res.json({ properties: props, rooms, site_phone: sitePhone });
});

// 合同模板预览（签约前展示：登录租客按房间渲染合同文本；租客已选租期/支付方式）
// 租期与支付方式由租客在小程序点击立即签约后先弹出选择，再生成合同预览
r.get('/contract-preview', tenantAuth, (req, res) => {
  const room_id = Number(req.query.room_id);
  if (!room_id) return res.status(400).json({ error: '请选择要签约的房间' });
  const t = db.prepare('SELECT id, name, phone, id_card_enc, verify_status FROM tenants WHERE id=?').get(req.tenant.id);
  if (!t || t.status === 0) return res.status(403).json({ error: '账号不可用' });
  const room = db.prepare(`SELECT r.id, r.room_no, r.area, r.layout, r.ref_rent, r.deposit, r.status, p.name AS property_name, p.address AS property_address
    FROM rooms r JOIN properties p ON p.id=r.property_id WHERE r.id=?`).get(room_id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  if (room.status !== 'vacant') return res.status(400).json({ error: `房间 ${room.room_no} 当前不可签约（非空置）` });
  // 租期（月）与支付方式：租客选择后传入
  let termMonths = Number(req.query.term_months);
  if (!(termMonths >= 1 && termMonths <= 36)) return res.status(400).json({ error: '请选择租赁期限' });
  const payMode = String(req.query.pay_mode || 'monthly');
  if (!PAY_MODES[payMode]) return res.status(400).json({ error: '请选择支付方式' });
  // 起止日期：默认自可入住日（或今日）起，按租期月数计算
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start_date || '')
    ? req.query.start_date
    : new Date().toISOString().slice(0, 10);
  const endDate = addMonths(startDate, termMonths);
  const rent = Number(room.ref_rent) || 0;
  const text = renderContract({
    property_name: room.property_name, property_address: room.property_address,
    room_no: room.room_no, layout: room.layout, area: room.area,
    tenant_name: t.name, id_card: decIdCard(t.id_card_enc), tenant_phone: t.phone,
    monthly_rent: rent, deposit: Number(room.deposit) || 0,
    term_months: termMonths, pay_mode: payMode,
    start_date: startDate, end_date: endDate,
  });
  res.json({ room_no: room.room_no, text, version: 2, start_date: startDate, end_date: endDate, monthly_rent: rent, deposit: Number(room.deposit) || 0, pay_mode: payMode, term_months: termMonths });
});

// 日期 +N 个月（自然月，跨年进位）
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1 + months, Math.min(d, 28));
  const yy = dt.getFullYear(), mm = String(dt.getMonth() + 1).padStart(2, '0'), dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 立即签约（登录租客对空置房源提交签约申请；需已实名 + 已阅读勾选同意合同 + 已选租期与支付方式）
r.post('/apply-sign', tenantAuth, (req, res) => {
  const { room_id, expected_date, remark, agreed, term_months, pay_mode } = req.body || {};
  if (!room_id) return res.status(400).json({ error: '请选择要签约的房间' });
  if (agreed !== true && agreed !== 1 && agreed !== '1' && agreed !== 'true') {
    return res.status(400).json({ error: '请先阅读并勾选同意《房屋租赁合同》' });
  }
  const termMonths = Number(term_months);
  if (!(termMonths >= 1 && termMonths <= 36)) return res.status(400).json({ error: '请选择租赁期限' });
  if (!PAY_MODES[pay_mode]) return res.status(400).json({ error: '请选择支付方式' });
  const t = db.prepare('SELECT id, name, phone, verify_status FROM tenants WHERE id=?').get(req.tenant.id);
  if (!t || t.status === 0) return res.status(403).json({ error: '账号不可用' });
  if (t.verify_status !== 'approved') return res.status(403).json({ error: '请先完成实名认证再签约' });
  const room = db.prepare('SELECT id, room_no, status, property_id FROM rooms WHERE id=?').get(room_id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  if (room.status !== 'vacant') return res.status(400).json({ error: `房间 ${room.room_no} 当前不可签约（非空置）` });
  const dup = db.prepare(`SELECT id FROM lease_applications WHERE tenant_id=? AND room_id=? AND status='pending'`).get(req.tenant.id, room_id);
  if (dup) return res.status(400).json({ error: '你已提交过该房间的签约申请，请等待房东审核' });
  const info = db.prepare(`
    INSERT INTO lease_applications (tenant_id, room_id, tenant_name, tenant_phone, expected_date, term_months, pay_mode, remark, agreed_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(req.tenant.id, room_id, t.name, t.phone, expected_date || '', termMonths, pay_mode, remark || '');
  res.json({ id: info.lastInsertRowid, status: 'pending', notice: '签约申请已提交，房东确认后即生成合同并提醒您支付租金及押金' });
});

// 我的签约申请
r.get('/my-applications', tenantAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, r.room_no, r.ref_rent, r.area, p.name AS property_name
    FROM lease_applications a JOIN rooms r ON r.id=a.room_id JOIN properties p ON p.id=r.property_id
    WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 50`).all(req.tenant.id);
  res.json(rows);
});

// 微信 code2session：code 换 openid（小程序已配置 AppID/Secret 时可用）
async function wxCode2Session(code) {
  const appid = CFG.appid(), secret = CFG.secret();
  if (!appid || !secret) return null;
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await resp.json();
  if (!data.openid) throw new Error((data.errmsg || '微信登录失败'));
  return data;
}

// 微信 access_token（内存缓存，提前 200s 过期）
let wxTokenCache = { token: '', exp: 0 };
async function wxAccessToken() {
  const appid = CFG.appid(), secret = CFG.secret();
  if (!appid || !secret) throw new Error('微信登录未开通，请先配置 AppID/Secret');
  if (wxTokenCache.token && Date.now() < wxTokenCache.exp) return wxTokenCache.token;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await resp.json();
  if (!data.access_token) throw new Error(data.errmsg || '获取微信 access_token 失败');
  wxTokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in - 200) * 1000 };
  return data.access_token;
}

// 微信手机号一键授权：getPhoneNumber 返回的 code → 微信绑定手机号（企业认证小程序可用）
r.post('/wechat-phone', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: '缺少授权凭证' });
  try {
    const token = await wxAccessToken();
    const resp = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }), signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    if (data.errcode) throw new Error(data.errmsg || '获取手机号失败');
    const phone = (data.phone_info || {}).phoneNumber || '';
    if (!phone) throw new Error('未获取到手机号');
    res.json({ phone });
  } catch (e) {
    res.status(400).json({ error: e.message || '获取手机号失败' });
  }
});

// 微信一键登录（wx.login 的 code → openid → 已有绑定则直接登录）
r.post('/wx-login', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: '缺少登录凭证' });
  if (!CFG.appid() || !CFG.secret()) return res.status(400).json({ error: '微信登录未开通，请用手机号+身份证登录' });
  try {
    const s = await wxCode2Session(code);
    const tenant = db.prepare('SELECT * FROM tenants WHERE wechat_openid=?').get(s.openid);
    if (!tenant) return res.json({ need_bind: true, openid: s.openid, notice: '请用注册的手机号和身份证完成绑定' });
    if (tenant.status === 0) return res.status(403).json({ error: '账号已停用' });
    res.json({ token: signTenantToken(tenant), openid: s.openid, tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, verify_status: tenant.verify_status } });
  } catch (e) {
    res.status(400).json({ error: e.message || '微信登录失败' });
  }
});

// 租客注册（实名：姓名+手机号+身份证；可选绑定微信 openid）
// 实名模式：manual=房东后台人工审核（默认）；auto=腾讯云身份信息核验（二要素，可加手机号三要素）
// 匹配规则：注册后先与网站租客管理中既有租客匹配，姓名/身份证/手机号任两项一致 → 直接绑定该租客档案
r.post('/register', async (req, res) => {
  const { name, phone, id_card, openid } = req.body || {};
  if (!name || !phone || !id_card) return res.status(400).json({ error: '姓名、手机号、身份证号必填' });
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!/^\d{17}[\dXx]$/.test(id_card)) return res.status(400).json({ error: '身份证号格式不正确' });

  // —— 新规则：与网站租客管理中既有租客匹配（姓名/身份证/手机号任两项一致 → 绑定对应房源，小程序按已签约显示）——
  const candidates = db.prepare(`SELECT * FROM tenants WHERE phone=? OR name=?`).all(phone, name);
  let matched = null;
  for (const c of candidates) {
    let score = 0;
    if (String(c.phone || '') === String(phone || '')) score++;
    if (String(decIdCard(c.id_card_enc) || '').toUpperCase() === String(id_card || '').toUpperCase()) score++;
    if (String(c.name || '') === String(name || '')) score++;
    if (score >= 2) { matched = c; break; }
  }
  if (matched) {
    if (matched.status === 0) return res.status(403).json({ error: '该租客档案已停用' });
    if (matched.wechat_openid && openid && matched.wechat_openid !== openid) {
      return res.status(400).json({ error: '该租客档案已绑定其他微信' });
    }
    if (openid) {
      const holder = db.prepare('SELECT id FROM tenants WHERE wechat_openid=? AND id<>?').get(openid, matched.id);
      if (holder) return res.status(400).json({ error: '该微信已绑定其他账号' });
    }
    db.prepare(`UPDATE tenants SET wechat_openid=?, verify_status='approved', verify_method='auto',
      verify_remark='小程序实名注册，姓名/身份证/手机号匹配既有租客档案，自动绑定' WHERE id=?`)
      .run(openid || matched.wechat_openid || '', matched.id);
    return res.json({
      id: matched.id,
      verify_status: 'approved',
      notice: '实名核验通过，已自动匹配并绑定已有租客档案（姓名/身份证/手机号匹配），按已签约租客显示',
      token: signTenantToken(matched),
      openid: openid || matched.wechat_openid || '',
      auto_bound: true
    });
  }

  const existed = db.prepare('SELECT id, verify_status FROM tenants WHERE phone=?').get(phone);
  if (existed) return res.status(400).json({ error: '该手机号已注册，请直接登录' });
  if (openid) {
    const bound = db.prepare('SELECT id FROM tenants WHERE wechat_openid=?').get(openid);
    if (bound) return res.status(400).json({ error: '该微信已绑定其他账号' });
  }

  // 实名核验：manual=人工审核（默认，房东后台兜底）；auto=腾讯云身份信息核验
  const mode = (db.prepare(`SELECT value FROM settings WHERE key='realname_verify_mode'`).get() || {}).value || 'manual';
  const phone3 = (db.prepare(`SELECT value FROM settings WHERE key='realname_verify_phone'`).get() || {}).value || '0';
  let verifyStatus = 'pending';
  let verifyMethod = 'manual';
  let verifyRemark = '';
  if (mode === 'auto') {
    verifyMethod = 'auto';
    try {
      const r = phone3 === '1' && phone
        ? await phoneVerify(name, id_card, phone)   // 三要素：姓名+身份证+手机号
        : await idCardVerify(name, id_card);        // 二要素：姓名+身份证
      if (r.ok) {
        verifyStatus = 'approved';
        verifyRemark = '腾讯云身份信息核验通过' + (phone3 === '1' ? '（三要素）' : '（二要素）');
      } else {
        verifyStatus = 'rejected';
        verifyRemark = '腾讯云核验不一致：' + (r.desc || '') + '（可人工复核）';
      }
    } catch (e) {
      verifyStatus = 'pending';
      verifyRemark = '自动核验失败：' + e.message + '（已转人工审核）';
    }
  }
  const info = db.prepare(`
    INSERT INTO tenants (name,phone,id_card_enc,verify_status,verify_method,verify_remark,source,wechat_openid,created_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
    .run(name, phone, encIdCard(id_card), verifyStatus, verifyMethod, verifyRemark, 'miniprogram', openid || '');
  const notice = verifyStatus === 'approved'
    ? '注册成功，实名认证已通过'
    : verifyStatus === 'rejected'
      ? '注册成功，但身份核验未通过，请联系房东人工复核'
      : '注册成功，房东审核身份后即可查看账单';
  // 在线核验通过（auto 二要素一致）→ 即时注册成功并直接登录，无需人工审核
  let token = null;
  if (verifyStatus === 'approved') {
    token = signTenantToken({ id: info.lastInsertRowid, phone });
  }
  res.json({ id: info.lastInsertRowid, verify_status: verifyStatus, notice, token, openid: openid || '' });
});

// 租客登录（手机号+身份证；可选 openid 完成微信绑定；code 存在时优先走微信快捷登录）
r.post('/login', async (req, res) => {
  const { phone, id_card, code, openid } = req.body || {};
  let tenant = null;

  // 微信快捷登录：code → openid → 已绑定直接登录；未绑定回退手机+身份证
  if (code && CFG.appid() && CFG.secret()) {
    try {
      const s = await wxCode2Session(code);
      tenant = db.prepare('SELECT * FROM tenants WHERE wechat_openid=?').get(s.openid);
      if (!tenant) {
        if (!phone) return res.json({ need_bind: true, openid: s.openid, notice: '请用注册的手机号和身份证完成绑定' });
        // 带手机号：继续走手机+身份证校验并绑定该 openid
        tenant = db.prepare('SELECT * FROM tenants WHERE phone=?').get(phone || '');
        if (!tenant || String(id_card || '').toUpperCase() !== String(decIdCard(tenant.id_card_enc) || '').toUpperCase()) return res.status(400).json({ error: '手机号或身份证号不正确' });
        if (tenant.status === 0) return res.status(403).json({ error: '账号已停用' });
        const holder = db.prepare('SELECT id FROM tenants WHERE wechat_openid=? AND id<>?').get(s.openid, tenant.id);
        if (holder) return res.status(400).json({ error: '该微信已绑定其他账号' });
        db.prepare(`UPDATE tenants SET wechat_openid=? WHERE id=?`).run(s.openid, tenant.id);
        return res.json({ token: signTenantToken(tenant), openid: s.openid, tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, verify_status: tenant.verify_status }, bound: true });
      }
      if (tenant.status === 0) return res.status(403).json({ error: '账号已停用' });
      return res.json({ token: signTenantToken(tenant), openid: s.openid, tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, verify_status: tenant.verify_status } });
    } catch (e) {
      return res.status(400).json({ error: e.message || '微信登录失败' });
    }
  }

  // 手机号+身份证登录（可选 openid 绑定，用于 wx-login 返回 need_bind 后的绑定流程）
  tenant = db.prepare('SELECT * FROM tenants WHERE phone=?').get(phone || '');
  if (!tenant || String(id_card || '').toUpperCase() !== String(decIdCard(tenant.id_card_enc) || '').toUpperCase()) return res.status(400).json({ error: '手机号或身份证号不正确' });
  if (tenant.status === 0) return res.status(403).json({ error: '账号已停用' });
  if (openid) {
    const holder = db.prepare('SELECT id FROM tenants WHERE wechat_openid=? AND id<>?').get(openid, tenant.id);
    if (holder) return res.status(400).json({ error: '该微信已绑定其他账号' });
    db.prepare(`UPDATE tenants SET wechat_openid=? WHERE id=?`).run(openid, tenant.id);
  }
  res.json({ token: signTenantToken(tenant), openid: openid || tenant.wechat_openid || '', tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, verify_status: tenant.verify_status }, bound: !!openid });
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
  const sitePhone = (db.prepare(`SELECT value FROM settings WHERE key='site_phone'`).get() || {}).value || '';
  res.json({ tenant: t, contract: contract || null, unpaid_total: unpaidBills, site_phone: sitePhone });
});

// 我的账单
r.get('/bills', tenantAuth, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT b.*, r.room_no, p.name AS property_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.bill_id=b.id AND pm.confirm_status='confirmed') AS paid_amount,
      (SELECT 1 FROM reminders rm WHERE rm.bill_id=b.id LIMIT 1) AS reminded
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
  // 退押金规则：合同已到期 且 无欠款，才可申请
  const today = new Date().toISOString().slice(0, 10);
  if (String(c.end_date || '') >= today) return res.status(400).json({ error: '合同尚未到期，到期后方可申请退押金' });
  const debt = (db.prepare(`SELECT COALESCE(SUM(total),0) v FROM bills WHERE tenant_id=? AND status IN ('unpaid','overdue')`).get(req.tenant.id) || {}).v || 0;
  if (debt > 0) return res.status(400).json({ error: `存在未缴账单 ${debt} 元，请结清后再申请退押金` });
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

// 订阅消息：小程序端拉取可用模板配置（无需登录，模板ID留空表示未配置）
r.get('/subscribe-config', (req, res) => {
  res.json(subscribeConfig());
});

// 订阅状态：subscribed=当前有可用额度（已开启）；pay_need_renew=已消耗需续订
r.get('/subscribe-status', tenantAuth, (req, res) => {
  const t = db.prepare('SELECT id, wechat_openid FROM tenants WHERE id=?').get(req.tenant.id);
  const cfg = subscribeConfig();
  const out = { template_pay: cfg.template_pay, subscribed: false, pay_need_renew: false };
  if (t?.wechat_openid) {
    const row = db.prepare('SELECT last_used_at FROM wechat_subscriptions WHERE openid=? AND template_key=? AND status=1')
      .get(t.wechat_openid, 'pay');
    out.subscribed = !!row;
    // 已订阅且已消耗过（last_used_at 非空）→ 需要续订；从未订阅 → 首次授权也可提示
    out.pay_need_renew = !!row;
  }
  res.json(out);
});

// 订阅消息：租客保存订阅授权（小程序 requestSubscribeMessage 后回传）
// body 支持 { pay, booking, refund } 任意组合，true=保存授权，false=取消
r.post('/subscribe', tenantAuth, (req, res) => {
  const t = db.prepare('SELECT id, wechat_openid FROM tenants WHERE id=?').get(req.tenant.id);
  if (!t || !t.wechat_openid) return res.status(400).json({ error: '请先微信登录' });
  const body = req.body || {};
  const keys = ['pay', 'booking', 'refund'];
  if (!keys.some(k => body[k] !== undefined)) return res.status(400).json({ error: '缺少订阅参数' });
  const upsert = db.prepare(`
    INSERT INTO wechat_subscriptions (tenant_id, openid, template_key, status) VALUES (?,?,?,1)
    ON CONFLICT(openid, template_key) DO UPDATE SET status=excluded.status`);
  for (const k of keys) {
    if (body[k] === undefined) continue;
    if (body[k]) upsert.run(t.id, t.wechat_openid, k);
    else db.prepare('UPDATE wechat_subscriptions SET status=0 WHERE openid=? AND template_key=?').run(t.wechat_openid, k);
  }
  res.json({ ok: true });
});

// 租客站内提醒列表（管理员催缴/系统自动生成的提醒；未读排前）
r.get('/reminders', tenantAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT rm.id, rm.bill_id, rm.kind, rm.title, rm.content, rm.status, rm.created_at, rm.read_at,
           b.period, b.total, b.status AS bill_status, r.room_no, p.name AS property_name
    FROM reminders rm
    LEFT JOIN bills b ON b.id=rm.bill_id
    LEFT JOIN rooms r ON r.id=rm.room_id
    LEFT JOIN properties p ON p.id=r.property_id
    WHERE rm.tenant_id=? ORDER BY (rm.status='pending') DESC, rm.id DESC LIMIT 50`).all(req.tenant.id);
  res.json(rows);
});

// 标记提醒已读
r.post('/reminders/read', tenantAuth, (req, res) => {
  const id = Number(req.body?.id || 0);
  if (id) db.prepare(`UPDATE reminders SET status='read', read_at=datetime('now','localtime') WHERE id=? AND tenant_id=?`).run(id, req.tenant.id);
  else db.prepare(`UPDATE reminders SET status='read', read_at=datetime('now','localtime') WHERE tenant_id=? AND status='pending'`).run(req.tenant.id);
  res.json({ ok: true });
});

export default r;