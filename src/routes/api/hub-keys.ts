import { Router } from 'express';
import { generateHubKey, type HubKey } from '../../middleware/auth.js';
import { getDb } from '../../db/index.js';

export const hubKeysRouter = Router();

interface HubKeyRow {
  id: string;
  label: string;
  key_prefix: string;
  enabled: number;
  created_at: number;
  last_used_at: number | null;
}

// GET /api/hub-keys — list all (without full keys)
hubKeysRouter.get('/hub-keys', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT id, label, key_prefix, enabled, created_at, last_used_at FROM hub_keys ORDER BY created_at DESC')
    .all() as HubKeyRow[];
  res.json({
    object: 'list',
    data: rows.map((r): HubKey & { keyPrefix: string } => ({
      id: r.id,
      label: r.label,
      keyPrefix: r.key_prefix,
      enabled: !!r.enabled,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
  });
});

// POST /api/hub-keys — create new
// body: { label }
hubKeysRouter.post('/hub-keys', (req, res) => {
  const label = (req.body?.label ?? '').toString().trim();
  if (!label) {
    res.status(400).json({ error: { message: 'label required' } });
    return;
  }
  const { fullKey, record } = generateHubKey(label);
  // Return the full key ONLY this once — caller must save it
  res.status(201).json({
    ...record,
    fullKey,
    warning: 'Save this key now — it will not be shown again.',
  });
});

// PATCH /api/hub-keys/:id — toggle enabled / rename
hubKeysRouter.patch('/hub-keys/:id', (req, res) => {
  const { enabled, label } = req.body ?? {};
  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof enabled === 'boolean') {
    updates.push('enabled = ?');
    params.push(enabled ? 1 : 0);
  }
  if (typeof label === 'string' && label.trim()) {
    updates.push('label = ?');
    params.push(label.trim());
  }
  if (updates.length === 0) {
    res.status(400).json({ error: { message: 'No fields to update' } });
    return;
  }
  const info = getDb()
    .prepare(`UPDATE hub_keys SET ${updates.join(', ')} WHERE id = ?`)
    .run(...params, req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: { message: 'Hub key not found' } });
    return;
  }
  res.json({ ok: true });
});

// DELETE /api/hub-keys/:id — revoke
hubKeysRouter.delete('/hub-keys/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM hub_keys WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: { message: 'Hub key not found' } });
    return;
  }
  res.status(204).end();
});
