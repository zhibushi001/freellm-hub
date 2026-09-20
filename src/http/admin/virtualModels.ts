/**
 * Admin 虚拟模型管理路由
 */
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/connection.js';
import { listKeys } from '../../db/repos/keys.js';

export async function registerVirtualModelAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/virtual-models - 列表 (含 candidates)
  app.get('/api/admin/virtual-models', { preHandler: requireAdmin }, async (_req, reply) => {
    const db = getDb();
    const models = db.prepare(`
      SELECT vm.*, 
        (SELECT COUNT(*) FROM model_candidates mc WHERE mc.virtual_model_id = vm.id AND mc.enabled = 1) as candidate_count
      FROM virtual_models vm
      ORDER BY vm.name
    `).all() as any[];

    return reply.send({ ok: true, models });
  });

  // GET /api/admin/virtual-models/:id - 详情 (含完整 candidates)
  app.get('/api/admin/virtual-models/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const db = getDb();
    
    const model = db.prepare('SELECT * FROM virtual_models WHERE id = ?').get(id) as any;
    if (!model) {
      return reply.code(404).send({ ok: false, error: 'Model not found' });
    }

    const candidates = db.prepare(`
      SELECT mc.*, k.label as key_label, k.status as key_status, 
        p.name as provider_name, p.display_name as provider_display_name
      FROM model_candidates mc
      LEFT JOIN keys k ON k.id = mc.key_id
      LEFT JOIN channels c ON c.id = k.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE mc.virtual_model_id = ?
      ORDER BY mc.priority ASC, mc.id ASC
    `).all(id) as any[];

    return reply.send({ ok: true, model, candidates });
  });

  // POST /api/admin/virtual-models - 创建
  app.post('/api/admin/virtual-models', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    if (!body.name) {
      return reply.code(400).send({ ok: false, error: 'name 必填' });
    }
    
    const db = getDb();
    const now = Date.now();
    
    try {
      const result = db.prepare(`
        INSERT INTO virtual_models (name, display_name, description, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        body.name.trim(),
        body.display_name || null,
        body.description || null,
        body.enabled !== false ? 1 : 0,
        now,
        now
      );

      const model = db.prepare('SELECT * FROM virtual_models WHERE id = ?').get(result.lastInsertRowid) as any;
      return reply.send({ ok: true, model });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: `模型名 "${body.name}" 已存在` });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // PATCH /api/admin/virtual-models/:id - 更新
  app.patch('/api/admin/virtual-models/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    const db = getDb();
    
    const model = db.prepare('SELECT * FROM virtual_models WHERE id = ?').get(id) as any;
    if (!model) {
      return reply.code(404).send({ ok: false, error: 'Model not found' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(body.display_name);
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(body.description);
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    
    if (fields.length === 0) {
      return reply.code(400).send({ ok: false, error: 'No valid fields to update' });
    }
    
    fields.push('updated_at = ?');
    values.push(Date.now(), id);
    
    try {
      db.prepare(`UPDATE virtual_models SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      const updated = db.prepare('SELECT * FROM virtual_models WHERE id = ?').get(id) as any;
      return reply.send({ ok: true, model: updated });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: `模型名 "${body.name}" 已存在` });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/admin/virtual-models/:id - 删除
  app.delete('/api/admin/virtual-models/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const db = getDb();
    
    const deleted = db.prepare('DELETE FROM virtual_models WHERE id = ?').run(id);
    if (deleted.changes === 0) {
      return reply.code(404).send({ ok: false, error: 'Model not found' });
    }
    return reply.send({ ok: true });
  });

  // POST /api/admin/virtual-models/:id/candidates - 添加候选
  app.post('/api/admin/virtual-models/:id/candidates', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    
    if (!body.key_id || !body.upstream_model) {
      return reply.code(400).send({ ok: false, error: 'key_id 和 upstream_model 必填' });
    }
    
    const db = getDb();
    const model = db.prepare('SELECT * FROM virtual_models WHERE id = ?').get(id) as any;
    if (!model) {
      return reply.code(404).send({ ok: false, error: 'Model not found' });
    }

    const now = Date.now();
    try {
      const result = db.prepare(`
        INSERT INTO model_candidates (virtual_model_id, key_id, upstream_model, priority, weight, enabled, pinned, created_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, ?)
      `).run(
        id,
        body.key_id,
        body.upstream_model,
        body.priority ?? 0,
        body.weight ?? 1,
        now
      );

      const candidate = db.prepare(`
        SELECT mc.*, k.label as key_label, k.status as key_status,
          p.name as provider_name, p.display_name as provider_display_name
        FROM model_candidates mc
        LEFT JOIN keys k ON k.id = mc.key_id
        LEFT JOIN channels c ON c.id = k.channel_id
        LEFT JOIN providers p ON p.id = c.provider_id
        WHERE mc.id = ?
      `).get(result.lastInsertRowid) as any;

      return reply.send({ ok: true, candidate });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: '该候选已存在' });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // PATCH /api/admin/model-candidates/:id - 更新候选
  app.patch('/api/admin/model-candidates/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    const db = getDb();
    
    const candidate = db.prepare('SELECT * FROM model_candidates WHERE id = ?').get(id) as any;
    if (!candidate) {
      return reply.code(404).send({ ok: false, error: 'Candidate not found' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    
    if (body.upstream_model !== undefined) {
      fields.push('upstream_model = ?');
      values.push(body.upstream_model);
    }
    if (body.priority !== undefined) {
      fields.push('priority = ?');
      values.push(body.priority);
    }
    if (body.weight !== undefined) {
      fields.push('weight = ?');
      values.push(body.weight);
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (body.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(body.pinned ? 1 : 0);
    }
    
    if (fields.length === 0) {
      return reply.code(400).send({ ok: false, error: 'No valid fields to update' });
    }
    
    db.prepare(`UPDATE model_candidates SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
    
    const updated = db.prepare(`
      SELECT mc.*, k.label as key_label, k.status as key_status,
        p.name as provider_name, p.display_name as provider_display_name
      FROM model_candidates mc
      LEFT JOIN keys k ON k.id = mc.key_id
      LEFT JOIN channels c ON c.id = k.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE mc.id = ?
    `).get(id) as any;

    return reply.send({ ok: true, candidate: updated });
  });

  // DELETE /api/admin/model-candidates/:id - 删除候选
  app.delete('/api/admin/model-candidates/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const db = getDb();
    
    const deleted = db.prepare('DELETE FROM model_candidates WHERE id = ?').run(id);
    if (deleted.changes === 0) {
      return reply.code(404).send({ ok: false, error: 'Candidate not found' });
    }
    return reply.send({ ok: true });
  });

  // GET /api/admin/virtual-models/available-keys - 获取可用的 key 列表 (用于添加候选)
  app.get('/api/admin/virtual-models/available-keys', { preHandler: requireAdmin }, async (_req, reply) => {
    const keys = listKeys().filter(k => k.enabled === 1 && k.status !== 'failed');
    return reply.send({ ok: true, keys });
  });
}