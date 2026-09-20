/**
 * Admin 回退配置管理路由
 */
import type { FastifyInstance } from 'fastify';
import {
  getFallbackConfig,
  listFallbackConfigs,
  upsertFallbackConfig,
  deleteFallbackConfig,
} from '../../services/fallbackService.js';

export async function registerFallbackAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/fallback
  app.get('/api/admin/fallback', { preHandler: requireAdmin }, async (_req, reply) => {
    const configs = listFallbackConfigs();
    return reply.send({ ok: true, configs });
  });

  // GET /api/admin/fallback/:model
  app.get('/api/admin/fallback/:model', { preHandler: requireAdmin }, async (req, reply) => {
    const model = (req.params as any).model;
    const config = getFallbackConfig(model);
    if (!config) {
      return reply.code(404).send({ ok: false, error: 'not_found' });
    }
    return reply.send({ ok: true, config });
  });

  // POST /api/admin/fallback
  app.post('/api/admin/fallback', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    if (!body.primary_model) {
      return reply.code(400).send({ ok: false, error: 'primary_model 必填' });
    }
    
    const config = upsertFallbackConfig({
      primaryModel: body.primary_model,
      fallbackModels: body.fallback_models || [],
      strategy: body.strategy || 'sequential',
      enabled: body.enabled !== undefined ? body.enabled : true,
      maxRetries: body.max_retries,
      retryDelayMs: body.retry_delay_ms,
    });
    
    return reply.send({ ok: true, config });
  });

  // DELETE /api/admin/fallback/:id
  app.delete('/api/admin/fallback/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const deleted = deleteFallbackConfig(id);
    return reply.send({ ok: deleted });
  });
}
