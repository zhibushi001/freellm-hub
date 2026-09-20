/**
 * Admin 渠道管理路由
 */
import type { FastifyInstance } from 'fastify';
import { listChannels, createChannel, updateChannel, deleteChannel } from '../../db/repos/channels.js';
import {
  createProvider, getProviderByName, getProvider, deleteProvider,
} from '../../db/repos/providers.js';
import {
  listKeysByChannel, createKey, getKey, updateKey, deleteKey, getDecryptedApiKey,
} from '../../db/repos/keys.js';
import { listModelRoutes, updateModelRoute } from '../../db/repos/modelRoutes.js';
import { getDb } from '../../db/connection.js';
import { probeKey } from '../../services/probeService.js';
import { testChannelModels, getChannelModelSummary } from '../../services/modelTestService.js';
import { deleteFailedModelsForChannel, clearTestResultsForKey } from '../../db/repos/discoveredModels.js';
import { toStrBody } from '../../util/body.js';
import { validateBody, CreateChannelSchema, UpdateChannelSchema, CreateKeySchema, UpdateKeySchema, FetchModelsSchema } from './validation.js';

export async function registerChannelAdminRoutes(app: FastifyInstance): Promise<void> {
  // 认证检查 helper
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // POST /api/admin/channels  (一次性: provider + channel + 第一个 key, 简化添加流)
  app.post('/api/admin/channels', { preHandler: requireAdmin }, async (req, reply) => {
    // 验证输入
    const validationResult = validateBody(req, CreateChannelSchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }
    
    const body = toStrBody(req.body);
    const providerIdRaw = (body.provider_id ?? '').trim();
    const name = (body.name ?? '').trim();
    
    // 如果提供了 provider_id，先从 provider 获取默认值
    let provider = providerIdRaw ? getProvider(parseInt(providerIdRaw, 10)) : null;
    const baseUrl = (body.base_url ?? (provider ? provider.base_url : '')).trim();
    const apiPath = (body.api_path ?? (provider ? provider.api_path : '/v1/chat/completions')).trim();
    const modelsPath = (body.models_path ?? (provider ? provider.models_path : '/v1/models')).trim();
    const protocol = (body.protocol ?? (provider ? provider.protocol : 'openai')).trim();
    const label = (body.label ?? '').trim();
    const providerLabel = (body.provider_label ?? '').trim() || null;
    const keyLabel = (body.key_label ?? '').trim() || null;
    // Key 输入 (支持单个或多个, 每行一个)
    const keysInput = (body.api_keys_batch ?? body.api_key ?? '').trim();

    if (!name || !baseUrl || !keysInput) {
      return reply.code(400).send({ ok: false, error: 'name, base_url, api_keys_batch (或 api_key) 必填' });
    }

    try {
      // 1. provider: 如果用户传了 provider_id, 先复用预置
      //    但如果 base_url 与预置不同 (= user override), 创建一个新的 provider
      if (!provider) {
        provider = providerIdRaw ? getProvider(parseInt(providerIdRaw, 10)) : null;
      }
      if (provider) {
        // 检查 base_url / protocol / api_path / models_path 是否有差异
        const sameBase = provider.base_url === baseUrl;
        const sameProto = provider.protocol === protocol;
        const sameApi = (provider.api_path ?? '/v1/chat/completions') === apiPath;
        const sameModels = (provider.models_path ?? '/v1/models') === modelsPath;
        if (!sameBase || !sameProto || !sameApi || !sameModels) {
          // 用户 override, 创一个独立的 provider (避免污染预置)
          const overrideName = name && !getProviderByName(name) ? name : `${provider.name}-${Date.now()}`;
          provider = createProvider({
            name: overrideName,
            display_name: providerLabel ?? provider.display_name ?? undefined,
            base_url: baseUrl,
            api_path: apiPath,
            models_path: modelsPath,
            protocol,
          });
        }
      } else {
        // 没用预置, 按 name 复用或创建
        provider = getProviderByName(name) ?? null;
        if (!provider) {
          provider = createProvider({
            name,
            display_name: providerLabel ?? undefined,
            base_url: baseUrl,
            api_path: apiPath,
            models_path: modelsPath,
            protocol,
          });
        }
      }

      // 提取 channel 通用字段
      const channelExtras = {
        models: (body.models ?? '').trim() || null,
        model_mapping: (body.model_mapping ?? '').trim() || null,
        status_code_mapping: (body.status_code_mapping ?? '').trim() || null,
        param_override: (body.param_override ?? '').trim() || null,
        header_override: (body.header_override ?? '').trim() || null,
        multi_key_mode: (body.multi_key_mode ?? 'random').trim(),
        test_model: (body.test_model ?? '').trim() || null,
        auto_ban: body.auto_ban === '0' ? 0 : 1,
        tag: (body.tag ?? '').trim() || null,
        capabilities: (body.capabilities ?? '').trim() || null,
      };

      const created: any[] = [];

      // Batch mode: 每行一个 key, 创独立 channel (newapi 风格, 便于分组管理)
      const lines = keysInput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const key = lines[i];
        const ch = createChannel({
          provider_id: provider.id,
          label: lines.length > 1 ? `${label || name}-${i + 1}` : (label || null),
          ...channelExtras,
        });
        const k = createKey({
          channel_id: ch.id,
          label: lines.length > 1 ? `${keyLabel || 'key'}-${i + 1}` : (keyLabel || null),
          apiKey: key,
        });
        created.push({ channel_id: ch.id, key_id: k.id, key_hint: key.slice(-4) });
      }
      return reply.send({
        ok: true,
        provider_id: provider.id,
        batch: true,
        created_count: created.length,
        created,
      });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // GET /api/admin/channels/:id/keys  (React SPA 展开渠道用, 不泄露明文)
  app.get('/api/admin/channels/:id/keys', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const keys = listKeysByChannel(channelId);
    // 只返回安全字段
    return reply.send({
      ok: true,
      keys: keys.map((k) => {
        let allowedParsed: string[] | null = null;
        if (k.allowed_models) {
          try {
            const p = JSON.parse(k.allowed_models);
            if (Array.isArray(p)) allowedParsed = p.filter((m: any) => typeof m === 'string');
          } catch { /* intentional empty */ }
        }
        return {
          id: k.id,
          label: k.label,
          enabled: k.enabled,
          status: k.status,
          api_key_hint: k.api_key_hint,
          success_count: k.success_count,
          failure_count: k.failure_count,
          avg_latency_ms: k.avg_latency_ms,
          created_at: k.created_at,
          allowed_models_parsed: allowedParsed,
        };
      }),
    });
  });

  // POST /api/admin/channels/:id/keys  (在已有 channel 加 key)
  app.post('/api/admin/channels/:id/keys', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    
    // 验证输入
    const validationResult = validateBody(req, CreateKeySchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }
    
    const body = req.body as any;
    const apiKey = (body.api_key ?? '').trim();
    const keyLabel = (body.key_label ?? '').trim() || null;
    // models 字段: 数组/null/undefined. null/undefined = 不限制
    let allowedModels: string[] | null = null;
    if (body.models !== undefined && body.models !== null) {
      if (Array.isArray(body.models)) {
        const filtered = body.models.filter((m: any) => typeof m === 'string' && m.length > 0);
        allowedModels = filtered.length > 0 ? filtered : null;
      } else if (typeof body.models === 'string') {
        // 兼容 JSON 字符串
        try {
          const parsed = JSON.parse(body.models);
          if (Array.isArray(parsed)) allowedModels = parsed.length > 0 ? parsed : null;
        } catch { allowedModels = null; }
      }
    }
    if (!apiKey) {
      return reply.code(400).send({ ok: false, error: 'api_key 必填' });
    }
    const channel = listChannels().find(c => c.id === channelId);
    if (!channel) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    try {
      const key = createKey({ channel_id: channelId, label: keyLabel, apiKey, allowed_models: allowedModels });
      return reply.send({ ok: true, key_id: key.id, allowed_models: allowedModels });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/admin/channels/:id  (删除 channel + 关联 keys + 关联 model_routes + usage_logs)
  app.delete('/api/admin/channels/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const channel = listChannels().find(c => c.id === channelId);
    if (!channel) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    try {
      // 0) 先清掉该 channel 关联 keys 的 usage_logs (避免 FK NO ACTION 阻塞)
      const keys = listKeysByChannel(channelId);
      const keyIds = keys.map(k => k.id);
      if (keyIds.length > 0) {
        const placeholders = keyIds.map(() => '?').join(',');
        getDb().prepare(`DELETE FROM usage_logs WHERE key_id IN (${placeholders})`).run(...keyIds);
      }
      // 1) 删除所有 keys (cascade 到 cooldown_hits/cooldowns/discovered_models/model_candidates)
      for (const k of keys) {
        deleteKey(k.id);
      }
      // 2) 清掉 model_routes 里引用此 channel 的
      try {
        const allRoutes = listModelRoutes();
        for (const r of allRoutes) {
          try {
            const ids = JSON.parse(r.channel_ids);
            if (Array.isArray(ids) && ids.includes(channelId)) {
              const newIds = ids.filter(x => x !== channelId);
              updateModelRoute(r.id, { channel_ids: newIds });
            }
          } catch { /* intentional empty */ }
        }
      } catch { /* intentional empty */ }
      // 3) 删 channel 本身
      deleteChannel(channelId);
      return reply.send({ ok: true, deleted_keys: keys.length });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: '删除失败: ' + (e.message || String(e)) });
    }
  });

  // PATCH /api/admin/channels/:id  (更新 channel 字段)
  app.patch('/api/admin/channels/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    
    // 验证输入
    const validationResult = validateBody(req, UpdateChannelSchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }
    
    const body = req.body as any;
    const patch: any = {};
    if (body.excluded_models !== undefined) {
      const trimmed = String(body.excluded_models).trim();
      patch.excluded_models = trimmed === '' ? null : trimmed;
    }
    if (body.models !== undefined) {
      const trimmed = String(body.models).trim();
      patch.models = trimmed === '' ? null : trimmed;
    }
    if (body.label !== undefined) {
      patch.label = String(body.label).trim() || null;
    }
    if (body.priority !== undefined) {
      patch.priority = parseInt(String(body.priority), 10) || 0;
    }
    if (body.weight !== undefined) {
      patch.weight = parseInt(String(body.weight), 10) || 1;
    }
    if (body.test_model !== undefined) {
      patch.test_model = String(body.test_model).trim() || null;
    }
    if (body.multi_key_mode !== undefined) {
      patch.multi_key_mode = String(body.multi_key_mode);
    }
    if (body.enabled !== undefined) {
      patch.enabled = body.enabled ? 1 : 0;
    }
    if (body.capabilities !== undefined) {
      const trimmed = String(body.capabilities).trim();
      patch.capabilities = trimmed === '' ? null : trimmed;
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ ok: false, error: '没可更新字段' });
    }
    const updated = updateChannel(channelId, patch);
    return reply.send({ ok: true, channel: updated });
  });

  // GET /api/admin/channels  (JSON 列表, 给前端编辑 modal 用)
  app.get('/api/admin/channels', { preHandler: requireAdmin }, async (req, reply) => {
    return reply.send({ ok: true, channels: listChannels() });
  });

  // POST /api/admin/fetch-models  (前端创建渠道时预取模型, 不需要 channel_id)
  app.post('/api/admin/fetch-models', { preHandler: requireAdmin }, async (req, reply) => {
    // 验证输入
    const validationResult = validateBody(req, FetchModelsSchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }
    
    const body = req.body as { base_url?: string; models_path?: string; api_key?: string };
    const baseUrl = (body.base_url ?? '').trim();
    const modelsPath = (body.models_path ?? '/models').trim();
    const apiKey = (body.api_key ?? '').trim();
    
    if (!baseUrl || !apiKey) {
      return reply.code(400).send({ ok: false, error: 'base_url 和 api_key 必填' });
    }

    const url = baseUrl.replace(/\/$/, '') + modelsPath;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({})) as any;
      
      if (res.status < 200 || res.status >= 300) {
        return reply.send({ ok: false, error: `HTTP ${res.status}`, data });
      }

      let models: string[] = [];
      if (Array.isArray(data.data)) {
        models = data.data.map((m: any) => m.id).filter((x: any) => typeof x === 'string');
      } else if (Array.isArray(data)) {
        models = data.map((m: any) => m.id ?? m.name ?? m).filter((x: any) => typeof x === 'string');
      }

      return reply.send({ ok: true, models });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // POST /api/admin/channels/:id/fetch-models  (从所有 enabled key 拉取模型, 返回 union + per-key)
  app.post('/api/admin/channels/:id/fetch-models', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    const keys = listKeysByChannel(channelId).filter(k => k.enabled);
    if (keys.length === 0) {
      return reply.code(400).send({ ok: false, error: '该渠道下没有启用的 key' });
    }
    const perKey: any[] = [];
    const union = new Set<string>();
    for (const k of keys) {
      try {
        const out = await probeKey(k.id);
        perKey.push({ keyId: k.id, label: k.label, ok: out.ok, models: out.models, error: out.error, latencyMs: out.latencyMs });
        for (const m of out.models) union.add(m);
      } catch (e: any) {
        perKey.push({ keyId: k.id, label: k.label, ok: false, models: [], error: e.message });
      }
    }
    return reply.send({
      ok: true,
      models: Array.from(union).sort(),
      perKey,
    });
  });

  // POST /api/admin/channels/:id/probe  (能力探测 — reasoning / tool_calls / vision)
  app.post('/api/admin/channels/:id/probe', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    const keys = listKeysByChannel(channelId).filter(k => k.enabled);
    if (keys.length === 0) {
      return reply.code(400).send({ ok: false, error: '该渠道下没有启用的 key' });
    }
    const k = keys[0];
    const apiKey = getDecryptedApiKey(k.id);
    const baseUrl = `${k.base_url.replace(/\/$/, '')}${k.api_path}`;
    const testModel = ch.test_model || ch.models?.split(',')[0]?.trim() || 'gpt-4o';
    const results: any = { reasoning: null, tool_calls: null, vision: null, latencyMs: 0, error: null };

    try {
      const start = Date.now();
      // 1. Reasoning probe: 问一个需要推理的问题
      const reasoningRes = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: '1+1=?' }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const reasoningData = await reasoningRes.json().catch(() => ({}));
      results.reasoning = reasoningRes.status >= 200 && reasoningRes.status < 300;
      results.latencyMs = Date.now() - start;

      if (reasoningRes.status >= 200 && reasoningRes.status < 300) {
        // 2. Tool calls probe: 发送带 tool 定义请求
        const toolRes = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: testModel,
            messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
            tools: [{
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get current weather',
                parameters: {
                  type: 'object',
                  properties: { city: { type: 'string' } },
                  required: ['city'],
                },
              },
            }],
            max_tokens: 50,
          }),
          signal: AbortSignal.timeout(10000),
        });
        results.tool_calls = toolRes.status >= 200 && toolRes.status < 300;

        // 3. Vision probe: 发送带图片的请求
        const visionRes = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: testModel,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this image?' },
                { type: 'image_url', image_url: { url: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a6348?w=100' } },
              ],
            }],
            max_tokens: 50,
          }),
          signal: AbortSignal.timeout(10000),
        });
        results.vision = visionRes.status >= 200 && visionRes.status < 300;
      } else {
        results.error = `Reasoning probe failed: HTTP ${reasoningRes.status}`;
      }

      updateKey(k.id, { status: 'healthy' });
      return reply.send({ ok: true, ...results });
    } catch (e: any) {
      updateKey(k.id, { status: 'failed', status_reason: e.message });
      results.error = e.message;
      return reply.send({ ok: false, ...results });
    }
  });

  // DELETE /api/admin/providers/:id  (只能删未被 channel 引用的 provider)
  app.delete('/api/admin/providers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const p = getProvider(id);
    if (!p) return reply.code(404).send({ ok: false, error: 'Provider not found' });
    // 引用检查
    const referencingChannels = listChannels().filter(c => c.provider_id === id);
    if (referencingChannels.length > 0) {
      return reply.code(409).send({
        ok: false,
        error: `还有 ${referencingChannels.length} 个 channel 引用此 provider, 请先删 channel`,
      });
    }
    deleteProvider(id);
    return reply.send({ ok: true });
  });

  // POST /api/admin/keys/:id/test  (单 Key 测活)
  app.post('/api/admin/keys/:id/test', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const key = getKey(id);
    if (!key) return reply.code(404).send({ ok: false, error: 'Key not found' });
    try {
      const apiKey = getDecryptedApiKey(id);
      const modelsPath = key.models_path || '/models';
      const url = `${key.base_url.replace(/\/$/, '')}${modelsPath}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      const status = res.status;
      const ok = status >= 200 && status < 300;
      updateKey(id, {
        status: ok ? 'healthy' : 'failed',
        status_reason: ok ? null : `HTTP ${status}`,
      });
      return reply.send({ ok, status, message: ok ? '连接成功' : `HTTP ${status}` });
    } catch (e: any) {
      updateKey(id, { status: 'failed', status_reason: e.message });
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // POST /api/admin/channels/:id/models-test (批量测试所有已发现模型的可用性)
  app.post('/api/admin/channels/:id/models-test', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    
    try {
      const result = await testChannelModels(channelId);
      return reply.send({ ok: true, ...result });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // GET /api/admin/channels/:id/models-summary (获取模型测试状态摘要)
  app.get('/api/admin/channels/:id/models-summary', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    
    const summary = getChannelModelSummary(channelId);
    return reply.send({ 
      ok: true, 
      total: summary.total, 
      okCount: summary.ok, 
      errorCount: summary.error, 
      untested: summary.untested 
    });
  });

  // DELETE /api/admin/channels/:id/models-failed (删除所有测试失败的模型)
  app.delete('/api/admin/channels/:id/models-failed', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    
    const deleted = deleteFailedModelsForChannel(channelId);
    return reply.send({ ok: true, deleted_count: deleted });
  });

  // PATCH /api/admin/keys/:id (toggle enabled, edit label, edit allowed_models)
  app.patch('/api/admin/keys/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    
    // 验证输入
    const validationResult = validateBody(req, UpdateKeySchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }
    
    const body = req.body as any;
    const patch: any = {};
    if (body.label !== undefined) patch.label = body.label;
    if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
    if (body.allowed_models !== undefined) {
      // null = 不限制, [] = 不限制, [...] = 限制
      if (body.allowed_models === null) patch.allowed_models = null;
      else if (Array.isArray(body.allowed_models)) {
        patch.allowed_models = body.allowed_models.filter((m: any) => typeof m === 'string' && m.length > 0);
      }
    }
    const k = updateKey(id, patch);
    if (!k) return reply.code(404).send({ ok: false, error: 'not found' });
    return reply.send({ ok: true, key: k });
  });

  // GET /api/admin/keys/:id/plain (获取明文 Key，需确认)
  app.get('/api/admin/keys/:id/plain', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const k = getKey(id);
    if (!k) return reply.code(404).send({ ok: false, error: 'not found' });
    const plainKey = getDecryptedApiKey(id);
    return reply.send({ ok: true, api_key: plainKey });
  });

  // GET /api/admin/keys/:id (含 allowed_models, 含解密明文 plain_key)
  app.get('/api/admin/keys/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const k = getKey(id);
    if (!k) return reply.code(404).send({ ok: false, error: 'not found' });
    let allowed: string[] | null = null;
    if (k.allowed_models) {
      try { allowed = JSON.parse(k.allowed_models); } catch { /* intentional empty */ }
    }
    let plainKey: string | null = null;
    try { plainKey = getDecryptedApiKey(id); } catch { /* intentional empty */ }
    return reply.send({ ok: true, key: { ...k, allowed_models_parsed: allowed, plain_key: plainKey } });
  });

  // GET /api/admin/channels/:id/available-models (此 channel 可服务的模型: discovered + 渠道定义)
  app.get('/api/admin/channels/:id/available-models', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === id);
    if (!ch) return reply.code(404).send({ ok: false, error: 'channel not found' });
    // 合并: 渠道的 excluded_models / discovered_models / 上游 /v1/models (Phase 1 暂用本地)
    const keys = listKeysByChannel(id);
    const set = new Set<string>();
    for (const k of keys) {
      try {
        const models = getDb().prepare('SELECT upstream_id FROM discovered_models WHERE key_id = ?').all(k.id) as { upstream_id: string }[];
        for (const m of models) set.add(m.upstream_id);
      } catch { /* intentional empty */ }
    }
    // 排除的模型不应该列在可选里
    let excluded: string[] = [];
    try { excluded = ch.excluded_models ? JSON.parse(ch.excluded_models) : []; } catch { /* intentional empty */ }
    const models = Array.from(set).filter(m => !excluded.includes(m)).sort();
    return reply.send({ ok: true, models });
  });

  app.delete('/api/admin/keys/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    try {
      // 清掉 usage_logs (避免 FK NO ACTION 阻塞)
      getDb().prepare('DELETE FROM usage_logs WHERE key_id = ?').run(id);
      deleteKey(id);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: '删除失败: ' + (e.message || String(e)) });
    }
  });

  // POST /api/admin/channels/batch-edit  (批量编辑渠道)
  app.post('/api/admin/channels/batch-edit', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const channelIds: number[] = body.channel_ids || [];
    const updates = body.updates || {};
    
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return reply.code(400).send({ ok: false, error: 'channel_ids 不能为空' });
    }
    
    const results: any[] = [];
    for (const id of channelIds) {
      try {
        const ch = listChannels().find(c => c.id === id);
        if (!ch) {
          results.push({ id, ok: false, error: 'Channel not found' });
          continue;
        }
        const updated = updateChannel(id, updates);
        results.push({ id, ok: true, channel: updated });
      } catch (e: any) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, results, updated_count: results.filter(r => r.ok).length });
  });

  // POST /api/admin/channels/batch-delete  (批量删除渠道)
  app.post('/api/admin/channels/batch-delete', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const channelIds: number[] = body.channel_ids || [];
    
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return reply.code(400).send({ ok: false, error: 'channel_ids 不能为空' });
    }
    
    const results: any[] = [];
    for (const id of channelIds) {
      try {
        const channel = listChannels().find(c => c.id === id);
        if (!channel) {
          results.push({ id, ok: false, error: 'Channel not found' });
          continue;
        }
        // 清理关联数据
        const keys = listKeysByChannel(id);
        const keyIds = keys.map(k => k.id);
        if (keyIds.length > 0) {
          const placeholders = keyIds.map(() => '?').join(',');
          getDb().prepare(`DELETE FROM usage_logs WHERE key_id IN (${placeholders})`).run(...keyIds);
        }
        for (const k of keys) {
          deleteKey(k.id);
        }
        // 清掉 model_routes 里引用此 channel 的
        try {
          const allRoutes = listModelRoutes();
          for (const r of allRoutes) {
            try {
              const ids = JSON.parse(r.channel_ids);
              if (Array.isArray(ids) && ids.includes(id)) {
                const newIds = ids.filter(x => x !== id);
                updateModelRoute(r.id, { channel_ids: newIds });
              }
            } catch { /* intentional empty */ }
          }
        } catch { /* intentional empty */ }
        deleteChannel(id);
        results.push({ id, ok: true, deleted_keys: keys.length });
      } catch (e: any) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, results, deleted_count: results.filter(r => r.ok).length });
  });

  // POST /api/admin/channels/batch-test  (批量测试渠道)
  app.post('/api/admin/channels/batch-test', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const channelIds: number[] = body.channel_ids || [];
    
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return reply.code(400).send({ ok: false, error: 'channel_ids 不能为空' });
    }
    
    const results: any[] = [];
    for (const id of channelIds) {
      try {
        const ch = listChannels().find(c => c.id === id);
        if (!ch) {
          results.push({ id, ok: false, error: 'Channel not found' });
          continue;
        }
        const keys = listKeysByChannel(id).filter(k => k.enabled);
        if (keys.length === 0) {
          results.push({ id, ok: false, error: '该渠道下没有启用的 key' });
          continue;
        }
        const k = keys[0];
        const apiKey = getDecryptedApiKey(k.id);
        const modelsPath = k.models_path || '/models';
        const url = `${k.base_url.replace(/\/$/, '')}${modelsPath}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        const status = res.status;
        const ok = status >= 200 && status < 300;
        updateKey(k.id, {
          status: ok ? 'healthy' : 'failed',
          status_reason: ok ? null : `HTTP ${status}`,
        });
        results.push({ id, ok, status, key_id: k.id });
      } catch (e: any) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({
      ok: true,
      results,
      success_count: results.filter(r => r.ok).length,
      failed_count: results.filter(r => !r.ok).length,
    });
  });

  // POST /api/admin/channels/batch-status  (批量启用/禁用渠道)
  app.post('/api/admin/channels/batch-status', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const channelIds: number[] = body.channel_ids || [];
    const enabled: boolean = body.enabled;
    
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return reply.code(400).send({ ok: false, error: 'channel_ids 不能为空' });
    }
    
    const results: any[] = [];
    for (const id of channelIds) {
      try {
        const ch = listChannels().find(c => c.id === id);
        if (!ch) {
          results.push({ id, ok: false, error: 'Channel not found' });
          continue;
        }
        const updated = updateChannel(id, { enabled: enabled ? 1 : 0 });
        results.push({ id, ok: true, enabled: updated?.enabled });
      } catch (e: any) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, results, count: results.filter(r => r.ok).length });
  });

  // POST /api/admin/channels/:id/copy  (复制渠道)
  app.post('/api/admin/channels/:id/copy', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const ch = listChannels().find(c => c.id === channelId);
    if (!ch) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    
    const body = req.body as any;
    const newLabel = (body.label ?? '').trim() || `${ch.label || 'channel'}-copy-${Date.now()}`;
    
    try {
      // 创建新渠道
      const newChannel = createChannel({
        provider_id: ch.provider_id,
        label: newLabel,
        models: ch.models,
        model_mapping: ch.model_mapping,
        status_code_mapping: ch.status_code_mapping,
        param_override: ch.param_override,
        header_override: ch.header_override,
        multi_key_mode: ch.multi_key_mode,
        test_model: ch.test_model,
        auto_ban: ch.auto_ban,
        tag: ch.tag,
        capabilities: ch.capabilities,
        excluded_models: ch.excluded_models,
        priority: ch.priority,
        weight: ch.weight,
      });
      
      // 新渠道默认禁用
      updateChannel(newChannel.id, { enabled: 0 });
      
      // 复制 keys (不复制明文，需要用户手动添加)
      const oldKeys = listKeysByChannel(channelId);
      const copiedKeys: any[] = [];
      for (const k of oldKeys) {
        copiedKeys.push({
          id: k.id,
          label: k.label,
          enabled: k.enabled,
          api_key_hint: k.api_key_hint,
          note: '需要手动添加 API Key',
        });
      }
      
      return reply.send({
        ok: true,
        channel: newChannel,
        copied_keys: copiedKeys,
        message: '渠道已复制，请手动添加 API Key',
      });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // GET /api/admin/keys/stats - 获取所有 Key 的统计信息 (最后调用 + 30 天统计)
  app.get('/api/admin/keys/stats', { preHandler: requireAdmin }, async (_req, reply) => {
    const db = getDb();
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // 获取所有 keys
    const keys = listKeysByChannel(0); // 0 means all channels
    const keyStats: any[] = [];

    for (const key of keys) {
      // 获取最后一次调用
      const lastCall = db.prepare(`
        SELECT 
          ul.status, 
          ul.error_message,
          ul.latency_ms,
          ul.total_tokens,
          ul.request_model,
          ul.routed_model,
          ul.created_at
        FROM usage_logs ul
        WHERE ul.key_id = ?
        ORDER BY ul.created_at DESC
        LIMIT 1
      `).get(key.id) as any;

      // 获取 30 天统计
      const thirtyDayStats = db.prepare(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as total_successes,
          SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as total_failures,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
          MAX(created_at) as last_request_at
        FROM usage_logs
        WHERE key_id = ? AND created_at >= ?
      `).get(key.id, thirtyDaysAgo) as any;

      keyStats.push({
        key_id: key.id,
        key_label: key.label || null,
        channel_id: key.channel_id,
        status: key.status,
        enabled: key.enabled,
        last_call: lastCall ? {
          status: lastCall.status,
          error_message: lastCall.error_message,
          latency_ms: lastCall.latency_ms,
          total_tokens: lastCall.total_tokens,
          request_model: lastCall.request_model,
          routed_model: lastCall.routed_model,
          created_at: lastCall.created_at,
        } : null,
        thirty_day_stats: {
          total_requests: thirtyDayStats.total_requests || 0,
          total_successes: thirtyDayStats.total_successes || 0,
          total_failures: thirtyDayStats.total_failures || 0,
          total_tokens: thirtyDayStats.total_tokens || 0,
          avg_latency_ms: Math.round(thirtyDayStats.avg_latency_ms) || 0,
          success_rate: thirtyDayStats.total_requests > 0 
            ? (thirtyDayStats.total_successes / thirtyDayStats.total_requests) 
            : 0,
        },
      });
    }

    return reply.send({ ok: true, stats: keyStats });
  });

  // GET /api/admin/channels/:id/keys-stats - 获取指定渠道所有 Key 的统计信息
  app.get('/api/admin/channels/:id/keys-stats', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const db = getDb();
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const keys = listKeysByChannel(channelId);
    const keyStats: any[] = [];

    for (const key of keys) {
      const lastCall = db.prepare(`
        SELECT 
          ul.status, 
          ul.error_message,
          ul.latency_ms,
          ul.total_tokens,
          ul.request_model,
          ul.routed_model,
          ul.created_at
        FROM usage_logs ul
        WHERE ul.key_id = ?
        ORDER BY ul.created_at DESC
        LIMIT 1
      `).get(key.id) as any;

      const thirtyDayStats = db.prepare(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as total_successes,
          SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as total_failures,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(AVG(latency_ms), 0) as avg_latency_ms
        FROM usage_logs
        WHERE key_id = ? AND created_at >= ?
      `).get(key.id, thirtyDaysAgo) as any;

      keyStats.push({
        key_id: key.id,
        key_label: key.label || null,
        status: key.status,
        enabled: key.enabled,
        last_call: lastCall ? {
          status: lastCall.status,
          error_message: lastCall.error_message,
          latency_ms: lastCall.latency_ms,
          total_tokens: lastCall.total_tokens,
          request_model: lastCall.request_model,
          routed_model: lastCall.routed_model,
          created_at: lastCall.created_at,
        } : null,
        thirty_day_stats: {
          total_requests: thirtyDayStats.total_requests || 0,
          total_successes: thirtyDayStats.total_successes || 0,
          total_failures: thirtyDayStats.total_failures || 0,
          total_tokens: thirtyDayStats.total_tokens || 0,
          avg_latency_ms: Math.round(thirtyDayStats.avg_latency_ms) || 0,
          success_rate: thirtyDayStats.total_requests > 0 
            ? (thirtyDayStats.total_successes / thirtyDayStats.total_requests) 
            : 0,
        },
      });
    }

    return reply.send({ ok: true, stats: keyStats });
  });
}
