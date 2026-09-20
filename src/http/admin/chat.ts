/**
 * Admin Chat 对话管理路由
 */
import type { FastifyInstance } from 'fastify';
import {
  listConversations,
  getConversation,
  createConversation,
  addMessage,
  updateConversationTitle,
  updateConversationModel,
  deleteConversation,
  clearConversationMessages,
  getConversationStats,
} from '../../services/conversationService.js';
import { listChannels } from '../../db/repos/channels.js';
import { listKeys } from '../../db/repos/keys.js';
import { getDiscoveredModelsForKey } from '../../db/repos/discoveredModels.js';
import { chatCompletion } from '../../services/chatService.js';

export async function registerChatAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/chat/stats
  app.get('/api/admin/chat/stats', { preHandler: requireAdmin }, async (_req, reply) => {
    const stats = getConversationStats();
    return reply.send({ ok: true, stats });
  });

  // GET /api/admin/chat/conversations
  app.get('/api/admin/chat/conversations', { preHandler: requireAdmin }, async (req, reply) => {
    const limit = parseInt((req.query as any).limit ?? '50', 10);
    const offset = parseInt((req.query as any).offset ?? '0', 10);
    const conversations = listConversations(limit, offset);
    return reply.send({ ok: true, conversations });
  });

  // GET /api/admin/chat/conversations/:id
  app.get('/api/admin/chat/conversations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const conversation = getConversation(id);
    if (!conversation) {
      return reply.code(404).send({ ok: false, error: 'Conversation not found' });
    }
    return reply.send({ ok: true, conversation });
  });

  // POST /api/admin/chat/conversations
  app.post('/api/admin/chat/conversations', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    if (!body.model) {
      return reply.code(400).send({ ok: false, error: 'model 必填' });
    }
    const conversation = createConversation({
      title: body.title,
      model: body.model,
      channelId: body.channelId,
    });
    return reply.send({ ok: true, conversation });
  });

  // PATCH /api/admin/chat/conversations/:id
  app.patch('/api/admin/chat/conversations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    if (body.title !== undefined) {
      const conversation = updateConversationTitle(id, body.title);
      if (!conversation) {
        return reply.code(404).send({ ok: false, error: 'Conversation not found' });
      }
      return reply.send({ ok: true, conversation });
    }
    if (body.model !== undefined) {
      const conversation = updateConversationModel(id, body.model);
      if (!conversation) {
        return reply.code(404).send({ ok: false, error: 'Conversation not found' });
      }
      return reply.send({ ok: true, conversation });
    }
    return reply.code(400).send({ ok: false, error: 'No valid fields to update' });
  });

  // DELETE /api/admin/chat/conversations/:id
  app.delete('/api/admin/chat/conversations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const deleted = deleteConversation(id);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: 'Conversation not found' });
    }
    return reply.send({ ok: true });
  });

  // DELETE /api/admin/chat/conversations/:id/messages
  app.delete('/api/admin/chat/conversations/:id/messages', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const conversation = clearConversationMessages(id);
    if (!conversation) {
      return reply.code(404).send({ ok: false, error: 'Conversation not found' });
    }
    return reply.send({ ok: true, conversation });
  });

  // POST /api/admin/chat/conversations/:id/messages
  app.post('/api/admin/chat/conversations/:id/messages', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    if (!body.role || !body.content) {
      return reply.code(400).send({ ok: false, error: 'role 和 content 必填' });
    }
    const conversation = addMessage(id, {
      role: body.role,
      content: body.content,
    }, body.tokens);
    if (!conversation) {
      return reply.code(404).send({ ok: false, error: 'Conversation not found' });
    }
    return reply.send({ ok: true, conversation });
  });

  // GET /api/admin/chat/models - 获取可用模型列表 (用于聊天页面)
  app.get('/api/admin/chat/models', { preHandler: requireAdmin }, async (_req, reply) => {
    const allKeys = listKeys().filter(k => k.enabled === 1);
    const seen = new Set<string>();
    const data: any[] = [];
    const modelCaps: Record<string, any> = {};

    // 1) channel.models 显式配置的
    const enabledChannels = listChannels().filter((c: any) => c.enabled);
    for (const ch of enabledChannels) {
      if (!ch.models) continue;
      
      // 解析渠道的 capabilities
      let channelCaps: any = {};
      if (ch.capabilities) {
        try { channelCaps = JSON.parse(ch.capabilities); } catch {}
      }
      
      for (const m of ch.models.split(',').map((s: string) => s.trim()).filter(Boolean)) {
        if (seen.has(m)) continue;
        seen.add(m);
        data.push({
          id: m,
          object: 'model',
          created: Math.floor((ch.updated_at || ch.created_at) / 1000),
          owned_by: ch.provider_name || ch.label || 'unknown',
          capabilities: channelCaps,
        });
        modelCaps[m] = channelCaps;
      }
    }

    // 2) discovered_models 探测到的 (仅当 channel.models 为空时补充)
    for (const key of allKeys) {
      const models = getDiscoveredModelsForKey(key.id);
      const ch = listChannels().find(c => c.id === key.channel_id);
      const excluded = ch?.excluded_models
        ? new Set(ch.excluded_models.split(',').map((s: string) => s.trim()).filter(Boolean))
        : new Set<string>();
      
      // 解析渠道的 capabilities
      let channelCaps: any = {};
      if (ch?.capabilities) {
        try { channelCaps = JSON.parse(ch.capabilities); } catch {}
      }
      
      for (const dm of models) {
        const modelId = dm.upstream_id;
        if (seen.has(modelId) || excluded.has(modelId)) continue;
        seen.add(modelId);
        data.push({
          id: modelId,
          object: 'model',
          created: Math.floor(dm.discovered_at / 1000),
          owned_by: ch?.provider_name || ch?.label || 'unknown',
          capabilities: channelCaps,
        });
        modelCaps[modelId] = channelCaps;
      }
    }

    return reply.send({ ok: true, data });
  });

  // POST /api/admin/chat/test-completion - 测试 Chat Completion (使用 admin session)
  app.post('/api/admin/chat/test-completion', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    if (!body.model || !body.messages) {
      return reply.code(400).send({ ok: false, error: 'model 和 messages 必填' });
    }

    try {
      const result = await chatCompletion(body, null);
      
      if ('error' in result) {
        return reply.code(result.status).send({ error: { message: result.error, type: 'gateway_error' } });
      }
      
      return reply.code(result.status).send(result.body);
    } catch (e: any) {
      return reply.send({
        error: {
          message: e.message || '路由失败',
          type: 'api_error',
          code: 'route_error',
        }
      });
    }
  });
}
