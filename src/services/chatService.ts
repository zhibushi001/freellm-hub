/**
 * Chat 服务 - 封装 failover 引擎，提供 chatCompletion 和 chatStream
 */
import { chatWithFailover, type ChatRequest } from '../routing/failover.js';
import { httpStream } from '../adapters/client.js';
import { getDecryptedApiKey, recordKeyUsage } from '../db/repos/keys.js';
import { resolveModel } from '../routing/resolver.js';
import { selectCandidatePool } from '../routing/selector.js';
import { listKeys } from '../db/repos/keys.js';
import { transitionKeyStatus } from './keyHealth.js';
import { recordUsage } from './usageService.js';
import { inflightStart, inflightEnd } from './inflightTracker.js';
import { buildUpstreamRequest, buildUpstreamUrl } from '../adapters/openai.js';
import {
  type ChatMessage,
  type ChatConversation,
  listConversations,
  getConversation,
  createConversation,
  addMessage,
  updateConversationTitle,
  deleteConversation,
  clearConversationMessages,
  getConversationStats,
} from './conversationService.js';

// 重新导出 conversation 相关类型和函数
export {
  type ChatMessage,
  type ChatConversation,
  listConversations,
  getConversation,
  createConversation,
  addMessage,
  updateConversationTitle,
  deleteConversation,
  clearConversationMessages,
  getConversationStats,
};

export interface ChatResult {
  status: number;
  body: any;
  keyId: number;
  keyName: string;
  upstreamModel: string;
  latencyMs: number;
  attempts?: number;
}

export interface ChatStreamHandle {
  status: number;
  headers: any;
  body: NodeJS.ReadableStream;
  keyId: number;
  keyName: string;
  upstreamModel: string;
  latencyMs: number;
  onStreamEnd?: () => void;
}

export type ChatCompletionResult =
  | ChatResult
  | { error: string; status: number; details?: any; attempts?: number };

/**
 * 非流式 chat - 使用 failover 引擎
 */
export async function chatCompletion(
  req: ChatRequest,
  hubKeyId: number | null,
): Promise<ChatCompletionResult> {
  const r = await chatWithFailover(req, hubKeyId);
  if (!r.ok) {
    return {
      error: errorMessage(r.error),
      status: errorStatus(r.error),
      details: r.error,
      attempts: r.attempts.length,
    };
  }
  const a = r.result;
  return {
    status: a.status,
    body: a.body,
    keyId: a.keyId,
    keyName: a.keyName,
    upstreamModel: a.upstreamModel,
    latencyMs: a.latencyMs,
    attempts: r.attempts.length,
  };
}

function errorMessage(e: any): string {
  switch (e.kind) {
    case 'no_candidates': return '没有可用的 Key/Provider';
    case 'budget_exhausted': return '请求超过 wall-clock budget';
    case 'client_error': return e.message;
    case 'auth_invalid': return '所有 Key 都 401 失败';
    case 'quota_exhausted': return '所有 Key 都额度耗尽';
    case 'rate_limited': return '所有 Key 都触发速率限制';
    case 'upstream_error': return '上游持续错误: ' + e.message;
    default: return '未知错误';
  }
}

function errorStatus(e: any): number {
  switch (e.kind) {
    case 'client_error': return e.status;
    case 'no_candidates': return 404;
    case 'budget_exhausted': return 504;
    case 'auth_invalid': return 502;
    case 'quota_exhausted': return 502;
    case 'rate_limited': return 429;
    case 'upstream_error': return 502;
    default: return 500;
  }
}

/**
 * 流式 chat - 流已开始不切换，选第一个可用 key
 */
export async function chatStream(
  req: ChatRequest,
  hubKeyId: number | null,
): Promise<ChatStreamHandle | { error: string; status: number }> {
  const allKeys = listKeys();
  const resolved = resolveModel(req.model, allKeys);
  if ('error' in resolved) {
    return { error: resolved.error, status: 404 };
  }

  const pool = selectCandidatePool(resolved.upstreamModel);
  const target = pool.available.find(p => p.key.id === resolved.key.id) ?? pool.available[0];
  if (!target) {
    return { error: '没有可用的 Key (所有都在 cooldown 或失败)', status: 503 };
  }
  const key = target.key;

  const apiKey = getDecryptedApiKey(key.id);
  const url = buildUpstreamUrl(key);
  const upstreamReq = buildUpstreamRequest(req, resolved.upstreamModel);
  const start = Date.now();
  inflightStart(key.id, resolved.upstreamModel);

  try {
    const res = await httpStream(url, apiKey, {
      method: 'POST',
      body: JSON.stringify({ ...upstreamReq, stream: true }),
      timeoutMs: 0,
    }, key.id);
    const latencyMs = Date.now() - start;
    transitionKeyStatus(key.id, { status: res.status, body: null, upstreamModel: resolved.upstreamModel });
    recordKeyUsage(key.id, res.status >= 200 && res.status < 300, latencyMs);
    recordUsage({
      hub_key_id: hubKeyId,
      key_id: key.id,
      provider_name: key.provider_name,
      request_model: req.model,
      routed_model: resolved.upstreamModel,
      latency_ms: latencyMs,
      status: res.status >= 200 && res.status < 300 ? 'success' : 'error',
      error_code: res.status >= 400 ? res.status : null,
      stream: 1,
    });

    return {
      status: res.status,
      headers: res.headers,
      body: res.body as unknown as NodeJS.ReadableStream,
      keyId: key.id,
      keyName: key.label ?? `key#${key.id}`,
      upstreamModel: resolved.upstreamModel,
      latencyMs,
      onStreamEnd: () => inflightEnd(key.id, resolved.upstreamModel, Date.now() - start),
    };
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    inflightEnd(key.id, resolved.upstreamModel, latencyMs);
    transitionKeyStatus(key.id, { status: 0, error: e.message, upstreamModel: resolved.upstreamModel });
    recordKeyUsage(key.id, false, latencyMs);
    return { error: e.message, status: 502 };
  }
}
