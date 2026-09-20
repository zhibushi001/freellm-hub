/**
 * OpenAI Responses 协议路由 (`/v1/responses`)
 * 转给内部 chat/completions, 透传
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { chatCompletion, chatStream, type ChatStreamHandle } from '../../services/chatService.js';
import { responsesToChatRequest, chatToResponsesResponse, createResponsesStreamState, responsesCreatedEvent, processChatChunkToResponses } from '../../adapters/responses.js';
import { randomUUID } from 'node:crypto';

function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function responsesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/responses', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    const auth = req.headers.authorization;
    const apiKey = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!apiKey) {
      return reply.code(401).send({ error: { message: 'Missing Authorization Bearer', type: 'invalid_request_error' } });
    }
    const { hubKeyId: _hubKeyId } = (req as any).hubKeyContext ?? { hubKeyId: null };
    // hubKeyId 实际由 rateLimitMiddleware 注入; 若无则从 body 查
    const hubKeyIdFromAuth = (req as any).hubKeyId ?? null;

    if (body?.stream) {
      // 流式
      const openaiReq = responsesToChatRequest(body);
      const result: ChatStreamHandle | { error: string; status: number } = await chatStream(openaiReq, hubKeyIdFromAuth);
      if ('error' in result) {
        return reply.code(result.status).send({ error: { message: result.error, type: 'api_error' } });
      }
      const responseId = `resp_${randomUUID()}`;
      const createdAt = Math.floor(Date.now() / 1000);
      const state = createResponsesStreamState(result.upstreamModel, responseId, createdAt);

      reply.raw.statusCode = 200;
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Hub-Key-Id', String(result.keyId));
      reply.raw.setHeader('X-Hub-Model', result.upstreamModel);

      // 立刻 flush response.created
      reply.raw.write(sseEvent('response.created', responsesCreatedEvent(state).next().value!.data));

      // pipe chat SSE → Responses events
      const decoder = new TextDecoder();
      let buffer = '';
      const upstreamBody = result.body as unknown as AsyncIterable<Uint8Array>;
      const iterator = upstreamBody[Symbol.asyncIterator]();

      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { value, done } = await iterator.next();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              let parsed: any;
              try { parsed = JSON.parse(data); } catch { continue; }
              for (const ev of processChatChunkToResponses(state, parsed)) {
                reply.raw.write(sseEvent(ev.event, ev.data));
              }
            }
          }
        } catch {
          // upstream stream error — fall through to end
        } finally {
          try { reply.raw.end(); } catch { /* intentional empty */ }
          try { result.onStreamEnd?.(); } catch { /* intentional empty */ }
        }
      };
      // fire-and-forget, fastify 不会等 (reply.raw 异步 flush)
      pump();
      return reply;
    } else {
      // 非流式
      const openaiReq = responsesToChatRequest(body);
      const result = await chatCompletion(openaiReq, hubKeyIdFromAuth);
      if ('error' in result) {
        return reply.code(result.status).send({ error: { message: result.error, type: 'api_error' } });
      }
      const responsesResp = chatToResponsesResponse(result.body, openaiReq.model, `resp_${randomUUID()}`);
      return reply.send(responsesResp);
    }
  });
}
