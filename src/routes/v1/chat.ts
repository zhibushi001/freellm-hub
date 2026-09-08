import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { getProviderKey } from '../api/providers.js';
import { OpenAICompatibleProvider } from '../../providers/openai-compatible.js';
import type { ChatRequest, ModelInfo, Provider } from '../../providers/base.js';

export const chatRouter = Router();

// POST /v1/chat/completions — OpenAI-compatible
// Body:
//   {
//     model: "provider_label:model_id" | "model_id",   // if no provider, picks first enabled
//     messages: [...],
//     temperature?, top_p?, max_tokens?, stream? (M1: not supported, returns error)
//   }
// Headers:
//   Authorization: Bearer <hub-key>  (M1: optional, just routes by model)
chatRouter.post('/chat/completions', async (req, res) => {
  const body = req.body as Partial<ChatRequest> | undefined;
  if (!body || !body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({
      error: { message: 'Required: model, non-empty messages[]' },
    });
    return;
  }
  if (body.stream) {
    res.status(501).json({
      error: { message: 'Streaming not yet supported in M1. Set stream=false.' },
    });
    return;
  }

  const { provider, modelId } = pickProvider(body.model);
  if (!provider) {
    res.status(404).json({
      error: {
        message: `No enabled provider can serve model "${body.model}". Add a provider first via POST /api/providers.`,
      },
    });
    return;
  }

  const start = Date.now();
  try {
    const response = await provider.chat({
      model: modelId,
      messages: body.messages,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens,
      stop: body.stop,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      user: body.user,
    });
    logRequest(provider.id, body.model, 200, Date.now() - start);
    res.json(response);
  } catch (e) {
    const msg = (e as Error).message;
    logRequest(provider.id, body.model, 500, Date.now() - start, msg);
    res.status(502).json({ error: { message: msg, type: 'upstream_error' } });
  }
});

// /v1/models — aggregate from all enabled providers
// For each enabled provider, fetch its /models and prefix with "label:" so callers can disambiguate.
// Cache in DB for 5 minutes to avoid hammering providers on every call.
const MODELS_CACHE_MS = 5 * 60 * 1000;

interface ModelRow {
  model_id: string;
  fetched_at: number;
}

async function loadModelsForProvider(provider: Provider, _baseUrl: string, _modelsPath: string, db: ReturnType<typeof getDb>): Promise<ModelInfo[]> {
  const cached = db
    .prepare('SELECT model_id, fetched_at FROM provider_models WHERE provider_id = ?')
    .all(provider.id) as ModelRow[];
  const fresh = cached.length > 0 && Date.now() - cached[0].fetched_at < MODELS_CACHE_MS;
  if (fresh) {
    return cached.map((r) => ({
      id: `${provider.label}:${r.model_id}`,
      object: 'model',
      owned_by: provider.label,
    }));
  }
  // Fetch fresh
  try {
    const models = await provider.listModels();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(provider.id);
      const ins = db.prepare('INSERT INTO provider_models (provider_id, model_id, fetched_at) VALUES (?, ?, ?)');
      const now = Date.now();
      for (const m of models) ins.run(provider.id, m.id, now);
    });
    tx();
    return models.map((m: ModelInfo) => ({
      id: `${provider.label}:${m.id}`,
      object: 'model',
      owned_by: provider.label,
    }));
  } catch (e) {
    // Fall back to stale cache
    if (cached.length > 0) {
      return cached.map((r) => ({
        id: `${provider.label}:${r.model_id}`,
        object: 'model',
        owned_by: provider.label,
      }));
    }
    throw e;
  }
}

// Helper: pick provider for a given model string
// Format: "label:model_id" or just "model_id" (uses first enabled provider that has it)
function pickProvider(modelStr: string): { provider: Provider | null; modelId: string } {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM providers WHERE enabled = 1 ORDER BY is_builtin DESC, label ASC')
    .all() as { id: string; label: string; base_url: string; api_path: string; models_path: string }[];

  // Try "label:model_id" match
  if (modelStr.includes(':')) {
    const [label, ...rest] = modelStr.split(':');
    const modelId = rest.join(':');
    const row = rows.find((r) => r.label === label);
    if (row) {
      const apiKey = getProviderKey(row.id);
      if (apiKey) {
        return {
          provider: new OpenAICompatibleProvider({
            id: row.id,
            label: row.label,
            baseUrl: row.base_url,
            apiPath: row.api_path,
            modelsPath: row.models_path,
            apiKey,
          }),
          modelId,
        };
      }
    }
    return { provider: null, modelId };
  }

  // No prefix — try each provider in order, asking if model_id is in its catalog
  for (const row of rows) {
    const apiKey = getProviderKey(row.id);
    if (!apiKey) continue;
    const has = db
      .prepare('SELECT 1 FROM provider_models WHERE provider_id = ? AND model_id = ?')
      .get(row.id, modelStr);
    if (has) {
      return {
        provider: new OpenAICompatibleProvider({
          id: row.id,
          label: row.label,
          baseUrl: row.base_url,
          apiPath: row.api_path,
          modelsPath: row.models_path,
          apiKey,
        }),
        modelId: modelStr,
      };
    }
  }
  return { provider: null, modelId: modelStr };
}

function logRequest(providerId: string | null, model: string, status: number, durationMs: number, error?: string) {
  try {
    getDb()
      .prepare(
        'INSERT INTO request_log (provider_id, model, status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(providerId, model, status, durationMs, error ?? null, Date.now());
  } catch {
    // best-effort logging
  }
}

// Re-export for the v1/models route override
export { loadModelsForProvider };
