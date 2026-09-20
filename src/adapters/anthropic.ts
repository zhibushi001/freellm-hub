/**
 * Anthropic Messages API 协议适配器
 *
 * 入站: Anthropic /v1/messages (Claude Code 用的就是这个)
 * 出站: 转成 OpenAI /v1/chat/completions 调上游
 * 回程: OpenAI 响应转回 Anthropic 格式
 *
 * 范围 (Phase 3.A):
 *   ✅ messages 转换 (含 system 提取 + content blocks)
 *   ✅ 多 content block: text / image
 *   ✅ 非流式响应
 *   ✅ SSE 流式响应 (event: message_start / content_block_start / content_block_delta* / content_block_stop / message_delta / message_stop)
 *   ✅ 错误映射 (Anthropic error shape: type/message)
 *   ❌ tool use 完整双向 (留 Phase 3.A.2)
 *   ❌ prompt caching / vision base64 (留 Phase 3.A.2)
 *
 * 关键差异表 (Anthropic ↔ OpenAI):
 *   system:    Anthropic 顶层 string | OpenAI system 消息
 *   messages:  Anthropic content: string | ContentBlock[] | OpenAI content: string
 *   model:     Anthropic "claude-3-5-sonnet-20241022" | OpenAI "gpt-4o-mini" → hub 做路由, 实际模型名由 resolver 选
 *   max_tokens: Anthropic 必填 (默认 1024) | OpenAI 可选
 *   stop_reason: Anthropic end_turn/length/tool_use/max_tokens | OpenAI stop/length/tool_calls/content_filter
 *   usage:     Anthropic input_tokens/output_tokens | OpenAI prompt_tokens/completion_tokens
 *   errors:    Anthropic {type, message} | OpenAI {error: {message, type}}
 */
import {randomUUID} from 'node:crypto'
import type { OpenAIChatRequest } from './openai.js';
import {
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
  anthropicMessagesToOpenAI,
  openAIToAnthropicContent,
} from './anthropicTools.js';

// ---------- Types ----------

/** Anthropic Content Block (text / image / tool_use / tool_result) */
export type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string } }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContent[]; is_error?: boolean };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContent[];
  max_tokens?: number;  // 必填 (API 拒绝 < 1)
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: { user_id?: string };
  // tools?: any[];  // Phase 3.A.2
  [k: string]: any;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContent[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicError {
  type: 'error';
  error: {
    type: 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'not_found_error' | 'rate_limit_error' | 'api_error' | 'overloaded_error' | 'gateway_error';
    message: string;
  };
}

// ---------- Inbound: Anthropic → OpenAI ----------

/**
 * Anthropic messages → OpenAI messages
 * - system (顶层) → {role:'system', content}
 * - 多个 content block: text 直接 concat (OpenAI 简单 text only), image 转 image_url
 * - tool_use / tool_result 走 anthropicMessagesToOpenAI (tool 转换)
 */
export function anthropicToOpenAIMessages(req: AnthropicRequest): OpenAIChatRequest {
  const out: OpenAIChatRequest = { model: req.model, messages: [] };

  // 1. system
  const sysText = extractSystemText(req.system);
  if (sysText) {
    out.messages.push({ role: 'system', content: sysText });
  }

  // 2. messages (含 tool_use / tool_result)
  out.messages.push(...anthropicMessagesToOpenAI(req.messages));

  // 3. 透传
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  // Anthropic max_tokens 必填; OpenAI 可选 - 透传
  if (req.max_tokens !== undefined) out.max_tokens = req.max_tokens;
  if (req.stream !== undefined) out.stream = req.stream;
  if (req.stop_sequences) out.stop = req.stop_sequences;

  // 4. tools
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    out.tools = anthropicToolsToOpenAI(req.tools as any);
  }
  if (req.tool_choice !== undefined) {
    out.tool_choice = anthropicToolChoiceToOpenAI(req.tool_choice as any);
  }

  // metadata.user_id 可忽略
  return out;
}

function extractSystemText(system: AnthropicRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
  }
  return '';
}

