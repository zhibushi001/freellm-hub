/**
 * Anthropic ↔ OpenAI tool 转换
 *
 * 关键差异:
 *   tools:        Anthropic [{name, description, input_schema}]
 *                 OpenAI    [{type:'function', function:{name, description, parameters}}]
 *   tool_choice:  Anthropic 'auto' | 'any' | {type:'tool', name}
 *                 OpenAI    'auto' | 'none' | {type:'function', function:{name}}
 *   assistant msg:
 *     Anthropic content:[{type:'text', text}, {type:'tool_use', id, name, input}]
 *     OpenAI    content:null|str, tool_calls:[{id, type, function:{name, arguments(JSON str)}}]
 *   tool result:
 *     Anthropic role:user, content:[{type:'tool_result', tool_use_id, content}]
 *     OpenAI    role:tool, tool_call_id, content (string)
 *   stop_reason:  Anthropic 'tool_use' | OpenAI 'tool_calls'
 *   id 前缀:     Anthropic 'toolu_xxx' | OpenAI 'call_xxx' (我们用上游 id 透传, 客户自己处理前缀)
 */
import type { AnthropicContent, AnthropicMessage } from './anthropic.js';

// ---------- 入站: Anthropic tools → OpenAI tools ----------

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: any;
}

export type AnthropicToolChoice =
  | 'auto'
  | 'any'
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean };

/** Anthropic tool → OpenAI tool */
export function anthropicToolsToOpenAI(tools: AnthropicTool[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    },
  }));
}

/** Anthropic tool_choice → OpenAI tool_choice */
export function anthropicToolChoiceToOpenAI(
  choice: AnthropicToolChoice | undefined,
): any {
  if (!choice) return undefined;
  if (choice === 'auto') return 'auto';
  if (choice === 'any') {
    // OpenAI 没 'any' 概念. 'any' 意思: 必须调至少一个 tool. 近似 → 'required'
    return 'required';
  }
  if (typeof choice === 'object' && choice.type === 'tool') {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

// ---------- 入站: Anthropic messages (含 tool_use/tool_result) → OpenAI messages ----------

/** 把 Anthropic message (含 tool_use/tool_result) 拍平成 OpenAI messages 数组 */
export function anthropicMessagesToOpenAI(messages: AnthropicMessage[]): any[] {
  const out: any[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      // 可能是 string / content blocks 数组 (含 tool_result)
      if (typeof m.content === 'string') {
        out.push({ role: 'user', content: m.content });
        continue;
      }
      if (!Array.isArray(m.content)) continue;

      const toolResults = m.content.filter((b) => b.type === 'tool_result');
      const otherBlocks = m.content.filter((b) => b.type !== 'tool_result');

      if (toolResults.length > 0) {
        // 每个 tool_result → role:'tool' (OpenAI 单独消息)
        for (const tr of toolResults as any[]) {
          out.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: toolResultContentToString(tr.content),
          });
        }
      }
      if (otherBlocks.length > 0) {
        // 剩余 (text / image) 作为 user 消息 - 复用 anthropic.ts 的 image 转换
        out.push({ role: 'user', content: blocksToOpenAIParts(otherBlocks) });
      }
    } else if (m.role === 'assistant') {
      if (typeof m.content === 'string') {
        out.push({ role: 'assistant', content: m.content });
        continue;
      }
      if (!Array.isArray(m.content)) continue;

      // 拆 text / tool_use
      const textParts = m.content.filter((b) => b.type === 'text') as any[];
      const toolUses = m.content.filter((b) => b.type === 'tool_use') as any[];

      const outMsg: any = { role: 'assistant' };
      if (textParts.length === 1 && toolUses.length === 0) {
        outMsg.content = textParts[0].text;
      } else if (textParts.length > 0) {
        outMsg.content = textParts.map((p) => p.text).join('');
      } else {
        outMsg.content = null;  // tool call 必须 content:null
      }
      if (toolUses.length > 0) {
        outMsg.tool_calls = toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: {
            name: tu.name,
            // OpenAI arguments 必须是 JSON 字符串
            arguments: typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input ?? {}),
          },
        }));
      }
      out.push(outMsg);
    }
  }
  return out;
}

function toolResultContentToString(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b.type === 'text' ? b.text : JSON.stringify(b)))
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

