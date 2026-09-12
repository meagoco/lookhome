import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { auth, signToken } from '../middleware/auth.js';
import { sendMail, smtpConfigured, getSmtpConfig } from '../lib/mailer.js';

const r = Router();

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM admin_users WHERE username=? AND status=1').get(String(username || ''));
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }
  res.json({ token: signToken(u), user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role, email: u.email || '' } });
});

r.get('/me', auth, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, role, email, created_at FROM admin_users WHERE id=?').get(req.user.id);
  res.json(u);
});

r.post('/password', auth, (req, res) => {
  const { oldPwd, newPwd } = req.body || {};
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(oldPwd || ''), u.password_hash)) return res.status(400).json({ error: '原密码错误' });
  if (!newPwd || String(newPwd).length < 6) return res.status(400).json({ error: '新密码至少6位' });
  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(newPwd), 10), req.user.id);
  res.json({ ok: true });
});

// 发送测试邮件（仅主管理员；发给当前账号绑定邮箱）
r.post('/test-mail', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅主管理员可操作' });
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.user.id);
  if (!u.email) return res.status(400).json({ error: '当前账号未绑定邮箱' });
  if (!smtpConfigured(getSmtpConfig())) return res.status(400).json({ error: 'SMTP 未配置' });
  const siteName = ((db.prepare(`SELECT value FROM settings WHERE key='site_name'`).get() || {}).value || '路客家');
  try {
    await sendMail({ to: u.email, subject: `【${siteName}】测试邮件`, text: '这是一封来自路客家管理后台的测试邮件，说明邮件服务配置正常。' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '邮件发送失败：' + e.message });
  }
});

// —— 密码找回（邮箱重置链接）——
// 申请重置：按用户名或邮箱定位账号，向绑定邮箱发重置链接（15分钟有效）
r.post('/forgot', async (req, res) => {
  const { account } = req.body || {};
  const key = String(account || '').trim();
  if (!key) return res.status(400).json({ error: '请输入用户名或邮箱' });
  const u = db.prepare(`SELECT * FROM admin_users WHERE username=? OR (email != '' AND email=?)`).get(key, key);
  if (!u || u.status !== 1) {
    // 账号不存在也统一响应，避免探测；但提示邮件未配置时说明
    return res.json({ ok: true, sent: false });
  }
  if (!u.email) return res.status(400).json({ error: '该账号未绑定邮箱，请联系主管理员重置' });
  if (!smtpConfigured(getSmtpConfig())) return res.status(400).json({ error: '系统未配置邮件服务，请使用服务器端重置脚本' });

  const token = crypto.randomBytes(24).toString('hex');
  db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?, datetime('now','localtime','+15 minutes'))")
    .run(u.id, crypto.createHash('sha256').update(token).digest('hex'));
  // 清理过期/已用令牌
  db.prepare("DELETE FROM password_resets WHERE expires_at < datetime('now','localtime') OR used=1").run();

  const siteUrl = ((db.prepare(`SELECT value FROM settings WHERE key='site_url'`).get() || {}).value || '').replace(/\/+$/, '');
  const base = siteUrl || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/reset?token=${token}`;
  const siteName = ((db.prepare(`SELECT value FROM settings WHERE key='site_name'`).get() || {}).value || '路客家');
  try {
    await sendMail({
      to: u.email,
      subject: `【${siteName}】密码重置`,
      text: `您好：\n\n您正在重置「${siteName}」管理后台的登录密码。\n请在 15 分钟内打开以下链接设置新密码（仅一次有效）：\n${link}\n\n如非本人操作，请忽略本邮件。`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <h3 style="margin-top:0;">${siteName} · 密码重置</h3>
        <p>您正在重置管理后台的登录密码，请在 <b>15 分钟</b>内点击下方按钮设置新密码（链接仅一次有效）：</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;padding:10px 28px;background:#2f54eb;color:#fff;text-decoration:none;border-radius:6px;">设置新密码</a>
        </p>
        <p style="font-size:12px;color:#9ca3af;">如果按钮无法点击，请复制以下链接到浏览器打开：<br>${link}</p>
        <p style="font-size:12px;color:#9ca3af;">如非本人操作，请忽略本邮件。</p>
      </div>`
    });
    res.json({ ok: true, sent: true });
  } catch (e) {
    console.error('[forgot] send failed:', e.message);
    res.status(500).json({ error: '邮件发送失败：' + e.message });
  }
});

// 校验重置令牌是否有效
function verifyResetToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return db.prepare(`SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at >= datetime('now','localtime')`).get(hash) || null;
}

// 执行重置：token + 新密码
r.post('/reset', (req, res) => {
  const { token, newPwd } = req.body || {};
  const row = verifyResetToken(token);
  if (!row) return res.status(400).json({ error: '重置链接无效或已过期，请重新申请' });
  if (!newPwd || String(newPwd).length < 6) return res.status(400).json({ error: '新密码至少6位' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(newPwd), 10), row.user_id);
    db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(row.id);
  });
  tx();
  res.json({ ok: true });
});

export default r;
