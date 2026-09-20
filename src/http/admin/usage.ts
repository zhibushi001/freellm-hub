/**
 * Admin 用量统计增强路由
 */
import type { FastifyInstance } from 'fastify';
import {
  getModelStats,
  getChannelStats,
  getErrorStats,
  getUsageOverview,
} from '../../services/usageStatsService.js';
import { getDb } from '../../db/connection.js';

export async function registerUsageAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/usage/overview
  app.get('/api/admin/usage/overview', { preHandler: requireAdmin }, async (req, reply) => {
    const days = parseInt((req.query as any).days || '7', 10);
    const overview = getUsageOverview(days);
    return reply.send({ ok: true, overview });
  });

  // GET /api/admin/usage/model-stats
  app.get('/api/admin/usage/model-stats', { preHandler: requireAdmin }, async (req, reply) => {
    const days = parseInt((req.query as any).days || '7', 10);
    const stats = getModelStats(days);
    return reply.send({ ok: true, stats });
  });

  // GET /api/admin/usage/channel-stats
  app.get('/api/admin/usage/channel-stats', { preHandler: requireAdmin }, async (req, reply) => {
    const days = parseInt((req.query as any).days || '7', 10);
    const stats = getChannelStats(days);
    return reply.send({ ok: true, stats });
  });

  // GET /api/admin/usage/error-stats
  app.get('/api/admin/usage/error-stats', { preHandler: requireAdmin }, async (req, reply) => {
    const days = parseInt((req.query as any).days || '7', 10);
    const stats = getErrorStats(days);
    return reply.send({ ok: true, stats });
  });

  // GET /api/admin/usage/logs is already defined in react-compat.ts
}
