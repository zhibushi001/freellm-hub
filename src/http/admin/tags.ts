/**
 * Admin 标签管理路由
 */
import type { FastifyInstance } from 'fastify';
import {
  listTags,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  addTagToChannel,
  removeTagFromChannel,
  setChannelTags,
  getChannelTags,
  getChannelsByTag,
  batchSetChannelTags,
} from '../../services/tagsService.js';
import { listChannels } from '../../db/repos/channels.js';

export async function registerTagsAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/tags
  app.get('/api/admin/tags', { preHandler: requireAdmin }, async (_req, reply) => {
    const tags = listTags();
    return reply.send({ ok: true, tags });
  });

  // POST /api/admin/tags
  app.post('/api/admin/tags', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const name = (body.name ?? '').trim();
    
    if (!name) {
      return reply.code(400).send({ ok: false, error: 'name 必填' });
    }
    
    try {
      const tag = createTag({
        name,
        description: body.description,
        color: body.color,
      });
      return reply.send({ ok: true, tag });
    } catch (e: any) {
      if (e.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: '标签名已存在' });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // PATCH /api/admin/tags/:id
  app.patch('/api/admin/tags/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    
    try {
      const tag = updateTag(id, {
        name: body.name,
        description: body.description,
        color: body.color,
      });
      if (!tag) {
        return reply.code(404).send({ ok: false, error: 'Tag not found' });
      }
      return reply.send({ ok: true, tag });
    } catch (e: any) {
      if (e.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: '标签名已存在' });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/admin/tags/:id
  app.delete('/api/admin/tags/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const deleted = deleteTag(id);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: 'Tag not found' });
    }
    return reply.send({ ok: true });
  });

  // GET /api/admin/channels/:id/tags
  app.get('/api/admin/channels/:id/tags', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const tags = getChannelTags(channelId);
    return reply.send({ ok: true, tags });
  });

  // PUT /api/admin/channels/:id/tags  (设置渠道的标签)
  app.put('/api/admin/channels/:id/tags', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    const tagIds: number[] = body.tag_ids || [];
    
    const channel = listChannels().find(c => c.id === channelId);
    if (!channel) {
      return reply.code(404).send({ ok: false, error: 'Channel not found' });
    }
    
    setChannelTags(channelId, tagIds);
    const tags = getChannelTags(channelId);
    return reply.send({ ok: true, tags });
  });

  // POST /api/admin/channels/:id/tags  (添加标签)
  app.post('/api/admin/channels/:id/tags', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    const tagId = body.tag_id;
    
    const channel = listChannels().find(c => c.id === channelId);
    if (!channel) {
      return reply.code(404).send({ ok: false, error: 'Channel not found' });
    }
    
    addTagToChannel(channelId, tagId);
    const tags = getChannelTags(channelId);
    return reply.send({ ok: true, tags });
  });

  // DELETE /api/admin/channels/:id/tags/:tagId  (移除标签)
  app.delete('/api/admin/channels/:id/tags/:tagId', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const tagId = parseInt((req.params as any).tagId, 10);
    
    removeTagFromChannel(channelId, tagId);
    const tags = getChannelTags(channelId);
    return reply.send({ ok: true, tags });
  });

  // GET /api/admin/tags/:id/channels  (获取标签关联的渠道)
  app.get('/api/admin/tags/:id/channels', { preHandler: requireAdmin }, async (req, reply) => {
    const tagId = parseInt((req.params as any).id, 10);
    const channelIds = getChannelsByTag(tagId);
    const channels = listChannels().filter(c => channelIds.includes(c.id));
    return reply.send({ ok: true, channels });
  });

  // POST /api/admin/channels/batch-tags  (批量设置渠道标签)
  app.post('/api/admin/channels/batch-tags', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const channelIds: number[] = body.channel_ids || [];
    const tagIds: number[] = body.tag_ids || [];
    
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return reply.code(400).send({ ok: false, error: 'channel_ids 不能为空' });
    }
    
    batchSetChannelTags(channelIds, tagIds);
    return reply.send({ ok: true, count: channelIds.length });
  });
}
