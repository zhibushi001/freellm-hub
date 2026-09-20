/**
 * 探测服务
 * - 探 /v1/models 获取 Key 下可用模型列表
 * - 探连接性 (401 等错误状态识别)
 * - 不阻塞调用方 (在 admin 显式触发时调用)
 */
import { listKeys, getDecryptedApiKey, getKey } from '../db/repos/keys.js';
import { httpSend as defaultHttpSend, type HttpResponse } from '../adapters/client.js';
import { transitionKeyStatus } from './keyHealth.js';
import { upsertDiscoveredModel, clearDiscoveredModelsForKey } from '../db/repos/discoveredModels.js';
import { logger } from '../util/logger.js';
import { parseJsonSafe } from '../util/json.js';

export type HttpSendFn = (url: string, apiKey: string | null, opts: any) => Promise<HttpResponse>;

// 允许测试时注入 mock
let httpSendImpl: HttpSendFn = defaultHttpSend;
export function setHttpSendForTest(fn: HttpSendFn) { httpSendImpl = fn; }
export function resetHttpSendForTest() { httpSendImpl = defaultHttpSend; }

export interface ProbeOutcome {
  keyId: number;
  ok: boolean;
  models: string[];
  error?: string;
  latencyMs: number;
}

/**
 * 探测单个 Key
 */
export async function probeKey(keyId: number): Promise<ProbeOutcome> {
  const key = getKey(keyId);
  if (!key) throw new Error(`Key ${keyId} not found`);

  const apiKey = getDecryptedApiKey(keyId);
  const url = `${key.base_url.replace(/\/$/, '')}${key.models_path}`;
  const start = Date.now();

  try {
    const res = await httpSendImpl(url, apiKey, { method: 'GET', timeoutMs: 15000 });
    const latencyMs = Date.now() - start;
    transitionKeyStatus(keyId, { status: res.status, body: parseJsonSafe(res.body) });

    if (res.status < 200 || res.status >= 300) {
      return { keyId, ok: false, models: [], error: `HTTP ${res.status}`, latencyMs };
    }

    const models = parseModelsResponse(res.body);
    // 写入 discovered_models (覆盖)
    clearDiscoveredModelsForKey(keyId);
    for (const m of models) {
      upsertDiscoveredModel(keyId, m);
    }
    logger.info({ keyId, count: models.length, latencyMs }, 'Probe success');
    return { keyId, ok: true, models, latencyMs };
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    transitionKeyStatus(keyId, { status: 0, error: e.message });
    return { keyId, ok: false, models: [], error: e.message, latencyMs };
  }
}

/**
 * 探测所有启用的 Key
 */
export async function probeAllKeys(): Promise<ProbeOutcome[]> {
  const keys = listKeys().filter((k) => k.enabled === 1);
  return Promise.all(keys.map((k) => probeKey(k.id)));
}



/**
 * 解析 OpenAI /v1/models 响应
 * { object: "list", data: [{ id: "gpt-4o", ... }, ...] }
 */
function parseModelsResponse(body: string): string[] {
  const j = parseJsonSafe(body);
  if (!j) return [];
  if (Array.isArray(j.data)) {
    return j.data.map((m: any) => m.id).filter((x: any) => typeof x === 'string');
  }
  if (Array.isArray(j)) {
    return j.map((m: any) => m.id ?? m.name ?? m).filter((x: any) => typeof x === 'string');
  }
  return [];
}
