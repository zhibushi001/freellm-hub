/**
 * Embeddings API 路由 - OpenAI 兼容
 */
import type { FastifyInstance } from 'fastify';
import { requireHubKey } from '../../auth/hubKeyAuth.js';
import { getDb } from '../../db/connection.js';
import { listChannels } from '../../db/repos/channels.js';
import { listKeysByChannel } from '../../db/repos/keys.js';
import { getDecryptedApiKey } from '../../db/repos/keys.js';
import { httpSend } from '../../adapters/client.js';
import { recordUsage } from '../../services/usageService.js';

export async function registerEmbeddingsRoutes(app: FastifyInstance): Promise<void> {
  // 需要 Hub Key 鉴权
  app.addHook('preHandler', async (req, reply) => {
    if (req.url !== '/v1/embeddings') return;
    await requireHubKey(req, reply);
  });

  // POST /v1/embeddings
  app.post('/v1/embeddings', async (req, reply) => {
    const body = req.body as any;
    
    if (!body?.model) {
      return reply.code(400).send({
        error: { message: 'model 字段必填', type: 'invalid_request_error' },
      });
    }
    
    if (!body.input) {
      return reply.code(400).send({
        error: { message: 'input 字段必填', type: 'invalid_request_error' },
      });
    }
    
    const model = body.model;
    const input = Array.isArray(body.input) ? body.input : [body.input];
    const hubKeyId = req.hubKey?.id ?? null;
    
    try {
      // 查找嵌入模型配置
      const embeddingModel = getDb()
        .prepare("SELECT * FROM embedding_models WHERE enabled = 1 AND (name = ? OR name = 'default')")
        .get(model) as any;
      
      if (!embeddingModel) {
        return reply.code(404).send({
          error: { message: `未找到嵌入模型配置: ${model}`, type: 'model_not_found' },
        });
      }
      
      // 获取 provider 的 API Key
      const channels = listChannels().filter((c: any) => c.enabled);
      let targetKey = null;
      
      for (const ch of channels) {
        if (ch.provider_name === embeddingModel.provider_name) {
          const keys = listKeysByChannel(ch.id).filter((k: any) => k.enabled === 1);
          if (keys.length > 0) {
            targetKey = keys[0];
            break;
          }
        }
      }
      
      if (!targetKey) {
        return reply.code(502).send({
          error: { message: '没有可用的 Provider Key', type: 'provider_not_available' },
        });
      }
      
      const apiKey = getDecryptedApiKey(targetKey.id);
      const baseUrl = embeddingModel.base_url.replace(/\/$/, '');
      const apiPath = embeddingModel.api_path || '/v1/embeddings';
      
      const response = await httpSend(`${baseUrl}${apiPath}`, apiKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          input: input,
          ...(body.encoding_format ? { encoding_format: body.encoding_format } : {}),
          ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        }),
        timeoutMs: 30000,
      });
      
      // 记录使用
      recordUsage({
        hub_key_id: hubKeyId,
        key_id: targetKey.id,
        provider_name: embeddingModel.provider_name,
        request_model: model,
        routed_model: model,
        status: 'success',
        stream: 0,
      });
      
      return reply.send(JSON.parse(response.body));
    } catch (e: any) {
      return reply.code(502).send({
        error: { message: `嵌入请求失败: ${e.message}`, type: 'upstream_error' },
      });
    }
  });
}
