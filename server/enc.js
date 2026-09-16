// 身份证等敏感字段 AES-256-GCM 加解密
// 密钥由 JWT_SECRET 派生（生产环境已通过 systemd Environment 注入，无需新增配置）
// 密文格式：lk1:<base64(iv+tag+ct)>，带前缀用于区分存量明文数据
import crypto from 'node:crypto';

const KEY = crypto.createHash('sha256')
  .update(process.env.JWT_SECRET || 'lookhome-secret-change-me')
  .digest();
const PREFIX = 'lk1:';

export function encIdCard(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decIdCard(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !v.startsWith(PREFIX)) return String(v); // 兼容存量明文
  try {
    const buf = Buffer.from(v.slice(PREFIX.length), 'base64');
    if (buf.length < 29) return String(v);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return String(v); // 解密失败（如密钥变更）返回原值，不阻塞业务
  }
}
