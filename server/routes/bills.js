import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 账单列表（操作员仅见授权项目账单）
r.get('/', auth, (req, res) => {
  const { period, status, bill_type, kw, remind } = req.query;
  const { cond, args: condArgs } = grantedScope(req, 'r');
  let sql = `
    SELECT b.*, t.name AS tenant_name, r.room_no, p.name AS property_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.bill_id=b.id AND pm.confirm_status='confirmed') AS paid_amount
    FROM bills b
    JOIN tenants t ON t.id=b.tenant_id
    JOIN rooms r ON r.id=b.room_id
    JOIN properties p ON p.id=r.property_id WHERE 1=1${cond}`;
  const args = [...condArgs];
  if (period && period !== 'all') { sql += ' AND b.period=?'; args.push(period); }
  if (status && status !== 'all') { sql += ' AND b.status=?'; args.push(status); }
  if (bill_type && bill_type !== 'all') { sql += ' AND b.bill_type=?'; args.push(bill_type); }
  if (kw) { sql += ' AND (t.name LIKE ? OR r.room_no LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`); }
  if (remind === 'reminded') { sql += ' AND EXISTS (SELECT 1 FROM reminders rm WHERE rm.bill_id=b.id)'; }
  if (remind === 'unreminded') { sql += ' AND NOT EXISTS (SELECT 1 FROM reminders rm WHERE rm.bill_id=b.id)'; }
  sql += ' ORDER BY b.id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...args);
  // 组装各账单的提醒状态（最近一条提醒：是否提醒/时间/来源）
  const billIds = rows.map(x => x.id);
  const rmMap = new Map();
  if (billIds.length) {
    const rms = db.prepare(`SELECT * FROM reminders WHERE bill_id IN (${billIds.map(() => '?').join(',')}) ORDER BY id DESC`).all(...billIds);
    for (const rm of rms) {
      if (!rmMap.has(rm.bill_id)) {
        rmMap.set(rm.bill_id, { reminded: 1, kind: rm.kind, created_at: rm.created_at, status: rm.status });
      }
    }
  }
  for (const row of rows) row.reminder = rmMap.get(row.id) || { reminded: 0 };
  const stat = db.prepare(`SELECT b.status, COUNT(*) c, COALESCE(SUM(b.total),0) v FROM bills b JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1${cond} GROUP BY b.status`).all(...condArgs);
  res.json({ rows, stat });
});

// 账单统计：费用分类汇总 + 应收趋势 + 实收趋势（按项目/周期）
r.get('/stats', auth, (req, res) => {
  const { property_id, start, end, group } = req.query;
  const { cond, args } = grantedScope(req, 'r'); // bills→rooms(r)
  const mStart = start ? start.slice(0, 7) : '0000-00';
  const mEnd = end ? end.slice(0, 7) : '9999-99';
  const propCond = property_id && property_id !== 'all' ? ' AND r.property_id=?' : '';
  const propArgs = property_id && property_id !== 'all' ? [Number(property_id)] : [];
  const join = 'JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id';
  // 费用分类汇总（应收口径：非作废账单的明细项，按账单周期范围）
  const fees = db.prepare(`
    SELECT bi.fee_code code, bi.fee_name name, SUM(bi.amount) v
    FROM bill_items bi JOIN bills b ON b.id=bi.bill_id ${join}
    WHERE b.status!='void' AND b.period BETWEEN ? AND ?${propCond}${cond}
    GROUP BY bi.fee_code, bi.fee_name ORDER BY v DESC`).all(mStart, mEnd, ...propArgs, ...args);
  // 应收趋势（按账单周期，group=year 时按年聚合）
  const g = group === 'year' ? 'substr(b.period,1,4)' : 'b.period';
  const trend = db.prepare(`
    SELECT ${g} AS period, SUM(b.total) v FROM bills b ${join}
    WHERE b.status!='void' AND b.period BETWEEN ? AND ?${propCond}${cond}
    GROUP BY ${g} ORDER BY period`).all(mStart, mEnd, ...propArgs, ...args);
  // 实收趋势（按支付确认时间）
  const income = db.prepare(`
    SELECT substr(pm.created_at,1,7) ym, SUM(pm.amount) v FROM payments pm
    JOIN bills b ON b.id=pm.bill_id ${join}
    WHERE pm.confirm_status='confirmed' AND date(pm.created_at) BETWEEN ? AND ?${propCond}${cond}
    GROUP BY ym ORDER BY ym`).all(start || '0000-00-00', end || '9999-12-31', ...propArgs, ...args);
  res.json({ fees, fee_total: fees.reduce((s, x) => s + Number(x.v), 0), trend, income });
});

// 账单详情（含明细与收款记录）
r.get('/:id', auth, (req, res) => {
  const b = db.prepare(`
    SELECT b.*, t.name AS tenant_name, t.phone AS tenant_phone, r.room_no, p.name AS property_name
    FROM bills b JOIN tenants t ON t.id=b.tenant_id JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id
    WHERE b.id=?`).get(req.params.id);
  if (!b) return res.status(404).json({ error: '账单不存在' });
  if (!canAccessProject(req, b.property_id)) return res.status(403).json({ error: '无权查看该账单' });
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id=?').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE bill_id=? ORDER BY id DESC').all(req.params.id);
  res.json({ bill: b, items, payments });
});

