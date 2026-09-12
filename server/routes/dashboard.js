import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope } from '../middleware/auth.js';

const r = Router();
const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);

// 生成连续月序列（含补零）
function monthRange(start, end) {
  const out = [];
  const [sy, sm] = start.slice(0, 7).split('-').map(Number);
  const [ey, em] = end.slice(0, 7).split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// 仪表盘统计（操作员仅统计授权项目；支持自定义周期 start/end）
r.get('/', auth, (req, res) => {
  const t = today(), m = month();
  // 周期：start/end 缺省为本月；trend 缺省近12个月
  const start = req.query.start || `${m}-01`;
  const end = req.query.end || `${m}-31`;
  const mStart = start.slice(0, 7), mEnd = end.slice(0, 7);
  const bs = grantedScope(req, 'r');   // bills → rooms(r)
  const rs = grantedScope(req, 'r');   // rooms(r)
  const cs = grantedScope(req, 'r');   // contracts → rooms(r)
  const ps = grantedScope(req, 'r');   // payments → rooms(r)
  const q1 = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN b.status IN ('unpaid','overdue') THEN b.total ELSE 0 END),0) AS outstanding,
      COALESCE(SUM(CASE WHEN b.status='overdue' THEN b.total ELSE 0 END),0) AS overdue,
      COALESCE(SUM(CASE WHEN b.status='paid' THEN b.total ELSE 0 END),0) AS collected
    FROM bills b JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id
    WHERE (b.period BETWEEN ? AND ?) AND b.status!='void'${bs.cond}`).get(mStart, mEnd, ...bs.args);
  const q2 = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN b.status IN ('unpaid','overdue') THEN b.total ELSE 0 END),0) AS today_receivable
    FROM bills b JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id
    WHERE (b.status IN ('unpaid','overdue')) AND (b.period BETWEEN ? AND ?)${bs.cond}`).get(mStart, mEnd, ...bs.args);
  const roomStat = db.prepare(`SELECT r.status, COUNT(*) c FROM rooms r JOIN properties p ON p.id=r.property_id WHERE 1=1${rs.cond} GROUP BY r.status`).all(...rs.args);
  const totalRooms = roomStat.reduce((s, x) => s + x.c, 0);
  const rented = (roomStat.find(x => x.status === 'rented') || {}).c || 0;
  const vacant = (roomStat.find(x => x.status === 'vacant') || {}).c || 0;
  const rentRate = totalRooms ? Math.round(rented / totalRooms * 10000) / 100 : 0;
  const tenantPending = db.prepare(`
    SELECT COUNT(*) c FROM tenants t WHERE t.verify_status='pending'
    AND (${req.user.role === 'admin' ? '1=1' : `t.created_by=? OR t.id IN (SELECT DISTINCT c.tenant_id FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN property_grants g ON g.property_id=r.property_id WHERE g.admin_user_id=?)`})`)
    .get(...(req.user.role === 'admin' ? [] : [req.user.id, req.user.id])).c;
  const depositOwed = db.prepare(`
    SELECT COALESCE(SUM(c.deposit),0) v FROM contracts c JOIN rooms r ON r.id=c.room_id JOIN properties p ON p.id=r.property_id
    WHERE c.status='active' AND NOT EXISTS (
      SELECT 1 FROM bills b WHERE b.contract_id=c.id AND b.bill_type='deposit' AND b.status='paid')${cs.cond}`).get(...cs.args).v;
  // 周期内实收（按支付确认时间，按日聚合趋势）
  const income = db.prepare(`
    SELECT substr(pm.created_at,1,7) ym, SUM(pm.amount) v FROM payments pm
    JOIN bills b ON b.id=pm.bill_id JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id
    WHERE pm.confirm_status='confirmed' AND date(pm.created_at) BETWEEN ? AND ?${ps.cond}
    GROUP BY ym ORDER BY ym`).all(start, end, ...ps.args);
  // 收入图表序列：默认近12个月（按支付时间），自定义周期按 start/end
  const tStart = req.query.start || new Date(Date.now() - 11 * 30 * 864e5).toISOString().slice(0, 10);
  const tEnd = req.query.end || today();
  const trendRaw = db.prepare(`
    SELECT substr(pm.created_at,1,7) ym, SUM(pm.amount) v FROM payments pm
    JOIN bills b ON b.id=pm.bill_id JOIN rooms r ON r.id=b.room_id JOIN properties p ON p.id=r.property_id
    WHERE pm.confirm_status='confirmed' AND date(pm.created_at) BETWEEN ? AND ?${ps.cond}
    GROUP BY ym ORDER BY ym`).all(tStart, tEnd, ...ps.args);
  const map = {}; for (const x of trendRaw) map[x.ym] = Number(x.v);
  const trend = monthRange(tStart, tEnd).map(ym => ({ ym, v: map[ym] || 0 }));
  res.json({
    outstanding: q1.outstanding, overdue: q1.overdue, collected: q1.collected,
    today_receivable: q2.today_receivable,
    rooms: { total: totalRooms, rented, vacant, rent_rate: rentRate },
    tenant_pending: tenantPending,
    deposit_owed: depositOwed,
    trend, income, range: { start, end }
  });
});

export default r;
