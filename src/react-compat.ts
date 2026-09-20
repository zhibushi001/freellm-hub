import { FastifyInstance } from 'fastify';
import { getDb } from './db/connection.js';
import { listChannels } from './db/repos/channels.js';
import { listKeys } from './db/repos/keys.js';

export function registerReactCompatRoutes(app: FastifyInstance): void {
  const requireAdmin = async (req: any, reply: any) => {
    if (!req.session?.adminId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };

  app.get('/api/admin/dashboard/stats', { preHandler: requireAdmin }, async (_req, reply) => {
    const channels = listChannels();
    const allKeys = listKeys();    const db = getDb();
    const last24h = db.prepare(`
      SELECT COUNT(*) AS total_requests,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
        COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
        COALESCE(SUM(completion_tokens), 0) AS output_tokens,
        COALESCE(AVG(latency_ms), 0) AS avg_latency
      FROM usage_logs
      WHERE created_at >= (strftime('%s', 'now') * 1000 - 86400000)
    `).get() as any;
    return reply.send({
      totalRequests: last24h?.total_requests ?? 0,
      totalTokens: (last24h?.input_tokens ?? 0) + (last24h?.output_tokens ?? 0),
      activeChannels: channels.filter((c: any) => c.enabled === 1).length,
      activeKeys: allKeys.filter((k: any) => k.enabled).length,
      successRate: last24h?.total_requests > 0 ? ((last24h.successes / last24h.total_requests) * 100) : 100,
      avgLatency: last24h?.avg_latency ?? 0,
    });
  });

  app.get('/api/admin/usage/daily', { preHandler: requireAdmin }, async (req, reply) => {
    const days = parseInt((req.query as any).days ?? '7', 10);
    const db = getDb();
    const rows = db.prepare(`
      SELECT date(created_at / 1000, 'unixepoch') AS date,
        COUNT(*) AS total_requests,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS failure_count,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms
      FROM usage_logs
      WHERE created_at >= (strftime('%s', 'now') * 1000 - (? * 86400000))
      GROUP BY date ORDER BY date ASC
    `).all(days);
    return reply.send({ ok: true, daily: rows });
  });

  app.get('/api/admin/usage/logs', { preHandler: requireAdmin }, async (req, reply) => {
    const limit = parseInt((req.query as any).limit ?? '50', 10);
    const offset = parseInt((req.query as any).offset ?? '0', 10);
    const status = (req.query as any).status as string | undefined;
    const model = (req.query as any).model as string | undefined;
    const db = getDb();

    // 支持 status / model 过滤 (前端 Usage 页的筛选下拉)
    const where: string[] = [];
    const params: any[] = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (model) { where.push('request_model = ?'); params.push(model); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`SELECT * FROM usage_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM usage_logs ${whereSql}`).get(...params) as any;

    return reply.send({ ok: true, logs: rows, total: totalRow?.total ?? rows.length });
  });
}
