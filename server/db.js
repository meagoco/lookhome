import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'lukejia.db');
export { DATA_DIR, DB_PATH };
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(sql);

  // 迁移：租客增加创建人（操作员隔离用）
  const tCols = db.prepare('PRAGMA table_info(tenants)').all().map(c => c.name);
  if (!tCols.includes('created_by')) db.exec('ALTER TABLE tenants ADD COLUMN created_by INTEGER');

  // 迁移：后台用户绑定邮箱（密码找回用）
  const uCols = db.prepare('PRAGMA table_info(admin_users)').all().map(c => c.name);
  if (!uCols.includes('email')) db.exec('ALTER TABLE admin_users ADD COLUMN email TEXT');

  // 密码重置令牌表（首次迁移建表；schema.sql 同步定义）
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES admin_users(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // 微信支付配置模板表（schema.sql 同步定义；兼容旧库迁移）
  db.exec(`CREATE TABLE IF NOT EXISTS payment_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mchid TEXT NOT NULL,
    apiv3_key TEXT,
    serial_no TEXT,
    private_key TEXT,
    notify_url TEXT,
    appid TEXT,
    scope TEXT DEFAULT 'global',
    created_by INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS payment_config_bindings (
    config_id INTEGER NOT NULL REFERENCES payment_configs(id),
    property_id INTEGER NOT NULL REFERENCES properties(id),
    PRIMARY KEY (config_id, property_id)
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_pcb_property ON payment_config_bindings(property_id)`);
  db.exec(`CREATE TABLE IF NOT EXISTS payment_config_access (
    config_id INTEGER NOT NULL REFERENCES payment_configs(id),
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id),
    PRIMARY KEY (config_id, admin_user_id)
  )`);

  // 迁移：退款增加租客申请字段（小程序申请退押金 / 后台审批）
  const rfCols = db.prepare('PRAGMA table_info(refunds)').all().map(c => c.name);
  if (!rfCols.includes('tenant_id')) db.exec('ALTER TABLE refunds ADD COLUMN tenant_id INTEGER');
  if (!rfCols.includes('source')) db.exec("ALTER TABLE refunds ADD COLUMN source TEXT DEFAULT 'admin'");
  if (!rfCols.includes('apply_remark')) db.exec('ALTER TABLE refunds ADD COLUMN apply_remark TEXT');

  // 默认配置（预留：小程序/支付/功能开关）
  const defaults = {
    site_name: '路客家',
    site_logo: '',
    site_icp: '',
    site_url: '',
    // 功能开关：realname_verify_mode = manual | auto；payment_confirm_mode = manual | auto
    realname_verify_mode: 'manual',
    payment_confirm_mode: 'manual',
    // 微信小程序预留
    wechat_mini_appid: '',
    wechat_mini_secret: '',
    wechat_template_pay: '',
    wechat_template_rent: '',
    // 微信支付预留（配置后自动启用自动入账）
    wechat_pay_mchid: '',
    wechat_pay_apiv3_key: '',
    wechat_pay_serial_no: '',
    wechat_pay_private_key: '',
    wechat_pay_notify_url: '',
    // 身份核验预留（腾讯云）
    tencent_secret_id: '',
    tencent_secret_key: '',
    tencent_verify_region: 'ap-guangzhou',
    // 邮件服务（密码找回）
    smtp_host: '',
    smtp_port: '465',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: '',
    smtp_secure: '1',
    // 数据备份（本地 + 多后端远程）
    backup_remote_type: 's3',
    backup_auto_enabled: '0',
    backup_auto_interval_hours: '24',
    backup_auto_remote: '0',
    backup_keep: '10',
    backup_cos_bucket: '',
    backup_cos_region: 'ap-guangzhou',
    backup_cos_secret_id: '',
    backup_cos_secret_key: '',
    backup_cos_prefix: 'lukejia-backup/',
    backup_ftp_host: '',
    backup_ftp_port: '21',
    backup_ftp_user: '',
    backup_ftp_pass: '',
    backup_ftp_path: '/lukejia-backup/',
    backup_webdav_url: '',
    backup_webdav_user: '',
    backup_webdav_pass: '',
    backup_webdav_path: 'lukejia-backup/',
    backup_od_client_id: '',
    backup_od_client_secret: '',
    backup_od_folder: 'lukejia-backup',
    backup_od_endpoint: 'global',
    backup_od_access_token: '',
    backup_od_refresh_token: '',
    backup_od_expires_at: '0',
    backup_last_at: ''
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, String(v));

  // 费用类型字典
  const fees = [
    ['rent', '租金', 1, 1, 0],
    ['deposit', '押金', 1, 0, 0],
    ['water', '水费', 1, 1, 0],
    ['electric', '电费', 1, 1, 0],
    ['garbage', '垃圾费', 1, 1, 0],
    ['property', '物业费', 1, 1, 0],
    ['network', '网费', 1, 1, 0],
    ['gas', '燃气费', 0, 1, 0],
    ['other', '其他', 1, 1, 0]
  ];
  const insFee = db.prepare('INSERT OR IGNORE INTO fee_types (code, name, enabled, is_bill_item, default_rate) VALUES (?, ?, ?, ?, ?)');
  for (const f of fees) insFee.run(...f);

  // 默认管理员 admin / admin123（首次登录后请修改）
  const adminCount = db.prepare('SELECT COUNT(*) c FROM admin_users').get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin_users (username, password_hash, display_name) VALUES (?, ?, ?)').run('admin', hash, '管理员');
  }
  console.log('[db] initialized at', DB_PATH);
}

if (process.argv[1] && process.argv[1].endsWith('db.js')) {
  initDb();
}
