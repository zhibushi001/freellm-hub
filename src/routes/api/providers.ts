import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { encryptToString, decryptFromString } from '../../crypto/encryption.js';

export const providersRouter = Router();

interface ProviderRow {
  id: string;
  label: string;
  base_url: string;
  api_path: string;
  models_path: string;
  enabled: number;
  is_builtin: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

// GET /api/providers — list all providers (without keys)
providersRouter.get('/providers', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM providers ORDER BY is_builtin DESC, label ASC')
    .all() as ProviderRow[];
  res.json({
    object: 'list',
    data: rows.map(rowToProvider),
  });
});

// GET /api/providers/:id — get one provider
providersRouter.get('/providers/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as
    | ProviderRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  res.json(rowToProvider(row));
});

// POST /api/providers — create a new provider
// body: { id?, label, baseUrl, apiPath?, modelsPath?, apiKey, notes? }
providersRouter.post('/providers', (req, res) => {
  const { id, label, baseUrl, apiPath, modelsPath, apiKey, notes } = req.body ?? {};
  if (!label || !baseUrl || !apiKey) {
    res.status(400).json({
      error: { message: 'Required: label, baseUrl, apiKey' },
    });
    return;
  }
  const providerId = id || `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO providers (id, label, base_url, api_path, models_path, enabled, is_builtin, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    ).run(
      providerId,
      label,
      baseUrl,
      apiPath || '/chat/completions',
      modelsPath || '/models',
      notes ?? null,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO provider_keys (provider_id, api_key_enc, updated_at) VALUES (?, ?, ?)`,
    ).run(providerId, encryptToString(apiKey), now);
  });
  try {
    tx();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as ProviderRow;
    res.status(201).json(rowToProvider(row));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: { message: 'Provider label already exists' } });
      return;
    }
    throw e;
  }
});

// DELETE /api/providers/:id
providersRouter.delete('/providers/:id', (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  res.status(204).end();
});

// PATCH /api/providers/:id — toggle enabled
providersRouter.patch('/providers/:id', (req, res) => {
  const { enabled, notes, baseUrl, apiKey } = req.body ?? {};
  const db = getDb();
  const now = Date.now();

  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof enabled === 'boolean') {
    updates.push('enabled = ?');
    params.push(enabled ? 1 : 0);
  }
  if (typeof notes === 'string') {
    updates.push('notes = ?');
    params.push(notes);
  }
  if (typeof baseUrl === 'string') {
    updates.push('base_url = ?');
    params.push(baseUrl);
  }
  updates.push('updated_at = ?');
  params.push(now);

  if (apiKey) {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...params, req.params.id);
      db.prepare(
        `UPDATE provider_keys SET api_key_enc = ?, updated_at = ? WHERE provider_id = ?`,
      ).run(encryptToString(apiKey), now, req.params.id);
    });
    tx();
  } else {
    db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...params, req.params.id);
  }

  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as
    | ProviderRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  res.json(rowToProvider(row));
});

// Internal: get decrypted key (for chat route)
export function getProviderKey(providerId: string): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT api_key_enc FROM provider_keys WHERE provider_id = ?')
    .get(providerId) as { api_key_enc: string } | undefined;
  if (!row) return null;
  try {
    return decryptFromString(row.api_key_enc);
  } catch {
    return null;
  }
}

function rowToProvider(row: ProviderRow) {
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    apiPath: row.api_path,
    modelsPath: row.models_path,
    enabled: !!row.enabled,
    isBuiltin: !!row.is_builtin,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
