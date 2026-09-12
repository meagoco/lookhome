import { Router } from 'express';
import { db } from '../db.js';
import { auth, adminOnly } from '../middleware/auth.js';

const r = Router();

// 敏感配置脱敏
const SENSITIVE = new Set(['wechat_pay_apiv3_key', 'wechat_pay_private_key', 'wechat_mini_secret', 'tencent_secret_key', 'smtp_pass', 'backup_cos_secret_key', 'backup_ftp_pass', 'backup_webdav_pass', 'backup_od_client_secret', 'backup_od_access_token', 'backup_od_refresh_token']);
const mask = (k, v) => (SENSITIVE.has(k) && v ? (v.length > 8 ? v.slice(0, 4) + '****' + v.slice(-4) : '****') : v);

// 读取配置：主管理员全部；操作员仅精简公开信息（站点名 + 开关模式）
r.get('/', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    const siteName = (db.prepare(`SELECT value FROM settings WHERE key='site_name'`).get() || {}).value || '路客家';
    const rm = (db.prepare(`SELECT value FROM settings WHERE key='realname_verify_mode'`).get() || {}).value || 'manual';
    const pm = (db.prepare(`SELECT value FROM settings WHERE key='payment_confirm_mode'`).get() || {}).value || 'manual';
    return res.json({ site: { site_name: siteName }, switches: { realname_verify_mode: rm, payment_confirm_mode: pm } });
  }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const data = {};
  for (const row of rows) data[row.key] = mask(row.key, row.value);
  res.json({
    site: {
      site_name: data.site_name, site_logo: data.site_logo, site_icp: data.site_icp, site_url: data.site_url
    },
    switches: {
      realname_verify_mode: data.realname_verify_mode,
      payment_confirm_mode: data.payment_confirm_mode
    },
    wechat_mini: {
      appid: data.wechat_mini_appid,
      appsecret_set: !!data.wechat_mini_secret,
      template_pay: data.wechat_template_pay,
      template_rent: data.wechat_template_rent
    },
    wechat_pay: {
      mchid: data.wechat_pay_mchid,
      apiv3_key_set: !!data.wechat_pay_apiv3_key,
      serial_no: data.wechat_pay_serial_no,
      private_key_set: !!data.wechat_pay_private_key,
      notify_url: data.wechat_pay_notify_url
    },
    tencent_verify: {
      secret_id: data.tencent_secret_id,
      secret_key_set: !!data.tencent_secret_key,
      region: data.tencent_verify_region
    },
    smtp: {
      host: data.smtp_host, port: data.smtp_port, user: data.smtp_user,
      pass_set: !!data.smtp_pass, from: data.smtp_from, secure: data.smtp_secure === '1' ? '1' : '0'
    },
    backup: {
      remote_type: data.backup_remote_type || 's3',
      auto_enabled: data.backup_auto_enabled === '1' ? '1' : '0',
      auto_interval_hours: data.backup_auto_interval_hours || '24',
      auto_remote: data.backup_auto_remote === '1' ? '1' : '0',
      keep: data.backup_keep || '10',
      s3: {
        bucket: data.backup_cos_bucket, region: data.backup_cos_region,
        secret_id: data.backup_cos_secret_id, secret_key_set: !!data.backup_cos_secret_key,
        prefix: data.backup_cos_prefix
      },
      ftp: {
        host: data.backup_ftp_host, port: data.backup_ftp_port, user: data.backup_ftp_user,
        pass_set: !!data.backup_ftp_pass, path: data.backup_ftp_path
      },
      webdav: {
        url: data.backup_webdav_url, user: data.backup_webdav_user,
        pass_set: !!data.backup_webdav_pass, path: data.backup_webdav_path
      },
      od: {
        client_id: data.backup_od_client_id, client_secret_set: !!data.backup_od_client_secret,
        folder: data.backup_od_folder, endpoint: data.backup_od_endpoint,
        authorized: !!(data.backup_od_access_token && data.backup_od_refresh_token)
      }
    }
  });
});

// 更新配置（白名单）
const ALLOWED = new Set([
  'site_name', 'site_logo', 'site_icp', 'site_url',
  'realname_verify_mode', 'payment_confirm_mode',
  'wechat_mini_appid', 'wechat_mini_secret', 'wechat_template_pay', 'wechat_template_rent',
  'wechat_pay_mchid', 'wechat_pay_apiv3_key', 'wechat_pay_serial_no', 'wechat_pay_private_key', 'wechat_pay_notify_url',
  'tencent_secret_id', 'tencent_secret_key', 'tencent_verify_region',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'backup_auto_enabled', 'backup_auto_interval_hours', 'backup_auto_remote', 'backup_keep',
  'backup_remote_type',
  'backup_cos_bucket', 'backup_cos_region', 'backup_cos_secret_id', 'backup_cos_secret_key', 'backup_cos_prefix',
  'backup_ftp_host', 'backup_ftp_port', 'backup_ftp_user', 'backup_ftp_pass', 'backup_ftp_path',
  'backup_webdav_url', 'backup_webdav_user', 'backup_webdav_pass', 'backup_webdav_path',
  'backup_od_client_id', 'backup_od_client_secret', 'backup_od_folder', 'backup_od_endpoint'
]);
r.put('/', auth, adminOnly, (req, res) => {
  const body = req.body || {};
  const stmt = db.prepare('UPDATE settings SET value=? WHERE key=?');
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k) && v !== undefined) { stmt.run(String(v), k); n++; }
  }
  res.json({ ok: true, updated: n });
});

export default r;
