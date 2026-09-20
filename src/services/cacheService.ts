/**
 * 响应缓存服务
 * 用于缓存相同的请求结果，减少重复请求
 */
import { getDb } from '../db/connection.js';
import { createHash } from 'node:crypto';

export interface CacheEntry {
  cacheKey: string;
  requestModel: string;
  requestHash: string;
  responseStatus: number;
  responseBody: any;
  upstreamModel?: string;
  providerName?: string;
  keyId?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  lastHitAt?: number;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
}

/**
 * 生成缓存 key
 */
export function generateCacheKey(model: string, messages: any[]): string {
  const hash = createHash('md5');
  hash.update(model);
  hash.update(JSON.stringify(messages));
  return hash.digest('hex');
}

/**
 * 检查缓存配置是否启用
 */
export function isCacheEnabled(): boolean {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'cache_enabled'").get() as any;
  return row?.value === '1' || row?.value === 'true';
}

/**
 * 获取缓存 TTL（秒）
 */
export function getCacheTTL(): number {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'cache_ttl'").get() as any;
  return parseInt(row?.value || '300', 10); // 默认 5 分钟
}

/**
 * 从缓存获取响应
 */
export function getFromCache(cacheKey: string): CacheEntry | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM response_cache WHERE cache_key = ? AND expires_at > ?`
    )
    .get(cacheKey, Date.now());

  if (!row) return null;

  // 更新命中次数
  getDb()
    .prepare(
      `UPDATE response_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?`
    )
    .run(Date.now(), row.id);

  return {
    cacheKey: row.cache_key as string,
    requestModel: row.request_model as string,
    requestHash: row.request_hash as string,
    responseStatus: row.response_status as number,
    responseBody: JSON.parse(row.response_body as string),
    upstreamModel: (row.upstream_model as string | null) ?? undefined,
    providerName: (row.provider_name as string | null) ?? undefined,
    keyId: (row.key_id as number | null) ?? undefined,
    promptTokens: (row.prompt_tokens as number | null) ?? undefined,
    completionTokens: (row.completion_tokens as number | null) ?? undefined,
    totalTokens: (row.total_tokens as number | null) ?? undefined,
    latencyMs: (row.latency_ms as number | null) ?? undefined,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    hitCount: row.hit_count as number,
    lastHitAt: (row.last_hit_at as number | null) ?? undefined,
  };
}

/**
 * 将响应存入缓存
 */
export function setToCache(
  cacheKey: string,
  requestModel: string,
  responseStatus: number,
  responseBody: any,
  options: {
    upstreamModel?: string;
    providerName?: string;
    keyId?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  } = {}
): void {
  const ttl = getCacheTTL();
  const now = Date.now();
  const expiresAt = now + ttl * 1000;
  const requestHash = createHash('md5').update(JSON.stringify(responseBody)).digest('hex');

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO response_cache
       (cache_key, request_model, request_hash, response_status, response_body,
        upstream_model, provider_name, key_id, prompt_tokens, completion_tokens, total_tokens,
        latency_ms, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cacheKey,
      requestModel,
      requestHash,
      responseStatus,
      JSON.stringify(responseBody),
      options.upstreamModel ?? null,
      options.providerName ?? null,
      options.keyId ?? null,
      options.promptTokens ?? 0,
      options.completionTokens ?? 0,
      options.totalTokens ?? 0,
      options.latencyMs ?? 0,
      now,
      expiresAt,
    );
}

/**
 * 清理过期缓存
 */
export function cleanupExpiredCache(): number {
  const result = getDb()
    .prepare("DELETE FROM response_cache WHERE expires_at < ?")
    .run(Date.now());
  return Number(result.changes);
}

/**
 * 获取缓存统计
 */
export function getCacheStats(): CacheStats {
  const totalEntries = getDb()
    .prepare("SELECT COUNT(*) as count FROM response_cache")
    .get() as any;
  const hits = getDb()
    .prepare("SELECT SUM(hit_count) as total FROM response_cache")
    .get() as any;
  const misses = totalEntries.count; // 简化计算
  const hitRate = misses > 0 ? (hits.total || 0) / misses : 0;

  return {
    totalEntries: totalEntries.count || 0,
    hitCount: hits.total || 0,
    missCount: misses,
    hitRate,
  };
}
