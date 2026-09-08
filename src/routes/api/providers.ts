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

// ===== Provider operations: refresh-models, test, bulk delete =====

import { createProvider } from '../../providers/factory.js';

// POST /api/providers/:id/refresh-models — fetch fresh model list from upstream
providersRouter.post('/providers/:id/refresh-models', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as
    | ProviderRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const apiKey = getProviderKey(req.params.id);
  if (!apiKey) {
    res.status(400).json({ error: { message: 'Provider has no API key' } });
    return;
  }
  const provider = createProvider({
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    apiPath: row.api_path,
    modelsPath: row.models_path,
    apiKey,
  });
  try {
    const models = await provider.listModels();
    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(row.id);
      const ins = db.prepare(
        'INSERT INTO provider_models (provider_id, model_id, fetched_at) VALUES (?, ?, ?)',
      );
      for (const m of models) ins.run(row.id, m.id, now);
    });
    tx();
    res.json({
      data: {
        providerId: row.id,
        count: models.length,
        models: models.map((m) => m.id),
      },
    });
  } catch (e) {
    res.status(502).json({
      error: {
        message: `Failed to fetch models: ${(e as Error).message}`,
        type: 'upstream_error',
      },
    });
  }
});

// POST /api/providers/:id/test — send a tiny test request, return latency
providersRouter.post('/providers/:id/test', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as
    | ProviderRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const apiKey = getProviderKey(req.params.id);
  if (!apiKey) {
    res.status(400).json({ error: { message: 'Provider has no API key' } });
    return;
  }
  const provider = createProvider({
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    apiPath: row.api_path,
    modelsPath: row.models_path,
    apiKey,
  });
  // Pick first model from cache, or fall back to "test" model id
  const cached = db
    .prepare('SELECT model_id FROM provider_models WHERE provider_id = ? LIMIT 1')
    .get(row.id) as { model_id: string } | undefined;
  const modelId = (req.body?.model as string) || cached?.model_id || 'test';
  const prompt = (req.body?.prompt as string) || 'ping';
  const start = Date.now();
  try {
    const out = await provider.chat({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8,
      stream: false,
    } as any);
    const latency = Date.now() - start;
    res.json({
      data: {
        providerId: row.id,
        model: modelId,
        latencyMs: latency,
        content: out.choices?.[0]?.message?.content ?? '',
        usage: out.usage,
      },
    });
  } catch (e) {
    res.status(502).json({
      error: {
        message: `Test failed: ${(e as Error).message}`,
        type: 'upstream_error',
        latencyMs: Date.now() - start,
      },
    });
  }
});

// GET /api/providers/:id/models — list cached models for a provider
providersRouter.get('/providers/:id/models', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id, label FROM providers WHERE id = ?').get(req.params.id) as
    | { id: string; label: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const models = db
    .prepare(
      'SELECT model_id, fetched_at FROM provider_models WHERE provider_id = ? ORDER BY model_id',
    )
    .all(row.id) as { model_id: string; fetched_at: number }[];
  res.json({
    data: {
      providerId: row.id,
      label: row.label,
      count: models.length,
      models: models.map((m) => ({
        id: m.model_id,
        qualified: `${row.label}:${m.model_id}`,
        fetchedAt: m.fetched_at,
      })),
    },
  });
});

// DELETE /api/providers/:id/models — bulk delete models
// body: { ids?: string[] } — if omitted, delete ALL cached models for this provider
providersRouter.delete('/providers/:id/models', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id) as
    | { id: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const ids = req.body?.ids as string[] | undefined;
  let changes = 0;
  if (Array.isArray(ids) && ids.length > 0) {
    const del = db.prepare(
      'DELETE FROM provider_models WHERE provider_id = ? AND model_id = ?',
    );
    const tx = db.transaction(() => {
      for (const m of ids) changes += del.run(row.id, m).changes;
    });
    tx();
  } else {
    // No ids provided → delete all
    const info = db
      .prepare('DELETE FROM provider_models WHERE provider_id = ?')
      .run(row.id);
    changes = info.changes;
  }
  res.json({ data: { deleted: changes } });
});

