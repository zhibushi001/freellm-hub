/**
 * Cooldown repo
 *
 * 设计依据: freellmapi ratelimit.ts 的 cooldown 机制
 *   - heuristic cooldown: 由 429/网络抖动 触发, 可被探测式早恢复清掉
 *   - authoritative cooldown: 由 provider 显式 Retry-After 或 quota reset 触发, 不可早恢复
 *   - escalation ladder: 连续失败 90s → 5m → 30m → 1h → 1d
 *
 * 我们 Phase 2 简化版: 用一张表存所有 active cooldown
 *   reason: 'rate_limit' | 'quota_exhausted' | 'transient_error' | 'auth' (auth 不入 cooldown, 走 status=failed)
 *   recoverable: 1 表示可被探测恢复, 0 表示必须等时间到
 */
import { getDb } from '../connection.js';

export interface Cooldown {
  id: number;
  key_id: number;
  reason: string;
  upstream_model: string | null;
  recoverable: number;
  started_at: number;
  expires_at: number;
  cleared_at: number | null;
  cleared_reason: string | null;
}

export function setCooldown(input: {
  keyId: number;
  reason: string;
  upstreamModel?: string | null;
  durationMs: number;
  recoverable?: boolean;
  source?: string;  // 'heuristic' | 'authoritative' | 'credit' | 'tier'
}): void {
  const now = Date.now();
  const expires = now + input.durationMs;
  // 同一 key+reason+model 只保留最长的 expires_at (覆盖式)
  getDb()
    .prepare(
      `INSERT INTO cooldowns (key_id, reason, source, upstream_model, recoverable, started_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key_id, reason, upstream_model) DO UPDATE SET
         expires_at = MAX(cooldowns.expires_at, excluded.expires_at),
         recoverable = MAX(cooldowns.recoverable, excluded.recoverable),
         source = excluded.source`,
    )
    .run(
      input.keyId,
      input.reason,
      input.source ?? 'heuristic',
      input.upstreamModel ?? null,
      input.recoverable === false ? 0 : 1,  // 默认 true, 只有显式 false 才 0
      now,
      expires,
    );
}

/**
 * 记录一次 heuristic cooldown hit - 用于 escalation ladder
 * (24h 内 hit 数决定下次 cooldown 时长)
 * AUTOINCREMENT id + idx 避免同毫秒被去重
 */
export function recordCooldownHit(keyId: number, at: number = Date.now()): void {
  getDb()
    .prepare('INSERT INTO cooldown_hits (key_id, hit_at) VALUES (?, ?)')
    .run(keyId, at);
  // 删 24h 之前的
  getDb()
    .prepare('DELETE FROM cooldown_hits WHERE key_id = ? AND hit_at < ?')
    .run(keyId, at - 24 * 60 * 60 * 1000);
}

export function getCooldownHitCount(keyId: number, at: number = Date.now()): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as c FROM cooldown_hits WHERE key_id = ? AND hit_at > ?')
    .get(keyId, at - 24 * 60 * 60 * 1000) as { c: number };
  return row.c;
}

export function clearCooldownHits(keyId: number): void {
  getDb().prepare('DELETE FROM cooldown_hits WHERE key_id = ?').run(keyId);
}

/**
 * 算下次 heuristic cooldown 时长 (ladder)
 * 24h 内 hit 数 → 索引到 ladder
 * 不记录 hit, 只查询 (调用方用 recordCooldownHit 记录)
 */
const LADDER = [2 * 60 * 1000, 10 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const DEFAULT_HEURISTIC_MS = 90_000;

export function getEscalationLadderDuration(keyId: number, at: number = Date.now()): number {
  const hits = getCooldownHitCount(keyId, at);
  if (hits === 0) return DEFAULT_HEURISTIC_MS;
  const idx = Math.min(hits - 1, LADDER.length - 1);
  return LADDER[idx];
}

export function getActiveCooldown(keyId: number, reason: string, upstreamModel?: string | null): Cooldown | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM cooldowns
       WHERE key_id = ? AND reason = ? AND (upstream_model IS ? OR upstream_model = ?)
         AND cleared_at IS NULL AND expires_at > ?
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(keyId, reason, upstreamModel ?? null, upstreamModel ?? null, Date.now());
  return (row as unknown as Cooldown) ?? null;
}

export function getAllActiveCooldownsForKey(keyId: number): Cooldown[] {
  return getDb()
    .prepare(
      `SELECT * FROM cooldowns WHERE key_id = ? AND cleared_at IS NULL AND expires_at > ?`,
    )
    .all(keyId, Date.now()) as unknown as Cooldown[];
}

export function clearCooldown(keyId: number, reason: string, upstreamModel: string | null, clearedReason: string): void {
  getDb()
    .prepare(
      `UPDATE cooldowns SET cleared_at = ?, cleared_reason = ?
       WHERE key_id = ? AND reason = ? AND (upstream_model IS ? OR upstream_model = ?)
         AND cleared_at IS NULL`,
    )
    .run(Date.now(), clearedReason, keyId, reason, upstreamModel, upstreamModel);
}

export function isKeyOnCooldown(keyId: number, upstreamModel?: string | null): { onCooldown: boolean; reason?: string; expiresAt?: number } {
  // 检查模型级 cooldown (最细粒度)
  if (upstreamModel) {
    const cd = getActiveCooldown(keyId, 'rate_limit', upstreamModel);
    if (cd) return { onCooldown: true, reason: `rate_limit(${upstreamModel})`, expiresAt: cd.expires_at };
  }
  // 检查 key 级 cooldown
  const cd = getActiveCooldown(keyId, 'quota_exhausted', null);
  if (cd) return { onCooldown: true, reason: 'quota_exhausted', expiresAt: cd.expires_at };
  return { onCooldown: false };
}

/** 找出可探测的 (heuristic) cooldowns - 用于 cooldown-probe 早恢复 */
export function getProbeableCooldowns(limit: number): Array<Cooldown & { key_provider: string; key_label: string; key_base_url: string; key_api_path: string; key_models_path: string; key_protocol: string; key_enabled: number }> {
  return getDb()
    .prepare(
      `SELECT c.*, p.name as key_provider, k.label as key_label, p.base_url as key_base_url,
              p.api_path as key_api_path, p.models_path as key_models_path, p.protocol as key_protocol, k.enabled as key_enabled
       FROM cooldowns c
       JOIN keys k ON k.id = c.key_id
       JOIN channels ch ON ch.id = k.channel_id
       JOIN providers p ON p.id = ch.provider_id
       WHERE c.cleared_at IS NULL
         AND c.recoverable = 1
         AND c.expires_at > ?
         AND k.enabled = 1
         AND (? - c.started_at) >= (c.expires_at - c.started_at) * 0.5
         AND (c.expires_at - ?) > 60000
       ORDER BY c.expires_at ASC
       LIMIT ?`,
    )
    .all(Date.now(), Date.now(), Date.now(), limit) as any;
}
