/**
 * 请求尝试追踪服务
 * 用于追踪每次请求的尝试详情（包括失败重试）
 */
import { getDb } from '../db/connection.js';

export interface RequestAttempt {
  id: number;
  requestId: number;
  attemptNumber: number;
  keyId: number | null;
  providerName: string | null;
  upstreamModel: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  isSuccess: boolean;
  createdAt: number;
}

export interface RequestAttemptsSummary {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  attempts: RequestAttempt[];
}

/**
 * 记录请求尝试
 */
export function recordRequestAttempt(
  requestId: number,
  attemptNumber: number,
  details: {
    keyId?: number | null;
    providerName?: string | null;
    upstreamModel?: string | null;
    statusCode?: number | null;
    latencyMs?: number | null;
    errorMessage?: string | null;
    isSuccess?: boolean;
  } = {}
): number {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO request_attempts
       (request_id, attempt_number, key_id, provider_name, upstream_model,
        status_code, latency_ms, error_message, is_success, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      requestId,
      attemptNumber,
      details.keyId ?? null,
      details.providerName ?? null,
      details.upstreamModel ?? null,
      details.statusCode ?? null,
      details.latencyMs ?? null,
      details.errorMessage ?? null,
      details.isSuccess ? 1 : 0,
      now,
    );
  return result.lastInsertRowid as number;
}

/**
 * 获取请求的所有尝试
 */
export function getRequestAttempts(requestId: number): RequestAttempt[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM request_attempts WHERE request_id = ? ORDER BY attempt_number"
    )
    .all(requestId) as any[];
  
  return rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    attemptNumber: row.attempt_number,
    keyId: row.key_id,
    providerName: row.provider_name,
    upstreamModel: row.upstream_model,
    statusCode: row.status_code,
    latencyMs: row.latency_ms,
    errorMessage: row.error_message,
    isSuccess: row.is_success === 1,
    createdAt: row.created_at,
  }));
}

/**
 * 获取请求尝试摘要
 */
export function getRequestAttemptsSummary(requestId: number): RequestAttemptsSummary {
  const attempts = getRequestAttempts(requestId);
  
  if (attempts.length === 0) {
    return {
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      attempts: [],
    };
  }
  
  const successCount = attempts.filter((a) => a.isSuccess).length;
  const failureCount = attempts.length - successCount;
  const latencies = attempts.map((a) => a.latencyMs || 0);
  const avgLatencyMs = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
  const maxLatencyMs = Math.max(...latencies);
  
  return {
    totalAttempts: attempts.length,
    successCount,
    failureCount,
    avgLatencyMs,
    maxLatencyMs,
    attempts,
  };
}

/**
 * 获取请求追踪统计
 */
export function getRequestTrackingStats(): {
  totalRequests: number;
  totalAttempts: number;
  successRate: number;
  avgAttemptsPerRequest: number;
} {
  const totalRequests = getDb()
    .prepare("SELECT COUNT(*) as count FROM usage_logs")
    .get() as any;
  
  const totalAttempts = getDb()
    .prepare("SELECT COUNT(*) as count FROM request_attempts")
    .get() as any;
  
  const successAttempts = getDb()
    .prepare("SELECT COUNT(*) as count FROM request_attempts WHERE is_success = 1")
    .get() as any;
  
  const totalAttemptsCount = totalAttempts.count || 0;
  const successAttemptsCount = successAttempts.count || 0;
  
  return {
    totalRequests: totalRequests.count || 0,
    totalAttempts: totalAttemptsCount,
    successRate: totalAttemptsCount > 0 ? successAttemptsCount / totalAttemptsCount : 0,
    avgAttemptsPerRequest: totalRequests.count > 0 ? totalAttemptsCount / totalRequests.count : 0,
  };
}
