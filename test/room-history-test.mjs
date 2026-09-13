// 房屋历史租赁查询接口测试
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

const rnd = Date.now().toString().slice(-6);
let r = await req('POST', '/auth/login', null, { username: 'admin', password: 'admin123' });
const adminTok = r.j.token;
check('admin 登录', !!adminTok);

r = await req('POST', '/properties', adminTok, { name: `历史查询测试${rnd}` });
const pid = r.j.id;
r = await req('POST', '/rooms', adminTok, { property_id: pid, room_no: 'H101', ref_rent: 1500, garbage_fee: 15, water_rate: 5, electric_rate: 1.2 });
const rid = r.j.id;
r = await req('POST', '/tenants', adminTok, { name: '张三', phone: `138${rnd}`, id_card: '110101199001011234' });
const tid1 = r.j.id;
r = await req('POST', '/tenants', adminTok, { name: '李四', phone: `139${rnd}`, id_card: '110101199002022345' });
const tid2 = r.j.id;
// 合同1：张三 2026-01-01 ~ 2026-06-30，押金 1500，已退房
r = await req('POST', '/contracts', adminTok, { tenant_id: tid1, room_id: rid, start_date: '2026-01-01', end_date: '2026-06-30', monthly_rent: 1500, deposit: 1500 });
const cid1 = r.j.id;
r = await req('POST', `/contracts/${cid1}/checkout`, adminTok, { remark: '到期退房' });
check('合同1退房', r.status === 200, JSON.stringify(r.j));
r = await req('POST', '/refunds', adminTok, { contract_id: cid1, amount: 1400, remark: '扣100维修费' });
check('合同1退押金(部分)', r.status === 200, JSON.stringify(r.j));
// 合同2：李四 在租
r = await req('POST', '/contracts', adminTok, { tenant_id: tid2, room_id: rid, start_date: '2026-07-01', end_date: '2027-06-30', monthly_rent: 1600, deposit: 1600 });
const cid2 = r.j.id;

// 历史查询
r = await req('GET', `/rooms/${rid}/history`, adminTok);
check('历史接口 200', r.status === 200, JSON.stringify(r.j));
const { room, history } = r.j;
check('房间信息完整', room && room.room_no === 'H101' && room.property_name.includes('历史查询'), JSON.stringify(room));
check('历史记录 2 条', history.length === 2, JSON.stringify(history));
const h1 = history.find(x => x.id === cid1);
const h2 = history.find(x => x.id === cid2);
check('合同1 已退租', h1 && h1.status === 'ended');
check('合同1 退房时间已记录', h1 && !!h1.actual_end && !!h1.ended_at, JSON.stringify(h1 && h1.ended_at));
check('合同1 租赁时长计算', h1 && h1.duration_text.includes('个月'), h1 && h1.duration_text);
check('合同1 租客信息(姓名/手机/身份证)', h1 && h1.tenant_name === '张三' && h1.tenant_phone === `138${rnd}` && h1.tenant_id_card === '110101199001011234');
check('合同1 月租/押金', h1 && h1.monthly_rent === 1500 && h1.deposit === 1500);
check('合同1 押金退还记录(已退1400)', h1 && h1.refunds.length === 1 && h1.refunds[0].status === 'done' && h1.refunds[0].amount === 1400, JSON.stringify(h1 && h1.refunds));
check('合同1 签订时间', h1 && !!h1.created_at);
check('合同2 在租中', h2 && h2.status === 'active' && h2.duration_text === '在租中', JSON.stringify(h2 && h2.duration_text));
check('合同2 押金未退', h2 && h2.refunds.length === 0);

// 操作员权限隔离
r = await req('POST', '/admin-users', adminTok, { username: `ophist${rnd}`, password: 'op123456', display_name: '历史查询操作员' });
const opId = r.j.id;
r = await req('POST', '/admin-users', adminTok, { username: `ophist2${rnd}`, password: 'op123456', display_name: '历史查询操作员2' });
const opId2 = r.j.id;
let { j: opLogin } = await req('POST', '/auth/login', null, { username: `ophist${rnd}`, password: 'op123456' });
const opTok = opLogin.token;
let { j: opLogin2 } = await req('POST', '/auth/login', null, { username: `ophist2${rnd}`, password: 'op123456' });
const opTok2 = opLogin2.token;
r = await req('GET', `/rooms/${rid}/history`, opTok);
check('未授权操作员 403', r.status === 403, JSON.stringify(r.j));
r = await req('PUT', `/admin-users/${opId}/grants`, adminTok, { property_ids: [pid] });
check('授权操作员项目', r.status === 200, JSON.stringify(r.j));
r = await req('GET', `/rooms/${rid}/history`, opTok);
check('授权操作员可查历史', r.status === 200 && r.j.history.length === 2, JSON.stringify(r.j));
r = await req('GET', `/rooms/${rid}/history`, opTok2);
check('未授权操作员2 仍 403', r.status === 403);

console.log(`\n=== ${pass} passed / ${fail} failed ===`);
process.exit(fail ? 1 : 0);
