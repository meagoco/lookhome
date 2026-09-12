// OneDrive（Microsoft Graph）备份后端：OAuth 授权码流 + 文件上传/删除
// 支持国际版（graph.microsoft.com）与中国世纪互联版（microsoftgraph.chinacloudapi.cn）
import { request } from 'node:https';

const EP = {
  global: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    graph: 'https://graph.microsoft.com'
  },
  china: {
    authorize: 'https://login.partner.microsoftonline.cn/common/oauth2/v2.0/authorize',
    token: 'https://login.partner.microsoftonline.cn/common/oauth2/v2.0/token',
    graph: 'https://microsoftgraph.chinacloudapi.cn'
  }
};

function postForm(url, form) {
  const u = new URL(url);
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: u.hostname, port: 443, method: 'POST', path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try { resolve(JSON.parse(buf.toString())); } catch (e) { reject(new Error(`OneDrive 响应异常: ${buf.toString().slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('OneDrive 请求超时')));
    req.write(body);
    req.end();
  });
}

function graph(method, cfg, path, data) {
  const ep = EP[cfg.endpoint || 'global'];
  const u = new URL(ep.graph + path);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: u.hostname, port: 443, method, path: u.pathname,
      headers: {
        Authorization: 'Bearer ' + cfg.access_token,
        ...(data ? { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length } : {})
      },
      timeout: 60000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: buf });
        else reject(new Error(`OneDrive ${method} -> ${res.statusCode}: ${buf.toString().slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('OneDrive 请求超时')));
    if (data) req.write(data);
    req.end();
  });
}

// 换取 token（授权码 → token）
export async function odExchangeToken(cfg, code, redirectUri) {
  const ep = EP[cfg.endpoint || 'global'];
  const t = await postForm(ep.token, {
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: 'offline_access files.readwrite'
  });
  if (!t.access_token) throw new Error('OneDrive 授权失败: ' + (t.error_description || t.error || '未知错误'));
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in || 3600 };
}

// 刷新 token
export async function odRefresh(cfg) {
  const ep = EP[cfg.endpoint || 'global'];
  const t = await postForm(ep.token, {
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token: cfg.refresh_token,
    grant_type: 'refresh_token',
    scope: 'offline_access files.readwrite'
  });
  if (!t.access_token) throw new Error('OneDrive token 刷新失败: ' + (t.error_description || t.error || ''));
  return { access_token: t.access_token, refresh_token: t.refresh_token || cfg.refresh_token, expires_in: t.expires_in || 3600 };
}

// 上传备份文件到 OneDrive 应用目录
export async function odUpload(cfg, file, data) {
  await graph('PUT', cfg, `/me/drive/root:/Apps/${cfg.folder}/${file}:/content`, data);
}

// 删除
export async function odDelete(cfg, file) {
  try { await graph('DELETE', cfg, `/me/drive/root:/Apps/${cfg.folder}/${file}:`); } catch (e) { /* 不存在忽略 */ }
}

// 生成授权链接
export function odAuthUrl(cfg, state, redirectUri) {
  const ep = EP[cfg.endpoint || 'global'];
  const p = new URLSearchParams({
    client_id: cfg.client_id,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'offline_access files.readwrite',
    response_mode: 'query',
    state
  });
  return ep.authorize + '?' + p.toString();
}
