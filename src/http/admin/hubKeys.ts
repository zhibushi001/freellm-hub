/**
 * Hub Key 管理 API (React SPA handles all HTML)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listHubKeys, createHubKey, regenerateHubKey,
  setHubKeyEnabled, deleteHubKey, getHubKeyById,
  updateHubKey, parseAllowedModels,
} from '../../db/repos/hubKeys.js';
import { validateBody } from './validation.js';

/** Hub Key 创建 */
const CreateHubKeySchema = z.object({
  name: z.string().min(1, '名称必填').max(128),
  notes: z.string().max(512).optional(),
  expires_in_days: z.union([z.number().positive(), z.string()]).optional(),
  rate_limit_rpm: z.number().positive().optional(),
  /** 允许调用的模型列表; null/省略 = 不限制 */
  allowed_models: z.union([z.array(z.string()), z.null()]).optional(),
});

/** Hub Key 更新 */
const UpdateHubKeySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  notes: z.string().max(512).nullable().optional(),
  expires_in_days: z.union([z.number().positive(), z.string()]).optional(),
  rate_limit_rpm: z.union([z.number().positive(), z.null()]).optional(),
  allowed_models: z.union([z.array(z.string()), z.null()]).optional(),
});

/** 统一序列化 Hub Key 响应 */
function serializeKey(k: NonNullable<ReturnType<typeof getHubKeyById>>) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.key_prefix,
    enabled: k.enabled,
    notes: k.notes,
    rate_limit_rpm: k.rate_limit_rpm,
    expires_at: k.expires_at,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    allowed_models_parsed: parseAllowedModels(k.allowed_models),
  };
}

export async function registerHubKeyAdminRoutes(app: FastifyInstance): Promise<void> {
  // 认证检查 helper
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/hub-keys
  app.get('/api/admin/hub-keys', { preHandler: requireAdmin }, async (req, reply) => {
    const keys = listHubKeys().map(serializeKey);
    return reply.send({ ok: true, keys });
  });

  // POST /api/admin/hub-keys - 创建
  app.post('/api/admin/hub-keys', { preHandler: requireAdmin }, async (req, reply) => {
    // 验证输入
    const validationResult = validateBody(req, CreateHubKeySchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }

    const body = req.body as any;
    const name = (body.name ?? '').trim();
    if (!name) return reply.code(400).send({ ok: false, error: '名称必填' });
    let expiresAt: number | null = null;
    if (body.expires_in_days !== undefined && body.expires_in_days !== null && body.expires_in_days !== '' && body.expires_in_days !== 'never') {
      const d = Number(body.expires_in_days);
      if (Number.isFinite(d) && d > 0) {
        expiresAt = Date.now() + Math.floor(d) * 24 * 3600 * 1000;
      }
    }
    try {
      const r = createHubKey({
        name,
        notes: body.notes,
        expires_at: expiresAt ?? undefined,
        rate_limit_rpm: body.rate_limit_rpm,
        allowed_models: body.allowed_models,
      });
      const created = getHubKeyById(r.id)!;
      return reply.send({ ok: true, ...serializeKey(created), plain_key: r.plainKey });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // PATCH /api/admin/hub-keys/:id - 更新名称/备注/过期时间/限速/模型权限
  app.patch('/api/admin/hub-keys/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const k = getHubKeyById(id);
    if (!k) return reply.code(404).send({ ok: false, error: 'not found' });

    const validationResult = validateBody(req, UpdateHubKeySchema);
    if (validationResult?.errors) {
      return reply.code(400).send({ ok: false, error: validationResult.errors[0].message, errors: validationResult.errors });
    }

    const body = req.body as any;
    const patch: any = {};
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) return reply.code(400).send({ ok: false, error: '名称不能为空' });
      patch.name = n;
    }
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.rate_limit_rpm !== undefined) patch.rate_limit_rpm = body.rate_limit_rpm;
    if (body.expires_in_days !== undefined) {
      patch.expires_at = body.expires_in_days === null || body.expires_in_days === '' || body.expires_in_days === 'never'
        ? null
        : Date.now() + Math.floor(Number(body.expires_in_days)) * 24 * 3600 * 1000;
    }
    if (body.allowed_models !== undefined) patch.allowed_models = body.allowed_models;

    const updated = updateHubKey(id, patch);
    if (!updated) return reply.code(404).send({ ok: false, error: 'not found' });
    return reply.send({ ok: true, key: serializeKey(updated) });
  });

  // POST /api/admin/hub-keys/:id/regenerate
  app.post('/api/admin/hub-keys/:id/regenerate', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    try {
      const old = getHubKeyById(id);
      if (!old) return reply.code(404).send({ ok: false, error: 'not found' });
      const r = regenerateHubKey(id);
      const updated = getHubKeyById(id)!;
      return reply.send({ ok: true, ...serializeKey(updated), plain_key: r.plainKey });
    } catch (e: any) {
      return reply.code(404).send({ ok: false, error: e.message });
    }
  });

  // POST /api/admin/hub-keys/:id/toggle
  app.post('/api/admin/hub-keys/:id/toggle', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const k = getHubKeyById(id);
    if (!k) return reply.code(404).send({ ok: false, error: 'not found' });
    const newEnabled = k.enabled === 0;
    setHubKeyEnabled(id, newEnabled);
    const updated = getHubKeyById(id)!;
    return reply.send({ ok: true, key: serializeKey(updated) });
  });

  // DELETE /api/admin/hub-keys/:id
  app.delete('/api/admin/hub-keys/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    deleteHubKey(id);
    return reply.send({ ok: true });
  });

  // GET /api/admin/hub-keys/:id/plain
  app.get('/api/admin/hub-keys/:id/plain', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const k = getHubKeyById(id);
    if (!k) return reply.code(404).send({ ok: false, error: 'not found' });
    if (!k.plain_key) {
      return reply.code(404).send({ ok: false, error: 'plain_key 不可用 (旧 key 在添加 plain_key 字段前创建, 需要重生成)' });
    }
    return reply.send({ ok: true, name: k.name, plain_key: k.plain_key, expires_at: k.expires_at });
  });
}
