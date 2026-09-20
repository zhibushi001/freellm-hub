/**
 * HTTP 客户端 (基于 undici)
 * - 自动注入 Authorization
 * - 超时控制
 * - 指标记录 (latency / status)
 * - 不抛出 4xx 错误 (让上层决定), 但抛出网络/超时错误
 */
import { request } from 'undici';
import { recordKeyUsage } from '../db/repos/keys.js';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array;
  timeoutMs?: number;
  stream?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  latencyMs: number;
}

export interface HttpResponseBinary {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  latencyMs: number;
}

export interface StreamResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;  // undici body: Dispatcher.ReadableStream, 类型在 undici 内部
  latencyMs: number;
}

/**
 * 非流式 HTTP 请求
 * 自动测量延迟、自动记录 Key 成功/失败
 */
export async function httpSend(
  url: string,
  apiKey: string | null,
  opts: HttpRequestOptions = {},
  recordKeyId: number | null = null,
): Promise<HttpResponse> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const start = Date.now();
  try {
    const res = await request(url, {
      method,
      headers,
      body: opts.body as any,
      headersTimeout: opts.timeoutMs ?? 30000,
      bodyTimeout: opts.timeoutMs ?? 60000,
    });
    const body = await res.body.text();
    const latencyMs = Date.now() - start;
    if (recordKeyId !== null) {
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      recordKeyUsage(recordKeyId, ok, latencyMs);
    }
    return {
      status: res.statusCode,
      headers: res.headers as any,
      body,
      latencyMs,
    };
  } catch (err: any) {
    if (recordKeyId !== null) {
      recordKeyUsage(recordKeyId, false, Date.now() - start);
    }
    throw err;
  }
}

/**
 * 非流式 HTTP 请求 (二进制响应, 如 TTS 音频)
 * httpSend 用 body.text() 读取, 会破坏音频字节; 此处用 arrayBuffer 保持原始字节。
 */
export async function httpSendBinary(
  url: string,
  apiKey: string | null,
  opts: HttpRequestOptions = {},
  recordKeyId: number | null = null,
): Promise<HttpResponseBinary> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const start = Date.now();
  try {
    const res = await request(url, {
      method,
      headers,
      body: opts.body as any,
      headersTimeout: opts.timeoutMs ?? 30000,
      bodyTimeout: opts.timeoutMs ?? 60000,
    });
    const body = Buffer.from(await res.body.arrayBuffer());
    const latencyMs = Date.now() - start;
    if (recordKeyId !== null) {
      recordKeyUsage(recordKeyId, res.statusCode >= 200 && res.statusCode < 400, latencyMs);
    }
    return {
      status: res.statusCode,
      headers: res.headers as any,
      body,
      latencyMs,
    };
  } catch (err: any) {
    if (recordKeyId !== null) {
      recordKeyUsage(recordKeyId, false, Date.now() - start);
    }
    throw err;
  }
}

/**
 * 流式 HTTP 请求 (SSE)
 * 返回 undici ReadableStream, 由上层按 chunk 处理
 */
export async function httpStream(
  url: string,
  apiKey: string | null,
  opts: HttpRequestOptions = {},
  recordKeyId: number | null = null,
): Promise<StreamResponse> {
  const method = opts.method ?? 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...opts.headers,
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const start = Date.now();
  try {
    const res = await request(url, {
      method,
      headers,
      body: opts.body as any,
      headersTimeout: opts.timeoutMs ?? 30000,
      bodyTimeout: 0, // 流式不限时
    });
    const latencyMs = Date.now() - start;
    if (recordKeyId !== null) {
      // 流式的成功/失败判定延迟到首 chunk 发出
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      recordKeyUsage(recordKeyId, ok, latencyMs);
    }
    return {
      status: res.statusCode,
      headers: res.headers as any,
      body: res.body,
      latencyMs,
    };
  } catch (err: any) {
    if (recordKeyId !== null) {
      recordKeyUsage(recordKeyId, false, Date.now() - start);
    }
    throw err;
  }
}
