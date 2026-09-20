/**
 * Discovered models repo
 */
import { getDb } from '../connection.js';
import { listKeysByChannel } from './keys.js';

export interface DiscoveredModel {
  id: number;
  key_id: number;
  upstream_id: string;
  discovered_at: number;
  test_status?: string | null;  // 'ok' | 'error' | null(未测试)
  test_latency_ms?: number | null;
  test_error?: string | null;
  tested_at?: number | null;
}

export function getDiscoveredModelsForKey(keyId: number): DiscoveredModel[] {
  return getDb()
    .prepare('SELECT * FROM discovered_models WHERE key_id = ? ORDER BY upstream_id')
    .all(keyId) as unknown as DiscoveredModel[];
}

export function getAllDiscoveredModels(): DiscoveredModel[] {
  return getDb()
    .prepare('SELECT * FROM discovered_models ORDER BY upstream_id')
    .all() as unknown as DiscoveredModel[];
}

export function upsertDiscoveredModel(keyId: number, upstreamId: string): void {
  getDb()
    .prepare(
      `INSERT INTO discovered_models (key_id, upstream_id, discovered_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key_id, upstream_id) DO UPDATE SET discovered_at = excluded.discovered_at`,
    )
    .run(keyId, upstreamId, Date.now());
}

export function clearDiscoveredModelsForKey(keyId: number): void {
  getDb().prepare('DELETE FROM discovered_models WHERE key_id = ?').run(keyId);
}

/** 更新模型测试结果 */
export function updateModelTestResult(keyId: number, upstreamId: string, result: {
  status: 'ok' | 'error' | 'skip';
  latencyMs: number;
  error?: string;
}): void {
  getDb()
    .prepare(
      `UPDATE discovered_models 
       SET test_status = ?, test_latency_ms = ?, test_error = ?, tested_at = ?
       WHERE key_id = ? AND upstream_id = ?`,
    )
    .run(result.status, result.latencyMs, result.error ?? null, Date.now(), keyId, upstreamId);
}

/** 批量更新模型测试结果 */
export function bulkUpdateModelTestResults(keyId: number, results: Array<{
  upstreamId: string;
  status: 'ok' | 'error' | 'skip';
  latencyMs: number;
  error?: string;
}>): void {
  const stmt = getDb().prepare(
    `UPDATE discovered_models 
     SET test_status = ?, test_latency_ms = ?, test_error = ?, tested_at = ?
     WHERE key_id = ? AND upstream_id = ?`,
  );
  for (const r of results) {
    stmt.run(r.status, r.latencyMs, r.error ?? null, Date.now(), keyId, r.upstreamId);
  }
}

/** 获取模型的测试结果 */
export function getDiscoveredModelsWithTestResults(keyId: number): DiscoveredModel[] {
  return getDb()
    .prepare('SELECT * FROM discovered_models WHERE key_id = ? ORDER BY upstream_id')
    .all(keyId) as unknown as DiscoveredModel[];
}

/** 删除 key 下所有测试失败的模型 */
export function deleteFailedModelsForKey(keyId: number): number {
  const result = getDb()
    .prepare("DELETE FROM discovered_models WHERE key_id = ? AND test_status = 'error'")
    .run(keyId);
  return Number(result.changes);
}

/** 删除 key 下所有测试失败的模型 (跨 key) */
export function deleteFailedModelsForChannel(channelId: number): number {
  const keys = listKeysByChannel(channelId);
  let totalDeleted = 0;
  for (const key of keys) {
    const result = getDb()
      .prepare("DELETE FROM discovered_models WHERE key_id = ? AND test_status = 'error'")
      .run(key.id);
    totalDeleted += Number(result.changes);
  }
  return totalDeleted;
}

/** 清除 key 下所有模型的测试结果 */
export function clearTestResultsForKey(keyId: number): void {
  getDb()
    .prepare("UPDATE discovered_models SET test_status = NULL, test_latency_ms = NULL, test_error = NULL, tested_at = NULL WHERE key_id = ?")
    .run(keyId);
}
