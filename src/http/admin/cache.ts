/**
 * Admin 缓存管理路由
 */
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/connection.js';
import {
  isCacheEnabled,
  getCacheTTL,
  getCacheStats,
  cleanupExpiredCache,
} from '../../services/cacheService.js';

export async function registerCacheAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/cache/stats
  app.get('/api/admin/cache/stats', { preHandler: requireAdmin }, async (_req, reply) => {
    const stats = getCacheStats();
    const enabled = isCacheEnabled();
    const ttl = getCacheTTL();
    
    return reply.send({
      ok: true,
      enabled,
      ttl_seconds: ttl,
      stats,
    });
  });

  // POST /api/admin/cache/cleanup
  app.post('/api/admin/cache/cleanup', { preHandler: requireAdmin }, async (_req, reply) => {
    const cleaned = cleanupExpiredCache();
    return reply.send({ ok: true, cleaned });
  });

  // POST /api/admin/cache/enable
  app.post('/api/admin/cache/enable', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const enabled = body.enabled !== false;
    const ttl = body.ttl_seconds || 300;
    
    getDb()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cache_enabled', ?)")
      .run(enabled ? '1' : '0');
    
    if (ttl) {
      getDb()
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cache_ttl', ?)")
        .run(String(ttl));
    }
    
    return reply.send({ ok: true, enabled, ttl_seconds: ttl });
  });
}
