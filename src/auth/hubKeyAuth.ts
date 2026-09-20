/**
 * Hub Key 鉴权中间件
 * 从 Authorization: Bearer fh_... 提取并验证
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getHubKeyByHash, recordHubKeyUsage, parseAllowedModels } from '../db/repos/hubKeys.js';

declare module 'fastify' {
  interface FastifyRequest {
    hubKey?: {
      id: number;
      name: string;
      prefix: string;
      /** null = 不限制; 数组 = 只允许调用列表中的模型 */
      allowed_models: string[] | null;
    };
  }
}

export interface AuthFailure {
  code: string;
  message: string;
}

/**
 * 判断 Hub Key 是否允许调用指定模型
 * - allowed_models 为 null: 不限制, 允许
 * - 否则 model 必须精确出现在列表中
 */
export function isHubKeyAllowedForModel(hubKey: NonNullable<FastifyRequest['hubKey']>, model: string | null | undefined): boolean {
  if (!hubKey.allowed_models || hubKey.allowed_models.length === 0) return true;
  if (!model) return true;
  // 支持 'provider/model' 形式的完整名与纯模型名两种写法
  const requested = model;
  const bare = requested.includes('/') ? requested.split('/').pop()! : requested;
  return hubKey.allowed_models.includes(requested) || hubKey.allowed_models.includes(bare);
}

export function authenticateHubKey(req: FastifyRequest): { ok: true; hubKey: NonNullable<FastifyRequest['hubKey']> } | { ok: false; error: AuthFailure } {
  // 同时支持两种 header:
  //   - Authorization: Bearer fh_<64hex> (OpenAI 风格, 主流)
  //   - x-api-key: fh_<64hex> (Anthropic 风格, Claude Code 默认)
  const auth = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'];
  let plain: string | null = null;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (m) plain = m[1].trim();
  }
  if (!plain && typeof xApiKey === 'string') {
    plain = xApiKey.trim();
  }
  if (!plain) {
    return { ok: false, error: { code: 'hub_key_missing', message: '缺少 Authorization / x-api-key header. 用法: Authorization: Bearer fh_<64hex> 或 x-api-key: fh_<64hex>' } };
  }
  if (!plain.startsWith('fh_') || plain.length !== 67) {
    return { ok: false, error: { code: 'hub_key_invalid', message: 'Hub Key 无效. 请检查是否拼写错误. (期望 fh_<64hex>)' } };
  }
  const key = getHubKeyByHash(plain);
  if (!key) {
    return { ok: false, error: { code: 'hub_key_not_found', message: 'Hub Key 已被删除. 请在 Hub 后台创建新的.' } };
  }
  if (key.enabled === 0) {
    return { ok: false, error: { code: 'hub_key_disabled', message: `Hub Key 已被禁用 (${key.name}). 在 Hub 后台启用.` } };
  }
  if (key.expires_at && key.expires_at < Date.now()) {
    return { ok: false, error: { code: 'hub_key_expired', message: `Hub Key 已过期 (${key.name}). 请在 Hub 后台重新生成.` } };
  }
  // 记录使用
  recordHubKeyUsage(key.id);
  return { ok: true, hubKey: { id: key.id, name: key.name, prefix: key.key_prefix, allowed_models: parseAllowedModels(key.allowed_models) } };
}

/**
 * Fastify preHandler 风格
 */
export async function requireHubKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = authenticateHubKey(req);
  if (!result.ok) {
    return reply.code(401).send({ error: { message: result.error.message, code: result.error.code, type: 'hub_key_error' } });
  }
  req.hubKey = result.hubKey;
}

/**
 * 在 requireHubKey 之后调用: 校验该 Hub Key 是否允许调用 body.model
 * 返回 true = 放行; false = 已发送 403 响应, 调用方应直接 return。
 */
export function requireModelAllowed(req: FastifyRequest, reply: FastifyReply, model: string | null | undefined): boolean {
  const hubKey = req.hubKey;
  if (!hubKey) return false;
  if (isHubKeyAllowedForModel(hubKey, model)) return true;
  reply.code(403).send({
    error: {
      message: `Hub Key '${hubKey.name}' 不允许调用模型 '${model}'。当前允许: ${hubKey.allowed_models!.join(', ')}。请在 Hub 后台的 Hub Keys 页面调整该 Key 的模型权限。`,
      code: 'hub_key_model_forbidden',
      type: 'permission_error',
    },
  });
  return false;
}