function _anthropicContentToOpenAI(content: string | AnthropicContent[]): string | any[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length === 0) return '';
  // 单元素 text → 简化成 string (OpenAI 兼容)
  if (content.length === 1 && content[0].type === 'text') return (content[0] as any).text;

  // 多元素 → OpenAI content parts
  const parts: any[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: (block as any).text });
    } else if (block.type === 'image') {
      const src = (block as any).source;
      if (src.type === 'base64' && src.media_type && src.data) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${src.media_type};base64,${src.data}` },
        });
      } else if (src.type === 'url' && src.url) {
        parts.push({ type: 'image_url', image_url: { url: src.url } });
      }
      // 其他格式暂忽略
    }
    // tool_use / tool_result: Phase 3.A.2 处理
  }
  return parts;
}

// ---------- Outbound: OpenAI → Anthropic (non-stream) ----------

/**
 * OpenAI ChatCompletionResponse → Anthropic Message
 * OpenAI 一般是 {choices: [{message:{role, content, tool_calls}, finish_reason}], usage}
 * Anthropic content 可以是 text + tool_use blocks
 */
export function openAIToAnthropicResponse(
  openaiResp: any,
  requestModel: string,
  upstreamModel: string,
): AnthropicResponse {
  const choice = openaiResp?.choices?.[0];
  const message = choice?.message ?? {};
  const finishReason = choice?.finish_reason ?? 'stop';
  const usage = openaiResp?.usage ?? {};

  // 拆 content + tool_calls
  const contentBlocks = openAIToAnthropicContent(message);

  return {
    id: openaiResp?.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
    model: upstreamModel || requestModel,
    stop_reason: mapStopReason(finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

function mapStopReason(openaiFinishReason: string): AnthropicResponse['stop_reason'] {
  switch (openaiFinishReason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    case 'content_filter': return 'end_turn';  // 近似
    case 'stop_sequence': return 'stop_sequence';
    default: return 'end_turn';
  }
}

// ---------- Outbound: OpenAI SSE → Anthropic SSE ----------

/**
 * OpenAI 流式 chunk → Anthropic SSE event 序列
 *
 * OpenAI delta 格式: {choices:[{delta:{content, tool_calls}, finish_reason:null|'stop'|'length'|'tool_calls'}]}
 * Anthropic event 序列:
 *   1. message_start
 *   2. content_block_start (text or tool_use, 0+)
 *   3. content_block_delta* (text_delta 或 input_json_delta)
 *   4. content_block_stop
 *   5. message_delta  {stop_reason, usage}
 *   6. message_stop
 *
 * 块 index 规则:
 *   - text 块 index=0 (只 1 个 text 块, 可选)
 *   - tool_use 块 index=1, 2, 3, ... (每个 tool 一个块)
 *
 * 工具调用流式: OpenAI 把 tool_call id+name 放第一个 chunk, arguments 后续 chunk 累积.
 * 工具状态 (id/name/argsSoFar) 维护在 toolState.byIndex
 */
import {
  createToolCallStreamState,
  processOpenAIToolCallChunk,
  finalizeToolCallStream,
} from './anthropicTools.js';

export async function* openAISseToAnthropicSse(
  openaiSseBytes: AsyncIterable<Uint8Array>,
  requestModel: string,
  upstreamModel: string,
): AsyncIterable<string> {
  const messageId = `msg_${randomUUID()}`;
  const decoder = new TextDecoder();
  let buffer = '';

  // 1. message_start
  yield sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: upstreamModel || requestModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  // 2. text content_block_start (延迟到第一个 text delta 时才发, 避免空 text 块)
  let textBlockStarted = false;

  // tool_use state
  const toolState = createToolCallStreamState();
  // tool_use block 起始 index: text 占 0, tool 从 1
  const TOOL_INDEX_OFFSET = 1;

  let outputTokens = 0;
  let finishReason: string | null = null;

  // 3. content_block_delta* — 解析 OpenAI SSE 流
  for await (const chunk of openaiSseBytes) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    process.stderr.write(`[anthropic SSE] lines count=${lines.length}, data lines=${lines.filter(l => l.trim().startsWith('data:')).length}\n`);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      let parsed: any;
      try { parsed = JSON.parse(data); } catch { continue; }

      const choice = parsed?.choices?.[0];
      const delta = choice?.delta ?? {};

      // 3a. text delta
      const textDelta = delta.content;
      if (typeof textDelta === 'string' && textDelta.length > 0) {
        if (!textBlockStarted) {
          textBlockStarted = true;
          yield sseEvent('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          });
        }
        outputTokens += estimateTokens(textDelta);
        yield sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: textDelta },
        });
      }

      // 3b. tool_calls delta
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
        // 收尾 text 块 (如果开了)
        if (textBlockStarted) {
          yield sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
          textBlockStarted = false;
        }
        for (const ev of processOpenAIToolCallChunk(toolState, delta, TOOL_INDEX_OFFSET)) {
          if (ev.event === 'content_block_delta') {
            // 累加 tool_use 的 input 长度作为 output tokens 估算
            const d = ev.data?.delta;
            if (d?.partial_json) outputTokens += estimateTokens(d.partial_json);
          }
          yield sseEvent(ev.event, ev.data);
        }
      }

      const fr = choice?.finish_reason;
      if (fr) finishReason = fr;
    }
  }

  // 4. 收尾所有 block
  if (textBlockStarted) {
    yield sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
  }
  for (const ev of finalizeToolCallStream(toolState)) {
    yield sseEvent(ev.event, ev.data);
  }

  // 5. message_delta
  yield sseEvent('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: mapStopReason(finishReason ?? 'stop'),
      stop_sequence: null,
    },
    usage: { output_tokens: outputTokens },
  });

  // 6. message_stop
  yield sseEvent('message_stop', { type: 'message_stop' });
}

/** 工具: 把对象转成 Anthropic SSE 事件字符串 (含双换行) */
function sseEvent(eventName: string, data: any): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 简单 token 估算 (字符数 / 4) - 真实 usage 拿不到时用 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------- Error mapping ----------

/**
 * OpenAI/HTTP 错误 → Anthropic error shape
 * HTTP 401 → authentication_error, 404 → not_found_error, 429 → rate_limit_error, 529 → overloaded_error
 * 400-499 → invalid_request_error, 500-599 → api_error
 */
export function toAnthropicError(status: number, message: string, errorType?: string): AnthropicError {
  let type: AnthropicError['error']['type'] = 'api_error';
  if (status === 401) type = 'authentication_error';
  else if (status === 403) type = 'permission_error';
  else if (status === 404) type = 'not_found_error';
  else if (status === 429) type = 'rate_limit_error';
  else if (status === 529 || status === 503) type = 'overloaded_error';
  else if (status >= 400 && status < 500) type = 'invalid_request_error';
  else if (status >= 500) type = 'api_error';

  return {
    type: 'error',
    error: { type, message: message || errorType || `HTTP ${status}` },
  };
}
