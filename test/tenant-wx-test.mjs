// 路客家 微信登录 API 测试（wx-login / 注册绑定 / 登录绑定 / 冲突校验）
const BASE = 'http://127.0.0.1:3110/api';
let asserts = 0;

async function call(method, path, body, t) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(cond, label) {
  if (!cond) throw new Error('断言失败: ' + label);
  asserts++;
  console.log(`[OK] ${label}`);
}

// 1 未配置小程序 → wx-login 应提示未开通
let r = await call('POST', '/tenant/wx-login', { code: 'test-code-1' });
assert(r.status === 400 && String(r.data.error).includes('未开通'), '未配置 AppID/Secret 时 wx-login 返回未开通');

// 2 缺 code → 400
r = await call('POST', '/tenant/wx-login', {});
assert(r.status === 400, 'wx-login 缺 code 返回 400');

// 3 注册并绑定 openid（新手机号 13900002222）
const phone = '13900002222';
const idCard = '610102199301123456';
const openidA = 'openid_test_A_001';
r = await call('POST', '/tenant/register', { name: '王五', phone, id_card: idCard, openid: openidA });
assert(r.status === 200, '注册带 openid 成功');
const tenantId = r.data.id;

// 4 同一 openid 重复注册 → 400
r = await call('POST', '/tenant/register', { name: '王五2', phone: '13900003333', id_card: '610102199401123456', openid: openidA });
assert(r.status === 400 && String(r.data.error).includes('已绑定'), 'openid 已被占用时注册被拒');

// 5 登录绑定 openid（另一租客 13900004444，绑 openidB）
r = await call('POST', '/tenant/register', { name: '赵六', phone: '13900004444', id_card: '610102199501123456' });
const tenant2Id = r.data.id;
const openidB = 'openid_test_B_002';
r = await call('POST', '/tenant/login', { phone: '13900004444', id_card: '610102199501123456', openid: openidB });
assert(r.status === 200 && r.data.bound === true, '手机+身份证登录绑定 openid 成功');

// 6 openidA 已被 tenant1 绑定，tenant2 用 openidA 登录绑定 → 400
r = await call('POST', '/tenant/login', { phone: '13900004444', id_card: '610102199501123456', openid: openidA });
assert(r.status === 400 && String(r.data.error).includes('已绑定'), '他人 openid 绑定被拒');

// 7 openidA 对应的租客（王五）手机+身份证登录 → 正常
r = await call('POST', '/tenant/login', { phone, id_card: idCard });
assert(r.status === 200, '原手机+身份证登录不受影响');

// 8 注册的 openid 已入库（租客1）
r = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
const adminToken = r.data.token;
r = await call('GET', `/tenants/${tenantId}`, null, adminToken);
assert(r.status === 200 && r.data.tenant && r.data.tenant.wechat_openid === openidA, '注册绑定的 openid 已持久化');

// 9 配置 AppID/Secret 后 code 无效 → 微信 API 返回错误（验证错误处理不 500）
r = await call('PUT', '/settings', { wechat_mini_appid: 'wx_mock_appid', wechat_mini_secret: 'mock_secret_123' }, adminToken);
assert(r.status === 200, '测试环境写入 mock appid/secret');
r = await call('POST', '/tenant/wx-login', { code: 'invalid-code-xyz' });
assert(r.status === 400, 'code 无效时微信 API 错误被正确返回（不 500）');
// 清理：恢复空配置，避免影响其他测试
r = await call('PUT', '/settings', { wechat_mini_appid: '', wechat_mini_secret: '' }, adminToken);
assert(r.status === 200, '恢复空配置');

// 10 清理测试数据（删租客前先删其合同/账单，这里只删注册的两个租客）
r = await call('DELETE', `/tenants/${tenant2Id}`, null, adminToken);
r = await call('DELETE', `/tenants/${tenantId}`, null, adminToken);

console.log(`\n=== 微信登录测试全部通过（${asserts} 断言）===`);
