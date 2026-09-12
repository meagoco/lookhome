import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { auth, grantedScope, canAccessProject } from '../middleware/auth.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// 抄表记录列表（操作员仅见授权项目）
r.get('/', auth, (req, res) => {
  const { period } = req.query;
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const { cond, args } = grantedScope(req, 'r');
  let sql = `
    SELECT m.*, r.room_no, p.name AS property_name
    FROM meter_readings m JOIN rooms r ON r.id=m.room_id JOIN properties p ON p.id=r.property_id WHERE 1=1${cond}`;
  if (period) { sql += ' AND m.period=?'; args.push(period); }
  if (projectId) { sql += ' AND r.property_id=?'; args.push(projectId); }
  sql += ' ORDER BY m.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
});

// 导出抄表 Excel 模板（可指定项目；上期读数列自动预填该房间最近一次抄表读数〔不含本月〕，本期留空）
r.get('/template', auth, (req, res) => {
  const period = String(req.query.period || '').trim();
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  if (!projectId) return res.status(400).json({ error: '请先选择要导出的项目' });
  if (!canAccessProject(req, projectId)) return res.status(403).json({ error: '无权操作该项目' });
  let sql = `
    SELECT r.id, r.room_no, p.name AS property_name
    FROM rooms r JOIN properties p ON p.id=r.property_id WHERE r.property_id=?`;
  const rooms = db.prepare(sql).all(projectId);
  if (!rooms.length) return res.status(400).json({ error: '该项目暂无房间，无法导出模板' });
  const lastReading = db.prepare(
    `SELECT curr_reading FROM meter_readings WHERE room_id=? AND meter_type=? AND period < ? ORDER BY period DESC LIMIT 1`);
  const rows = [['项目', '房间号', '水表上期', '水表本期', '电表上期', '电表本期']];
  for (const rm of rooms) {
    const wPrev = period ? ((lastReading.get(rm.id, 'water', period) || {}).curr_reading ?? '') : '';
    const ePrev = period ? ((lastReading.get(rm.id, 'electric', period) || {}).curr_reading ?? '') : '';
    rows.push([rm.property_name, rm.room_no, wPrev, '', ePrev, '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '抄表');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="meter-${period || 'all'}.xlsx"`);
  res.send(buf);
});

// 批量导入抄表（模板填好本期读数后上传；同一房间同表同期重复导入会覆盖）
r.post('/import', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 Excel 文件' });
  const period = String((req.body || {}).period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: '月份格式错误（应为 YYYY-MM）' });
  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch (e) {
    return res.status(400).json({ error: 'Excel 解析失败：' + e.message });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 定位表头行
  let headIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').includes('项目') && String(rows[i][1] || '').includes('房间号')) { headIdx = i; break; }
  }
  if (headIdx < 0) return res.status(400).json({ error: '未识别到模板表头（需含：项目、房间号、水表上期、水表本期、电表上期、电表本期）' });

  // 房间索引：项目名+房号 → id（房号跨项目可能重复，优先精确匹配项目）
  const rooms = db.prepare(`
    SELECT r.*, p.name AS property_name FROM rooms r
    JOIN properties p ON p.id=r.property_id`).all();
  const roomByNo = new Map();
  for (const rm of rooms) {
    if (!roomByNo.has(rm.room_no)) roomByNo.set(rm.room_no, []);
    roomByNo.get(rm.room_no).push(rm);
  }

  const lastReading = db.prepare(
    `SELECT curr_reading FROM meter_readings WHERE room_id=? AND meter_type=? AND period <= ? ORDER BY period DESC LIMIT 1`);
  const upsert = db.prepare(`SELECT id FROM meter_readings WHERE room_id=? AND meter_type=? AND period=?`);

  const ok = [];   // {room, type, prev, curr, usage, amount}
  const fail = []; // {line, reason}

  const tx = db.transaction(() => {
    for (let i = headIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const prop = String(row[0] || '').trim();
      const roomNo = String(row[1] || '').trim();
      if (!roomNo) continue; // 空行跳过
      const wPrevRaw = String(row[2] || '').trim();
      const wCurrRaw = String(row[3] || '').trim();
      const ePrevRaw = String(row[4] || '').trim();
      const eCurrRaw = String(row[5] || '').trim();
      if (!wCurrRaw && !eCurrRaw) { fail.push({ line: i + 1, reason: '水表/电表本期均未填写' }); continue; }

      // 找房间
      let cand = roomByNo.get(roomNo) || [];
      let rm = null;
      if (prop) rm = cand.find(x => x.property_name === prop) || null;
      if (!rm && cand.length === 1) rm = cand[0];
      if (!rm) { fail.push({ line: i + 1, reason: `找不到房间「${roomNo}」${prop ? '（项目' + prop + '）' : ''}` }); continue; }
      if (!canAccessProject(req, rm.property_id)) { fail.push({ line: i + 1, reason: `无权操作项目「${rm.property_name}」的房间` }); continue; }

      for (const [type, prevRaw, currRaw] of [['water', wPrevRaw, wCurrRaw], ['electric', ePrevRaw, eCurrRaw]]) {
        if (!currRaw) continue; // 该表本期未填 → 不处理
        const curr = Number(currRaw);
        if (!isFinite(curr) || curr < 0) { fail.push({ line: i + 1, reason: `${type === 'water' ? '水' : '电'}表本期读数无效` }); continue; }
        // 上期：模板填了用模板，没填取系统上次读数
        let prev = prevRaw !== '' ? Number(prevRaw) : null;
        if (prev === null || !isFinite(prev) || prev < 0) {
          prev = (lastReading.get(rm.id, type, period) || {}).curr_reading ?? 0;
        }
        if (curr < prev) { fail.push({ line: i + 1, reason: `${type === 'water' ? '水' : '电'}表本期(${curr})小于上期(${prev})` }); continue; }
        const usage = Math.round((curr - prev) * 1000) / 1000;
        const rate = type === 'water' ? (rm.water_rate || 0) : (rm.electric_rate || 0);
        const factor = type === 'water' ? (rm.water_factor || 1) : (rm.electric_factor || 1);
        const amount = Math.round(usage * rate * factor * 100) / 100;
        const exist = upsert.get(rm.id, type, period);
        if (exist) {
          db.prepare(`UPDATE meter_readings SET prev_reading=?,curr_reading=?,usage=?,amount=? WHERE id=?`)
            .run(prev, curr, usage, amount, exist.id);
        } else {
          db.prepare(`INSERT INTO meter_readings (room_id,meter_type,period,prev_reading,curr_reading,usage,amount) VALUES (?,?,?,?,?,?,?)`)
            .run(rm.id, type, period, prev, curr, usage, amount);
        }
        ok.push({ room: roomNo, type, prev, curr, usage, amount });
      }
    }
  });
  tx();

  res.json({ ok: true, period, success: ok.length, failed: fail.length, details: ok, failures: fail.slice(0, 50) });
});

export default r;
