import express from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
initDb();

const app = express();
// 同源部署（nginx 反代），无需跨域；小程序 wx.request 不受浏览器 CORS 限制
app.use(express.json({ limit: '2mb' }));

// 上传目录（租客证件照等）
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '..', 'data', 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// 健康检查
app.get('/api/health', (req, res) => {
  const site = (db.prepare("SELECT value FROM settings WHERE key='site_name'").get() || {}).value || '路客家';
  res.json({ ok: true, site, time: new Date().toISOString() });
});

// 业务路由
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import dashboardRoutes from './routes/dashboard.js';
import propertiesRoutes from './routes/properties.js';
import roomsRoutes from './routes/rooms.js';
import tenantsRoutes from './routes/tenants.js';
import contractsRoutes from './routes/contracts.js';
import billsRoutes from './routes/bills.js';
import paymentsRoutes from './routes/payments.js';
import refundsRoutes from './routes/refunds.js';
import feesRoutes from './routes/fees.js';
import payRoutes from './routes/pay.js';
import tenantRoutes from './routes/tenant.js';
import backupRoutes from './routes/backup.js';
import meteringsRoutes from './routes/meterings.js';
import adminUsersRoutes from './routes/admin-users.js';
import payConfigsRoutes from './routes/pay-configs.js';
import remindersRoutes, { runAutoReminders } from './routes/reminders.js';

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/tenants', tenantsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/bills', billsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/refunds', refundsRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/pay', payRoutes);
app.use('/api/tenant', tenantRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/meterings', meteringsRoutes);
app.use('/api/admin-users', adminUsersRoutes);
app.use('/api/pay-configs', payConfigsRoutes);
app.use('/api/reminders', remindersRoutes);

// 全局错误处理：统一 500 JSON，不向客户端泄露内部细节
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.path, err.message);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体格式错误' });
  if (err.name === 'MulterError') return res.status(400).json({ error: '文件上传错误：' + err.message });
  res.status(500).json({ error: '服务器内部错误' });
});

// 前端静态文件（web/dist 构建后）
const WEB_DIST = join(__dirname, '..', 'web', 'dist');
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`[lukejia] server running at http://${process.env.HOST || '127.0.0.1'}:${PORT}`));

// 缴费提醒自动任务：启动时跑一次，之后每 6 小时检查（到期日前 3 天下发提醒）
runAutoReminders();
setInterval(runAutoReminders, 6 * 60 * 60 * 1000).unref();
console.log('[lukejia] reminder auto-task scheduled (every 6h, due-3d)');
