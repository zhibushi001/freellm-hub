/**
 * OpenAI 协议适配器 (纯透传)
 *
 * Phase 1.3 范围: 接收 OpenAI 格式, 转发给 OpenAI 兼容上游
 * 不做字段转换 (因绝大多数上游也吃 OpenAI 格式)
 *
 * Phase 1.4 起 /v1/models 也会用这个适配器
 */
import type { KeyWithChannel } from '../db/repos/keys.js';

export interface OpenAIChatRequest {
  model: string;
  messages: any[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: any[];
  tool_choice?: any;
  [k: string]: any;
}

/**
 * 把 Hub 解析出的内部路由结果构造成上游请求 body
 * (Phase 1: 改写 model 字段, 其他透传)
 */
export function buildUpstreamRequest(
  clientRequest: OpenAIChatRequest,
  upstreamModel: string,
): OpenAIChatRequest {
  return { ...clientRequest, model: upstreamModel };
}

/**
 * 从 key 算出上游 URL
 */
export function buildUpstreamUrl(key: KeyWithChannel, path?: string): string {
  return `${key.base_url.replace(/\/$/, '')}${path ?? key.api_path}`;
}

export function buildModelsUrl(key: KeyWithChannel): string {
  return `${key.base_url.replace(/\/$/, '')}${key.models_path}`;
}
