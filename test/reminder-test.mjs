// 缴费提醒测试：自动到期前3天 + 手动批量 + 小程序接口 + 权限
import { runAutoReminders } from '../server/routes/reminders.js';

const B = 'http://127.0.0.1:3999/api';
async function req(method, path, token, body) {
  const hasBody = body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase());
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: hasBody ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

// 今天 + 3 天的日期（构造到期账单）
const now = new Date();
const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
const period = dueDate.slice(0, 7);
const payDay = due.getDate();
console.log(`  目标到期日=${dueDate} period=${period} payDay=${payDay}`);

const rnd = Date.now().toString().slice(-6);
let r = await req('POST', '/auth/login', null, { username: 'admin', password: 'admin123' });
const adminTok = r.j.token;
check('admin 登录', !!adminTok);

r = await req('POST', '/properties', adminTok, { name: `提醒测试${rnd}` });
const pid = r.j.id;
r = await req('POST', '/rooms', adminTok, { property_id: pid, room_no: 'R101', ref_rent: 1000 });
const rid = r.j.id;
r = await req('POST', '/tenants', adminTok, { name: '提醒租客', phone: `138${rnd}`, id_card: '110101199001011234' });
const tid = r.j.id;
r = await req('POST', '/contracts', adminTok, { tenant_id: tid, room_id: rid, start_date: '2026-01-01', end_date: '2027-12-31', monthly_rent: 1000, deposit: 1000, pay_day: payDay });
const cid = r.j.id;
check('创建合同(pay_day)', r.status === 200 && !!cid, JSON.stringify(r.j));
r = await req('POST', '/bills/generate', adminTok, { period });
check('生成月度账单', r.status === 200 && r.j.created >= 1, JSON.stringify(r.j));
r = await req('GET', '/bills', adminTok);
const rows = (r.j.rows || r.j).filter ? (Array.isArray(r.j) ? r.j : r.j.rows) : [];
const bill = rows.find(x => x.contract_id === cid && x.bill_type === 'monthly');
check('找到未缴月度账单', !!bill && bill.status === 'unpaid', JSON.stringify(rows));

// 1. 自动任务（到期前3天）→ 生成 auto 提醒
const autoSent = runAutoReminders();
check('自动任务命中到期前3天账单', autoSent >= 1, `sent=${autoSent}`);
r = await req('GET', '/reminders', adminTok);
const autoRm = r.j.find(x => x.bill_id === bill.id && x.kind === 'auto');
check('自动提醒已入库(kind=auto)', !!autoRm, JSON.stringify(r.j));
const nAuto = r.j.filter(x => x.kind === 'auto').length;
runAutoReminders(); // 幂等：不重复
r = await req('GET', '/reminders', adminTok);
check('自动提醒不重复下发', r.j.filter(x => x.kind === 'auto').length === nAuto);

// 2. 小程序端：租客登录 → 查看提醒 → 标记已读
r = await req('POST', '/tenant/login', null, { phone: `138${rnd}`, id_card: '110101199001011234' });
const tTok = r.j.token;
r = await req('GET', '/tenant/reminders', tTok);
check('小程序提醒列表(含账单跳转信息)', r.status === 200 && r.j.length >= 1 && !!r.j[0].bill_id && !!r.j[0].bill_total, JSON.stringify(r.j));
const rmId = r.j.find(x => x.id === autoRm.id).id;
r = await req('POST', `/tenant/reminders/${rmId}/read`, tTok);
check('标记已读', r.status === 200 && r.j.ok, JSON.stringify(r.j));
r = await req('GET', '/tenant/reminders', tTok);
check('已读状态生效', r.j.find(x => x.id === rmId).status === 'read');

// 账单列表回显提醒状态（自动提醒）
r = await req('GET', '/bills', adminTok);
const bRows = Array.isArray(r.j) ? r.j : (r.j.rows || []);
const b1 = bRows.find(x => x.id === bill.id);
check('账单列表回显自动提醒', b1.reminder && b1.reminder.reminded === 1 && b1.reminder.kind === 'auto' && !!b1.reminder.created_at, JSON.stringify(b1.reminder));

