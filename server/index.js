import express from 'express';
import cors from 'cors';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
initDb();

const app = express();
app.use(cors());
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

// 前端静态文件（web/dist 构建后）
const WEB_DIST = join(__dirname, '..', 'web', 'dist');
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`[lukejia] server running at http://${process.env.HOST || '127.0.0.1'}:${PORT}`));
