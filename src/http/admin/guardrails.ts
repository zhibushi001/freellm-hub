/**
 * Admin 护栏管理路由
 */
import type { FastifyInstance } from 'fastify';
import {
  getGuardrailConfig,
  updateGuardrailConfig,
} from '../../services/guardrailsService.js';

export async function registerGuardrailsAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/guardrails
  app.get('/api/admin/guardrails', { preHandler: requireAdmin }, async (_req, reply) => {
    const config = getGuardrailConfig();
    return reply.send({ ok: true, config });
  });

  // PUT /api/admin/guardrails
  app.put('/api/admin/guardrails', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    const config = updateGuardrailConfig({
      enabled: body.enabled,
      inputFilter: body.input_filter,
      outputFilter: body.output_filter,
      rules: body.rules,
      description: body.description,
    });
    return reply.send({ ok: true, config });
  });
}
