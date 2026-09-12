// 轻量 S3 兼容客户端（SigV4 签名，零依赖）
// 兼容腾讯云 COS / 阿里云 OSS 等所有 S3 兼容对象存储
import { createHmac, createHash } from 'node:crypto';
import { request } from 'node:https';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const hmacHex = (key, data) => createHmac('sha256', key).update(data).digest('hex');

function sign(key, date, region, service, stringToSign) {
  const kDate = hmac(`AWS4${key}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  return hmacHex(kSigning, stringToSign);
}

function buildSignedRequest({ method, host, path, query, payload, secretId, secretKey, region, service }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);
  const canonicalUri = encodeURI(path).replace(/%2F/g, '/');
  const canonicalQuery = Object.keys(query || {}).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const headers = {
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join('');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = sign(secretKey, date, region, service, stringToSign);
  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, payload };
}

function s3Request({ method, bucket, region, key, payload = Buffer.alloc(0), secretId, secretKey, service = 's3', query }) {
  const host = `${bucket}.cos.${region}.myqcloud.com`; // 腾讯云 COS
  const path = `/${key}`;
  const { headers, payload: body } = buildSignedRequest({
    method, host, path, query, payload,
    secretId, secretKey, region, service
  });
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: host, port: 443, method, path, headers,
      timeout: 30000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: buf });
        else reject(new Error(`S3 ${method} ${key} -> ${res.statusCode}: ${buf.toString().slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('S3 请求超时')));
    if (body.length) req.write(body);
    req.end();
  });
}

// 上传（支持任意 S3 兼容域名，可通过 bucketHost 覆盖默认 cos 域名）
export async function s3Put({ bucket, region, key, data, secretId, secretKey, endpoint }) {
  const host = endpoint || `${bucket}.cos.${region}.myqcloud.com`;
  const { headers, payload } = buildSignedRequest({
    method: 'PUT', host, path: `/${key}`, query: {}, payload: data,
    secretId, secretKey, region, service: 's3'
  });
  return new Promise((resolve, reject) => {
    const req = request({ hostname: host, port: 443, method: 'PUT', path: `/${key}`, headers, timeout: 60000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode });
        else reject(new Error(`COS 上传失败 -> ${res.statusCode}: ${buf.toString().slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('COS 上传超时')));
    req.write(payload);
    req.end();
  });
}

export async function s3Get({ bucket, region, key, secretId, secretKey, endpoint }) {
  const host = endpoint || `${bucket}.cos.${region}.myqcloud.com`;
  const { headers } = buildSignedRequest({
    method: 'GET', host, path: `/${key}`, query: {}, payload: Buffer.alloc(0),
    secretId, secretKey, region, service: 's3'
  });
  return new Promise((resolve, reject) => {
    const req = request({ hostname: host, port: 443, method: 'GET', path: `/${key}`, headers, timeout: 60000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(buf);
        else reject(new Error(`COS 下载失败 -> ${res.statusCode}: ${buf.toString().slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('COS 下载超时')));
    req.end();
  });
}

export async function s3Delete({ bucket, region, key, secretId, secretKey, endpoint }) {
  const host = endpoint || `${bucket}.cos.${region}.myqcloud.com`;
  const { headers } = buildSignedRequest({
    method: 'DELETE', host, path: `/${key}`, query: {}, payload: Buffer.alloc(0),
    secretId, secretKey, region, service: 's3'
  });
  return new Promise((resolve, reject) => {
    const req = request({ hostname: host, port: 443, method: 'DELETE', path: `/${key}`, headers, timeout: 30000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode });
        else reject(new Error(`COS 删除失败 -> ${res.statusCode}: ${buf.toString().slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('COS 删除超时')));
    req.end();
  });
}
