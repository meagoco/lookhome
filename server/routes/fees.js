import { Router } from 'express';
import { db } from '../db.js';
import { auth } from '../middleware/auth.js';

const r = Router();

r.get('/', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM fee_types ORDER BY id').all());
});

r.put('/:id', auth, (req, res) => {
  const { enabled, default_rate, name } = req.body || {};
  const cur = db.prepare('SELECT * FROM fee_types WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE fee_types SET enabled=?, default_rate=?, name=? WHERE id=?')
    .run(enabled === undefined ? cur.enabled : (enabled ? 1 : 0),
      default_rate === undefined ? cur.default_rate : Number(default_rate),
      name || cur.name, req.params.id);
  res.json({ ok: true });
});

export default r;
