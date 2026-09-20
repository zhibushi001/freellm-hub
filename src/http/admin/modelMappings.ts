/**
 * Admin 模型映射管理路由
 */
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/connection.js';

export async function registerModelMappingAdminRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!(req.session as any).adminId) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  // GET /api/admin/model-mappings - 列表
  app.get('/api/admin/model-mappings', { preHandler: requireAdmin }, async (_req, reply) => {
    const db = getDb();
    const mappings = db.prepare('SELECT * FROM model_mappings ORDER BY from_model').all() as any[];
    return reply.send({ ok: true, mappings });
  });

  // POST /api/admin/model-mappings - 创建
  app.post('/api/admin/model-mappings', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any;
    if (!body.from_model || !body.to_model) {
      return reply.code(400).send({ ok: false, error: 'from_model 和 to_model 必填' });
    }
    
    const db = getDb();
    const now = Date.now();
    
    try {
      const result = db.prepare(`
        INSERT INTO model_mappings (from_model, to_model, enabled, created_at)
        VALUES (?, ?, ?, ?)
      `).run(
        body.from_model.trim(),
        body.to_model.trim(),
        body.enabled !== false ? 1 : 0,
        now
      );

      const mapping = db.prepare('SELECT * FROM model_mappings WHERE id = ?').get(result.lastInsertRowid) as any;
      return reply.send({ ok: true, mapping });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: `模型名 "${body.from_model}" 已存在映射` });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // PATCH /api/admin/model-mappings/:id - 更新
  app.patch('/api/admin/model-mappings/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const body = req.body as any;
    const db = getDb();
    
    const mapping = db.prepare('SELECT * FROM model_mappings WHERE id = ?').get(id) as any;
    if (!mapping) {
      return reply.code(404).send({ ok: false, error: 'Mapping not found' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    
    if (body.from_model !== undefined) {
      fields.push('from_model = ?');
      values.push(body.from_model.trim());
    }
    if (body.to_model !== undefined) {
      fields.push('to_model = ?');
      values.push(body.to_model.trim());
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    
    if (fields.length === 0) {
      return reply.code(400).send({ ok: false, error: 'No valid fields to update' });
    }
    
    try {
      db.prepare(`UPDATE model_mappings SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
      const updated = db.prepare('SELECT * FROM model_mappings WHERE id = ?').get(id) as any;
      return reply.send({ ok: true, mapping: updated });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ ok: false, error: `模型名 "${body.from_model}" 已存在映射` });
      }
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/admin/model-mappings/:id - 删除
  app.delete('/api/admin/model-mappings/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const db = getDb();
    
    const deleted = db.prepare('DELETE FROM model_mappings WHERE id = ?').run(id);
    if (deleted.changes === 0) {
      return reply.code(404).send({ ok: false, error: 'Mapping not found' });
    }
    return reply.send({ ok: true });
  });

  // GET /api/admin/model-mappings/preview - 预览映射效果
  app.get('/api/admin/model-mappings/preview', { preHandler: requireAdmin }, async (req, reply) => {
    const target = (req.query as any).model || '';
    const db = getDb();
    
    // 查找直接映射
    const mapping = db.prepare('SELECT * FROM model_mappings WHERE from_model = ? AND enabled = 1').get(target) as any;
    
    if (!mapping) {
      return reply.send({ ok: true, original: target, mapped: null });
    }
    
    // 递归查找映射链
    let current = mapping.to_model;
    const chain = [target];
    const visited = new Set([target]);
    
    while (true) {
      if (visited.has(current)) {
        // 循环引用
        return reply.send({ ok: false, error: `映射循环: ${chain.join(' → ')}`, chain });
      }
      visited.add(current);
      chain.push(current);
      
      const next = db.prepare('SELECT * FROM model_mappings WHERE from_model = ? AND enabled = 1').get(current) as any;
      if (!next) break;
      current = next.to_model;
    }
    
    return reply.send({ ok: true, original: target, mapped: current, chain });
  });
}