/** Image block → OpenAI image_url part (与 anthropic.ts 同逻辑) */
function blocksToOpenAIParts(blocks: any[]): any[] {
  const parts: any[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      const src = block.source;
      if (src?.type === 'base64' && src.media_type && src.data) {
        parts.push({ type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}` } });
      } else if (src?.type === 'url' && src.url) {
        parts.push({ type: 'image_url', image_url: { url: src.url } });
      }
    }
    // tool_use 已在上面拆出
  }
  // 简化: 单 text → string
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

// ---------- 出站: OpenAI response (含 tool_calls) → Anthropic response ----------

/** OpenAI choices[0].message → Anthropic content blocks */
export function openAIToAnthropicContent(message: any): AnthropicContent[] {
  const blocks: AnthropicContent[] = [];
  // text
  if (typeof message?.content === 'string' && message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content });
  }
  // tool_calls
  const tcs = message?.tool_calls;
  if (Array.isArray(tcs) && tcs.length > 0) {
    for (const tc of tcs) {
      const fn = tc.function ?? {};
      let input: any = {};
      try { input = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { input = {}; }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: fn.name,
        input,
      } as any);
    }
  }
  return blocks;
}

// ---------- 出站: OpenAI SSE delta (含 tool_calls) → Anthropic SSE events ----------

/**
 * 把 OpenAI stream 里 *一个* chunk 转成 0+ 个 Anthropic SSE 事件
 *
 * OpenAI tool_call delta 是增量构建的 (流式 tool_call 通常拆 3+ chunk):
 *   chunk 1: {tool_calls:[{index:0, id:'call_xxx', function:{name:'get_weather', arguments:''}}]}
 *   chunk 2: {tool_calls:[{index:0, function:{arguments:'{"loc'}}]}
 *   chunk 3: {tool_calls:[{index:0, function:{arguments:'ation":"sf"}'}]}
 *
 * Anthropic tool_use delta 序列:
 *   1. content_block_start: {type:'content_block_start', index:N, content_block:{type:'tool_use', id, name, input:{}}}
 *   2. content_block_delta* : {type:'content_block_delta', index:N, delta:{type:'input_json_delta', partial_json:'...'}}
 *   3. content_block_stop:   {type:'content_block_stop', index:N}
 *
 * 我们的策略: 在 hub 里用 Map 跟踪每个 tool_call 状态, 把 delta 累积,
 * 收到 finish_reason 一起 flush.
 *
 * 这里只做 single-chunk 转换; 多 chunk 状态在 openAISseToAnthropicSseTools() 里维护.
 */
export interface ToolCallStreamState {
  /** index → {id?, name?, argsSoFar: string, started: bool} */
  byIndex: Map<number, { id?: string; name?: string; argsSoFar: string; started: boolean }>;
}

/** 创建 tool call 流式状态 */
export function createToolCallStreamState(): ToolCallStreamState {
  return { byIndex: new Map() };
}

/** 处理一个 OpenAI chunk, 返回 Anthropic 事件
 * chunk 接受两种:
 *   - 完整 chunk: {choices:[{delta:{tool_calls:[...]}}]}  (OpenAI SSE 流)
 *   - 仅 delta:   {tool_calls:[...]}                       (调用方已拆出)
 */
export function* processOpenAIToolCallChunk(
  state: ToolCallStreamState,
  chunk: any,
  startIndex: number = 0,  // 之前 text content_block 占 0; tool_use 从 1 开始
): Generator<{ event: string; data: any }> {
  // 先看 chunk.tool_calls (已拆出) 再看 chunk.choices[0].delta.tool_calls (完整)
  const tcs = chunk?.tool_calls
    ?? chunk?.choices?.[0]?.delta?.tool_calls
    ?? chunk?.choices?.[0]?.tool_calls;
  if (!Array.isArray(tcs) || tcs.length === 0) return;

  for (const tc of tcs) {
    const idx = (tc.index ?? 0) + startIndex;  // 0=content_block_start(text), tool_use 从 1
    let s = state.byIndex.get(idx);
    if (!s) {
      s = { argsSoFar: '', started: false };
      state.byIndex.set(idx, s);
    }
    if (!s.started) {
      // 第一个 chunk: 应含 id + name
      s.id = tc.id ?? s.id;
      s.name = tc.function?.name ?? s.name;
      s.started = true;
      yield {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: idx,
          content_block: { type: 'tool_use', id: s.id ?? `toolu_${idx}`, name: s.name ?? '', input: {} },
        },
      };
    }
    // 累积 arguments
    const argDelta = tc.function?.arguments;
    if (typeof argDelta === 'string' && argDelta.length > 0) {
      s.argsSoFar += argDelta;
      yield {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'input_json_delta', partial_json: argDelta },
        },
      };
    }
  }
}

/** 收尾: 对所有 started tool_use 发 content_block_stop */
export function* finalizeToolCallStream(state: ToolCallStreamState): Generator<{ event: string; data: any }> {
  for (const [idx, s] of state.byIndex.entries()) {
    if (s.started) {
      yield {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: idx },
      };
    }
  }
}
