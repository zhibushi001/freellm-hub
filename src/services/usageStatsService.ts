/**
 * 用量统计增强服务
 */
import { getDb } from '../db/connection.js';

export interface ModelStats {
  model: string;
  requests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  successes: number;
  failures: number;
  avgLatency: number;
}

export interface ChannelStats {
  channelId: number;
  providerName: string;
  requests: number;
  totalTokens: number;
  successes: number;
  failures: number;
  avgLatency: number;
}

export interface ErrorStats {
  errorCode: number | null;
  errorType: string;
  count: number;
  percentage: number;
}

/**
 * 按模型统计
 */
export function getModelStats(days = 7): ModelStats[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  
  const rows = getDb()
    .prepare(
      `SELECT 
        request_model as model,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failures,
        COALESCE(CAST(AVG(latency_ms) AS INTEGER), 0) as avg_latency
      FROM usage_logs
      WHERE created_at >= ?
        AND request_model IS NOT NULL
      GROUP BY request_model
      ORDER BY requests DESC`
    )
    .all(since) as any[];

  return rows.map(r => ({
    model: r.model,
    requests: r.requests,
    totalTokens: r.total_tokens,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    successes: r.successes,
    failures: r.failures,
    avgLatency: r.avg_latency,
  }));
}

/**
 * 按渠道统计
 */
export function getChannelStats(days = 7): ChannelStats[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  
  const rows = getDb()
    .prepare(
      `SELECT 
        k.channel_id,
        p.name as provider_name,
        COUNT(*) as requests,
        COALESCE(SUM(u.total_tokens), 0) as total_tokens,
        SUM(CASE WHEN u.status = 'success' THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN u.status = 'error' THEN 1 ELSE 0 END) as failures,
        COALESCE(CAST(AVG(u.latency_ms) AS INTEGER), 0) as avg_latency
      FROM usage_logs u
      LEFT JOIN keys k ON u.key_id = k.id
      LEFT JOIN channels c ON k.channel_id = c.id
      LEFT JOIN providers p ON c.provider_id = p.id
      WHERE u.created_at >= ?
        AND u.key_id IS NOT NULL
      GROUP BY k.channel_id
      ORDER BY requests DESC`
    )
    .all(since) as any[];

  return rows.map(r => ({
    channelId: r.channel_id,
    providerName: r.provider_name || 'Unknown',
    requests: r.requests,
    totalTokens: r.total_tokens,
    successes: r.successes,
    failures: r.failures,
    avgLatency: r.avg_latency,
  }));
}

/**
 * 错误统计
 */
export function getErrorStats(days = 7): ErrorStats[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  
  const totalErrors = getDb()
    .prepare("SELECT COUNT(*) as count FROM usage_logs WHERE status = 'error' AND created_at >= ?")
    .get(since) as any;
  
  const rows = getDb()
    .prepare(
      `SELECT 
        error_code,
        COALESCE(error_type, 'unknown') as error_type,
        COUNT(*) as count
      FROM usage_logs
      WHERE status = 'error'
        AND created_at >= ?
      GROUP BY error_code, error_type
      ORDER BY count DESC`
    )
    .all(since) as any[];

  const total = totalErrors.count || 1;
  
  return rows.map(r => ({
    errorCode: r.error_code,
    errorType: r.error_type,
    count: r.count,
    percentage: Math.round((r.count / total) * 100),
  }));
}

/**
 * 总体统计概览
 */
export function getUsageOverview(days = 7) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  
  const total = getDb()
    .prepare("SELECT COUNT(*) as count FROM usage_logs WHERE created_at >= ?")
    .get(since) as any;
  
  const successes = getDb()
    .prepare("SELECT COUNT(*) as count FROM usage_logs WHERE status = 'success' AND created_at >= ?")
    .get(since) as any;
  
  const failures = total.count - successes.count;
  
  const tokens = getDb()
    .prepare(
      `SELECT 
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM usage_logs WHERE created_at >= ?`
    )
    .get(since) as any;
  
  const latency = getDb()
    .prepare(
      `SELECT 
        COALESCE(CAST(AVG(latency_ms) AS INTEGER), 0) as avg_latency,
        COALESCE(CAST(MIN(latency_ms) AS INTEGER), 0) as min_latency,
        COALESCE(CAST(MAX(latency_ms) AS INTEGER), 0) as max_latency
      FROM usage_logs WHERE created_at >= ? AND latency_ms IS NOT NULL`
    )
    .get(since) as any;

  return {
    totalRequests: total.count,
    successes: successes.count,
    failures: failures,
    successRate: total.count > 0 ? Math.round((successes.count / total.count) * 100) : 0,
    totalTokens: tokens.total_tokens,
    promptTokens: tokens.prompt_tokens,
    completionTokens: tokens.completion_tokens,
    avgLatency: latency.avg_latency,
    minLatency: latency.min_latency,
    maxLatency: latency.max_latency,
  };
}
