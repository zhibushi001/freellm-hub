/**
 * 多媒体异步任务 repo
 * 视频生成是异步的 (MiniMax / Agnes 返回 task_id)，本表持久化任务状态，
 * 供 GET /v1/videos/tasks/:taskId 轮询读取 + 刷新。
 */
import { getDb } from '../connection.js';

export interface MediaTask {
  id: string;
  provider: string;
  model: string;
  type: 'video' | 'video_edit';
  hub_key_id: number | null;
  channel_key_id: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result: { url?: string; duration?: number; [k: string]: unknown } | null;
  error: { message: string; code?: string } | null;
  created_at: number;
  updated_at: number;
}

export function createMediaTask(input: {
  id: string;
  provider: string;
  model: string;
  type: 'video' | 'video_edit';
  hub_key_id?: number | null;
  channel_key_id?: number | null;
  status?: MediaTask['status'];
  result?: MediaTask['result'];
  error?: MediaTask['error'];
}): MediaTask {
  const now = Date.now();
  getDb().prepare(
    `INSERT OR REPLACE INTO media_tasks
       (id, provider, model, type, hub_key_id, channel_key_id, status, result, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.provider,
    input.model,
    input.type,
    input.hub_key_id ?? null,
    input.channel_key_id ?? null,
    input.status ?? 'pending',
    input.result ? JSON.stringify(input.result) : null,
    input.error ? JSON.stringify(input.error) : null,
    now,
    now,
  );
  return getMediaTask(input.id)!;
}

export function getMediaTask(id: string): MediaTask | null {
  const row = getDb().prepare('SELECT * FROM media_tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    provider: row.provider as string,
    model: row.model as string,
    type: row.type as 'video' | 'video_edit',
    hub_key_id: (row.hub_key_id as number | null) ?? null,
    channel_key_id: (row.channel_key_id as number | null) ?? null,
    status: row.status as MediaTask['status'],
    result: row.result ? (JSON.parse(row.result as string) as MediaTask['result']) : null,
    error: row.error ? (JSON.parse(row.error as string) as MediaTask['error']) : null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

export function updateMediaTask(
  id: string,
  patch: Partial<Pick<MediaTask, 'status' | 'result' | 'error'>>,
): MediaTask | null {
  const cur = getMediaTask(id);
  if (!cur) return null;
  const next = {
    status: patch.status ?? cur.status,
    result: patch.result !== undefined ? patch.result : cur.result,
    error: patch.error !== undefined ? patch.error : cur.error,
  };
  getDb().prepare(
    `UPDATE media_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?`,
  ).run(
    next.status,
    next.result ? JSON.stringify(next.result) : null,
    next.error ? JSON.stringify(next.error) : null,
    Date.now(),
    id,
  );
  return getMediaTask(id);
}
