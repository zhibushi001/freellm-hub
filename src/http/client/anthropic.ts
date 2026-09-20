/**
 * Anthropic 兼容客户端 API
 * POST /v1/messages - 接受 Anthropic Messages API 请求
 * 流式 (stream:true) 输出 Anthropic SSE 事件
 */
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { authenticateHubKey, isHubKeyAllowedForModel } from '../../auth/hubKeyAuth.js';
import { listKeys } from '../../db/repos/keys.js';
import {
  anthropicToOpenAIMessages,
  openAIToAnthropicResponse,
  openAISseToAnthropicSse,
  toAnthropicError,
  type AnthropicRequest,
} from '../../adapters/anthropic.js';
import { chatCompletion, chatStream } from '../../services/chatService.js';
import { logger } from '../../util/logger.js';

export async function registerAnthropicClientRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/messages
  app.post('/v1/messages', async (req, reply) => {
    // 自己鉴权 (返回 Anthropic 错误格式, 不走 preHandler 的 OpenAI 格式)
    const result = authenticateHubKey(req);
    if (!result.ok) {
      return reply
        .code(401)
        .send(toAnthropicError(401, result.error.message));
    }
    const hubKey = result.hubKey;
    const hubKeyId = hubKey.id;

    const body = req.body as AnthropicRequest;
    if (!body?.model) {
      return reply
        .code(400)
        .send(toAnthropicError(400, 'model 字段必填', 'invalid_request_error'));
    }
    // Hub Key 模型白名单校验
    if (!isHubKeyAllowedForModel(hubKey, body.model)) {
      return reply
        .code(403)
        .send(toAnthropicError(403, `Hub Key '${hubKey.name}' 不允许调用模型 '${body.model}'。当前允许: ${hubKey.allowed_models!.join(', ')}。`, 'permission_error'));
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply
        .code(400)
        .send(toAnthropicError(400, 'messages 不能为空', 'invalid_request_error'));
    }
    if (body.max_tokens === undefined || body.max_tokens < 1) {
      return reply
        .code(400)
        .send(toAnthropicError(400, 'max_tokens 必填且 >= 1', 'invalid_request_error'));
    }

    // Anthropic → OpenAI
    const openaiReq = anthropicToOpenAIMessages(body);

    // 流式
    if (body.stream) {
      return handleAnthropicStream(req, reply, openaiReq, body.model, hubKeyId);
    }

    // 非流式
    try {
      const result = await chatCompletion(openaiReq, hubKeyId);
      if ('error' in result) {
        return reply
          .code(result.status)
          .send(toAnthropicError(result.status, result.error));
      }
      const anthropicResp = openAIToAnthropicResponse(result.body, body.model, result.upstreamModel);
      // 加 hub 调试 header
      reply.header('X-Hub-Key-Id', String(result.keyId));
      reply.header('X-Hub-Model', result.upstreamModel);
      reply.header('X-Hub-Latency-Ms', String(result.latencyMs));
      reply.header('X-Hub-Attempts', String(result.attempts ?? 1));
      return reply.code(200).send(anthropicResp);
    } catch (e: any) {
      logger.error({ err: e }, 'Anthropic /v1/messages 失败');
      return reply
        .code(500)
        .send(toAnthropicError(500, e.message ?? 'Internal error'));
    }
  });
}

/**
 * 处理流式响应: 把上游 OpenAI SSE 转 Anthropic SSE
 */
async function handleAnthropicStream(
  req: any,
  reply: any,
  openaiReq: any,
  requestModel: string,
  hubKeyId: number,
) {
  const allKeys = listKeys();
  if (allKeys.length === 0) {
    return reply
      .code(503)
      .send(toAnthropicError(503, '没有可用的 Key/Provider'));
  }

  // 直接调 chatStream (Phase 2: 池选第一个 key)
  const result = await chatStream(openaiReq, hubKeyId);
  if ('error' in result) {
    return reply
      .code(result.status)
      .send(toAnthropicError(result.status, result.error));
  }

  // OpenAI SSE → Anthropic SSE
  const anthropicStream = openAISseToAnthropicSse(
    result.body as unknown as AsyncIterable<Uint8Array>,
    requestModel,
    result.upstreamModel,
  );

  reply.raw.statusCode = result.status;
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Hub-Key-Id', String(result.keyId));
  reply.raw.setHeader('X-Hub-Model', result.upstreamModel);

  // AsyncIterable<string> → Node Readable
  const nodeStream = Readable.from(
    (async function* () {
      for await (const chunk of anthropicStream) {
        yield chunk;
      }
    })(),
  );

  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(reply.raw);
    nodeStream.on('end', () => {
      // 显式 end raw response, 否则 HTTP keep-alive 让 socket 维持打开
      try { reply.raw.end(); } catch { /* intentional empty */ }
      try { result.onStreamEnd?.(); } catch { /* intentional empty */ }
      resolve();
    });
    nodeStream.on('error', reject);
  });
  return reply;
}
