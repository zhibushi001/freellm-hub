/**
 * Benchmark 服务 - 测速 / 健康评分
 *
 * 用法:
 *  - benchmarkKey(keyId, model?, n=5) 跑 N 个 chat 请求, 统计 latency / tokens / 错误
 *  - benchmarkAll() 测所有 enabled key
 *
 * 输出: {
 *   keyId, model, samples, successes, errors, successRate,
 *   avgLatencyMs, p50LatencyMs, p95LatencyMs,
 *   totalTokens, avgTokensPerRequest,
 *   score: 0-100 综合分
 * }
 */
import {getKey, listKeys, getDecryptedApiKey} from '../db/repos/keys.js'
import { buildUpstreamRequest, buildUpstreamUrl } from '../adapters/openai.js';
import { httpSend } from '../adapters/client.js';

export interface BenchmarkResult {
  keyId: number;
  model: string;
  samples: number;
  successes: number;
  errors: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalTokens: number;
  avgTokensPerRequest: number;
  score: number;  // 0-100
  error?: string;
  perSample: Array<{ ok: boolean; latencyMs: number; errorCode?: number; errorMessage?: string }>;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function scoreFrom(result: { successRate: number; avgLatencyMs: number; p95LatencyMs: number; successes: number }): number {
  if (result.successes === 0) return 0;
  // 权重: success 60% + p95 latency 30% + avg latency 10%
  const sRate = result.successRate;  // 0-1
  const sP95 = Math.max(0, Math.min(1, 1 - result.p95LatencyMs / 10000));  // 0-1, 10s 为 0
  const sAvg = Math.max(0, Math.min(1, 1 - result.avgLatencyMs / 5000));  // 0-1, 5s 为 0
  return Math.round((sRate * 60 + sP95 * 30 + sAvg * 10));
}

const BENCH_PROMPT = {
  model: 'benchmark',  // 会被覆盖
  messages: [
    { role: 'user', content: 'Reply with the single word "ok" and nothing else.' },
  ],
  max_tokens: 10,
  temperature: 0,
};

/** 测单个 key */
export async function benchmarkKey(
  keyId: number,
  options: { model?: string; samples?: number; timeoutMs?: number } = {},
): Promise<BenchmarkResult> {
  const key = getKey(keyId);
  if (!key) {
    return {
      keyId, model: options.model ?? 'unknown', samples: 0, successes: 0, errors: 0,
      successRate: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0,
      totalTokens: 0, avgTokensPerRequest: 0, score: 0, error: 'key not found',
      perSample: [],
    };
  }
  const model = options.model ?? 'gpt-4o-mini';
  const samples = options.samples ?? 5;
  const timeoutMs = options.timeoutMs ?? 30000;
  const apiKey = getDecryptedApiKey(keyId);
  const url = buildUpstreamUrl(key);

  const reqBody = buildUpstreamRequest({ ...BENCH_PROMPT, model }, model);

  const perSample: BenchmarkResult['perSample'] = [];
  let totalTokens = 0;
  const latencies: number[] = [];

  for (let i = 0; i < samples; i++) {
    const start = Date.now();
    try {
      const res = await httpSend(url, apiKey, {
        method: 'POST',
        body: JSON.stringify(reqBody),
        timeoutMs,
      }, keyId);
      const latency = Date.now() - start;
      latencies.push(latency);
      const text = res.body ?? '{}';
      let body: any;
      try { body = JSON.parse(text); } catch { body = {}; }
      if (res.status >= 200 && res.status < 300) {
        const t = body.usage?.total_tokens ?? 0;
        totalTokens += t;
        perSample.push({ ok: true, latencyMs: latency });
      } else {
        const errMsg = body?.error?.message ?? `HTTP ${res.status}`;
        perSample.push({ ok: false, latencyMs: latency, errorCode: res.status, errorMessage: errMsg });
      }
    } catch (e: any) {
      const latency = Date.now() - start;
      perSample.push({ ok: false, latencyMs: latency, errorMessage: e.message ?? 'network error' });
    }
  }

  const successes = perSample.filter((s) => s.ok).length;
  const errors = perSample.length - successes;
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  return {
    keyId, model, samples,
    successes, errors,
    successRate: samples > 0 ? successes / samples : 0,
    avgLatencyMs: avgLatency,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    totalTokens,
    avgTokensPerRequest: successes > 0 ? Math.round(totalTokens / successes) : 0,
    score: scoreFrom({ successRate: samples > 0 ? successes / samples : 0, avgLatencyMs: avgLatency, p95LatencyMs: p95, successes }),
    perSample,
  };
}

/** 测所有 enabled key */
export async function benchmarkAll(options: { samples?: number; model?: string } = {}): Promise<BenchmarkResult[]> {
  const keys = listKeys().filter((k) => k.enabled);
  const out: BenchmarkResult[] = [];
  for (const k of keys) {
    out.push(await benchmarkKey(k.id, options));
  }
  return out;
}
