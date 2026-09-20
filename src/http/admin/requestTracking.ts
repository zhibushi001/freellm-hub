/**
 * Admin 请求追踪管理路由
 */
import type { FastifyInstance } from 'fastify';
import {
  getRequestAttemptsSummary,
  getRequestTrackingStats,
} from '../../services/requestTrackingService.js';
import { getDb } from '../../db/connection.js';

export async function registerRequestTrackingAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/requests/stats
  app.get('/api/admin/requests/stats', { preHandler: requireAdmin }, async (_req, reply) => {
    const stats = getRequestTrackingStats();
    return reply.send({ ok: true, stats });
  });

  // GET /api/admin/requests/:id/attempts
  app.get('/api/admin/requests/:id/attempts', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const summary = getRequestAttemptsSummary(id);
    
    if (summary.totalAttempts === 0) {
      return reply.code(404).send({ ok: false, error: 'not_found' });
    }
    
    return reply.send({ ok: true, summary });
  });

  // GET /api/admin/requests
  app.get('/api/admin/requests', { preHandler: requireAdmin }, async (req, reply) => {
    const query = req.query as any;
    const limit = parseInt(query.limit || '20', 10);
    const offset = parseInt(query.offset || '0', 10);
    const status = query.status || null;
    
    let rows: any[];
    if (status) {
      rows = getDb()
        .prepare(
          "SELECT * FROM usage_logs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        )
        .all(status, limit, offset) as any[];
    } else {
      rows = getDb()
        .prepare(
          "SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT ? OFFSET ?"
        )
        .all(limit, offset) as any[];
    }
    
    const total = getDb()
      .prepare("SELECT COUNT(*) as count FROM usage_logs")
      .get() as any;
    
    return reply.send({ ok: true, requests: rows, total: total.count });
  });
}
