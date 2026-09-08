import { Router, Request } from 'express';
import { getDb } from '../../db/index.js';
import { encryptToString } from '../../crypto/encryption.js';
import { randomBytes, createHash } from 'node:crypto';

export const configRouter = Router();

// Auto-detect the hub's public base URL from the request
function detectBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3030';
  return `${proto}://${host}`;
}

// GET /api/config — return hub info (used by dashboard to show "Base URL" etc.)
configRouter.get('/config', (req, res) => {
  res.json({
    data: {
      baseUrl: detectBaseUrl(req),
      version: '0.1.0',
      mode: 'm2-streaming-auth',
      timestamp: Date.now(),
    },
  });
});

// GET /api/export?include=providers,hubkeys — download hub config as JSON
// Default: providers only (no secrets), no hub-keys (recreate on import)
// ?includeSecrets=true → also include encrypted API keys (for self-restoration)
configRouter.get('/export', (req, res) => {
  const include = (req.query.include as string) || 'providers,hubkeys';
  const includeSecrets = req.query.includeSecrets === 'true';
  const parts = new Set(include.split(',').map(s => s.trim()));
  const db = getDb();
  const out: Record<string, unknown> = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'freellm-hub',
  };
  if (parts.has('providers')) {
    const providers = db
      .prepare('SELECT id, label, base_url, api_path, models_path, enabled, notes, created_at, updated_at FROM providers ORDER BY label')
      .all() as Array<{ id: string; label: string; base_url: string; api_path: string; models_path: string; enabled: number; notes: string | null; created_at: number; updated_at: number }>;
    if (includeSecrets) {
      const keys = db.prepare('SELECT provider_id, api_key_enc FROM provider_keys').all() as Array<{ provider_id: string; api_key_enc: string }>;
      const keyMap = new Map(keys.map(k => [k.provider_id, k.api_key_enc]));
      out.providers = providers.map(p => ({
        label: p.label,
        baseUrl: p.base_url,
        apiPath: p.api_path,
        modelsPath: p.models_path,
        enabled: !!p.enabled,
        notes: p.notes,
        apiKey: keyMap.get(p.id) || null,  // still encrypted
      }));
    } else {
      out.providers = providers.map(p => ({
        label: p.label,
        baseUrl: p.base_url,
        apiPath: p.api_path,
        modelsPath: p.models_path,
        enabled: !!p.enabled,
        notes: p.notes,
      }));
    }
  }
  if (parts.has('hubkeys')) {
    const keys = db
      .prepare('SELECT id, label, enabled, created_at, last_used_at FROM hub_keys ORDER BY created_at')
      .all() as Array<{ id: string; label: string; enabled: number; created_at: number; last_used_at: number | null }>;
    out.hubKeys = keys.map(k => ({
      label: k.label,
      enabled: !!k.enabled,
      // fullKey is NOT exported (security)
    }));
  }
  res.setHeader('Content-Disposition', `attachment; filename="freellm-hub-export-${Date.now()}.json"`);
  res.json(out);
});

