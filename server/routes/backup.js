// 数据备份与恢复：本地备份 + 多后端远程备份（S3/COS/OSS、FTP、WebDAV、OneDrive）+ 周期自动备份 + 导入恢复
import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { db, DATA_DIR, DB_PATH } from '../db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { remoteCfg, remoteReady, remoteUpload, remoteDelete, ensureOdToken } from '../lib/storage.js';
import { odAuthUrl, odExchangeToken } from '../lib/onedrive.js';

const r = Router();
// 备份恢复仅主管理员可用
r.use(auth, adminOnly);
const BACKUP_DIR = join(DATA_DIR, 'backups');
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const getCfg = () => {
  const row = key => (db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) || {}).value;
  return {
    auto_enabled: row('backup_auto_enabled') === '1',
    auto_interval_hours: parseInt(row('backup_auto_interval_hours') || '24', 10),
    auto_remote: row('backup_auto_remote') === '1',
    keep: parseInt(row('backup_keep') || '10', 10)
  };
};
const ts = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); // YYYYMMDDHHmmss
let odState = ''; // OneDrive 授权 state（防 CSRF，内存态）

// 备份列表
r.get('/', auth, (req, res) => {
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = statSync(join(BACKUP_DIR, f));
      return { file: f, size: st.size, time: st.mtime.toISOString().slice(0, 19).replace('T', ' '), kind: f.startsWith('pre_restore_') ? '恢复前快照' : '备份' };
    })
    .sort((a, b) => b.time.localeCompare(a.time));
  const cfg = getCfg();
  const rc = remoteCfg(db);
  const last = (db.prepare(`SELECT value FROM settings WHERE key='backup_last_at'`).get() || {}).value || '';
  res.json({
    rows: files,
    auto: { enabled: cfg.auto_enabled, interval_hours: cfg.auto_interval_hours, remote: cfg.auto_remote, keep: cfg.keep },
    remote_type: rc.type,
    remote_ready: remoteReady(rc),
    remote_config: {
      s3: { bucket: rc.s3.bucket, region: rc.s3.region, prefix: rc.s3.prefix },
      ftp: { host: rc.ftp.host, port: rc.ftp.port, path: rc.ftp.path, user: rc.ftp.user },
      webdav: { url: rc.webdav.url, path: rc.webdav.path, user: rc.webdav.user },
      od: { client_id: rc.od.client_id, folder: rc.od.folder, endpoint: rc.od.endpoint, authorized: !!(rc.od.access_token && rc.od.refresh_token) }
    },
    last_at: last
  });
});

// 创建备份（可选同步到远程）
r.post('/', auth, async (req, res) => {
  const { remote } = req.body || {};
  const cfg = getCfg();
  db.pragma('wal_checkpoint(TRUNCATE)');
  const file = `lukejia-${ts()}.db`;
  copyFileSync(DB_PATH, join(BACKUP_DIR, file));
  let remote_ok = false, remote_err = '';
  if (remote) {
    try {
      const rc = remoteCfg(db);
      if (!remoteReady(rc)) throw new Error('远程存储未配置完整');
      await ensureOdToken(db, rc);
      await remoteUpload(rc, file, join(BACKUP_DIR, file));
      remote_ok = true;
    } catch (e) { remote_err = e.message; }
  }
  // 自动清理超出保留份数的旧备份
  const all = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db') && !f.startsWith('pre_restore_')).sort().reverse();
  const drop = all.slice(cfg.keep);
  for (const f of drop) {
    unlinkSync(join(BACKUP_DIR, f));
    try {
      const rc = remoteCfg(db);
      if (remoteReady(rc)) { await ensureOdToken(db, rc); await remoteDelete(rc, f); }
    } catch (e) { /* 忽略远程清理失败 */ }
  }
  db.prepare(`UPDATE settings SET value=? WHERE key='backup_last_at'`).run(ts());
  res.json({ ok: true, file, remote_ok, remote_err });
});

// 下载备份
r.get('/:file/download', auth, (req, res) => {
  const file = basename(req.params.file);
  if (!/^[\w.-]+\.db$/.test(file)) return res.status(400).json({ error: '非法文件名' });
  const p = join(BACKUP_DIR, file);
  if (!existsSync(p)) return res.status(404).json({ error: '备份不存在' });
  res.download(p, file);
});

// 删除备份
r.delete('/:file', auth, async (req, res) => {
  const file = basename(req.params.file);
  if (!/^[\w.-]+\.db$/.test(file)) return res.status(400).json({ error: '非法文件名' });
  const p = join(BACKUP_DIR, file);
  if (!existsSync(p)) return res.status(404).json({ error: '备份不存在' });
  unlinkSync(p);
  try {
    const rc = remoteCfg(db);
    if (remoteReady(rc)) { await ensureOdToken(db, rc); await remoteDelete(rc, file); }
  } catch (e) { /* 远程删除失败不影响本地 */ }
  res.json({ ok: true });
});

