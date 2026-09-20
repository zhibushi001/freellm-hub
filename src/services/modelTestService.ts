/**
 * 模型测试服务 - 批量测试已发现的模型是否真正可用
 */
import { listKeysByChannel, getDecryptedApiKey } from '../db/repos/keys.js';
import { getDiscoveredModelsForKey, bulkUpdateModelTestResults } from '../db/repos/discoveredModels.js';
import { listChannels } from '../db/repos/channels.js';
import { logger } from '../util/logger.js';

export interface ModelTestResult {
  key_id: number;
  key_label: string | null;
  upstream_id: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
}

export interface ChannelModelTestResult {
  channel_id: number;
  channel_label: string;
  results: ModelTestResult[];
  summary: {
    total: number;
    ok: number;
    error: number;
    untested: number;
  };
}

/**
 * 根据模型名判断模型类型，返回对应的端点和请求体
 */
function resolveTestEndpoint(modelName: string, baseUrl: string, apiPath: string): {
  url: string;
  body: any;
} {
  const m = modelName.toLowerCase();
  const base = baseUrl.replace(/\/$/, '');
  
  // 视频模型 - 通过 chat 端点检测模型是否存在 (不会实际生成)
  if (m.includes('video')) {
    return {
      url: `${base}${apiPath}`,
      body: { model: modelName, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 },
    };
  }
  
  // 图片模型 - 使用图片生成端点
  if (m.includes('image') || m.includes('draw') || m.includes('flux') || m.includes('sd-') || m.includes('sdxl') || m.includes('stable-diffusion')) {
    // 将 chat/completions 替换为 images/generations
    const imagePath = apiPath.replace('/chat/completions', '/images/generations');
    return {
      url: `${base}${imagePath}`,
      body: { model: modelName, prompt: 'a simple cat', n: 1, size: '1024x1024' },
    };
  }
  
  // Embedding 模型
  if (m.includes('embedding') || m.startsWith('m3e') || m.includes('bge-')) {
    const embedPath = apiPath.replace('/chat/completions', '/embeddings');
    return {
      url: `${base}${embedPath}`,
      body: { model: modelName, input: 'hello world' },
    };
  }
  
  // Rerank 模型
  if (m.includes('rerank')) {
    const rerankPath = apiPath.replace('/chat/completions', '/rerank');
    return {
      url: `${base}${rerankPath}`,
      body: { model: modelName, query: 'test', documents: ['doc1', 'doc2'], top_n: 1 },
    };
  }
  
  // 默认 - Chat completion
  return {
    url: `${base}${apiPath}`,
    body: { model: modelName, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 },
  };
}

/**
 * 测试单个模型是否真正可用
 * 根据模型类型自动选择合适的端点
 */
async function testModel(
  apiKey: string,
  baseUrl: string,
  apiPath: string,
  upstreamModel: string,
): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const endpoint = resolveTestEndpoint(upstreamModel, baseUrl, apiPath);
  
  const url = endpoint.url;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(endpoint.body),
      signal: AbortSignal.timeout(15000),
    });
    const latency_ms = Date.now() - start;

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, latency_ms };
    }

    let errorMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json() as any;
      errorMsg = body?.error?.message || body?.error?.code || body?.message || errorMsg;
    } catch { /* ignore */ }
    
    // 如果返回 "is a video model" 或 "is an image model" 等错误，说明模型存在且可用
    const modelIsAvailable = /is a (video|image|audio) model/i.test(errorMsg);
    if (modelIsAvailable) {
      return { ok: true, latency_ms };
    }
    
    return { ok: false, latency_ms, error: errorMsg };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: e.message };
  }
}

/**
 * 测试某个 Channel 下所有 Key 的所有已发现模型
 */
export async function testChannelModels(channelId: number): Promise<ChannelModelTestResult> {
  const channel = listChannels().find(c => c.id === channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} not found`);
  }

  const keys = listKeysByChannel(channelId);
  const allResults: ModelTestResult[] = [];

  for (const key of keys) {
    if (key.enabled !== 1) continue;

    const apiKey = getDecryptedApiKey(key.id);
    const discoveredModels = getDiscoveredModelsForKey(key.id);
    
    if (discoveredModels.length === 0) {
      // 如果没有 discovered models，尝试探测
      logger.info({ keyId: key.id, channelId }, 'No discovered models, skipping key');
      continue;
    }

    const testResults: Array<{ upstreamId: string; status: 'ok' | 'error'; latencyMs: number; error?: string }> = [];

    for (const model of discoveredModels) {
      const result = await testModel(apiKey, key.base_url, key.api_path, model.upstream_id);
      testResults.push({
        upstreamId: model.upstream_id,
        status: result.ok ? 'ok' : 'error',
        latencyMs: result.latency_ms,
        error: result.error,
      });

      allResults.push({
        key_id: key.id,
        key_label: key.label,
        upstream_id: model.upstream_id,
        ok: result.ok,
        latency_ms: result.latency_ms,
        error: result.error,
      });

      // 小延迟避免限流
      await new Promise(r => setTimeout(r, 100));
    }

    // 批量更新数据库
    bulkUpdateModelTestResults(key.id, testResults);
  }

  const summary = {
    total: allResults.length,
    ok: allResults.filter(r => r.ok).length,
    error: allResults.filter(r => !r.ok).length,
    untested: 0,
  };

  return {
    channel_id: channelId,
    channel_label: channel.label || '',
    results: allResults,
    summary,
  };
}

/**
 * 获取模型的测试状态摘要
 */
export function getChannelModelSummary(channelId: number): {
  total: number;
  ok: number;
  error: number;
  untested: number;
} {
  const keys = listKeysByChannel(channelId);
  let total = 0, ok = 0, error = 0, untested = 0;

  for (const key of keys) {
    if (key.enabled !== 1) continue;
    const models = getDiscoveredModelsForKey(key.id);
    for (const m of models) {
      total++;
      if (m.test_status === 'ok') ok++;
      else if (m.test_status === 'error') error++;
      else untested++;
    }
  }

  return { total, ok, error, untested };
}