// 3. 手动批量提醒：未缴账单（改 period 到非自动日期：生成另一张期账单）
const otherPeriod = '2026-10';
r = await req('POST', '/bills/generate', adminTok, { period: otherPeriod });
r = await req('GET', '/bills', adminTok);
const rows2 = Array.isArray(r.j) ? r.j : (r.j.rows || []);
const bill2 = rows2.find(x => x.contract_id === cid && x.bill_type === 'monthly' && x.period === otherPeriod);
check('生成10月账单', !!bill2);
r = await req('POST', '/reminders/manual', adminTok, { bill_ids: [bill2.id] });
check('手动批量提醒 created=1', r.status === 200 && r.j.created === 1, JSON.stringify(r.j));
r = await req('POST', '/reminders/manual', adminTok, { bill_ids: [bill2.id] });
check('重复手动提醒 skipped=1', r.status === 200 && r.j.skipped === 1, JSON.stringify(r.j));
// 账单列表回显手动提醒 + 未提醒账单
r = await req('GET', '/bills', adminTok);
const bRows2 = Array.isArray(r.j) ? r.j : (r.j.rows || []);
const b2 = bRows2.find(x => x.id === bill2.id);
check('账单列表回显手动提醒', b2.reminder && b2.reminder.reminded === 1 && b2.reminder.kind === 'manual' && !!b2.reminder.created_at, JSON.stringify(b2.reminder));
const dep = bRows2.find(x => x.contract_id === cid && x.bill_type === 'deposit');
if (dep) check('押金账单未提醒', dep.reminder && dep.reminder.reminded === 0, JSON.stringify(dep.reminder));
// 提醒状态筛选
r = await req('GET', '/bills?remind=reminded', adminTok);
const rRows = Array.isArray(r.j) ? r.j : (r.j.rows || []);
check('筛选「已提醒」含手动账单', rRows.some(x => x.id === bill2.id) && !rRows.some(x => x.reminder && x.reminder.reminded === 0));
r = await req('GET', '/bills?remind=unreminded', adminTok);
const uRows = Array.isArray(r.j) ? r.j : (r.j.rows || []);
check('筛选「未提醒」不含已提醒账单', !uRows.some(x => x.id === bill2.id) && !uRows.some(x => x.id === bill.id));

// 4. 权限：操作员
r = await req('POST', '/admin-users', adminTok, { username: `oprm${rnd}`, password: 'op123456', display_name: '提醒操作员' });
const opId = r.j.id;
r = await req('POST', '/admin-users', adminTok, { username: `oprm2${rnd}`, password: 'op123456', display_name: '提醒操作员2' });
const opId2 = r.j.id;
let { j: opLogin } = await req('POST', '/auth/login', null, { username: `oprm${rnd}`, password: 'op123456' });
const opTok = opLogin.token;
let { j: opLogin2 } = await req('POST', '/auth/login', null, { username: `oprm2${rnd}`, password: 'op123456' });
const opTok2 = opLogin2.token;
r = await req('POST', '/reminders/manual', opTok, { bill_ids: [bill2.id] });
check('未授权操作员手动提醒 denied', r.status === 200 && r.j.denied === 1, JSON.stringify(r.j));
r = await req('PUT', `/admin-users/${opId}/grants`, adminTok, { property_ids: [pid] });
r = await req('POST', '/reminders/manual', opTok, { bill_ids: [bill2.id] });
check('授权操作员手动提醒(重复→skipped)', r.status === 200 && r.j.skipped === 1, JSON.stringify(r.j));
r = await req('GET', '/reminders', opTok);
check('授权操作员可见提醒列表', r.j.length >= 1);
r = await req('GET', '/reminders', opTok2);
check('未授权操作员列表为空', r.j.length === 0);

console.log(`\n=== ${pass} passed / ${fail} failed ===`);
process.exit(fail ? 1 : 0);
