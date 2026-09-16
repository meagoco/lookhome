import { Router } from 'express';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';
import { sendToTenant } from '../wechat-subscribe.js';
import { payConfigured, createWechatRefund } from './pay.js';

const r = Router();

function refundRoomProperty(req, contractId) {
  const c = db.prepare('SELECT room_id FROM contracts WHERE id=?').get(contractId);
  if (!c) return null;
  const room = db.prepare('SELECT property_id FROM rooms WHERE id=?').get(c.room_id);
  return room ? room.property_id : null;
}

// 查找该合同押金账单的微信支付记录（只有小程序微信支付收取的押金才能原路退回）
function findDepositWechatPayment(contractId) {
  return db.prepare(`
    SELECT p.*, ROUND(p.amount * 100) AS total_fen
    FROM payments p JOIN bills b ON b.id = p.bill_id
    WHERE b.contract_id = ? AND b.bill_type = 'deposit'
      AND p.pay_mode = 'wechat' AND p.confirm_status = 'confirmed'
    ORDER BY p.id DESC LIMIT 1`).get(contractId) || null;
}

// 后台直接退押金（全额/部分；微信收款押金 → 微信原路退回；否则记账手工退款）
r.post('/', auth, async (req, res) => {
  const { contract_id, amount, remark } = req.body || {};
  if (!contract_id || !(amount > 0)) return res.status(400).json({ error: '参数错误' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(contract_id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const pid = refundRoomProperty(req, contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  if (Number(amount) > c.deposit) return res.status(400).json({ error: `退款不能超过押金 ${c.deposit} 元` });
  const willEnd = c.status === 'active';

  const pay = findDepositWechatPayment(contract_id);
  const wechatOk = payConfigured() && pay;

  // 有微信押金支付记录 → 调微信原路退回，受理成功后才记账+退房置空
  if (wechatOk) {
    const outRefundNo = `R${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r2 = await createWechatRefund({
      outRefundNo,
      payment: pay,
      amountFen: Math.round(Number(amount) * 100),
      reason: '押金退款'
    });
    if (!r2.ok) return res.status(502).json({ error: `微信退款提交失败：${r2.error}（可改用「人工退押金」记账）` });
    let newId = null;
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO refunds (contract_id,payment_id,tenant_id,amount,refund_mode,source,status,remark,out_refund_no,wechat_refund_id,wx_refund_status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
        .run(contract_id, pay.id, c.tenant_id, Number(amount), 'wechat', 'admin', 'processing', (remark || '').toString().slice(0, 200), outRefundNo, r2.data.refund_id || '', r2.data.status || 'PROCESSING');
      newId = info.lastInsertRowid;
      if (willEnd) {
        db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime') WHERE id=?`).run(contract_id);
        db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
      }
    });
    tx();
    return res.json({
      id: newId, refund_mode: 'wechat', auto_ended: willEnd, wx_status: r2.data.status || 'PROCESSING',
      notice: willEnd
        ? '已提交微信原路退回：合同已自动退房，房间已改为空置，退款到账后自动确认（一般 1-3 个工作日）'
        : '已提交微信原路退回（合同已解除/作废），退款到账后自动确认（一般 1-3 个工作日）'
    });
  }

  // 无微信支付记录 / 未配置 → 记账手工退款（线下已退场景）
  let newId = null;
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO refunds (contract_id,payment_id,tenant_id,amount,refund_mode,source,status,remark,done_at)
      VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
      .run(contract_id, pay ? pay.id : null, c.tenant_id, Number(amount), 'manual', 'admin', 'done', (remark || '').toString().slice(0, 200));
    newId = info.lastInsertRowid;
    if (willEnd) {
      db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime') WHERE id=?`).run(contract_id);
      db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
    }
  });
  tx();
  res.json({
    id: newId, refund_mode: 'manual', auto_ended: willEnd,
    notice: pay
      ? (willEnd ? '该押金非小程序微信支付收取，已按手工退款记账：合同已自动退房，房间已改为空置，请线下转账后在收款记录中登记' : '该押金非小程序微信支付收取，已按手工退款记账（合同已解除/作废），请线下转账后登记收款')
      : (willEnd ? '已记录手工退款：合同已自动退房，房间已改为空置，请线下转账后在收款记录中登记' : '已记录手工退款（合同已解除/作废），请线下转账后登记收款')
  });
});

// 后台人工退押金：仅系统记录（不联动微信支付），选择合同后把押金记为已退；
// 与「发起退押金」的区别：后者按微信原路退回流程处理，人工退押金仅为线下已退的记录
r.post('/manual', auth, (req, res) => {
  const { contract_id, amount, remark } = req.body || {};
  if (!contract_id || !(amount > 0)) return res.status(400).json({ error: '参数错误' });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(contract_id);
  if (!c) return res.status(404).json({ error: '合同不存在' });
  const pid = refundRoomProperty(req, contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  if (Number(amount) > c.deposit) return res.status(400).json({ error: `退款不能超过押金 ${c.deposit} 元` });
  const willEnd = c.status === 'active';
  let newId = null;
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO refunds (contract_id,payment_id,tenant_id,amount,refund_mode,source,status,remark,done_at)
      VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
      .run(contract_id, null, c.tenant_id, Number(amount), 'manual', 'admin-manual', 'done', (remark || '人工退押金（线下已退）').toString().slice(0, 200));
    newId = info.lastInsertRowid;
    if (willEnd) {
      db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime') WHERE id=?`).run(contract_id);
      db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
    }
  });
  tx();
  res.json({
    id: newId,
    refund_mode: 'manual',
    auto_ended: willEnd,
    notice: willEnd
      ? '已记录人工退押金（线下已退）：押金记为已退，合同已自动退房，房间已改为空置'
      : '已记录人工退押金（线下已退）：合同已解除/作废，未重复退房'
  });
});

