import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../../db/index.js';
import { createProvider } from '../../providers/factory.js';
import { getProviderKey } from './providers.js';

export const modelsRouter = Router();

interface ModelRow {
  model_id: string;
  provider_id: string;
  fetched_at: number;
}

interface ProviderRow {
  id: string;
  label: string;
  base_url: string;
  api_path: string;
  models_path: string;
  enabled: number;
}

interface PresetEntry {
  platform: string;
  name?: string;
  baseUrl: string;
  tier?: string;
  signupUrl?: string;
  applyNote?: string;
  keyless?: boolean;
}

interface CatalogEntry {
  qualified: string;
  modelId: string;
  label: string;
  baseUrl: string;
  tier: string;
  signupUrl: string | null;
  applyNote: string | null;
  keyless: boolean;
  fetchedAt: number;
}

// Load presets once at module init
const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_PATH = join(__dirname, '..', '..', '..', 'presets', 'providers.json');
let PRESETS: PresetEntry[] = [];
try {
  PRESETS = (JSON.parse(readFileSync(PRESETS_PATH, 'utf8')) as { providers: PresetEntry[] }).providers;
} catch (e) {
  console.error('Failed to load presets:', e);
}

function presetFor(label: string, baseUrl: string): PresetEntry | undefined {
  let p = PRESETS.find(x => x.platform === label);
  if (p) return p;
  const norm = (s: string) => s.replace(/\/+$/, '');
  return PRESETS.find(x => norm(baseUrl).startsWith(norm(x.baseUrl)));
}

// GET /api/models/all — enriched model catalog across all providers
modelsRouter.get('/models/all', (_req, res) => {
  const db = getDb();
  const providers = db
    .prepare('SELECT id, label, base_url, api_path, models_path, enabled FROM providers ORDER BY label')
    .all() as ProviderRow[];
  const modelsByProv = db
    .prepare('SELECT model_id, provider_id, fetched_at FROM provider_models ORDER BY model_id')
    .all() as ModelRow[];

  const out: CatalogEntry[] = [];
  for (const m of modelsByProv) {
    const prov = providers.find(p => p.id === m.provider_id);
    if (!prov || !prov.enabled) continue;
    const preset = presetFor(prov.label, prov.base_url);
    out.push({
      qualified: `${prov.label}:${m.model_id}`,
      modelId: m.model_id,
      label: prov.label,
      baseUrl: prov.base_url,
      tier: preset?.tier || 'free',
      signupUrl: preset?.signupUrl || null,
      applyNote: preset?.applyNote || null,
      keyless: preset?.keyless || false,
      fetchedAt: m.fetched_at,
    });
  }
  // Sort: free first, then by label, then by model id
  const tierOrder: Record<string, number> = { free: 0, freemium: 1, paid: 2 };
  out.sort((a, b) => {
    const ta = tierOrder[a.tier] ?? 3;
    const tb = tierOrder[b.tier] ?? 3;
    if (ta !== tb) return ta - tb;
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.modelId.localeCompare(b.modelId);
  });
  res.json({ data: out, total: out.length });
});

// POST /api/models/refresh-all — bulk refresh from all enabled providers
modelsRouter.post('/models/refresh-all', async (_req, res) => {
  const db = getDb();
  const providers = db
    .prepare('SELECT id, label, base_url, api_path, models_path, enabled FROM providers WHERE enabled = 1')
    .all() as ProviderRow[];
  const results: Array<{ providerId: string; label: string; count: number; error?: string }> = [];
  for (const p of providers) {
    const apiKey = getProviderKey(p.id);
    if (!apiKey) {
      results.push({ providerId: p.id, label: p.label, count: 0, error: 'no api key' });
      continue;
    }
    try {
      const provider = createProvider({
        id: p.id,
        label: p.label,
        baseUrl: p.base_url,
        apiPath: p.api_path,
        modelsPath: p.models_path,
        apiKey,
      });
      const models = await provider.listModels();
      const now = Date.now();
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(p.id);
        const ins = db.prepare(
          'INSERT INTO provider_models (provider_id, model_id, fetched_at) VALUES (?, ?, ?)',
        );
        for (const m of models) ins.run(p.id, m.id, now);
      });
      tx();
      results.push({ providerId: p.id, label: p.label, count: models.length });
    } catch (e) {
      results.push({ providerId: p.id, label: p.label, count: 0, error: (e as Error).message });
    }
  }
  const ok = results.filter(r => !r.error).length;
  const failed = results.length - ok;
  res.json({ data: { ok, failed, results } });
});
