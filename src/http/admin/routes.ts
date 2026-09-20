/**
 * Model Routes API (React SPA handles all HTML)
 */
import type { FastifyInstance } from 'fastify';
import { listModelRoutes, createModelRoute, updateModelRoute, deleteModelRoute, getModelRouteByName, getModelRoute } from '../../db/repos/modelRoutes.js';

export async function registerModelRouteAdminRoutes(app: FastifyInstance): Promise<void> {
  // 认证检查 helper
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/model-routes
  app.get('/api/admin/model-routes', { preHandler: requireAdmin }, async (req, reply) => {
    const routes = listModelRoutes();
    return reply.send({ ok: true, routes });
  });

  // POST /api/admin/model-routes
  app.post('/api/admin/model-routes', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as { request_model: string; channel_ids: number[]; enabled?: boolean; notes?: string };
    const requestModel = (body.request_model ?? '').trim();
    if (!requestModel) return reply.code(400).send({ ok: false, error: 'request_model 必填' });
    if (getModelRouteByName(requestModel)) {
      return reply.code(409).send({ ok: false, error: `model "${requestModel}" 已有 route, 请用 PUT` });
    }
    const channelIds = Array.isArray(body.channel_ids) ? body.channel_ids : [];
    const r = createModelRoute({
      request_model: requestModel,
      channel_ids: channelIds,
      enabled: body.enabled !== false ? 1 : 0,
      notes: body.notes,
    });
    return reply.send({ ok: true, id: r.id, route: r });
  });

  // PUT /api/admin/model-routes/:id
  app.put('/api/admin/model-routes/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    if (!getModelRoute(id)) return reply.code(404).send({ ok: false, error: 'Route not found' });
    const body = req.body as { request_model?: string; channel_ids?: number[]; enabled?: boolean; notes?: string };
    const patch: any = {};
    if (body.request_model !== undefined) patch.request_model = body.request_model;
    if (body.channel_ids !== undefined) patch.channel_ids = body.channel_ids;
    if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
    if (body.notes !== undefined) patch.notes = body.notes;
    const r = updateModelRoute(id, patch);
    return reply.send({ ok: true, route: r });
  });

  // DELETE /api/admin/model-routes/:id
  app.delete('/api/admin/model-routes/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    if (!getModelRoute(id)) return reply.code(404).send({ ok: false, error: 'Route not found' });
    deleteModelRoute(id);
    return reply.send({ ok: true });
  });
}
