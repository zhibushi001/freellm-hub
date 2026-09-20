/**
 * Key / Candidate 评分公式 — 凸组合版 (借鉴 FreeLLM API scoring.ts)
 *
 * 核心设计:
 *   1. 凸组合评分 — 所有维度归一化到 [0,1]，权重和=1
 *      score = w_rel·reliability + w_speed·speed + w_intel·intelligence
 *   2. Thompson sampling — Beta 后验采样，失败自动降权但不冻结
 *   3. 护栏乘法降权 — 配额/限流用乘法因子，不扣穿
 *
 * 对比旧版加分制:
 *   旧: 1000基础 + 速度+200 + 可靠性+300 + ... (魔法数字)
 *   新: base∈[0,1] × headroomFactor × rateLimitFactor (归一化)
 */

// ── 路由策略 ────────────────────────────────────────────────────────────────

export type RoutingStrategy = 'priority' | 'balanced' | 'smartest' | 'fastest' | 'reliable';

export interface RoutingWeights {
  reliability: number;
  speed: number;
  intelligence: number;
}

/** 4 个内置策略预设 (权重和=1) */
export const BANDIT_PRESETS: Record<Exclude<RoutingStrategy, 'priority'>, RoutingWeights> = {
  /** 均衡: 可靠性主导，速度和智能均分 */
  balanced: { reliability: 0.5, speed: 0.25, intelligence: 0.25 },
  /** 最智能: 智能主导，可靠性仍有实际权重 */
  smartest: { reliability: 0.35, speed: 0.1, intelligence: 0.55 },
  /** 最快: 速度主导，可靠性防止快但坏的模型赢 */
  fastest: { reliability: 0.35, speed: 0.55, intelligence: 0.1 },
  /** 最可靠: 可靠性主导，给"只要能用就行"的场景 */
  reliable: { reliability: 0.7, speed: 0.15, intelligence: 0.15 },
};

export const DEFAULT_STRATEGY: RoutingStrategy = 'balanced';

// ── Thompson sampling: Beta 后验 ──────────────────────────────────────────

/**
 * 从 Beta(1+success, 1+failure) 后验采样。
 * 使用正态近似 (Marsaglia-Tsang 简化版):
 *   mean = α / (α+β)
 *   std  = sqrt(αβ / ((α+β)²·(α+β+1)))
 * 对大样本足够精确，对小样本保留探索性。
 */
export function sampleBetaReliability(successCount: number, failureCount: number): number {
  const alpha = 1 + successCount;   // Beta(1,1) 先验
  const beta = 1 + failureCount;
  const total = alpha + beta;
  const mean = alpha / total;

  // Beta 分布方差: αβ / ((α+β)²·(α+β+1))
  const variance = (alpha * beta) / (total * total * (total + 1));
  const std = Math.sqrt(variance);

  // Box-Muller 变换生成正态样本
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);

  // 截断到 [0.05, 0.95] — 永不把分数推到极端
  const sample = mean + z * std;
  return Math.max(0.05, Math.min(0.95, sample));
}

// ── 维度归一化 ─────────────────────────────────────────────────────────────

/**
 * 速度归一化: 用 sigmoid 映射 avg_latency_ms → [0,1]
 *   300ms  → ~0.88 (快)
 *   1000ms → ~0.50 (中)
 *   3000ms → ~0.11 (慢)
 *   5000ms → ~0.02 (很慢)
 * 无数据时给 0.5 (中间值)
 */
export function normalizeSpeed(avgLatencyMs: number | null): number {
  if (avgLatencyMs == null) return 0.5;
  // sigmoid: midpoint=1000ms, scale=800ms
  const x = (avgLatencyMs - 1000) / 800;
  return 1 / (1 + Math.exp(x));
}

// ── 护栏 (乘法降权) ────────────────────────────────────────────────────────

/**
 * 配额护栏: 剩余配额 < 20% 开始降权
 *   ratio >= 0.2 → 1.0 (无惩罚)
 *   ratio < 0.2  → 线性降权，到 0 时保留 0.1
 * 乘法降权，永不把分数压到 0
 */
export function headroomFactor(remainingQuotaRatio: number): number {
  if (remainingQuotaRatio >= 0.2) return 1.0;
  // 线性从 1.0 降到 0.1
  return 0.1 + (remainingQuotaRatio / 0.2) * 0.9;
}

