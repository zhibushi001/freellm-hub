/**
 * 模型路由 resolver
 * 详见 docs/DESIGN.md §4.2
 *
 * Phase 1 简化版: 单 Key 直传, 不做候选池/评分
 * Phase 2 起: 加 candidate 池、key 池、failover、冷却
 * Phase 5.E: 加 model_routes 显式路由 (用户配置的 "gpt-4o" → channel_ids 顺序)
 */
import type { KeyWithChannel } from '../db/repos/keys.js';
import { getModelRouteByName } from '../db/repos/modelRoutes.js';
import { getChannel } from '../db/repos/channels.js';

export type ResolveResult =
  | { key: KeyWithChannel; upstreamModel: string }
  | { error: string };

/**
 * 解析 model 字段 → (key, upstreamModel) 对
 *
 * 规则:
 *   'minimax/M3'           → 在 minimax provider 下选第一个可用 key, upstream=M3
 *   'minimax/A1/M3'        → 强制 provider=minimax, key 标签 A1, upstream=M3 (Phase 2)
 *   'M3'                   → 找第一个可用 key, upstream=M3
 *   其他                    → Phase 1 不支持
 *
 * Phase 5.E 增强: 如果有 model_routes 配置, 优先按 route 选 channel,
 *   在该 channel 的 keys 中按 priority/weight 选一个
 */
/**
 * 检查 key 是否可以服务此 upstream model
 * - key.allowed_models 为 null 或 '[]' 或空数组: 不限制
 * - 否则 key.allowed_models JSON 数组必须包含此 model
 */
function isKeyEligibleForModel(key: KeyWithChannel, upstreamModel: string): boolean {
  const raw = key.allowed_models;
  if (!raw) return true;
  let list: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed.filter((m: any) => typeof m === 'string');
  } catch { return true; }
  if (list.length === 0) return true;
  return list.includes(upstreamModel);
}

export function resolveModel(requestModel: string, allKeys: KeyWithChannel[]): ResolveResult {
  if (!requestModel) return { error: 'model 字段必填' };

  const parts = requestModel.split('/').filter(Boolean);

  // 0. Phase 5.E: 显式 model_routes 优先
  // 只对纯 model 名 (1 段) 触发, 避免与 provider/model 形式冲突
  if (parts.length === 1) {
    const route = getModelRouteByName(requestModel);
    if (route && route.enabled === 1) {
      let channelIds: number[] = [];
      try {
        const parsed = JSON.parse(route.channel_ids);
        if (Array.isArray(parsed)) channelIds = parsed.filter((n: any) => Number.isFinite(n));
      } catch { /* intentional empty */ }
      if (channelIds.length > 0) {
        // 按 route 顺序遍历 channel_ids, 找第一个有 enabled key 的
        for (const cid of channelIds) {
          const ch = getChannel(cid);
          if (!ch || !ch.enabled) continue;
          const chKey = allKeys.find((k) => k.channel_id === cid && k.enabled === 1 && k.status !== 'failed' && isKeyEligibleForModel(k, requestModel));
          if (chKey) {
            return { key: chKey, upstreamModel: requestModel };
          }
        }
        return { error: `model_routes 配置的 channel ${channelIds.join(',')} 全无 enabled key` };
      }
      // channel_ids = [] 表示 "走默认 resolver" (fall through)
    }
  }

  // 1. 三段式: provider/key/model (Phase 2 完整支持, Phase 1 部分支持)
  if (parts.length === 3) {
    const [providerName, keyRef, upstream] = parts;
    const candidates = allKeys.filter(
      k => k.provider_name === providerName && k.enabled === 1 && k.status !== 'failed' && isKeyEligibleForModel(k, upstream),
    );
    if (candidates.length === 0) {
      return { error: `Provider '${providerName}' 下没有可用 Key (启用且服务此模型)` };
    }
    // keyRef 可能是 label 或 id
    const target = candidates.find(k =>
      (k.label && slugify(k.label) === slugify(keyRef)) || String(k.id) === keyRef,
    );
    if (!target) {
      return { error: `Provider '${providerName}' 下没有 Key '${keyRef}' (或被模型限制排除)` };
    }
    return { key: target, upstreamModel: upstream };
  }

  // 2. 两段式: provider/model
  if (parts.length === 2) {
    const [providerName, upstream] = parts;
    const candidates = allKeys.filter(
      k => k.provider_name === providerName && k.enabled === 1 && k.status !== 'failed' && isKeyEligibleForModel(k, upstream),
    );
    if (candidates.length === 0) {
      return { error: `Provider '${providerName}' 下没有可用 Key (启用且服务此模型)` };
    }
    // 简单选第一个 (Phase 2 会按 priority/weight 评分)
    return { key: candidates[0], upstreamModel: upstream };
  }

  // 3. 纯 model 名
  const upstream = parts[0];
  const candidates = allKeys.filter(k => k.enabled === 1 && k.status !== 'failed' && isKeyEligibleForModel(k, upstream));
  if (candidates.length === 0) {
    return { error: `没有可用的 Key 服务模型 '${upstream}'` };
  }
  // Phase 1: 简单选第一个
  return { key: candidates[0], upstreamModel: upstream };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}
