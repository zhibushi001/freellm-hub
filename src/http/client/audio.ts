/**
 * 音频 API - OpenAI 兼容
 * POST /v1/audio/speech (TTS)
 * POST /v1/audio/transcriptions (STT)
 */
import type { FastifyInstance } from 'fastify';
import { httpSend, httpSendBinary } from '../../adapters/client.js';
import { getDecryptedApiKey, recordKeyUsage } from '../../db/repos/keys.js';
import { resolveModel } from '../../routing/resolver.js';
import { selectCandidatePool } from '../../routing/selector.js';
import { listKeys } from '../../db/repos/keys.js';
import { transitionKeyStatus } from '../../services/keyHealth.js';
import { recordUsage } from '../../services/usageService.js';
import { inflightStart, inflightEnd } from '../../services/inflightTracker.js';
import { buildUpstreamUrl } from '../../adapters/openai.js';

export async function registerAudioRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/audio/speech (TTS)
  app.post('/v1/audio/speech', async (req, reply) => {
    const body = req.body as any;
    if (!body?.model) {
      return reply.code(400).send({ error: { message: 'model 字段必填', type: 'invalid_request_error' } });
    }
    if (!body?.input) {
      return reply.code(400).send({ error: { message: 'input 字段必填', type: 'invalid_request_error' } });
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
    const start = Date.now();
    inflightStart(key.id, resolved.upstreamModel);

    try {
      // TTS 上游返回二进制音频, 必须用 httpSendBinary (httpSend 的 body.text() 会破坏音频字节)
      const res = await httpSendBinary(url, apiKey, {
        method: 'POST',
        body: JSON.stringify({
          model: resolved.upstreamModel,
          input: body.input,
          voice: body.voice || 'alloy',
          response_format: body.response_format || 'mp3',
          speed: body.speed || 1.0,
        }),
        timeoutMs: 60000,
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

      // 上游返回 JSON = 错误 (例如该渠道不支持 TTS), 原样返回错误而不是当二进制乱码透传
      const upstreamCt = String(res.headers['content-type'] ?? '');
      if (upstreamCt.includes('application/json')) {
        return reply.code(res.status).type('application/json').send(res.body.toString('utf8'));
      }

      // 返回音频数据
      reply.header('X-Hub-Key', key.label ?? `key#${key.id}`);
      reply.header('X-Hub-Key-Id', String(key.id));
      reply.header('X-Hub-Model', resolved.upstreamModel);
      reply.header('X-Hub-Latency-Ms', String(latencyMs));

      const format = body.response_format || 'mp3';
      const contentTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        opus: 'audio/opus',
        aac: 'audio/aac',
        flac: 'audio/flac',
        wav: 'audio/wav',
        pcm: 'audio/pcm',
      };
      reply.header('Content-Type', contentTypes[format] || 'audio/mpeg');

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

  // POST /v1/audio/transcriptions (STT)
  app.post('/v1/audio/transcriptions', async (req, reply) => {
    const body = req.body as any;
    if (!body?.model) {
      return reply.code(400).send({ error: { message: 'model 字段必填', type: 'invalid_request_error' } });
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
    const start = Date.now();
    inflightStart(key.id, resolved.upstreamModel);

    try {
      // 构建 multipart/form-data 请求
      // 注意: undici 的 FormData.append 只接受 Blob, 不接受 Buffer, 必须先包一层
      const formData = new FormData();
      formData.append('model', resolved.upstreamModel);
      if (body.file) {
        let buf: Buffer;
        if (typeof body.file === 'string') {
          buf = body.file.startsWith('data:')
            ? Buffer.from(body.file.slice(body.file.indexOf(',') + 1), 'base64')
            : Buffer.from(body.file, 'base64');
        } else {
          buf = Buffer.isBuffer(body.file) ? body.file : Buffer.from(body.file);
        }
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        formData.append('file', blob, 'audio.mp3');
      }
      if (body.prompt) formData.append('prompt', body.prompt);
      if (body.language) formData.append('language', body.language);
      if (body.temperature) formData.append('temperature', String(body.temperature));
      if (body.response_format) formData.append('response_format', body.response_format);

      const res = await httpSend(url, apiKey, {
        method: 'POST',
        body: formData as any,
        timeoutMs: 60000,
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
