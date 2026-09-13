import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 到期日 = 账单周期月 + 合同缴费日（pay_day 超出当月天数则取月末）
function dueDateOf(period, payDay) {
  const [y, m] = String(period).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(payDay || 1, last)).padStart(2, '0')}`;
}

function buildTitle(bill) {
  return `${bill.period} ${bill.tenant_name} 账单提醒（${bill.property_name}·${bill.room_no}）`;
}

function insertReminder(tenantId, billId, roomId, kind, title, content) {
  const dup = db.prepare(`SELECT id FROM reminders WHERE bill_id=? AND kind=?`).get(billId, kind);
  if (dup) return false; // 同一账单同一来源只提醒一次
  db.prepare(`
    INSERT INTO reminders (tenant_id,bill_id,room_id,kind,remind_type,title,content,status)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(tenantId, billId, roomId, kind, billId ? 'monthly' : 'all', title, content, 'pending');
  return true;
}

// 自动任务：到期日前 3 天提醒（租金/水电/垃圾费）。每日/每 6 小时由服务启动时调度
export function runAutoReminders() {
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（本地时区）
  const due = new Date();
  due.setDate(due.getDate() + 3);
  const remindFor = due.toLocaleDateString('sv-SE'); // 3 天后到期的账单
  const bills = db.prepare(`
    SELECT b.*, c.pay_day, t.name AS tenant_name, t.id AS tenant_id, r.room_no, p.name AS property_name
    FROM bills b
    JOIN contracts c ON c.id=b.contract_id
    JOIN tenants t ON t.id=b.tenant_id
    JOIN rooms r ON r.id=b.room_id
    JOIN properties p ON p.id=r.property_id
    WHERE b.status IN ('unpaid','overdue') AND b.bill_type='monthly'
      AND c.status='active'`).all();
  let sent = 0;
  for (const b of bills) {
    if (dueDateOf(b.period, b.pay_day) !== remindFor) continue;
    const title = buildTitle(b);
    const content = `您有 ${b.period} 期账单（租金、水电、垃圾费等合计 ${b.total} 元）将于 ${remindFor} 到期，请在小程序中查看并缴费。`;
    if (insertReminder(b.tenant_id, b.id, b.room_id, 'auto', title, content)) sent++;
  }
  if (sent > 0) console.log(`[reminders] auto: ${sent} 条到期前3天提醒已下发 (${today})`);
  return sent;
}

// 后台手动批量提醒（对逾期/未缴账单的房客发起；管理员/操作员，操作员限授权项目）
r.post('/manual', auth, (req, res) => {
  const ids = (req.body?.bill_ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: '请选择要提醒的账单' });
  const placeholders = ids.map(() => '?').join(',');
  const bills = db.prepare(`
    SELECT b.*, c.pay_day, t.name AS tenant_name, t.id AS tenant_id, r.room_no, p.name AS property_name, r.property_id
    FROM bills b
    JOIN contracts c ON c.id=b.contract_id
    JOIN tenants t ON t.id=b.tenant_id
    JOIN rooms r ON r.id=b.room_id
    JOIN properties p ON p.id=r.property_id
    WHERE b.id IN (${placeholders})`).all(...ids);
  let created = 0, skipped = 0, denied = 0;
  for (const b of bills) {
    if (!canAccessProject(req, b.property_id)) { denied++; continue; }
    const title = buildTitle(b);
    const content = `【手动催缴】您有 ${b.period} 期账单（租金、水电、垃圾费等合计 ${b.total} 元）尚未缴纳，请尽快在小程序中查看并缴费。`;
    if (insertReminder(b.tenant_id, b.id, b.room_id, 'manual', title, content)) created++;
    else skipped++;
  }
  res.json({ ok: true, created, skipped, denied });
});

// 提醒列表（后台查看最近下发记录；管理员/操作员）
r.get('/', auth, (req, res) => {
  const { cond, args } = grantedScope(req, 'r');
  const rows = db.prepare(`
    SELECT rm.*, t.name AS tenant_name, r.room_no, p.name AS property_name
    FROM reminders rm
    JOIN tenants t ON t.id=rm.tenant_id
    LEFT JOIN rooms r ON r.id=rm.room_id
    LEFT JOIN properties p ON p.id=r.property_id
    WHERE 1=1${cond}
    ORDER BY rm.id DESC LIMIT 300`).all(...args);
  res.json(rows);
});

// 删除单条提醒（管理员清理用）
r.delete('/:id', auth, (req, res) => {
  const rm = db.prepare('SELECT rm.*, r.property_id FROM reminders rm LEFT JOIN rooms r ON r.id=rm.room_id WHERE rm.id=?').get(req.params.id);
  if (!rm) return res.status(404).json({ error: '提醒不存在' });
  if (rm.property_id && !canAccessProject(req, rm.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  db.prepare('DELETE FROM reminders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
