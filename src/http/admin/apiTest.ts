/**
 * Admin API 测试代理路由
 * 使用 admin session 代理调用客户端 API (复用第一个启用的 Hub Key 认证)
 *
 * 所有端点通过 app.inject 转发到 /v1/ 路由，因此完整复用
 * 客户端的认证、模型路由、失败转移和用量记录逻辑。
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { listHubKeys } from '../../db/repos/hubKeys.js';
import { chatCompletion } from '../../services/chatService.js';

export async function registerApiTestAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // 获取第一个可用的 Hub Key (用于内部代理认证)
  const getFirstHubKey = () =>
    listHubKeys().filter(k => k.enabled === 1 && k.plain_key)[0] ?? null;

  /**
   * 内部代理转发到客户端 /v1/ 路由
   * 返回 null 表示没有可用 Hub Key
   */
  async function proxy(path: string, body: unknown) {
    const hubKey = getFirstHubKey();
    if (!hubKey) return null;
    return app.inject({
      method: 'POST',
      url: path,
      headers: { authorization: `Bearer ${hubKey.plain_key}` },
      payload: body as any,
    });
  }

  const missingKeyReply = (reply: FastifyReply) =>
    reply.code(400).send({
      ok: false,
      error: {
        message: '没有可用的 Hub Key，请先在 Hub Keys 页面创建',
        type: 'api_error',
      },
    });

  // POST /api/admin/api/chat - 代理 Chat Completion
  app.post('/api/admin/api/chat', { preHandler: requireAdmin }, async (req, reply) => {
    const hubKeyId = getFirstHubKey()?.id ?? null;
    if (!hubKeyId) return missingKeyReply(reply);

    const body = req.body as any;
    try {
      const result = await chatCompletion(body, hubKeyId);

      if ('error' in result) {
        return reply.code(result.status).send({ error: { message: result.error, type: 'gateway_error' } });
      }

      return reply.code(result.status).send(result.body);
    } catch (e: any) {
      return reply.send({ error: { message: e.message, type: 'api_error' } });
    }
  });

  // POST /api/admin/api/images/generations - 文生图
  app.post('/api/admin/api/images/generations', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await proxy('/v1/images/generations', req.body);
    if (!r) return missingKeyReply(reply);
    return reply.code(r.statusCode).send(r.json());
  });

  // POST /api/admin/api/audio/speech - TTS (上游返回音频二进制)
  app.post('/api/admin/api/audio/speech', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await proxy('/v1/audio/speech', req.body);
    if (!r) return missingKeyReply(reply);

    const ct = r.headers['content-type'];
    // 非 JSON 响应 = 音频流，原样透传
    if (ct && !String(ct).includes('application/json')) {
      return reply.code(r.statusCode).type(ct).send(r.rawPayload);
    }
    return reply.code(r.statusCode).send(r.json());
  });

  // POST /api/admin/api/audio/transcriptions - STT (JSON: {model, file: base64})
  app.post('/api/admin/api/audio/transcriptions', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await proxy('/v1/audio/transcriptions', req.body);
    if (!r) return missingKeyReply(reply);
    return reply.code(r.statusCode).send(r.json());
  });

  // POST /api/admin/api/videos/generations - 文生视频
  app.post('/api/admin/api/videos/generations', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await proxy('/v1/videos/generations', req.body);
    if (!r) return missingKeyReply(reply);
    return reply.code(r.statusCode).send(r.json());
  });

  // POST /api/admin/api/videos/edits - 图生视频
  app.post('/api/admin/api/videos/edits', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await proxy('/v1/videos/edits', req.body);
    if (!r) return missingKeyReply(reply);
    return reply.code(r.statusCode).send(r.json());
  });
}
