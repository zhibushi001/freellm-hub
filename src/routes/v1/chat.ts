import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { getProviderKey } from '../api/providers.js';
import { OpenAICompatibleProvider } from '../../providers/openai-compatible.js';
import type { ChatRequest, ModelInfo, Provider } from '../../providers/base.js';

export const chatRouter = Router();

// POST /v1/chat/completions — OpenAI-compatible
// Auth: requires Authorization: Bearer fh_... (applied at server level)
chatRouter.post('/chat/completions', async (req, res) => {
  const body = req.body as Partial<ChatRequest> | undefined;
  if (!body || !body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({
      error: { message: 'Required: model, non-empty messages[]' },
    });
    return;
  }

  const wantStream = !!body.stream;

  // Find all candidate providers, in priority order
  const candidates = pickProviders(body.model);
  if (candidates.length === 0) {
    res.status(404).json({
      error: {
        message: `No enabled provider can serve model "${body.model}". Add a provider via POST /api/providers.`,
      },
    });
    return;
  }

  // Try each candidate in order; on failure, move to next
  let lastError: Error | null = null;
  for (const { provider, modelId } of candidates) {
    if (wantStream) {
      // Stream mode: set headers once, then forward
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      res.flushHeaders?.();
      const start = Date.now();
      try {
        await provider.chatStream(
          { ...body, model: modelId, stream: true } as ChatRequest,
          (raw) => {
            res.write(raw);
          },
          // Allow client to abort — close handler
        );
        logRequest(provider.id, body.model ?? '', 200, Date.now() - start);
        return; // success, done
      } catch (e) {
        lastError = e as Error;
        logRequest(provider.id, body.model ?? '', 500, Date.now() - start, lastError.message);
        // Send error as SSE event and bail
        try {
          res.write(
            `data: ${JSON.stringify({ error: { message: lastError.message, type: 'upstream_error' } })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
        } catch {
          // ignore
        }
        return; // stream already started, can't try next provider
      }
    } else {
      // Non-streaming
      const start = Date.now();
      try {
        const response = await provider.chat({
          ...body,
          model: modelId,
          stream: false,
        } as ChatRequest);
        logRequest(provider.id, body.model ?? '', 200, Date.now() - start);
        res.json(response);
        return;
      } catch (e) {
        lastError = e as Error;
        logRequest(provider.id, body.model ?? '', 500, Date.now() - start, lastError.message);
        // Try next candidate
      }
    }
  }
  // All candidates failed
  res.status(502).json({
    error: {
      message: `All ${candidates.length} candidate(s) failed. Last error: ${lastError?.message ?? 'unknown'}`,
      type: 'upstream_error',
    },
  });
});

// /v1/models — aggregate from all enabled providers
const MODELS_CACHE_MS = 5 * 60 * 1000;

interface ModelRow {
  model_id: string;
  fetched_at: number;
}

async function loadModelsForProvider(
  provider: Provider,
  _baseUrl: string,
  _modelsPath: string,
  db: ReturnType<typeof getDb>,
): Promise<ModelInfo[]> {
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
  try {
    const models = await provider.listModels();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(provider.id);
      const ins = db.prepare(
        'INSERT INTO provider_models (provider_id, model_id, fetched_at) VALUES (?, ?, ?)',
      );
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

// Find all candidate providers for a model, ordered by priority
function pickProviders(modelStr: string): { provider: Provider; modelId: string }[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM providers WHERE enabled = 1 ORDER BY is_builtin DESC, label ASC')
    .all() as {
    id: string;
    label: string;
    base_url: string;
    api_path: string;
    models_path: string;
  }[];

  const make = (row: (typeof rows)[number], modelId: string): { provider: Provider; modelId: string } | null => {
    const apiKey = getProviderKey(row.id);
    if (!apiKey) return null;
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
  };

  // "label:model_id" → match that specific provider
  if (modelStr.includes(':')) {
    const [label, ...rest] = modelStr.split(':');
    const modelId = rest.join(':');
    const row = rows.find((r) => r.label === label);
    if (!row) return [];
    const p = make(row, modelId);
    return p ? [p] : [];
  }

  // Otherwise try each provider that has this model in its catalog
  const candidates: { provider: Provider; modelId: string }[] = [];
  for (const row of rows) {
    const has = db
      .prepare('SELECT 1 FROM provider_models WHERE provider_id = ? AND model_id = ?')
      .get(row.id, modelStr);
    if (has) {
      const p = make(row, modelStr);
      if (p) candidates.push(p);
    }
  }
  return candidates;
}

function logRequest(
  providerId: string | null,
  model: string,
  status: number,
  durationMs: number,
  error?: string,
) {
  try {
    getDb()
      .prepare(
        'INSERT INTO request_log (provider_id, model, status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(providerId, model, status, durationMs, error ?? null, Date.now());
  } catch {
    // best-effort
  }
}

export { loadModelsForProvider };
