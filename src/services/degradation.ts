/**
 * 全局降级状态机
 *
 * 设计依据: freellmapi degradation.ts (#904)
 * 当健康 provider 比例 < 阈值持续一段时间, 进入降级模式:
 *   - 跳过探索 (Thompson sampling)
 *   - 路由器只走已确认健康的 provider
 *   - 出口: 健康比例持续高于阈值一段时间, 退出降级
 *
 * Phase 2 我们没上 bandit, 所以"跳过探索"对我们没意义
 * 我们的降级模式影响:
 *   - 评分里禁用 freshness bonus (不主动给新 key 机会)
 *   - 选择器只走已 'healthy' 状态的 key, 'unknown' 视为不可用
 *   - 在 health 端点报告状态
 *
 * 阈值通过环境变量:
 *   DEGRADED_HEALTHY_RATIO (默认 0.5)
 *   DEGRADED_MIN_PROVIDERS (默认 3, 太少不做降级判定)
 *   DEGRADED_ENTRY_GRACE_MS (默认 60_000)
 *   DEGRADED_EXIT_GRACE_MS (默认 120_000)
 */
import { getDb } from '../db/connection.js';
import { logger } from '../util/logger.js';

export type DegradationState = 'normal' | 'degraded';

export interface HealthSnapshot {
  totalKeys: number;
  healthyKeys: number;
  failedKeys: number;
  cooldownKeys: number;
  disabledKeys: number;
  ratio: number;  // healthyKeys / (totalKeys - disabledKeys)
}

export interface DegradationStatus extends HealthSnapshot {
  state: DegradationState;
  degradedAt: number | null;
  enteredAt: number | null;
}

const _HEALTHY_STATUSES = new Set(['healthy']);

function positiveEnv(raw: string | undefined, fallback: number): number {
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

const DEGRADED_HEALTHY_RATIO = positiveEnv(process.env.DEGRADED_HEALTHY_RATIO, 0.5);
const DEGRADED_MIN_PROVIDERS = positiveEnv(process.env.DEGRADED_MIN_PROVIDERS, 3);
const DEGRADED_ENTRY_GRACE_MS = positiveEnv(process.env.DEGRADED_ENTRY_GRACE_MS, 60_000);
const DEGRADED_EXIT_GRACE_MS = positiveEnv(process.env.DEGRADED_EXIT_GRACE_MS, 120_000);

interface State {
  state: DegradationState;
  degradedAt: number | null;
  belowSince: number | null;
  recoveredSince: number | null;
}

const state: State = {
  state: 'normal',
  degradedAt: null,
  belowSince: null,
  recoveredSince: null,
};

let lastSnapshot: HealthSnapshot | null = null;

export function computeHealthSnapshot(): HealthSnapshot {
  const db = getDb();
  const totalRow = db.prepare('SELECT COUNT(*) as c FROM keys').get() as { c: number };
  const enabledRow = db.prepare('SELECT COUNT(*) as c FROM keys WHERE enabled = 1').get() as { c: number };
  const disabledKeys = totalRow.c - enabledRow.c;
  const statusRows = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('healthy', 'unknown') THEN 1 ELSE 0 END) as usable,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM cooldowns c WHERE c.key_id = keys.id AND c.cleared_at IS NULL AND c.expires_at > ?) THEN 1 ELSE 0 END) as cooldown
    FROM keys WHERE enabled = 1
  `).get(Date.now()) as { usable: number; failed: number; cooldown: number };
  const totalKeys = enabledRow.c;
  const healthyKeys = statusRows.usable ?? 0;
  const failedKeys = statusRows.failed ?? 0;
  const cooldownKeys = statusRows.cooldown ?? 0;
  const ratio = totalKeys === 0 ? 1 : healthyKeys / totalKeys;
  const snap: HealthSnapshot = { totalKeys, healthyKeys, failedKeys, cooldownKeys, disabledKeys, ratio };
  lastSnapshot = snap;
  return snap;
}

export function updateDegradationState(now: number = Date.now()): DegradationStatus {
  const snap = computeHealthSnapshot();
  if (snap.totalKeys < DEGRADED_MIN_PROVIDERS) {
    state.state = 'normal';
    state.degradedAt = null;
    state.belowSince = null;
    state.recoveredSince = null;
    return getDegradationStatus();
  }
  const below = snap.ratio < DEGRADED_HEALTHY_RATIO;
  if (below) {
    state.recoveredSince = null;
    if (state.state === 'normal') {
      state.belowSince ??= now;
      if (now - state.belowSince >= DEGRADED_ENTRY_GRACE_MS) {
        state.state = 'degraded';
        state.degradedAt = now;
        logger.warn({ snap, threshold: DEGRADED_HEALTHY_RATIO }, `[Degradation] → degraded: ${snap.healthyKeys}/${snap.totalKeys} healthy`);
      }
    }
  } else {
    state.belowSince = null;
    if (state.state === 'degraded') {
      state.recoveredSince ??= now;
      if (now - state.recoveredSince >= DEGRADED_EXIT_GRACE_MS) {
        state.state = 'normal';
        state.degradedAt = null;
        logger.info({ snap, threshold: DEGRADED_HEALTHY_RATIO }, `[Degradation] → normal: ${snap.healthyKeys}/${snap.totalKeys} healthy`);
      }
    } else {
      state.recoveredSince = null;
    }
  }
  return getDegradationStatus();
}

export function isDegraded(): boolean {
  return state.state === 'degraded';
}

export function getDegradationStatus(): DegradationStatus {
  const snap = lastSnapshot ?? computeHealthSnapshot();
  return { ...snap, state: state.state, degradedAt: state.degradedAt, enteredAt: state.state === 'degraded' ? state.degradedAt : null };
}

export function resetDegradationState(): void {
  state.state = 'normal';
  state.degradedAt = null;
  state.belowSince = null;
  state.recoveredSince = null;
  lastSnapshot = null;
}

export const DEGRADATION_CONFIG = {
  HEALTHY_RATIO: DEGRADED_HEALTHY_RATIO,
  MIN_PROVIDERS: DEGRADED_MIN_PROVIDERS,
  ENTRY_GRACE_MS: DEGRADED_ENTRY_GRACE_MS,
  EXIT_GRACE_MS: DEGRADED_EXIT_GRACE_MS,
};
