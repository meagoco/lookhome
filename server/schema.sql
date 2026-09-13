-- 路客家 · 数据库 Schema（SQLite）
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 后台账号
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 密码重置令牌
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 项目授权（操作员 ↔ 项目，主管理员可授权；操作员自建项目自动授权）
CREATE TABLE IF NOT EXISTS property_grants (
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  PRIMARY KEY (admin_user_id, property_id)
);

-- 系统配置（KV）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 项目/楼栋
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  type TEXT DEFAULT 'centralized',
  remark TEXT,
  status INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 房间
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_no TEXT NOT NULL,
  layout TEXT,
  orientation TEXT,
  area REAL,
  ref_rent REAL,
  garbage_fee REAL DEFAULT 0,
  water_rate REAL DEFAULT 0,
  electric_rate REAL DEFAULT 0,
  water_factor REAL DEFAULT 1,
  electric_factor REAL DEFAULT 1,
  status TEXT DEFAULT 'vacant',
  available_date TEXT,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 租客
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  id_card_enc TEXT,
  id_card_photo TEXT,
  verify_status TEXT DEFAULT 'pending',
  verify_method TEXT DEFAULT 'manual',
  verify_remark TEXT,
  verified_by INTEGER,
  verified_at TEXT,
  wechat_openid TEXT,
  source TEXT DEFAULT 'admin',
  status INTEGER DEFAULT 1,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 合同（绑定房源，租金/押金手动设定）
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  monthly_rent REAL NOT NULL,
  deposit REAL NOT NULL,
  rent_cycle TEXT DEFAULT 'monthly',
  pay_day INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  ended_at TEXT
);

-- 费用类型字典（预留物业/网/燃气）
CREATE TABLE IF NOT EXISTS fee_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  is_bill_item INTEGER DEFAULT 1,
  default_rate REAL DEFAULT 0
);

-- 账单
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER REFERENCES contracts(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  period TEXT NOT NULL,
  bill_type TEXT DEFAULT 'monthly',
  title TEXT,
  total REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'unpaid',
  paid_at TEXT,
  pay_trade_no TEXT,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 账单明细
CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  fee_code TEXT NOT NULL,
  fee_name TEXT NOT NULL,
  amount REAL NOT NULL,
  quantity REAL,
  rate REAL,
  remark TEXT
);

-- 抄表
CREATE TABLE IF NOT EXISTS meter_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  meter_type TEXT NOT NULL,
  period TEXT NOT NULL,
  prev_reading REAL,
  curr_reading REAL,
  usage REAL,
  amount REAL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 收款记录（手工/微信双模式）
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  tenant_id INTEGER REFERENCES tenants(id),
  amount REAL NOT NULL,
  pay_mode TEXT DEFAULT 'manual',
  confirm_status TEXT DEFAULT 'pending',
  wechat_transaction_id TEXT,
  wechat_order_no TEXT,
  confirmed_by INTEGER,
  confirmed_at TEXT,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 退款（押金）
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER REFERENCES contracts(id),
  payment_id INTEGER REFERENCES payments(id),
  amount REAL NOT NULL,
  refund_mode TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'pending',
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  done_at TEXT
);

-- 工单（预留）
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id),
  room_id INTEGER REFERENCES rooms(id),
  wo_type TEXT DEFAULT 'repair',
  title TEXT,
  content TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 操作日志
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 微信支付配置模板（主管理员=全局，操作员=自持）
CREATE TABLE IF NOT EXISTS payment_configs (
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
);

-- 配置-项目绑定（一个项目只能绑定一个支付配置）
CREATE TABLE IF NOT EXISTS payment_config_bindings (
  config_id INTEGER NOT NULL REFERENCES payment_configs(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  PRIMARY KEY (config_id, property_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcb_property ON payment_config_bindings(property_id);
