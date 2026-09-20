/**
 * Key 健康状态机 + Cooldown 集成
 *
 * 状态机:
 *
 *              ┌────────┐
 *              │ unknown│
 *              └───┬────┘
 *                  │ 探测/调用 2xx
 *                  ▼
 *   ┌────────┐  探测失败  ┌────────┐
 *   │ healthy│◄────────►│ failed │
 *   └───┬────┘          └────────┘
 *       │
 *       │ 5xx ──(不改变状态, 重试)
 *       │
 *       │ 429 ──► cooldown (短期, 90s, 可探测恢复)
 *       │ 402 ──► cooldown (长, 24h, 不可探测)
 *       │ 401 ──► failed (永久, 不可自动恢复)
 *       │
 *       ▼
 *   ┌─────────┐
 *   │cooldown │ ──expires──► healthy
 *   └─────────┘    ──probe ok──► healthy
 *
 * Cooldown 是 *cooldowns 表里的行*, 跟 keys.status 解耦:
 *   - keys.status = 'healthy' 表示 enabled+未failed
 *   - 实际"是否可用"还看是否有 active cooldown
 *   - 这设计参考 freellmapi ratelimit.ts
 */
import { updateKey, getKey } from '../db/repos/keys.js';
import {
  setCooldown, isKeyOnCooldown, clearCooldown, getAllActiveCooldownsForKey,
  recordCooldownHit, clearCooldownHits, getEscalationLadderDuration,
} from '../db/repos/cooldowns.js';
import { logger } from '../util/logger.js';

export { recordCooldownHit, clearCooldownHits, getEscalationLadderDuration as getEscalationLadder };

export type KeyStatus =
  | 'healthy'
  | 'failed'
  | 'disabled'
  | 'unknown'
  | 'cooldown'           // 任何 active cooldown 都映射到这里 (探活后自动回 healthy)
  | 'quota_exhausted';   // 402 / insufficient_quota

export interface ProbeResult {
  status: number;
  body?: any;
  error?: string;
}

// Cooldown 时长常量 (ms)
export const COOLDOWN_DURATIONS = {
  RATE_LIMIT: 90 * 1000,            // 90s (heuristic, 可探测恢复)
  TRANSIENT_ERROR: 30 * 1000,        // 30s
  QUOTA_EXHAUSTED: 24 * 60 * 60 * 1000,  // 24h (authoritative)
  AUTH_INVALID: 0,                  // 永久 - 直接 failed, 不入 cooldown
};

/**
 * 根据 HTTP 响应, 更新 key 状态 + 必要时加 cooldown
 */
export function transitionKeyStatus(
  keyId: number,
  result: { status: number; body?: any; error?: string; upstreamModel?: string | null },
): void {
  const key = getKey(keyId);
  if (!key) return;
  if (key.enabled === 0) return;

  // 网络错误
  if (result.status === 0 || result.error) {
    setCooldown({
      keyId,
      reason: 'transient_error',
      upstreamModel: result.upstreamModel ?? null,
      durationMs: COOLDOWN_DURATIONS.TRANSIENT_ERROR,
      recoverable: true,
    });
    return;
  }

  // 401 = 永久失败 (auth invalid) — 但不标 status=failed (cooldown 已足够, status=failed 干扰 failover)
  // status=failed 只在 key 持久被 disable 时 (用户操作) 用
  if (result.status === 401) {
    setCooldown({
      keyId,
      reason: 'auth',
      upstreamModel: null,
      durationMs: 5 * 60 * 1000,  // 5 min heuristic
      recoverable: true,
      source: 'heuristic',
    });
    logger.warn({ keyId }, 'Key 5min cooldown: 401');
    return;
  }

  // 402 / insufficient_quota = 额度耗尽, 24h 长冷却, authoritative
  if (result.status === 402 || isInsufficientQuota(result.body)) {
    setCooldown({
      keyId,
      reason: 'quota',
      upstreamModel: null,  // 整个 key 冷, 不是一个 model
      durationMs: COOLDOWN_DURATIONS.QUOTA_EXHAUSTED,
      recoverable: false,
      source: 'credit',
    });
    updateKey(keyId, { status: 'quota_exhausted', status_reason: '402 / quota_exhausted' });
    logger.warn({ keyId }, 'Key 24h cooldown: quota exhausted');
    return;
  }

  // 429 = 速率限制, 90s 短冷却, heuristic (可探测恢复)
  if (result.status === 429) {
    setCooldown({
      keyId,
      reason: 'rate_limit',
      upstreamModel: result.upstreamModel ?? null,
      durationMs: COOLDOWN_DURATIONS.RATE_LIMIT,
      recoverable: true,
      source: 'heuristic',
    });
    updateKey(keyId, { status: 'cooldown', status_reason: '429 rate_limit' });
    logger.warn({ keyId, model: result.upstreamModel }, 'Key 90s cooldown: 429');
    return;
  }

  // 5xx = 短暂, 30s 冷却
  if (result.status >= 500 && result.status < 600) {
    setCooldown({
      keyId,
      reason: 'transient_error',
      upstreamModel: result.upstreamModel ?? null,
      durationMs: COOLDOWN_DURATIONS.TRANSIENT_ERROR,
      recoverable: true,
      source: 'heuristic',
    });
    return;
  }

  // 2xx = 成功 - 清掉这个 key 的所有 heuristic cooldown, 标 healthy
  if (result.status >= 200 && result.status < 300) {
    if (key.status === 'failed' || key.status === 'unknown') {
      updateKey(keyId, { status: 'healthy', status_reason: null });
    }
    // 成功调用清掉该 model 的 rate_limit cooldown
    if (result.upstreamModel) {
      clearCooldown(keyId, 'rate_limit', result.upstreamModel, 'call_succeeded');
    }
    return;
  }
}

function isInsufficientQuota(body: any): boolean {
  if (!body) return false;
  const msg = JSON.stringify(body).toLowerCase();
  return (
    msg.includes('insufficient_quota') ||
    msg.includes('quota_exceeded') ||
    msg.includes('quota exhausted') ||
    msg.includes('balance insufficient') ||
    msg.includes('credit exhausted')
  );
}

/** Key 是否真的可用 (看 status + cooldown) */
export function isKeyUsable(key: { id: number; enabled: number; status: string }, upstreamModel?: string): boolean {
  if (key.enabled === 0) return false;
  if (key.status === 'failed' || key.status === 'disabled') return false;
  // 检查 cooldown
  const cd = isKeyOnCooldown(key.id, upstreamModel ?? null);
  if (cd.onCooldown) return false;
  return true;
}

/** 手动重置 */
export function resetKeyStatus(keyId: number): void {
  updateKey(keyId, { status: 'healthy', status_reason: null });
  // 清掉所有 cooldown
  const cds = getAllActiveCooldownsForKey(keyId);
  for (const cd of cds) {
    clearCooldown(keyId, cd.reason, cd.upstream_model, 'manual_reset');
  }
}
