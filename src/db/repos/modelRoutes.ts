/**
 * Phase 5.E: Model routes repo
 * 用户配置 model → channel 列表 (顺序 = failover 顺序)
 */
import { getDb } from '../connection.js';

export interface ModelRoute {
  id: number;
  request_model: string;
  channel_ids: string;       // JSON 数组 string
  enabled: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export function listModelRoutes(): ModelRoute[] {
  return getDb().prepare(`SELECT * FROM model_routes ORDER BY request_model`).all() as unknown as ModelRoute[];
}

export function getModelRoute(id: number): ModelRoute | null {
  const row = getDb().prepare('SELECT * FROM model_routes WHERE id = ?').get(id);
  return (row as unknown as ModelRoute) ?? null;
}

export function getModelRouteByName(requestModel: string): ModelRoute | null {
  const row = getDb().prepare('SELECT * FROM model_routes WHERE request_model = ?').get(requestModel);
  return (row as unknown as ModelRoute) ?? null;
}

export function createModelRoute(input: {
  request_model: string;
  channel_ids: number[];
  enabled?: number;
  notes?: string | null;
}): ModelRoute {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO model_routes (request_model, channel_ids, enabled, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.request_model,
      JSON.stringify(input.channel_ids),
      input.enabled ?? 1,
      input.notes ?? null,
      now,
      now,
    );
  return getModelRoute(Number(info.lastInsertRowid))!;
}

export function updateModelRoute(id: number, patch: {
  request_model?: string;
  channel_ids?: number[];
  enabled?: number;
  notes?: string | null;
}): ModelRoute | null {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.request_model !== undefined) {
    fields.push('request_model = ?');
    values.push(patch.request_model);
  }
  if (patch.channel_ids !== undefined) {
    fields.push('channel_ids = ?');
    values.push(JSON.stringify(patch.channel_ids));
  }
  if (patch.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.notes !== undefined) {
    fields.push('notes = ?');
    values.push(patch.notes);
  }
  if (fields.length === 0) return getModelRoute(id);
  fields.push('updated_at = ?');
  values.push(Date.now(), id);
  getDb().prepare(`UPDATE model_routes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getModelRoute(id);
}

export function deleteModelRoute(id: number): void {
  getDb().prepare('DELETE FROM model_routes WHERE id = ?').run(id);
}
