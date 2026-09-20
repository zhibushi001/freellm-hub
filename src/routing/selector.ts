/**
 * Key / Candidate 选择器
 *
 * Phase 2 范围:
 *   - 同 Channel 多 Key 选择 (KeyPoolSelector)
 *   - 跨 Channel 候选选择 (CandidateSelector) - 通过 model_candidates 表
 *   - 自动从 discovered_models 推断候选 (Phase 2.4 简化, 让用户确认/调整)
 *
 * Phase 3 起会引入 VirtualModel 完全手动管理
 */
import {getDb} from '../db/connection.js'
import {listKeys} from '../db/repos/keys.js'
import {getAllActiveCooldownsForKey, isKeyOnCooldown} from '../db/repos/cooldowns.js'
import {getAllSettings} from '../db/repos/settings.js'
import {rankCandidates, type ScoringInput, type RoutingStrategy, DEFAULT_STRATEGY} from './scorer.js'

export interface PoolResult {
  available: Array<{ key: any; score: number }>;
  unavailable: Array<{ key: any; reason: string; score: number }>;
}

/**
 * 读取当前路由策略 (从 settings 表)
 */
function getRoutingStrategy(): RoutingStrategy {
  const settings = getAllSettings();
  const raw = settings['routing_strategy'] ?? DEFAULT_STRATEGY;
  if (raw === 'priority' || raw === 'balanced' || raw === 'smartest' || raw === 'fastest' || raw === 'reliable') {
    return raw;
  }
  return DEFAULT_STRATEGY;
}

/**
 * 同 Channel 多 Key 选择
 * 给定 provider_id + channel_label, 列出该 Channel 下所有 key, 按 score 排序
 */
export function selectKeyPool(providerId: number, upstreamModel: string | null, withinChannelId?: number): PoolResult {
  const all = listKeys().filter(k => k.provider_id === providerId && (withinChannelId == null || k.channel_id === withinChannelId));
  return rankPool(all, upstreamModel);
}

/**
 * 跨 Channel 候选选择
 * 给定 model 名, 找所有声称支持该 model 的 (key, upstream_model) 对, 按 score 排序
 */
export function selectCandidatePool(upstreamModel: string): PoolResult {
  // Phase 2 简化: 任何 enabled key 都可能支持该 model
  // Phase 2.4 会用 model_candidates 表来精确
  // 这里通过 discovered_models 推断
  // 特殊: upstreamModel = '__any__' 返回所有 enabled keys (退化模式, 用于 failover)
  if (upstreamModel === '__any__') {
    return rankPool(listKeys().filter(k => k.enabled === 1), null);
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT k.*, p.id as provider_id, p.name as provider_name,
              p.base_url as provider_base_url, p.api_path as provider_api_path,
              p.models_path as provider_models_path, p.protocol as provider_protocol,
              ch.label as channel_name, dm.upstream_id
       FROM discovered_models dm
       JOIN keys k ON k.id = dm.key_id
       JOIN channels ch ON ch.id = k.channel_id
       JOIN providers p ON p.id = ch.provider_id
       WHERE dm.upstream_id = ? AND k.enabled = 1`,
    )
    .all(upstreamModel) as any[];

  if (rows.length === 0) {
    // 没有精确候选 (没 discovered), 退化为 "任何 enabled key"
    return rankPool(listKeys().filter(k => k.enabled === 1), upstreamModel);
  }
  // 有精确候选, 但如果全部 cooldown/failed (rankPool 会标 available=false),
  // 也退化到 "任何 enabled key" - 让 mock 等 fallback 接管
  const exactPool = rankPool(rows, upstreamModel);
  if (exactPool.available.length === 0) {
    return rankPool(listKeys().filter(k => k.enabled === 1), upstreamModel);
  }
  return exactPool;
}

/**
 * 把 keys 列表转成 PoolResult
 */
function rankPool(keys: any[], upstreamModel: string | null): PoolResult {
  const strategy = getRoutingStrategy();
  const inputs: ScoringInput[] = keys.map((k, idx) => {
    const cd = upstreamModel ? isKeyOnCooldown(k.id, upstreamModel) : { onCooldown: false };
    const cds = getAllActiveCooldownsForKey(k.id);
    // 仅用户主动禁用才排除 — 失败/冷却/配额耗尽仍留在池中，靠评分降权
    // 这样失败 Key 可以自动恢复
    const isUserDisabled = k.enabled !== 1 || k.status === 'disabled';
    // 字段归一: selectCandidatePool 走 JOIN 用 alias (provider_base_url), listKeys() 直接拿 (base_url)
    // 统一映射成 key.base_url / key.api_path 给 tryOnce / buildUpstreamUrl 用
    if (k.provider_base_url) k.base_url = k.provider_base_url;
    if (k.provider_api_path) k.api_path = k.provider_api_path;
    return {
      key_id: k.id,
      enabled: k.enabled,
      status: k.status,
      avg_latency_ms: k.avg_latency_ms,
      success_count: k.success_count,
      failure_count: k.failure_count,
      rank_in_candidates: idx,
      weight: k.weight ?? 1,
      recent_usage_ratio: 0,  // Phase 2.6 接上
      remaining_quota_ratio: 1, // Phase 2.6 接上
      available: isUserDisabled ? 0 : 1,
      cooldown_remaining_sec: cds.length > 0 ? Math.ceil((cds[0].expires_at - Date.now()) / 1000) : undefined,
    };
  });
  const results = rankCandidates(inputs, strategy);
  const available: any[] = [];
  const unavailable: any[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const k = keys[i];
    if (r.available) available.push({ key: k, score: r.score });
    else unavailable.push({ key: k, reason: r.reason ?? 'unavailable', score: r.score });
  }
  return { available, unavailable };
}

/**
 * Failover: 从 ranking 中选下一个可用 key
 * 配合 chatService 的重试循环
 */
export function pickNext(pool: PoolResult): { key: any; score: number } | null {
  return pool.available[0] ?? null;
}
