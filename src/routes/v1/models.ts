import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { getProviderKey } from '../api/providers.js';
import { createProvider } from '../../providers/factory.js';
import { loadModelsForProvider } from './chat.js';
import type { ModelInfo } from '../../providers/base.js';

export const modelsRouter = Router();

// /v1/models — aggregate models from all enabled providers.
// Each model is prefixed with "label:" so callers can request a specific provider.
modelsRouter.get('/models', async (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, label, base_url, api_path, models_path FROM providers WHERE enabled = 1')
    .all() as { id: string; label: string; base_url: string; api_path: string; models_path: string }[];

  const all: ModelInfo[] = [];
  const errors: { provider: string; error: string }[] = [];

  for (const row of rows) {
    const apiKey = getProviderKey(row.id);
    if (!apiKey) continue;
    const provider = createProvider({
      id: row.id,
      label: row.label,
      baseUrl: row.base_url,
      apiPath: row.api_path,
      modelsPath: row.models_path,
      apiKey,
    });
    try {
      const models = await loadModelsForProvider(provider, row.base_url, row.models_path, db);
      all.push(...models);
    } catch (e) {
      errors.push({ provider: row.label, error: (e as Error).message });
    }
  }

  res.json({
    object: 'list',
    data: all,
    ...(errors.length > 0 ? { errors } : {}),
  });
});
