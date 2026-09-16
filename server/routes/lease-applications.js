import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';
import { renderContract, PAY_MODES } from '../lib/contract-template.js';
import { sendToTenant } from '../wechat-subscribe.js';
import { decIdCard } from '../enc.js';

const r = Router();

// 签约申请列表（管理员全量；操作员仅见被授权项目的申请）
r.get('/', auth, (req, res) => {
  const { status } = req.query;
  const { cond, args } = grantedScope(req, 'r', 'p.id');
  let sql = `
    SELECT a.*, t.name AS tenant_name, t.phone AS tenant_phone, t.verify_status,
           r.room_no, r.area, r.ref_rent, p.name AS property_name
    FROM lease_applications a
    JOIN tenants t ON t.id=a.tenant_id
    JOIN rooms r ON r.id=a.room_id
    JOIN properties p ON p.id=r.property_id
    WHERE 1=1${cond}`;
  if (status && status !== 'all') { sql += ' AND a.status=?'; args.push(status); }
  sql += ' ORDER BY (a.status=\'pending\') DESC, a.id DESC';
  res.json(db.prepare(sql).all(...args));
});

// 审核通过：生成合同（租期/月租/押金由房东设定）+ 房间转已租 + 押金账单
r.post('/:id/approve', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM lease_applications WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: '申请不存在' });
  if (a.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  const room = db.prepare(`SELECT r.*, p.name AS property_name FROM rooms r JOIN properties p ON p.id=r.property_id WHERE r.id=?`).get(a.room_id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  if (!canAccessProject(req, room.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  if (room.status === 'rented') return res.status(400).json({ error: '房间已在租' });
  const activeCnt = db.prepare("SELECT COUNT(*) c FROM contracts WHERE room_id=? AND status='active'").get(a.room_id).c;
  if (activeCnt > 0) return res.status(400).json({ error: '该房间已有生效合同，一个房间只能存在一份生效合同' });

  const tenantRow = db.prepare('SELECT id_card_enc FROM tenants WHERE id=?').get(a.tenant_id);
  const tenantIdCard = tenantRow ? decIdCard(tenantRow.id_card_enc) : '';

  const b = req.body || {};
  if (!b.start_date || !b.end_date) return res.status(400).json({ error: '合同起止日期必填' });
  if (!(Number(b.monthly_rent) > 0)) return res.status(400).json({ error: '请设定月租金' });

  const tx = db.transaction(() => {
    // 合同文本快照（渲染完整模板，含租客/房源/租金/押金/租期/支付方式）
    const termMonths = Number(a.term_months) > 0 ? Number(a.term_months) : 1;
    const payMode = PAY_MODES[a.pay_mode] ? a.pay_mode : 'monthly';
    const contractText = renderContract({
      property_name: room.property_name, property_address: room.address || '',
      room_no: room.room_no, layout: room.layout, area: room.area,
      tenant_name: a.tenant_name, id_card: tenantIdCard, tenant_phone: a.tenant_phone,
      monthly_rent: Number(b.monthly_rent), deposit: Number(b.deposit || 0),
      term_months: termMonths, pay_mode: payMode,
      start_date: b.start_date, end_date: b.end_date,
    });
    // 缴款日默认取合同签订日（start_date 的日），可被 b.pay_day 覆盖
    const payDay = b.pay_day !== undefined && b.pay_day !== ''
      ? Number(b.pay_day)
      : (Number(b.start_date.slice(8, 10)) || 1);
    const payNote = `${payMode === 'monthly' ? '月付' : payMode === 'quarterly' ? '季付' : payMode === 'half' ? '半年付' : '年付'}${termMonths}个月`;
    const info = db.prepare(`
      INSERT INTO contracts (tenant_id,room_id,start_date,end_date,monthly_rent,deposit,rent_cycle,pay_day,remark,contract_text)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      a.tenant_id, a.room_id, b.start_date, b.end_date,
      Number(b.monthly_rent), Number(b.deposit || 0), b.rent_cycle || 'monthly', payDay,
      (a.remark ? a.remark + '；' : '') + `租期${termMonths}个月，${payNote}`, contractText);
    const cid = info.lastInsertRowid;
    db.prepare(`UPDATE rooms SET status='rented', available_date=? WHERE id=?`).run(b.end_date, a.room_id);
    if (Number(b.deposit) > 0) {
      const period = b.start_date.slice(0, 7);
      const bi = db.prepare(`
        INSERT INTO bills (contract_id,tenant_id,room_id,period,bill_type,title,total,status)
        VALUES (?,?,?,?,?,?,?,?)`).run(cid, a.tenant_id, a.room_id, period, 'deposit', `押金（${room.room_no}）`, Number(b.deposit), 'unpaid');
      db.prepare(`INSERT INTO bill_items (bill_id,fee_code,fee_name,amount,remark) VALUES (?,?,?,?,?)`)
        .run(bi.lastInsertRowid, 'deposit', '押金', Number(b.deposit), '');
    }
    db.prepare(`UPDATE lease_applications SET status='approved', contract_id=?, handled_at=datetime('now','localtime'), handled_by=? WHERE id=?`)
      .run(cid, req.user.id, a.id);
    return cid;
  });
  const cid = tx();
  // 预订结果通知（租客点击签约时已订阅）：提醒支付租金及押金，跳转账单页
  const totalPay = Number(b.monthly_rent) + Number(b.deposit || 0);
  sendToTenant(a.tenant_id, 'booking', {
    things: ['签约成功', `${room.property_name} ${room.room_no}`],
    amount: totalPay,
    date: b.start_date
  }, 'pages/bill/bill');
  res.json({ id: cid, notice: '签约已通过，合同已生成' });
});

// 审核拒绝
r.post('/:id/reject', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM lease_applications WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: '申请不存在' });
  if (a.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  const room = db.prepare('SELECT property_id FROM rooms WHERE id=?').get(a.room_id);
  if (!room || !canAccessProject(req, room.property_id)) return res.status(403).json({ error: '无权操作该项目' });
  const reason = (req.body || {}).reason || '';
  db.prepare(`UPDATE lease_applications SET status='rejected', reject_reason=?, handled_at=datetime('now','localtime'), handled_by=? WHERE id=?`)
    .run(reason, req.user.id, a.id);
  res.json({ ok: true });
});

export default r;
