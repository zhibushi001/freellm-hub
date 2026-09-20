/**
 * Phase 4.C: In-flight 跟踪 + 限流感知路由
 *
 * 跟踪每个 (key, model) 当前 in-flight 请求数, 超过阈值时路由层降权。
 * 解决问题: provider 限制 RPM (request per minute) 时, hub 不感知会触发 429.
 *            已知 RPM 时, 主动限流。
 *
 * 简化版: 单进程内存跟踪 (够用, 多实例需 Redis 共享)
 */

interface InflightKey {
  count: number;
  totalDurationMs: number;
  lastStartedAt: number;
}

const inflight = new Map<string, InflightKey>();

/** key: "{keyId}:{model}" */
function makeKey(keyId: number, model: string): string {
  return `${keyId}:${model}`;
}

export function inflightStart(keyId: number, model: string): void {
  const k = makeKey(keyId, model);
  const v = inflight.get(k) ?? { count: 0, totalDurationMs: 0, lastStartedAt: 0 };
  v.count += 1;
  v.lastStartedAt = Date.now();
  inflight.set(k, v);
}

export function inflightEnd(keyId: number, model: string, durationMs: number): void {
  const k = makeKey(keyId, model);
  const v = inflight.get(k);
  if (!v) return;
  v.count = Math.max(0, v.count - 1);
  v.totalDurationMs += durationMs;
  if (v.count === 0) {
    inflight.delete(k);
  }
}

export function inflightGet(keyId: number, model: string): number {
  return inflight.get(makeKey(keyId, model))?.count ?? 0;
}

export function inflightGetAll(): Array<{ keyId: number; model: string; count: number; lastStartedAt: number }> {
  const out: Array<{ keyId: number; model: string; count: number; lastStartedAt: number }> = [];
  for (const [k, v] of inflight.entries()) {
    const [keyIdStr, ...modelParts] = k.split(':');
    out.push({
      keyId: parseInt(keyIdStr, 10),
      model: modelParts.join(':'),
      count: v.count,
      lastStartedAt: v.lastStartedAt,
    });
  }
  return out;
}

/** 测试用: 清空 */
export function inflightClear(): void {
  inflight.clear();
}

/**
 * 限流权重调整: 同一 (key, model) 已有 N 个 in-flight, 降权 1/(1+N)
 * - 1 in-flight: 0.5 权重
 * - 2 in-flight: 0.33 权重
 * - 3 in-flight: 0.25 权重
 * 返回 weight multiplier (0-1)
 */
export function inflightWeightPenalty(keyId: number, model: string): number {
  const n = inflightGet(keyId, model);
  if (n === 0) return 1.0;
  return 1.0 / (1 + n);
}
