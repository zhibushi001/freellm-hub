/**
 * 客户端 API 路由 - OpenAI 兼容 + 扩展
 * 全部需要 Hub Key 鉴权
 */
import type { FastifyInstance } from 'fastify';
import {requireHubKey, requireModelAllowed} from '../../auth/hubKeyAuth.js'
import {chatCompletion, chatStream} from '../../services/chatService.js'
import {listKeys} from '../../db/repos/keys.js'
import {getDiscoveredModelsForKey} from '../../db/repos/discoveredModels.js'
import {listChannels} from '../../db/repos/channels.js'

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  // 所有 /v1/* 需要 Hub Key (但 /v1/messages 自己在路由内处理 + 转 Anthropic 错误格式)
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    if (req.url.startsWith('/v1/messages')) return;  // Anthropic 路由自己鉴权, 返回 Anthropic 错误格式
    await requireHubKey(req, reply);
    if (!req.hubKey) return;  // 鉴权失败, reply 已发送响应
    // Hub Key 模型白名单校验 (allowed_models = null 时放行)
    const body = req.body as any;
    if (body && typeof body === 'object' && 'model' in body) {
      requireModelAllowed(req, reply, body.model);
    }
  });

  // GET /v1/models
  // 聚合来源 (优先级: 1=channel.models 显式, 2=discovered_models 探测)
  app.get('/v1/models', async (req, _reply) => {
    const allKeys = listKeys().filter(k => k.enabled === 1);
    const seen = new Set<string>();
    const data: any[] = [];

    // 1) channel.models 显式配置的 (newapi 风格: 用户可手填 "gpt-4o,claude-3")
    const enabledChannels = listChannels().filter((c: any) => c.enabled);
    for (const ch of enabledChannels) {
      if (!ch.models) continue;
      for (const m of ch.models.split(',').map((s: string) => s.trim()).filter(Boolean)) {
        if (seen.has(m)) continue;
        seen.add(m);
        data.push({
          id: m,
          object: 'model',
          created: Math.floor((ch.updated_at || ch.created_at) / 1000),
          owned_by: ch.provider_name,
        });
      }
    }

    // 2) discovered_models 探测到的 (仅当 channel.models 为空时补充)
    for (const key of allKeys) {
      const models = getDiscoveredModelsForKey(key.id);
      // 找到 key 对应的 channel
      const ch = listChannels().find(c => c.id === key.channel_id);
      const excluded = ch?.excluded_models
        ? new Set(ch.excluded_models.split(',').map((s: string) => s.trim()).filter(Boolean))
        : new Set<string>();
      
      // 只有当 channel.models 为空时，才从 discovered_models 补充
      if (ch?.models && ch.models.trim()) continue;
      
      for (const m of models) {
        if (excluded.has(m.upstream_id)) continue;
        if (seen.has(m.upstream_id)) continue;
        seen.add(m.upstream_id);
        data.push({
          id: m.upstream_id,
          object: 'model',
          created: Math.floor(m.discovered_at / 1000),
          owned_by: key.provider_name,
        });
      }
    }

    // 3) Hub Key 模型白名单过滤: 受限 Key 只能看到自己允许的模型
    //    (allowed_models 为 null 表示不限制, 原样返回)
    const allowed = req.hubKey?.allowed_models;
    if (allowed && allowed.length > 0) {
      const allowSet = new Set(allowed);
      for (let i = data.length - 1; i >= 0; i--) {
        const id = data[i].id as string;
        const bare = id.includes('/') ? id.split('/').pop()! : id;
        if (!allowSet.has(id) && !allowSet.has(bare)) data.splice(i, 1);
      }
    }

    return { object: 'list', data };
  });

  // POST /v1/chat/completions
  app.post('/v1/chat/completions', async (req, reply) => {
    const body = req.body as any;
    if (!body?.model) {
      return reply.code(400).send({ error: { message: 'model 字段必填', type: 'invalid_request_error' } });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: { message: 'messages 不能为空', type: 'invalid_request_error' } });
    }
    const hubKeyId = req.hubKey?.id ?? null;

    if (body.stream) {
      const result = await chatStream(body, hubKeyId);
      if ('error' in result) {
        return reply.code(result.status).send({ error: { message: result.error, type: 'gateway_error' } });
      }
      // 流式响应: 把上游 SSE 直接转发给客户端
      reply.raw.statusCode = result.status;
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Hub-Key', result.keyName);
      reply.raw.setHeader('X-Hub-Key-Id', String(result.keyId));
      reply.raw.setHeader('X-Hub-Model', result.upstreamModel);
      reply.raw.setHeader('X-Hub-Latency-Ms', String(result.latencyMs));
      // node:sqlite 的 ReadableStream → Node Readable
      const stream = result.body as any;
      for await (const chunk of stream) {
        reply.raw.write(chunk);
      }
      reply.raw.end();
      try { result.onStreamEnd?.(); } catch { /* intentional empty */ }
      return reply;
    }

    const result = await chatCompletion(body, hubKeyId);
    if ('error' in result) {
      return reply.code(result.status).send({ error: { message: result.error, type: 'gateway_error' } });
    }
    reply.header('X-Hub-Key', result.keyName);
    reply.header('X-Hub-Key-Id', String(result.keyId));
    reply.header('X-Hub-Model', result.upstreamModel);
    reply.header('X-Hub-Latency-Ms', String(result.latencyMs));
    return reply.code(result.status).send(result.body);
  });

  // GET /v1/health (简单健康)
  app.get('/v1/health', async () => ({ status: 'ok' }));
}
