// ===== 微信订阅消息服务（LookHome）=====
// 依赖：settings 表 wechat_mini_appid / wechat_mini_secret / wechat_template_pay / wechat_template_rent
// 模板 ID 未配置、租客未订阅或 openid 缺失时静默跳过，不影响正常流程。
// 字段自适应：发送前拉取已添加模板的字段结构（content 中 {{typeN.DATA}}），
// 按类型自动填充（amount/number→金额、date/time→日期、thing/name 等→描述），
// 用户后续更换模板也兼容。

import { db } from './db.js';

let tokenCache = { token: '', expires: 0 };
let fieldsCache = { ts: 0, map: {} };

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return (row && row.value) || '';
}

export function subscribeConfig() {
  return {
    template_pay: getSetting('wechat_template_pay'),
    template_booking: getSetting('wechat_template_booking'),
    template_refund: getSetting('wechat_template_refund'),
    appid: getSetting('wechat_mini_appid'),
    enabled: !!(getSetting('wechat_mini_appid') && getSetting('wechat_mini_secret'))
  };
}

async function getAccessToken() {
  if (tokenCache.token && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const appid = getSetting('wechat_mini_appid');
  const secret = getSetting('wechat_mini_secret');
  if (!appid || !secret) throw new Error('小程序 AppID/AppSecret 未配置');
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.access_token) throw new Error(`获取 access_token 失败: ${JSON.stringify(data)}`);
  tokenCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// 拉取模板字段 key 列表（5 分钟缓存）
async function getTemplateFieldKeys(templateId) {
  if (fieldsCache.map[templateId] && Date.now() - fieldsCache.ts < 300_000) return fieldsCache.map[templateId];
  try {
    const AT = await getAccessToken();
    const resp = await fetch(`https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${encodeURIComponent(AT)}`);
    const data = await resp.json();
    const tpl = (data.data || []).find(t => t.priTmplId === templateId);
    const keys = [];
    if (tpl?.content) {
      const re = /\{\{(\w+)\.DATA\}\}/g;
      let m;
      while ((m = re.exec(tpl.content)) !== null) keys.push(m[1]);
    }
    fieldsCache.map[templateId] = keys;
    fieldsCache.ts = Date.now();
    return keys;
  } catch (e) {
    console.log(`[wx-subscribe] 拉取模板字段失败: ${e.message}`);
    return [];
  }
}

/**
 * 发送微信订阅消息（字段自适应映射）
 * @param {object} opts { openid, templateId, data: {thing, amount, date}, page }
 */
export async function sendSubscribeMessage(opts) {
  if (!opts?.openid || !opts?.templateId) return { ok: false, skipped: 'missing' };
  try {
    const accessToken = await getAccessToken();
    const keys = await getTemplateFieldKeys(opts.templateId);
    const data = {};
    const things = Array.isArray(opts.data?.things) ? opts.data.things : [];
    let thingIdx = 0;
    for (const k of keys) {
      if (data[k]) continue;
      const type = k.replace(/\d+$/, '');
      if (type === 'amount' || type === 'number') data[k] = { value: String(opts.data?.amount ?? '') };
      else if (type === 'date' || type === 'time') data[k] = { value: String(opts.data?.date ?? opts.data?.time ?? '') };
      else {
        const v = things[thingIdx] ?? opts.data?.thing ?? '';
        thingIdx++;
        data[k] = { value: String(v) };
      }
    }
    const body = {
      touser: opts.openid,
      template_id: opts.templateId,
      page: opts.page || 'pages/home/home',
      lang: 'zh_CN',
      data
    };    const resp = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const rj = await resp.json();
    if (rj.errcode && rj.errcode !== 0) {
      console.log(`[wx-subscribe] 发送失败 errcode=${rj.errcode} errmsg=${rj.errmsg} keys=${keys.join(',')}`);
      return { ok: false, errcode: rj.errcode, errmsg: rj.errmsg };
    }
    // 发送成功：该次订阅授权已消耗（一次性模板），置 status=0 防止重复推送；last_used_at 用于续订提示
    try {
      db.prepare("UPDATE wechat_subscriptions SET status=0, last_used_at=datetime('now','localtime') WHERE openid=? AND template_key=? AND status=1")
        .run(opts.openid, opts.templateKey || 'pay');
    } catch { /* 忽略 */ }
    return { ok: true };
  } catch (e) {
    console.log(`[wx-subscribe] 发送异常: ${e.message}`);
    return { ok: false, errmsg: e.message };
  }
}

/**
 * 根据租客订阅记录发送提醒
 * @param {number} tenantId 租客id
 * @param {string} templateKey 'pay' | 'booking' | 'refund'
 * @param {object} data {thing, amount, date, things}
 */
export async function sendToTenant(tenantId, templateKey, data, page) {
  const tenant = db.prepare('SELECT id, wechat_openid FROM tenants WHERE id=?').get(tenantId);
  if (!tenant?.wechat_openid) return { ok: false, skipped: 'no-openid' };
  const sub = db.prepare("SELECT id FROM wechat_subscriptions WHERE openid=? AND template_key=? AND status=1").get(tenant.wechat_openid, templateKey);
  if (!sub) return { ok: false, skipped: 'not-subscribed' };
  const keyMap = { pay: 'wechat_template_pay', rent: 'wechat_template_rent', booking: 'wechat_template_booking', refund: 'wechat_template_refund' };
  const templateId = getSetting(keyMap[templateKey] || 'wechat_template_pay');
  if (!templateId) return { ok: false, skipped: 'no-template' };
  return sendSubscribeMessage({ openid: tenant.wechat_openid, templateKey, templateId, data, page: page || 'pages/home/home' });
}
