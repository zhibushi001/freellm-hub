/**
 * 图像生成 API - OpenAI 兼容
 * POST /v1/images/generations
 * POST /v1/images/edits
 */
import type { FastifyInstance } from 'fastify';
import { httpSend } from '../../adapters/client.js';
import { getDecryptedApiKey, recordKeyUsage } from '../../db/repos/keys.js';
import { resolveModel } from '../../routing/resolver.js';
import { selectCandidatePool } from '../../routing/selector.js';
import { listKeys } from '../../db/repos/keys.js';
import { transitionKeyStatus } from '../../services/keyHealth.js';
import { recordUsage } from '../../services/usageService.js';
import { inflightStart, inflightEnd } from '../../services/inflightTracker.js';
import { buildUpstreamRequest, buildUpstreamUrl } from '../../adapters/openai.js';

export async function registerImageRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/images/generations
  app.post('/v1/images/generations', async (req, reply) => {
    const body = req.body as any;
    if (!body?.model) {
      return reply.code(400).send({ error: { message: 'model 字段必填', type: 'invalid_request_error' } });
    }
    if (!body?.prompt) {
      return reply.code(400).send({ error: { message: 'prompt 字段必填', type: 'invalid_request_error' } });
    }
    const hubKeyId = req.hubKey?.id ?? null;

    const allKeys = listKeys();
    const resolved = resolveModel(body.model, allKeys);
    if ('error' in resolved) {
      return reply.code(404).send({ error: { message: resolved.error, type: 'not_found' } });
    }

    const pool = selectCandidatePool(resolved.upstreamModel);
    const target = pool.available.find(p => p.key.id === resolved.key.id) ?? pool.available[0];
    if (!target) {
      return reply.code(503).send({ error: { message: '没有可用的 Key', type: 'gateway_error' } });
    }
    const key = target.key;

    const apiKey = getDecryptedApiKey(key.id);
    const url = buildUpstreamUrl(key);
    const upstreamReq = buildUpstreamRequest(body, resolved.upstreamModel);
    const start = Date.now();
    inflightStart(key.id, resolved.upstreamModel);

    try {
      const res = await httpSend(url, apiKey, {
        method: 'POST',
        body: JSON.stringify(upstreamReq),
        timeoutMs: 120000, // 图像生成可能需要更长时间
      }, key.id);
      const latencyMs = Date.now() - start;
      transitionKeyStatus(key.id, { status: res.status, body: null, upstreamModel: resolved.upstreamModel });
      recordKeyUsage(key.id, res.status >= 200 && res.status < 300, latencyMs);
      recordUsage({
        hub_key_id: hubKeyId,
        key_id: key.id,
        provider_name: key.provider_name,
        request_model: body.model,
        routed_model: resolved.upstreamModel,
        latency_ms: latencyMs,
        status: res.status >= 200 && res.status < 300 ? 'success' : 'error',
        error_code: res.status >= 400 ? res.status : null,
        stream: 0,
      });

      reply.header('X-Hub-Key', key.label ?? `key#${key.id}`);
      reply.header('X-Hub-Key-Id', String(key.id));
      reply.header('X-Hub-Model', resolved.upstreamModel);
      reply.header('X-Hub-Latency-Ms', String(latencyMs));
      
      return reply.code(res.status).send(res.body);
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      inflightEnd(key.id, resolved.upstreamModel, latencyMs);
      transitionKeyStatus(key.id, { status: 0, error: e.message, upstreamModel: resolved.upstreamModel });
      recordKeyUsage(key.id, false, latencyMs);
      return reply.code(502).send({ error: { message: e.message, type: 'gateway_error' } });
    } finally {
      inflightEnd(key.id, resolved.upstreamModel, Date.now() - start);
    }
  });

  // POST /v1/images/edits
  app.post('/v1/images/edits', async (req, reply) => {
    const body = req.body as any;
    if (!body?.model) {
      return reply.code(400).send({ error: { message: 'model 字段必填', type: 'invalid_request_error' } });
    }
    if (!body?.image) {
      return reply.code(400).send({ error: { message: 'image 字段必填', type: 'invalid_request_error' } });
    }
    const hubKeyId = req.hubKey?.id ?? null;

    const allKeys = listKeys();
    const resolved = resolveModel(body.model, allKeys);
    if ('error' in resolved) {
      return reply.code(404).send({ error: { message: resolved.error, type: 'not_found' } });
    }

    const pool = selectCandidatePool(resolved.upstreamModel);
    const target = pool.available.find(p => p.key.id === resolved.key.id) ?? pool.available[0];
    if (!target) {
      return reply.code(503).send({ error: { message: '没有可用的 Key', type: 'gateway_error' } });
    }
    const key = target.key;

    const apiKey = getDecryptedApiKey(key.id);
    const url = buildUpstreamUrl(key);
    const upstreamReq = buildUpstreamRequest(body, resolved.upstreamModel);
    const start = Date.now();
    inflightStart(key.id, resolved.upstreamModel);

    try {
      // 处理 image 字段（可能是 base64 或文件）
      const formData = new FormData();
      formData.append('model', resolved.upstreamModel);
      formData.append('image', body.image);
      if (body.prompt) formData.append('prompt', body.prompt);
      if (body.mask) formData.append('mask', body.mask);
      if (body.size) formData.append('size', body.size);
      if (body.n) formData.append('n', String(body.n));
      if (body.response_format) formData.append('response_format', body.response_format);

      const res = await httpSend(url, apiKey, {
        method: 'POST',
        body: formData as any,
        timeoutMs: 120000,
      }, key.id);
      const latencyMs = Date.now() - start;
      transitionKeyStatus(key.id, { status: res.status, body: null, upstreamModel: resolved.upstreamModel });
      recordKeyUsage(key.id, res.status >= 200 && res.status < 300, latencyMs);
      recordUsage({
        hub_key_id: hubKeyId,
        key_id: key.id,
        provider_name: key.provider_name,
        request_model: body.model,
        routed_model: resolved.upstreamModel,
        latency_ms: latencyMs,
        status: res.status >= 200 && res.status < 300 ? 'success' : 'error',
        error_code: res.status >= 400 ? res.status : null,
        stream: 0,
      });

      reply.header('X-Hub-Key', key.label ?? `key#${key.id}`);
      reply.header('X-Hub-Key-Id', String(key.id));
      reply.header('X-Hub-Model', resolved.upstreamModel);
      reply.header('X-Hub-Latency-Ms', String(latencyMs));
      
      return reply.code(res.status).send(res.body);
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      inflightEnd(key.id, resolved.upstreamModel, latencyMs);
      transitionKeyStatus(key.id, { status: 0, error: e.message, upstreamModel: resolved.upstreamModel });
      recordKeyUsage(key.id, false, latencyMs);
      return reply.code(502).send({ error: { message: e.message, type: 'gateway_error' } });
    } finally {
      inflightEnd(key.id, resolved.upstreamModel, Date.now() - start);
    }
  });
}