// 抄表（水/电）
r.post('/readings', auth, (req, res) => {
  const { room_id, meter_type, period, curr_reading } = req.body || {};
  if (!room_id || !['water', 'electric'].includes(meter_type) || !period) return res.status(400).json({ error: '参数错误' });
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(room_id);
  if (!room) return res.status(400).json({ error: '房间不存在' });
  if (!canAccessProject(req, room.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  const curr = Number(curr_reading);
  const last = db.prepare(`SELECT * FROM meter_readings WHERE room_id=? AND meter_type=? AND period < ? ORDER BY period DESC LIMIT 1`)
    .get(room_id, meter_type, period);
  const prev = last ? last.curr_reading : 0;
  const usage = Math.max(0, curr - prev);
  const rate = meter_type === 'water' ? room.water_rate : room.electric_rate;
  const factor = meter_type === 'water' ? room.water_factor : room.electric_factor;
  const amount = Math.round(usage * rate * factor * 100) / 100;
  const exist = db.prepare(`SELECT id FROM meter_readings WHERE room_id=? AND meter_type=? AND period=?`).get(room_id, meter_type, period);
  if (exist) {
    db.prepare(`UPDATE meter_readings SET prev_reading=?,curr_reading=?,usage=?,amount=? WHERE id=?`)
      .run(prev, curr, usage, amount, exist.id);
  } else {
    db.prepare(`INSERT INTO meter_readings (room_id,meter_type,period,prev_reading,curr_reading,usage,amount) VALUES (?,?,?,?,?,?,?)`)
      .run(room_id, meter_type, period, prev, curr, usage, amount);
  }
  res.json({ prev, curr, usage, rate, factor, amount });
});

// 生成月度账单（租金+垃圾费+水电抄表金额；操作员仅生成授权项目合同）
r.post('/generate', auth, (req, res) => {
  const period = (req.body || {}).period || new Date().toISOString().slice(0, 7);
  const onlyContract = (req.body || {}).contract_id ? Number((req.body || {}).contract_id) : null;
  const { cond, args } = grantedScope(req, 'r');
  let contracts;
  if (onlyContract) {
    contracts = db.prepare(`SELECT c.*, r.garbage_fee, r.room_no FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.id=? AND c.status='active' AND r.property_id IN (SELECT property_id FROM property_grants WHERE admin_user_id=?)`).all(onlyContract, req.user.id);
  } else {
    contracts = db.prepare(`SELECT c.*, r.garbage_fee, r.room_no FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.status='active'${cond}`).all(...args);
  }
  if (req.user.role !== 'admin' && onlyContract && !contracts.length) {
    return res.status(403).json({ error: '无权操作该项目' });
  }
  let created = 0;
  const tx = db.transaction(() => {
    for (const c of contracts) {
      const dup = db.prepare(`SELECT id FROM bills WHERE contract_id=? AND period=? AND bill_type='monthly'`).get(c.id, period);
      if (dup) continue;
      const items = [];
      items.push({ code: 'rent', name: '租金', amount: Number(c.monthly_rent) });
      if (Number(c.garbage_fee) > 0) items.push({ code: 'garbage', name: '垃圾费', amount: Number(c.garbage_fee) });
      const meters = db.prepare(`SELECT * FROM meter_readings WHERE room_id=? AND period=?`).all(c.room_id, period);
      for (const m of meters) {
        items.push({ code: m.meter_type, name: m.meter_type === 'water' ? '水费' : '电费', amount: Number(m.amount || 0), qty: m.usage, rate: m.amount && m.usage ? Math.round(m.amount / m.usage * 100) / 100 : 0 });
      }
      const total = Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100;
      const bi = db.prepare(`
        INSERT INTO bills (contract_id,tenant_id,room_id,period,bill_type,title,total,status)
        VALUES (?,?,?,?,?,?,?,?)`).run(c.id, c.tenant_id, c.room_id, period, 'monthly',
        `${period} 房租·水电（${c.room_no}）`, total, 'unpaid');
      const insItem = db.prepare(`INSERT INTO bill_items (bill_id,fee_code,fee_name,amount,quantity,rate) VALUES (?,?,?,?,?,?)`);
      for (const it of items) insItem.run(bi.lastInsertRowid, it.code, it.name, it.amount, it.qty || null, it.rate || null);
      created++;
    }
  });
  tx();
  res.json({ ok: true, created, period });
});

// 手工确认收款（支付双模式：默认手工；配微信后仍保留入口）
r.post('/:id/pay-manual', auth, (req, res) => {
  const { amount, remark } = req.body || {};
  const b = db.prepare('SELECT * FROM bills WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '账单不存在' });
  if (!canAccessProject(req, b.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  if (!(amount > 0)) return res.status(400).json({ error: '金额不正确' });
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE bill_id=? AND confirm_status='confirmed'`).get(b.id).v;
  if (paid + Number(amount) > b.total + 0.001) return res.status(400).json({ error: '收款超过账单总额' });
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO payments (bill_id,tenant_id,amount,pay_mode,confirm_status,confirmed_by,confirmed_at,remark)
      VALUES (?,?,?,?,?,?,datetime('now','localtime'),?)`)
      .run(b.id, b.tenant_id, Number(amount), 'manual', 'confirmed', req.user.id, remark || '');
    const nowPaid = paid + Number(amount);
    if (nowPaid >= b.total - 0.001) {
      db.prepare(`UPDATE bills SET status='paid', paid_at=datetime('now','localtime') WHERE id=?`).run(b.id);
    } else {
      db.prepare(`UPDATE bills SET status='unpaid' WHERE id=?`).run(b.id);
    }
  });
  tx();
  res.json({ ok: true });
});

// 作废账单
r.post('/:id/void', auth, (req, res) => {
  const b = db.prepare('SELECT * FROM bills WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '账单不存在' });
  if (!canAccessProject(req, b.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  db.prepare(`UPDATE bills SET status='void' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

export default r;