/**
 * 限流护栏: 根据连续失败次数降权
 *   0 次 → 1.0 (无惩罚)
 *   1 次 → 0.9
 *   2 次 → 0.8
 *   3 次 → 0.7
 *   4+次 → 0.4 (最低保留)
 * 成功一次后 failure_count 归零，自动恢复
 */
export function rateLimitFactor(failureCount: number): number {
  if (failureCount === 0) return 1.0;
  return Math.max(0.4, 1.0 - failureCount * 0.1);
}

// ── 评分输入 / 输出 ────────────────────────────────────────────────────────

export interface ScoringInput {
  key_id: number;
  enabled: number;
  status: string;
  avg_latency_ms: number | null;
  success_count: number;
  failure_count: number;
  /** 用户拖拽排序, 0 = 第一 */
  rank_in_candidates: number;
  /** 用户权重 */
  weight: number;
  /** 最近 1h token 消耗比例 (0~1), 用于 freshness */
  recent_usage_ratio: number;
  /** 估算的剩余配额比例 (0~1, 1=满, 0=光) */
  remaining_quota_ratio: number;
  /** 1 = 用户启用, 0 = 用户禁用 */
  available: number;
  /** cooldown 剩余秒数 (用于日志) */
  cooldown_remaining_sec?: number;
}

export interface ScoringResult {
  key_id: number;
  score: number;
  available: boolean;
  reason?: string;
}

// ── 评分主函数 ─────────────────────────────────────────────────────────────

/**
 * 凸组合评分 + 护栏乘法降权
 *
 *   base      = w_rel·reliability + w_speed·speed + w_intel·intelligence  (∈[0,1])
 *   effective = base × headroomFactor × rateLimitFactor                    (∈[0,1])
 */
export function score(s: ScoringInput, weights: RoutingWeights): ScoringResult {
  // 硬排除: 仅用户主动禁用才不可用
  if (s.enabled === 0) {
    return { key_id: s.key_id, score: -Infinity, available: false, reason: 'disabled' };
  }
  if (s.status === 'disabled') {
    return { key_id: s.key_id, score: -Infinity, available: false, reason: 'disabled' };
  }

  // 计算各维度 [0,1]
  const reliability = sampleBetaReliability(s.success_count, s.failure_count);
  const speed = normalizeSpeed(s.avg_latency_ms);
  // 智能维度: 暂无数据，给中性值 0.5 (未来接 benchmark)
  const intelligence = 0.5;

  // 凸组合 (权重自动归一化)
  const wSum = weights.reliability + weights.speed + weights.intelligence || 1;
  const base =
    (weights.reliability * reliability +
      weights.speed * speed +
      weights.intelligence * intelligence) / wSum;

  // 护栏乘法降权 (永不压到 0)
  const headroom = headroomFactor(s.remaining_quota_ratio);
  const rateLimit = rateLimitFactor(s.failure_count);

  // 最终分数
  const effective = base * headroom * rateLimit;

  return { key_id: s.key_id, score: effective, available: true };
}

// ── 批量评分 + 排序 ───────────────────────────────────────────────────────

/**
 * 批量评分 + 排序 + 可用过滤
 *
 * @param strategy 路由策略，'priority' 走旧版手动排序，其他走凸组合评分
 */
export function rankCandidates(
  inputs: ScoringInput[],
  strategy: RoutingStrategy = DEFAULT_STRATEGY,
): ScoringResult[] {
  // 'priority' 策略: 按用户手动排序的优先级排列
  if (strategy === 'priority') {
    // 用 balanced 权重算分 (但排序按 rank_in_candidates)
    const results = inputs.map(s => score(s, BANDIT_PRESETS.balanced));
    results.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      const idxA = inputs.find(i => i.key_id === a.key_id)?.rank_in_candidates ?? 999;
      const idxB = inputs.find(i => i.key_id === b.key_id)?.rank_in_candidates ?? 999;
      if (idxA !== idxB) return idxA - idxB;
      return a.key_id - b.key_id;
    });
    return results;
  }

  // 其他策略: 凸组合评分
  const weights = BANDIT_PRESETS[strategy];
  const results = inputs.map(s => score(s, weights));
  results.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.score === b.score) return a.key_id - b.key_id;
    return b.score - a.score;
  });
  return results;
}