// 恢复（导入）：先自动快照当前库，再覆盖，随后服务自动重启
r.post('/restore', auth, async (req, res) => {
  const file = basename((req.body || {}).file || '');
  if (!/^[\w.-]+\.db$/.test(file)) return res.status(400).json({ error: '非法文件名' });
  const p = join(BACKUP_DIR, file);
  if (!existsSync(p)) return res.status(404).json({ error: '备份不存在' });
  if (!existsSync(DB_PATH)) return res.status(500).json({ error: '数据库路径异常' });
  // 1 当前库 checkpoint 后快照（恢复保险）
  db.pragma('wal_checkpoint(TRUNCATE)');
  const snap = `pre_restore_${ts()}.db`;
  copyFileSync(DB_PATH, join(BACKUP_DIR, snap));
  // 2 覆盖数据库文件，清除 WAL/SHM
  copyFileSync(p, DB_PATH);
  rmSync(DB_PATH + '-wal', { force: true });
  rmSync(DB_PATH + '-shm', { force: true });
  // 3 重启进程（systemd 自动拉起）
  setTimeout(() => process.exit(0), 800);
  res.json({ ok: true, restarting: true, snapshot: snap });
});

// OneDrive 授权：生成授权链接
r.get('/onedrive/auth', auth, (req, res) => {
  const rc = remoteCfg(db);
  if (!rc.od.client_id) return res.status(400).json({ error: '请先保存 OneDrive 应用配置（Client ID）' });
  odState = randomBytes(16).toString('hex');
  const redirectUri = `${req.protocol}://${req.get('host')}/api/backups/onedrive/callback`;
  res.json({ url: odAuthUrl(rc.od, odState, redirectUri), redirect_uri: redirectUri });
});

// OneDrive OAuth 回调（浏览器跳转，无 auth）
r.get('/onedrive/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.type('html').send(`<meta charset="utf-8"><h3>OneDrive 授权失败：${error_description || error}</h3><p>请关闭窗口返回后台重试。</p>`);
  if (!code || state !== odState) return res.status(400).type('html').send('<meta charset="utf-8"><h3>授权校验失败（state 不匹配）</h3><p>请关闭窗口，从后台重新发起授权。</p>');
  const rc = remoteCfg(db);
  const redirectUri = `${req.protocol}://${req.get('host')}/api/backups/onedrive/callback`;
  try {
    const t = await odExchangeToken(rc.od, code, redirectUri);
    const stmt = db.prepare('UPDATE settings SET value=? WHERE key=?');
    stmt.run(t.access_token, 'backup_od_access_token');
    stmt.run(t.refresh_token, 'backup_od_refresh_token');
    stmt.run(String(Date.now() + t.expires_in * 1000), 'backup_od_expires_at');
    res.type('html').send(`<meta charset="utf-8"><h3>✅ OneDrive 授权成功</h3><p>现在可以关闭此窗口，返回后台使用「备份并上传远程」。</p>`);
  } catch (e) {
    res.type('html').send(`<meta charset="utf-8"><h3>OneDrive 授权失败：${e.message}</h3><p>请关闭窗口返回后台检查配置后重试。</p>`);
  }
});

// 周期自动备份定时器（每 10 分钟检查一次）
function startAutoBackup() {
  const tick = async () => {
    try {
      const cfg = getCfg();
      if (!cfg.auto_enabled) return;
      const last = (db.prepare(`SELECT value FROM settings WHERE key='backup_last_at'`).get() || {}).value || '';
      const now = new Date();
      const lastDate = last ? new Date(last.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')) : new Date(0);
      const hours = (now - lastDate) / 3600000;
      if (hours >= cfg.auto_interval_hours) {
        const file = `lukejia-${ts()}.db`;
        db.pragma('wal_checkpoint(TRUNCATE)');
        copyFileSync(DB_PATH, join(BACKUP_DIR, file));
        if (cfg.auto_remote) {
          try {
            const rc = remoteCfg(db);
            if (remoteReady(rc)) { await ensureOdToken(db, rc); await remoteUpload(rc, file, join(BACKUP_DIR, file)); }
          } catch (e) { console.log('[backup] 远程自动备份失败:', e.message); }
        }
        const all = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db') && !f.startsWith('pre_restore_')).sort().reverse();
        for (const f of all.slice(cfg.keep)) { try { unlinkSync(join(BACKUP_DIR, f)); } catch (e) { /* ignore */ } }
        db.prepare(`UPDATE settings SET value=? WHERE key='backup_last_at'`).run(ts());
        console.log('[backup] 自动备份完成:', file);
      }
    } catch (e) { console.log('[backup] 自动备份异常:', e.message); }
  };
  tick();
  setInterval(tick, 10 * 60 * 1000);
}

startAutoBackup();
export default r;
