// 退押金全链路测试：租客申请 → 后台同意（自动解约+置空）/ 驳回
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

// 建项目/房间/租客/合同
r = await req('POST', '/properties', adminTok, { name: `退押金测试${rnd}` });
const pid = r.j.id;
r = await req('POST', '/rooms', adminTok, { property_id: pid, room_no: 'A101', ref_rent: 1200, garbage_fee: 10, water_rate: 4, electric_rate: 1 });
const rid = r.j.id;
check('创建房间', !!rid, JSON.stringify(r.j));
r = await req('POST', '/tenants', adminTok, { name: '测试租客', phone: `138${rnd}`, id_card: '110101199001011234' });
const tid = r.j.id;
check('创建租客', !!tid, JSON.stringify(r.j));
r = await req('POST', '/tenants', adminTok, { name: '测试租客2', phone: `139${rnd}`, id_card: '110101199002022345' });
const tid2 = r.j.id;
r = await req('POST', '/contracts', adminTok, { tenant_id: tid, room_id: rid, start_date: '2026-09-01', end_date: '2027-08-31', monthly_rent: 1200, deposit: 1200 });
const cid = r.j.id;
check('创建在租合同', r.status === 200 && !!cid, JSON.stringify(r.j));

// 租客登录（模拟小程序）
r = await req('POST', '/tenant/login', null, { phone: `138${rnd}`, id_card: '110101199001011234' });
const tTok = r.j.token;
check('租客登录', !!tTok);

// 1. 无合同租客申请 → 400（租客2 无合同）
r = await req('POST', '/tenant/login', null, { phone: `139${rnd}`, id_card: '110101199002022345' });
const tTok2 = r.j.token;
r = await req('POST', '/tenant/refunds/apply', tTok2, { apply_remark: '想退' });
check('无合同租客申请被拒', r.status === 400, JSON.stringify(r.j));

// 2. 租客申请退押金 → pending
r = await req('POST', '/tenant/refunds/apply', tTok, { apply_remark: '合同到期退押金' });
check('租客申请退押金 → pending', r.status === 200 && r.j.status === 'pending', JSON.stringify(r.j));
const rfId = r.j.id;

// 3. 重复申请被拦
r = await req('POST', '/tenant/refunds/apply', tTok, {});
check('重复申请被拦', r.status === 400, JSON.stringify(r.j));

// 4. 后台列表可见申请（source=tenant, pending）
r = await req('GET', '/refunds', adminTok);
const row = r.j.find(x => x.id === rfId);
check('后台列表可见租客申请', !!row && row.source === 'tenant' && row.status === 'pending', JSON.stringify(r.j));

// 5. 后台同意退押金
r = await req('POST', `/refunds/${rfId}/approve`, adminTok, {});
check('后台同意退押金', r.status === 200 && r.j.ok, JSON.stringify(r.j));

// 6. 同意后：合同 ended、房间 vacant、退款 done
r = await req('GET', '/contracts', adminTok);
const c = r.j.find(x => x.id === cid);
check('合同自动解除(ended)', c && c.status === 'ended', JSON.stringify(c));
r = await req('GET', `/rooms?property_id=${pid}`, adminTok);
const room = (r.j.rows || []).find(x => x.id === rid);
check('房间自动置空(vacant)', room && room.status === 'vacant', JSON.stringify(r.j));
r = await req('GET', '/refunds', adminTok);
check('退款状态 done', r.j.find(x => x.id === rfId).status === 'done');

// 7. 已处理申请不可重复审批
r = await req('POST', `/refunds/${rfId}/approve`, adminTok, {});
check('重复同意被拦', r.status === 400, JSON.stringify(r.j));

// 8. 驳回流程：租客2 建合同后申请 → 驳回 → 合同仍 active
r = await req('POST', '/contracts', adminTok, { tenant_id: tid2, room_id: rid, start_date: '2026-10-01', end_date: '2027-09-30', monthly_rent: 1200, deposit: 1200 });
const cid2 = r.j.id;
r = await req('POST', '/tenant/refunds/apply', tTok2, { apply_remark: '要退' });
const rfId2 = r.j.id;
r = await req('POST', `/refunds/${rfId2}/reject`, adminTok, { reason: '未到期，不退' });
check('后台驳回申请', r.status === 200 && r.j.ok, JSON.stringify(r.j));
r = await req('GET', '/refunds', adminTok);
check('驳回状态 rejected', r.j.find(x => x.id === rfId2).status === 'rejected');
r = await req('GET', '/contracts', adminTok);
check('驳回后合同仍生效', r.j.find(x => x.id === cid2).status === 'active');
r = await req('GET', `/rooms?property_id=${pid}`, adminTok);
check('驳回后房间仍已租', (r.j.rows || []).find(x => x.id === rid).status === 'rented');

// 9. 驳回缺原因 → 400
r = await req('POST', `/refunds/${rfId2}/reject`, adminTok, {});
check('驳回必填原因', r.status === 400, JSON.stringify(r.j));

// 10. 后台直接退押金兼容（原功能）
r = await req('POST', '/refunds', adminTok, { contract_id: cid2, amount: 500, remark: '部分退' });
check('后台直接退款兼容', r.status === 200 && r.j.refund_mode === 'manual', JSON.stringify(r.j));

// 11. 操作员权限隔离
r = await req('POST', '/admin-users', adminTok, { username: `oprefund${rnd}`, password: 'op123456', display_name: '退押金操作员' });
const opId = r.j.id;
r = await req('POST', '/admin-users', adminTok, { username: `oprefund2${rnd}`, password: 'op123456', display_name: '退押金操作员2' });
const opId2 = r.j.id;
let { j: opLogin } = await req('POST', '/auth/login', null, { username: `oprefund${rnd}`, password: 'op123456' });
const opTok = opLogin.token;
let { j: opLogin2 } = await req('POST', '/auth/login', null, { username: `oprefund2${rnd}`, password: 'op123456' });
const opTok2 = opLogin2.token;
r = await req('GET', '/refunds', opTok);
check('操作员无授权项目列表为空', r.j.length === 0);
r = await req('PUT', `/admin-users/${opId}/grants`, adminTok, { property_ids: [pid] });
check('授权操作员项目', r.status === 200, JSON.stringify(r.j));
r = await req('GET', '/refunds', opTok);
check('授权后操作员可见退款', r.j.length >= 1, JSON.stringify(r.j));
r = await req('GET', '/refunds', opTok2);
check('未授权操作员仍不可见', r.j.length === 0);
// 操作员审批自己授权范围内的申请
r = await req('POST', '/tenant/refunds/apply', tTok2, {});
check('租客2 再次申请', r.status === 200 && r.j.status === 'pending', JSON.stringify(r.j));
const rfId3 = r.j.id;
r = await req('POST', `/refunds/${rfId3}/approve`, opTok2, {});
check('未授权操作员审批被拒', r.status === 403, JSON.stringify(r.j));
r = await req('POST', `/refunds/${rfId3}/approve`, opTok, {});
check('授权操作员可审批', r.status === 200 && r.j.ok, JSON.stringify(r.j));

console.log(`\n=== ${pass} passed / ${fail} failed ===`);
process.exit(fail ? 1 : 0);
