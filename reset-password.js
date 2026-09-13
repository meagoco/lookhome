#!/usr/bin/env node
// 路客家 · 服务器端一键重置密码
// 用法：
//   node reset-password.js                    # 交互式输入用户名与新密码
//   node reset-password.js <用户名> <新密码>   # 参数直接指定
// 数据目录默认 ./data（可用环境变量 DATA_DIR 覆盖）
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'lukejia.db');

if (!existsSync(DB_PATH)) {
  console.error(`[错误] 未找到数据库: ${DB_PATH}`);
  console.error('       请确认在项目目录（/opt/lukejia）下执行，或用 DATA_DIR 指定数据目录。');
  process.exit(1);
}

const db = new Database(DB_PATH);

async function main() {
  let username = process.argv[2]?.trim();
  let newPwd = process.argv[3];

  const rl = createInterface({ input: stdin, output: stdout });
  if (!username) {
    username = (await rl.question('请输入要重置的用户名: ')).trim();
  }
  if (!newPwd) {
    const p1 = await rl.question('请输入新密码（至少6位）: ');
    const p2 = await rl.question('请再次输入新密码: ');
    if (p1 !== p2) { console.error('[错误] 两次输入不一致'); process.exit(1); }
    newPwd = p1;
  }
  rl.close();

  if (!username) { console.error('[错误] 用户名不能为空'); process.exit(1); }
  if (!newPwd || String(newPwd).length < 6) { console.error('[错误] 新密码至少 6 位'); process.exit(1); }

  const u = db.prepare('SELECT id, username, display_name, role, status FROM admin_users WHERE username=?').get(username);
  if (!u) {
    console.error(`[错误] 用户「${username}」不存在。现有用户：`);
    for (const r of db.prepare('SELECT id, username, role, status FROM admin_users ORDER BY id').all()) {
      console.log(`  #${r.id} ${r.username} (${r.role}, ${r.status === 1 ? '正常' : '停用'})`);
    }
    process.exit(1);
  }
  if (u.status !== 1) console.warn(`[警告] 该用户当前为停用状态，重置后仍需先启用才能登录。`);

  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(newPwd), 10), u.id);
  // 使未使用的重置令牌失效
  db.prepare('UPDATE password_resets SET used=1 WHERE user_id=? AND used=0').run(u.id);
  // 写入可追溯的审计日志（而非仅打印到易失的控制台输出）
  db.prepare('INSERT INTO operation_logs (admin_id, action, detail) VALUES (?, ?, ?)')
    .run(u.id, 'reset_password_cli', `通过 reset-password.js CLI 工具重置密码（用户「${u.username}」，#${u.id}，角色：${u.role}）`);
  console.log(`[成功] 用户「${u.username}」密码已重置（#${u.id}，角色：${u.role}）。`);
  console.log('       如启用了邮箱找回，该账号未使用的重置链接已同时作废。');
}

main().catch(e => { console.error('[错误]', e.message); process.exit(1); });