// 后台同意退押金：微信收款押金 → 微信原路退回（到账后自动确认）；否则立即记账并自动退房置空
r.post('/:id/approve', auth, async (req, res) => {
  const { id } = req.params;
  const rf = db.prepare('SELECT * FROM refunds WHERE id=?').get(id);
  if (!rf) return res.status(404).json({ error: '退款记录不存在' });
  if (rf.status !== 'pending') return res.status(400).json({ error: `该申请当前状态为「${rf.status}」，不可重复审批` });
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(rf.contract_id);
  if (!c) return res.status(404).json({ error: '关联合同不存在' });
  const pid = refundRoomProperty(req, rf.contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  const willEnd = c.status === 'active'; // 退款失败恢复待审批后，合同可能已解除，此时仅退款不再退房
  const note = (req.body?.note || '').toString().slice(0, 200);

  const pay = findDepositWechatPayment(rf.contract_id);
  const wechatOk = payConfigured() && pay;

  // 微信押金支付记录存在 → 原路退回：受理成功 → 标记退款中，合同解除+房间置空；到账后回调自动置为已退
  if (wechatOk) {
    const outRefundNo = `R${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r2 = await createWechatRefund({
      outRefundNo,
      payment: pay,
      amountFen: Math.round(Number(rf.amount) * 100),
      reason: '租客申请退押金'
    });
    if (!r2.ok) return res.status(502).json({ error: `微信退款提交失败：${r2.error}（可驳回申请，改用后台「发起退押金」或「人工退押金」处理）` });
    const tx = db.transaction(() => {
      db.prepare(`UPDATE refunds SET status='processing', remark=?, out_refund_no=?, wechat_refund_id=?, wx_refund_status=? WHERE id=?`)
        .run(note || rf.remark || '', outRefundNo, r2.data.refund_id || '', r2.data.status || 'PROCESSING', id);
      if (willEnd) {
        db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime') WHERE id=?`).run(rf.contract_id);
        db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
      }
    });
    tx();
    return res.json({ ok: true, wechat: true, auto_ended: willEnd, notice: willEnd
      ? '已提交微信原路退回：合同已解除，房间已改为空置，退款到账后自动确认（一般 1-3 个工作日）'
      : '已提交微信原路退回（合同此前已解除），退款到账后自动确认（一般 1-3 个工作日）' });
  }

  // 无微信支付记录 → 立即记账完成，并发送退款进度提醒
  const tx = db.transaction(() => {
    db.prepare(`UPDATE refunds SET status='done', done_at=datetime('now','localtime'), remark=? WHERE id=?`)
      .run(note || rf.remark || '', id);
    if (willEnd) {
      db.prepare(`UPDATE contracts SET status='ended', ended_at=datetime('now','localtime') WHERE id=?`).run(rf.contract_id);
      db.prepare(`UPDATE rooms SET status='vacant', available_date=date('now','localtime') WHERE id=?`).run(c.room_id);
    }
  });
  tx();
  // 退款进度通知（租客申请退押金时已订阅）：押金已退
  sendToTenant(c.tenant_id, 'refund', {
    things: ['退款成功', 'LookHome', `退押金单号 ${id}`],
    amount: rf.amount,
    date: new Date().toISOString().slice(0, 10)
  }, 'pages/profile/profile');
  res.json({
    ok: true,
    notice: pay
      ? '该押金非小程序微信支付收取，已按手工退款记账：合同已解除，房间已改为空置，请线下转账后在收款记录中登记'
      : '已同意退押金：合同已解除，房间已改为空置'
  });
});

// 后台驳回退押金申请
r.post('/:id/reject', auth, (req, res) => {
  const { id } = req.params;
  const rf = db.prepare('SELECT * FROM refunds WHERE id=?').get(id);
  if (!rf) return res.status(404).json({ error: '退款记录不存在' });
  if (rf.status !== 'pending') return res.status(400).json({ error: `该申请当前状态为「${rf.status}」，不可重复审批` });
  const pid = refundRoomProperty(req, rf.contract_id);
  if (pid && !canAccessProject(req, pid)) return res.status(403).json({ error: '无权操作该项目' });
  const reason = (req.body?.reason || '').toString().slice(0, 200);
  if (!reason) return res.status(400).json({ error: '请填写驳回原因' });
  db.prepare(`UPDATE refunds SET status='rejected', remark=? WHERE id=?`).run(reason, id);
  res.json({ ok: true, notice: '已驳回该退押金申请' });
});

// 退款列表（操作员仅见授权项目）
r.get('/', auth, (req, res) => {
  const { cond, args } = grantedScope(req, 'r');
  const rows = db.prepare(`
    SELECT rf.*, t.name AS tenant_name, r.room_no, p.name AS property_name, c.monthly_rent
    FROM refunds rf
    JOIN contracts c ON c.id=rf.contract_id
    JOIN tenants t ON t.id=c.tenant_id
    JOIN rooms r ON r.id=c.room_id
    JOIN properties p ON p.id=r.property_id
    WHERE 1=1${cond}
    ORDER BY rf.id DESC LIMIT 300`).all(...args);
  res.json(rows);
});

export default r;
