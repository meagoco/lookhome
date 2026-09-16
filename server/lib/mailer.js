// 轻量邮件发送：基于 nodemailer（零 runtime 依赖），配置读 settings 表
import nodemailer from 'nodemailer';
import { db } from '../db.js';

export function getSmtpConfig() {
  const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('smtp_%');
  const c = {};
  for (const r of rows) c[r.key] = r.value;
  return {
    host: c.smtp_host || '',
    port: Number(c.smtp_port || (c.smtp_secure === '0' ? 25 : 465)),
    user: c.smtp_user || '',
    pass: c.smtp_pass || '',
    from: c.smtp_from || (c.smtp_user ? c.smtp_user : ''),
    secure: String(c.smtp_secure) === '1'
  };
}

export function smtpConfigured(cfg) {
  return !!(cfg.host && cfg.from);
}

// 发送邮件；成功返回 true，失败抛错
export async function sendMail({ to, subject, html, text }) {
  const cfg = getSmtpConfig();
  if (!smtpConfigured(cfg)) throw new Error('SMTP 未配置');
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: false }
  });
  await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text: text || '',
    html: html || ''
  });
}
