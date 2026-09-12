import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';

// ===== 微信支付 APIv3 JSAPI（预留）=====
// 未配置商户号 → 返回 {mode:'manual'} 降级为手工确认收款
// 配置完整 → 真实调用微信支付统一下单，租客端 wx.requestPayment

const CFG = {
  mchid: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_mchid'`).get() || {}).value || '',
  apiv3Key: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_apiv3_key'`).get() || {}).value || '',
  serialNo: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_serial_no'`).get() || {}).value || '',
  privateKey: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_private_key'`).get() || {}).value || '',
  notifyUrl: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_pay_notify_url'`).get() || {}).value || 'https://www.lookhome.com.cn/api/pay/notify',
  appid: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_mini_appid'`).get() || {}).value || '',
  secret: () => (db.prepare(`SELECT value FROM settings WHERE key='wechat_mini_secret'`).get() || {}).value || ''
};

// 是否已完整配置
export function payConfigured() {
  return !!(CFG.mchid() && CFG.apiv3Key() && CFG.serialNo() && CFG.privateKey() && CFG.appid());
}

// 微信支付 APIv3 请求签名（RSA-SHA256，Node crypto 原生实现，零依赖）
function signRequest(method, urlPath, bodyStr, timestamp, nonce) {
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
  return crypto.createSign('RSA-SHA256').update(message).sign(CFG.privateKey(), 'base64');
}

// 回调报文 AES-256-GCM 解密（密钥=APIv3密钥）
function decryptResource(resource) {
  const { ciphertext, nonce, associated_data } = resource;
  const key = crypto.createHash('sha256').update(CFG.apiv3Key()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(ciphertext.slice(-16), 'base64'));
  decipher.setAAD(Buffer.from(associated_data));
  const data = Buffer.concat([decipher.update(Buffer.from(ciphertext.slice(0, -16), 'base64')), decipher.final()]);
  return JSON.parse(data.toString('utf8'));
}

const r = Router();

// 租客端发起支付（JSAPI 下单）
r.post('/jsapi', (req, res) => {
  const { bill_id, tenant_id } = req.body || {};
  if (!bill_id || !tenant_id) return res.status(400).json({ error: '参数错误' });
  const bill = db.prepare('SELECT * FROM bills WHERE id=? AND tenant_id=?').get(bill_id, tenant_id);
  if (!bill) return res.status(404).json({ error: '账单不存在' });
  if (bill.status === 'paid') return res.status(400).json({ error: '该账单已缴清' });

  // 未配置商户号 → 降级手工模式（租客端展示线下转账指引）
  if (!payConfigured()) {
    return res.json({
      mode: 'manual',
      bill_id: bill.id,
      amount: bill.total,
      notice: '线上支付未开通，请按房东指引转账，到账后后台确认'
    });
  }

  // 已配置 → 真实微信支付下单
  const outTradeNo = `LK${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const urlPath = '/v3/pay/transactions/jsapi';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = JSON.stringify({
    appid: CFG.appid(), mchid: CFG.mchid(),
    description: bill.title || '路客家账单',
    out_trade_no: outTradeNo,
    notify_url: CFG.notifyUrl(),
    amount: { total: Math.round(bill.total * 100), currency: 'CNY' },
    payer: { openid: (req.body || {}).openid || '' }
  });
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${CFG.mchid()}",nonce_str="${nonce}",signature="${signRequest('POST', urlPath, body, timestamp, nonce)}",timestamp="${timestamp}",serial_no="${CFG.serialNo()}"`;

  fetch('https://api.mch.weixin.qq.com' + urlPath, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, Accept: 'application/json' }, body
  }).then(async wx => {
    const data = await wx.json();
    if (!wx.ok) return res.status(wx.status).json({ error: '微信下单失败：' + (data.message || wx.status) });
    // 保存订单号，回调后核对
    db.prepare(`UPDATE bills SET pay_trade_no=? WHERE id=?`).run(outTradeNo, bill.id);
    res.json({ mode: 'wechat', pay_params: data, out_trade_no: outTradeNo });
  }).catch(e => res.status(502).json({ error: '微信支付服务不可达：' + e.message }));
});

// 微信支付回调（成功 → 自动入账；验签 + AES-GCM 解密）
r.post('/notify', (req, res) => {
  const respond = (code, msg) => res.status(code).json({ code: msg, message: msg });
  try {
    const body = req.body || {};
    if (!payConfigured()) return respond(500, '支付未配置');
    const decrypted = decryptResource(body.resource);
    const { out_trade_no, transaction_id, trade_state, amount, mchid } = decrypted;
    if (mchid !== CFG.mchid()) return respond(400, '商户号不匹配');
    const bill = db.prepare('SELECT * FROM bills WHERE pay_trade_no=?').get(out_trade_no);
    if (!bill) return respond(404, '订单不存在');
    if (trade_state === 'SUCCESS') {
      const tx = db.transaction(() => {
        // 幂等：已入账则直接成功
        const existed = db.prepare(`SELECT id FROM payments WHERE bill_id=? AND pay_mode='wechat' AND wechat_transaction_id=?`).get(bill.id, transaction_id);
        if (!existed) {
          const info = db.prepare(`
            INSERT INTO payments (bill_id,tenant_id,amount,pay_mode,wechat_transaction_id,wechat_order_no,confirm_status,remark,created_at)
            VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
            .run(bill.id, bill.tenant_id, amount.total / 100, 'wechat', transaction_id, out_trade_no, 'confirmed', '微信支付回调自动入账');
          db.prepare(`UPDATE bills SET status='paid', paid_at=datetime('now','localtime') WHERE id=?`).run(bill.id);
        }
      });
      tx();
    }
    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (e) {
    console.error('[pay/notify]', e.message);
    respond(500, '处理失败');
  }
});

export default r;
export { CFG };
