// 腾讯云人脸核身（慧眼）· 身份信息核验（非人脸版）
// 二要素：姓名+身份证  CheckIdCardInformation
// 三要素：姓名+身份证+手机号  PhoneVerification
// TC3-HMAC-SHA256 签名，零依赖（仅 node 内置 crypto/https）
import crypto from 'crypto';
import https from 'https';
import { db } from '../db.js';

const HOST = 'faceid.tencentcloudapi.com';
const SERVICE = 'faceid';
const VERSION = '2018-03-01';
const REGION = 'ap-guangzhou';

function cfg() {
  return {
    secretId: (db.prepare(`SELECT value FROM settings WHERE key='tencent_secret_id'`).get() || {}).value || '',
    secretKey: (db.prepare(`SELECT value FROM settings WHERE key='tencent_secret_key'`).get() || {}).value || '',
    region: (db.prepare(`SELECT value FROM settings WHERE key='tencent_verify_region'`).get() || {}).value || REGION,
  };
}

function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg, 'utf8').digest(); }
function sha256Hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function httpsPost(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: 'POST', headers, timeout: 10000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('响应解析失败: ' + d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('腾讯云接口请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 腾讯云 API 3.0 TC3 签名调用
async function callTencent(action, payload) {
  const { secretId, secretKey, region } = cfg();
  if (!secretId || !secretKey) throw new Error('未配置腾讯云密钥，请在系统设置填写 tencent_secret_id / tencent_secret_key');
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10); // UTC
  const body = JSON.stringify(payload);
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(body)}`;
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${ts}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const data = await httpsPost(HOST, '/', {
    'Content-Type': contentType,
    Host: HOST,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(ts),
    'X-TC-Version': VERSION,
    'X-TC-Region': region,
    Authorization: authorization,
  }, body);
  const resp = data.Response || {};
  if (resp.Error) throw new Error(resp.Error.Message || '核验接口调用失败');
  return resp;
}

// 二要素核验：姓名 + 身份证号（Action=IdCardVerification；Result "0"=一致）
export async function idCardVerify(name, idcard) {
  const r = await callTencent('IdCardVerification', { Name: String(name).trim(), IdCard: String(idcard).trim().toUpperCase() });
  return { ok: String(r.Result) === '0', desc: r.Description || '' };
}

// 三要素核验：姓名 + 身份证号 + 手机号（Action=PhoneVerification；Result "0"=一致）
export async function phoneVerify(name, idcard, phone) {
  const r = await callTencent('PhoneVerification', {
    Name: String(name).trim(), IdCard: String(idcard).trim().toUpperCase(), Phone: String(phone).trim(),
  });
  return { ok: String(r.Result) === '0', desc: r.Description || '' };
}