// ===== Provider operations: refresh-models, test, bulk delete =====


// POST /api/providers/:id/refresh-models — fetch fresh model list from upstream
providersRouter.post('/providers/:id/refresh-models', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as
    | ProviderRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const apiKey = getProviderKey(req.params.id);
  if (!apiKey) {
    res.status(400).json({ error: { message: 'Provider has no API key' } });
    return;
  }
  const provider = createProvider({
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    apiPath: row.api_path,
    modelsPath: row.models_path,
    apiKey,
  });
  try {
    const models = await provider.listModels();
    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(row.id);
      const ins = db.prepare(
        'INSERT INTO provider_models (provider_id, model_id, fetched_at) VALUES (?, ?, ?)',
      );
      for (const m of models) ins.run(row.id, m.id, now);
    });
    tx();
    res.json({
      data: {
        providerId: row.id,
        count: models.length,
        models: models.map((m) => m.id),
      },
    });
  } catch (e) {
    res.status(502).json({
      error: {
        message: `Failed to fetch models: ${(e as Error).message}`,
        type: 'upstream_error',
      },
    });
  }
});

// POST /api/providers/:id/test — send a tiny test request, return latency
providersRouter.post('/providers/:id/test', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as
    | ProviderRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const apiKey = getProviderKey(req.params.id);
  if (!apiKey) {
    res.status(400).json({ error: { message: 'Provider has no API key' } });
    return;
  }
  const provider = createProvider({
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    apiPath: row.api_path,
    modelsPath: row.models_path,
    apiKey,
  });
  // Pick first model from cache, or fall back to "test" model id
  const cached = db
    .prepare('SELECT model_id FROM provider_models WHERE provider_id = ? LIMIT 1')
    .get(row.id) as { model_id: string } | undefined;
  const modelId = (req.body?.model as string) || cached?.model_id || 'test';
  const prompt = (req.body?.prompt as string) || 'ping';
  const start = Date.now();
  try {
    const out = await provider.chat({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8,
      stream: false,
    } as any);
    const latency = Date.now() - start;
    res.json({
      data: {
        providerId: row.id,
        model: modelId,
        latencyMs: latency,
        content: out.choices?.[0]?.message?.content ?? '',
        usage: out.usage,
      },
    });
  } catch (e) {
    res.status(502).json({
      error: {
        message: `Test failed: ${(e as Error).message}`,
        type: 'upstream_error',
        latencyMs: Date.now() - start,
      },
    });
  }
});

// GET /api/providers/:id/models — list cached models for a provider
providersRouter.get('/providers/:id/models', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id, label FROM providers WHERE id = ?').get(req.params.id) as
    | { id: string; label: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const models = db
    .prepare(
      'SELECT model_id, fetched_at FROM provider_models WHERE provider_id = ? ORDER BY model_id',
    )
    .all(row.id) as { model_id: string; fetched_at: number }[];
  res.json({
    data: {
      providerId: row.id,
      label: row.label,
      count: models.length,
      models: models.map((m) => ({
        id: m.model_id,
        qualified: `${row.label}:${m.model_id}`,
        fetchedAt: m.fetched_at,
      })),
    },
  });
});

// DELETE /api/providers/:id/models — bulk delete models
// body: { ids?: string[] } — if omitted, delete ALL cached models for this provider
providersRouter.delete('/providers/:id/models', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id) as
    | { id: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const ids = req.body?.ids as string[] | undefined;
  let changes = 0;
  if (Array.isArray(ids) && ids.length > 0) {
    const del = db.prepare(
      'DELETE FROM provider_models WHERE provider_id = ? AND model_id = ?',
    );
    const tx = db.transaction(() => {
      for (const m of ids) changes += del.run(row.id, m).changes;
    });
    tx();
  } else {
    const info = db
      .prepare('DELETE FROM provider_models WHERE provider_id = ?')
      .run(row.id);
    changes = info.changes;
  }
  res.json({ data: { deleted: changes } });
});
