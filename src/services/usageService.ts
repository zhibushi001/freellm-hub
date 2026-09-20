/**
 * Usage 日志服务
 * 详见 docs/DESIGN.md §3.1 usage_logs / usage_daily
 */
import { getDb } from '../db/connection.js';

export interface UsageInput {
  hub_key_id?: number | null;
  key_id?: number | null;
  provider_name?: string | null;
  request_model?: string;
  routed_model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  latency_ms?: number;
  status: 'success' | 'error';
  error_code?: number | null;
  error_type?: string | null;
  error_message?: string | null;
  stream: 0 | 1;
  virtual_model_id?: number | null;
  candidate_id?: number | null;
}

export function recordUsage(u: UsageInput): void {
  getDb()
    .prepare(
      `INSERT INTO usage_logs
       (hub_key_id, key_id, provider_name, request_model, routed_model,
        prompt_tokens, completion_tokens, total_tokens,
        latency_ms, status, error_code, error_type, error_message, stream,
        virtual_model_id, candidate_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      u.hub_key_id ?? null,
      u.key_id ?? null,
      u.provider_name ?? null,
      u.request_model ?? null,
      u.routed_model ?? null,
      u.prompt_tokens ?? null,
      u.completion_tokens ?? null,
      u.total_tokens ?? null,
      u.latency_ms ?? null,
      u.status,
      u.error_code ?? null,
      u.error_type ?? null,
      u.error_message ?? null,
      u.stream,
      u.virtual_model_id ?? null,
      u.candidate_id ?? null,
      Date.now(),
    );
}

/** 后台汇总 (Phase 1 MVP 不做定时任务, 留接口给 Phase 5) */
export function aggregateDaily(now: Date = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO usage_daily
         (key_id, day, requests, successes, failures,
          prompt_tokens, completion_tokens, total_tokens, avg_latency_ms)
       SELECT
         key_id,
         ?,
         COUNT(*),
         SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END),
         COALESCE(SUM(prompt_tokens), 0),
         COALESCE(SUM(completion_tokens), 0),
         COALESCE(SUM(total_tokens), 0),
         CAST(AVG(latency_ms) AS INTEGER)
       FROM usage_logs
       WHERE key_id IS NOT NULL
         AND substr(datetime(created_at/1000, 'unixepoch'), 1, 10) = ?
       GROUP BY key_id`,
    )
    .run(day, day);
}
