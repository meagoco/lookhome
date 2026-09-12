// 统一远程存储后端：s3（COS/OSS）/ ftp / webdav / onedrive
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { Client } from 'basic-ftp';
import { s3Put, s3Get, s3Delete } from './s3.js';
import { odUpload, odDelete, odRefresh } from './onedrive.js';

export const STORAGE_TYPES = ['s3', 'ftp', 'webdav', 'onedrive'];

// 读取远程配置（按类型）
export function remoteCfg(db) {
  const row = key => (db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) || {}).value;
  return {
    type: row('backup_remote_type') || 's3',
    s3: {
      bucket: row('backup_cos_bucket') || '', region: row('backup_cos_region') || 'ap-guangzhou',
      secret_id: row('backup_cos_secret_id') || '', secret_key: row('backup_cos_secret_key') || '',
      prefix: row('backup_cos_prefix') || 'lukejia-backup/'
    },
    ftp: {
      host: row('backup_ftp_host') || '', port: parseInt(row('backup_ftp_port') || '21', 10),
      user: row('backup_ftp_user') || '', pass: row('backup_ftp_pass') || '',
      path: row('backup_ftp_path') || '/lukejia-backup/'
    },
    webdav: {
      url: row('backup_webdav_url') || '', user: row('backup_webdav_user') || '', pass: row('backup_webdav_pass') || '',
      path: row('backup_webdav_path') || 'lukejia-backup/'
    },
    od: {
      client_id: row('backup_od_client_id') || '', client_secret: row('backup_od_client_secret') || '',
      folder: row('backup_od_folder') || 'lukejia-backup', endpoint: row('backup_od_endpoint') || 'global',
      access_token: row('backup_od_access_token') || '', refresh_token: row('backup_od_refresh_token') || '',
      expires_at: parseInt(row('backup_od_expires_at') || '0', 10)
    }
  };
}

export function remoteReady(cfg) {
  switch (cfg.type) {
    case 's3': return !!(cfg.s3.bucket && cfg.s3.secret_id && cfg.s3.secret_key);
    case 'ftp': return !!(cfg.ftp.host && cfg.ftp.user);
    case 'webdav': return !!(cfg.webdav.url && cfg.webdav.user);
    case 'onedrive': return !!(cfg.od.client_id && cfg.od.refresh_token);
    default: return false;
  }
}

// 上传备份文件
export async function remoteUpload(cfg, file, filePath) {
  const data = readFileSync(filePath);
  switch (cfg.type) {
    case 's3':
      await s3Put({ bucket: cfg.s3.bucket, region: cfg.s3.region, key: cfg.s3.prefix + file, data, secretId: cfg.s3.secret_id, secretKey: cfg.s3.secret_key });
      break;
    case 'ftp':
      await ftpOp(cfg.ftp, async c => {
        await c.ensureDir(cfg.ftp.path);
        await c.uploadFrom(filePath, file);
      });
      break;
    case 'webdav':
      await webdavPut(cfg.webdav, cfg.webdav.path + file, data);
      break;
    case 'onedrive':
      await odUpload(cfg.od, file, data);
      break;
    default: throw new Error('未知远程存储类型');
  }
}

// 删除远程备份
export async function remoteDelete(cfg, file) {
  switch (cfg.type) {
    case 's3':
      await s3Delete({ bucket: cfg.s3.bucket, region: cfg.s3.region, key: cfg.s3.prefix + file, secretId: cfg.s3.secret_id, secretKey: cfg.s3.secret_key });
      break;
    case 'ftp':
      await ftpOp(cfg.ftp, async c => { try { await c.remove(cfg.ftp.path + file); } catch (e) { /* 文件不存在忽略 */ } });
      break;
    case 'webdav':
      await webdavDel(cfg.webdav, cfg.webdav.path + file);
      break;
    case 'onedrive':
      await odDelete(cfg.od, file);
      break;
    default: throw new Error('未知远程存储类型');
  }
}

// ---------- FTP ----------
async function ftpOp(cfg, fn) {
  const c = new Client();
  c.ftp.verbose = false;
  try {
    await c.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.pass, secure: false, timeout: 30000 });
    await fn(c);
  } finally {
    c.close();
  }
}

// ---------- WebDAV ----------
function webdavRequest(method, cfg, path, data) {
  const url = new URL(cfg.url);
  const target = new URL(path, url.origin);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: target.hostname, port: target.port || 443, method, path: target.pathname,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64'),
        ...(data ? { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length } : {}),
        'User-Agent': 'lukejia-backup'
      },
      timeout: 60000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode });
        else reject(new Error(`WebDAV ${method} ${path} -> ${res.statusCode}: ${buf.toString().slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('WebDAV 请求超时')));
    if (data) req.write(data);
    req.end();
  });
}

async function webdavPut(cfg, path, data) {
  // 尝试创建目录（忽略已存在错误）
  const dirs = path.split('/').slice(0, -1);
  let cur = '';
  for (const d of dirs) {
    cur += d + '/';
    try { await webdavRequest('MKCOL', cfg, cur, null); } catch (e) { /* 目录已存在则忽略 */ }
  }
  await webdavRequest('PUT', cfg, path, data);
}
async function webdavDel(cfg, path) {
  try { await webdavRequest('DELETE', cfg, path, null); } catch (e) { /* 不存在忽略 */ }
}

// OneDrive token 刷新入口（供 backup.js 在需要时刷新）
export async function ensureOdToken(db, cfg) {
  if (cfg.type !== 'onedrive') return cfg;
  const now = Date.now();
  if (cfg.od.access_token && cfg.od.expires_at > now + 60000) return cfg;
  if (!cfg.od.refresh_token) return cfg;
  try {
    const t = await odRefresh(cfg.od);
    cfg.od.access_token = t.access_token;
    cfg.od.refresh_token = t.refresh_token || cfg.od.refresh_token;
    cfg.od.expires_at = Date.now() + t.expires_in * 1000;
    const stmt = db.prepare('UPDATE settings SET value=? WHERE key=?');
    stmt.run(cfg.od.access_token, 'backup_od_access_token');
    stmt.run(cfg.od.refresh_token, 'backup_od_refresh_token');
    stmt.run(String(cfg.od.expires_at), 'backup_od_expires_at');
    return cfg;
  } catch (e) {
    throw new Error('OneDrive 授权已过期，请重新授权');
  }
}

export { readFileSync };