// POST /api/import — accept JSON and create providers + hub keys
// Accepts two formats:
//   1. Hub's own export: {providers: [{label, baseUrl, apiKey?, apiPath?, modelsPath?, notes?, enabled?}], hubKeys: [{label}]}
//   2. freellmapi-like: [{platform, apiKey, baseUrl, ...}] OR {keys: [...]}
// Returns: {providers: {created, updated, skipped}, hubKeys: {created, skipped}}
configRouter.post('/import', (req, res) => {
  const body = req.body;
  if (!body) {
    res.status(400).json({ error: { message: 'No body' } });
    return;
  }
  const db = getDb();
  // Normalize input
  let providersRaw: Array<Record<string, unknown>> = [];
  let hubKeysRaw: Array<Record<string, unknown>> = [];
  // Hub format
  if (Array.isArray(body.providers)) providersRaw = body.providers;
  if (Array.isArray(body.hubKeys)) hubKeysRaw = body.hubKeys;
  // freellmapi-like: top-level array
  if (Array.isArray(body)) {
    for (const item of body) {
      if (item && (item.platform || item.label)) providersRaw.push(item);
    }
  }
  // freellmapi-like: { keys: [...] }
  if (Array.isArray(body.keys)) {
    for (const item of body.keys) {
      if (item && (item.platform || item.label)) providersRaw.push(item);
    }
  }
  if (providersRaw.length === 0 && hubKeysRaw.length === 0) {
    res.status(400).json({ error: { message: 'No providers or hubKeys found in body' } });
    return;
  }

  const result = { providers: { created: 0, updated: 0, skipped: 0, errors: [] as string[] }, hubKeys: { created: 0, skipped: 0 } };
  // Import providers
  for (const p of providersRaw) {
    const label = (p.label || p.platform || '').toString().trim();
    const baseUrl = (p.baseUrl || p.base_url || '').toString().trim();
    const apiKey = (p.apiKey || p.api_key || '').toString();
    if (!label || !baseUrl) { result.providers.skipped++; result.providers.errors.push(`缺少 label 或 baseUrl: ${JSON.stringify(p).slice(0, 80)}`); continue; }
    if (!apiKey) { result.providers.skipped++; result.providers.errors.push(`${label}: 缺 apiKey`); continue; }
    const apiPath = (p.apiPath || p.api_path || '/chat/completions').toString();
    const modelsPath = (p.modelsPath || p.models_path || '/models').toString();
    const notes = (p.notes || (p.platform ? `imported from freellmapi: ${p.platform}` : null)) as string | null;
    const enabled = p.enabled !== false;
    const existing = db.prepare('SELECT id FROM providers WHERE label = ?').get(label) as { id: string } | undefined;
    if (existing) {
      // Update if same label
      const tx = db.transaction(() => {
        db.prepare(`UPDATE providers SET base_url = ?, api_path = ?, models_path = ?, enabled = ?, notes = ?, updated_at = ? WHERE id = ?`)
          .run(baseUrl, apiPath, modelsPath, enabled ? 1 : 0, notes, Date.now(), existing.id);
        db.prepare('UPDATE provider_keys SET api_key_enc = ?, updated_at = ? WHERE provider_id = ?')
          .run(encryptToString(apiKey), Date.now(), existing.id);
      });
      tx();
      result.providers.updated++;
    } else {
      const providerId = `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const tx = db.transaction(() => {
        db.prepare(`INSERT INTO providers (id, label, base_url, api_path, models_path, enabled, is_builtin, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
          .run(providerId, label, baseUrl, apiPath, modelsPath, enabled ? 1 : 0, notes, now, now);
        db.prepare(`INSERT INTO provider_keys (provider_id, api_key_enc, updated_at) VALUES (?, ?, ?)`)
          .run(providerId, encryptToString(apiKey), now);
      });
      tx();
      result.providers.created++;
    }
  }
  // Import hub keys (always re-create — old full key not exported)
  for (const k of hubKeysRaw) {
    const label = (k.label || '').toString().trim();
    if (!label) { result.hubKeys.skipped++; continue; }
    const existing = db.prepare('SELECT id FROM hub_keys WHERE label = ?').get(label);
    if (existing) { result.hubKeys.skipped++; continue; }
    // Generate key inline (we don't need the full key back; user can copy after)
    const id = 'hk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const fullKey = 'fh_' + randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = fullKey.slice(0, 12);
    const now = Date.now();
    db.prepare('INSERT INTO hub_keys (id, label, key_hash, key_prefix, enabled, created_at, last_used_at) VALUES (?, ?, ?, ?, 1, ?, NULL)')
      .run(id, label, keyHash, keyPrefix, now);
    result.hubKeys.created++;
  }
  res.json({ data: result });
});
