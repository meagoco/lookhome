import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();

// 合同列表（操作员仅见授权项目合同）
r.get('/', auth, (req, res) => {
  const { status, kw } = req.query;
  const { cond, args } = grantedScope(req, 'r');
  let sql = `
    SELECT c.*, t.name AS tenant_name, t.phone AS tenant_phone, r.room_no, p.name AS property_name,
      (SELECT SUM(total) FROM bills b WHERE b.contract_id=c.id AND b.status IN ('unpaid','overdue')) AS unpaid_amount,
      (SELECT SUM(total) FROM bills b WHERE b.contract_id=c.id AND b.bill_type='deposit' AND b.status='paid') AS deposit_paid
    FROM contracts c
    JOIN tenants t ON t.id=c.tenant_id
    JOIN rooms r ON r.id=c.room_id
    JOIN properties p ON p.id=r.property_id WHERE 1=1${cond}`;
  if (status && status !== 'all') { sql += ' AND c.status=?'; args.push(status); }
  if (kw) { sql += ' AND (t.name LIKE ? OR r.room_no LIKE ? OR p.name LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  sql += ' ORDER BY c.id DESC';
  res.json(db.prepare(sql).all(...args));
});

// 校验合同房间项目权限
function canContract(req, id) {
  const row = db.prepare('SELECT r.property_id pid FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.id=?').get(id);
  if (!row) return null;
  if (!canAccessProject(req, row.pid)) return false;
  return true;
}

// 创建合同（绑定房源，租金/押金手动设定）
r.post('/', auth, (req, res) => {
  const b = req.body || {};
  if (!b.tenant_id || !b.room_id) return res.status(400).json({ error: '请选择租客和房间' });
  if (!b.start_date || !b.end_date) return res.status(400).json({ error: '合同起止日期必填' });
  if (!(b.monthly_rent > 0)) return res.status(400).json({ error: '请设定月租金' });
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(b.room_id);
  if (!room) return res.status(400).json({ error: '房间不存在' });
  if (!canAccessProject(req, room.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  if (room.status === 'rented') return res.status(400).json({ error: '房间已在租' });
  // 一个房间同时只能生效一份合同
  const activeCnt = db.prepare("SELECT COUNT(*) c FROM contracts WHERE room_id=? AND status='active'").get(b.room_id).c;
  if (activeCnt > 0) return res.status(400).json({ error: `该房间已有 ${activeCnt} 份生效合同，一个房间同时只能存在一份生效合同` });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO contracts (tenant_id,room_id,start_date,end_date,monthly_rent,deposit,rent_cycle,pay_day,remark)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      b.tenant_id, b.room_id, b.start_date, b.end_date,
      Number(b.monthly_rent), Number(b.deposit || 0), b.rent_cycle || 'monthly',
      b.pay_day || 1, b.remark || '');
    const cid = info.lastInsertRowid;
    db.prepare(`UPDATE rooms SET status='rented', available_date=? WHERE id=?`).run(b.end_date, b.room_id);
    // 自动生成押金账单（bill_type=deposit）
    if (Number(b.deposit) > 0) {
      const period = b.start_date.slice(0, 7);
      const bi = db.prepare(`
        INSERT INTO bills (contract_id,tenant_id,room_id,period,bill_type,title,total,status)
        VALUES (?,?,?,?,?,?,?,?)`).run(cid, b.tenant_id, b.room_id, period, 'deposit', `押金（${room.room_no}）`, Number(b.deposit), 'unpaid');
      db.prepare(`INSERT INTO bill_items (bill_id,fee_code,fee_name,amount,remark) VALUES (?,?,?,?,?)`)
        .run(bi.lastInsertRowid, 'deposit', '押金', Number(b.deposit), '');
    }
    return cid;
  });
  const cid = tx();
  res.json({ id: cid });
});

// 编辑合同（租金/押金/租期等；涨价直接改月租金，后续账单自动按新价生成）
r.put('/:id', auth, (req, res) => {
  const acc = canContract(req, req.params.id);
  if (acc === null) return res.status(404).json({ error: '合同不存在' });
  if (acc === false) return res.status(403).json({ error: '无权操作该项目' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const b = req.body || {};
  const monthlyRent = b.monthly_rent !== undefined && b.monthly_rent !== '' ? Number(b.monthly_rent) : c.monthly_rent;
  const deposit = b.deposit !== undefined && b.deposit !== '' ? Number(b.deposit) : c.deposit;
  const endDate = b.end_date || c.end_date;
  const rentCycle = b.rent_cycle || c.rent_cycle;
  const payDay = b.pay_day !== undefined && b.pay_day !== '' ? Number(b.pay_day) : c.pay_day;
  if (!(monthlyRent > 0)) return res.status(400).json({ error: '月租金必须大于 0' });
  if (!(deposit >= 0)) return res.status(400).json({ error: '押金不能为负' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return res.status(400).json({ error: '结束日期格式错误' });
  if (!(payDay >= 1 && payDay <= 31)) return res.status(400).json({ error: '缴费日需在 1-31 之间' });

  // 押金变动：若押金账单已支付，禁止修改押金金额
  if (Math.abs(deposit - c.deposit) > 0.001) {
    const depPaid = db.prepare(`SELECT COUNT(*) c FROM bills WHERE contract_id=? AND bill_type='deposit' AND status='paid'`).get(req.params.id).c;
    if (depPaid > 0) return res.status(400).json({ error: '押金已支付，不能修改押金金额' });
    // 同步未支付押金账单金额
    const depUnpaid = db.prepare(`SELECT id FROM bills WHERE contract_id=? AND bill_type='deposit' AND status='unpaid'`).all(req.params.id);
    for (const d of depUnpaid) {
      db.prepare(`UPDATE bills SET total=? WHERE id=?`).run(deposit, d.id);
      db.prepare(`UPDATE bill_items SET amount=? WHERE bill_id=? AND fee_code='deposit'`).run(deposit, d.id);
    }
  }

  db.prepare(`UPDATE contracts SET monthly_rent=?,deposit=?,end_date=?,rent_cycle=?,pay_day=?,remark=? WHERE id=?`)
    .run(monthlyRent, deposit, endDate, rentCycle, payDay, b.remark !== undefined ? b.remark : c.remark, req.params.id);
  res.json({ ok: true });
});

// 退房
r.post('/:id/checkout', auth, (req, res) => {
  const acc = canContract(req, req.params.id);
  if (acc === null) return res.status(404).json({ error: '合同不存在' });
  if (acc === false) return res.status(403).json({ error: '无权操作该项目' });
  const { remark } = req.body || {};
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime'), remark=? WHERE id=?`)
    .run(remark || c.remark || '', req.params.id);
  db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
  res.json({ ok: true });
});

// 作废合同
r.post('/:id/void', auth, (req, res) => {
  const acc = canContract(req, req.params.id);
  if (acc === null) return res.status(404).json({ error: '合同不存在' });
  if (acc === false) return res.status(403).json({ error: '无权操作该项目' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  db.prepare(`UPDATE contracts SET status='void' WHERE id=?`).run(req.params.id);
  db.prepare(`UPDATE rooms SET status='vacant' WHERE id=? AND status='rented'`).run(c.room_id);
  res.json({ ok: true });
});

export default r;
