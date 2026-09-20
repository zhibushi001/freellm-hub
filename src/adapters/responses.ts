/**
 * OpenAI Responses API 转换器
 * https://platform.openai.com/docs/api-reference/responses
 *
 * Responses 协议 vs chat/completions:
 *  - input: items 数组, 每项是 {type:'message'|'function_call'|'function_call_output'|...}
 *  - instructions: 系统提示 (等同 chat system)
 *  - output: items 数组 [{type:'message'|'function_call'|'reasoning', ...}]
 *  - 工具: tools[].name + parameters (没 function 包装)
 *  - function_call_output: 工具结果
 *
 * 转换策略:
 *  - 入站: Responses input items → chat messages
 *  - 出站 (非流): chat response → Responses output items
 *  - 出站 (流): chat SSE → Responses SSE events
 *  - 工具: tools 数组直接复用 (两边格式几乎一致)
 */

export interface ResponsesRequest {
  model: string;
  input?: string | ResponsesItem[];
  instructions?: string | null;
  tools?: ResponsesTool[];
  tool_choice?: string | { type: 'function'; name: string };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  [k: string]: any;
}

export interface ResponsesItem {
  type: string;  // 'message' | 'function_call' | 'function_call_output' | 'reasoning' | ...
  [k: string]: any;
}

export interface ResponsesTool {
  type?: 'function';  // 默认 'function', 可省略
  name: string;
  description?: string;
  parameters: any;
}

export interface ResponsesOutput {
  id: string;
  object: 'response';
  created_at: number;
  model: string;
  status: 'completed' | 'incomplete' | 'failed' | 'in_progress';
  instructions?: string | null;
  output: ResponsesItem[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: any;
}

/* ---------- 入站: Responses → chat/completions ---------- */

export function responsesToChatRequest(req: ResponsesRequest): any {
  const messages: any[] = [];

  // instructions (system)
  if (req.instructions && typeof req.instructions === 'string') {
    messages.push({ role: 'system', content: req.instructions });
  }

  // input: string 当 user 消息, 数组按 item 类型拆
  if (typeof req.input === 'string') {
    messages.push({ role: 'user', content: req.input });
  } else if (Array.isArray(req.input)) {
    for (const item of req.input) {
      const m = responsesItemToChatMessage(item);
      if (Array.isArray(m)) {
        for (const mm of m) messages.push(mm);
      } else if (m) {
        messages.push(m);
      }
    }
  }

  // tools: Responses 格式 {type:'function', name, parameters}
  //        chat 格式  {type:'function', function:{name, description, parameters}}
  const tools = (req.tools ?? []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters ?? { type: 'object', properties: {} },
    },
  }));

  const out: any = {
    model: req.model,
    messages,
    stream: !!req.stream,
  };
  if (tools.length > 0) out.tools = tools;
  if (req.tool_choice !== undefined) out.tool_choice = req.tool_choice;
  if (req.max_tokens !== undefined) out.max_tokens = req.max_tokens;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  // 透传其他字段 (metadata, parallel_tool_calls 等)
  for (const k of Object.keys(req)) {
    if (['model', 'input', 'instructions', 'tools', 'tool_choice', 'max_tokens', 'temperature', 'top_p', 'stream'].includes(k)) continue;
    if (out[k] === undefined) out[k] = req[k];
  }
  return out;
}

function responsesItemToChatMessage(item: ResponsesItem): any | any[] | null {
  switch (item.type) {
    case 'message': {
      // role: 'user' | 'assistant' | 'system'
      const role = item.role ?? 'user';
      const content = item.content;
      // content 可能是 string 或 array of parts
      if (typeof content === 'string') {
        return { role, content };
      }
      if (Array.isArray(content)) {
        // 输出 parts: input_text/output_text/text → text, input_image → image_url
        const textParts = content.filter((p) => p.type === 'output_text' || p.type === 'input_text' || p.type === 'text');
        if (textParts.length === 1 && content.length === 1) {
          return { role, content: textParts[0].text };
        }
        return {
          role,
          content: content.map((p) => {
            if (p.type === 'output_text' || p.type === 'input_text' || p.type === 'text') return { type: 'text', text: p.text };
            if (p.type === 'input_image' || p.type === 'image') {
              return { type: 'image_url', image_url: p.image_url ?? p.url };
            }
            return p;
          }),
        };
      }
      return { role, content: '' };
    }
    case 'function_call': {
      // assistant 的 tool_use → chat tool_calls
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id ?? item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        }],
      };
    }
    case 'function_call_output': {
      // 工具结果 → chat role:tool
      return {
        role: 'tool',
        tool_call_id: item.call_id,
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
      };
    }
    case 'reasoning': {
      // 内部思考 — 暂丢弃 (OpenAI Responses 把 reasoning 暴露给客户端, 但我们 upstream 是 chat 协议没这概念)
      return null;
    }
    default:
      return null;
  }
}

/* ---------- 出站 (非流): chat response → Responses ---------- */

export function chatToResponsesResponse(chatResp: any, model: string, requestId?: string): ResponsesOutput {
  const choice = chatResp?.choices?.[0];
  const msg = choice?.message ?? {};
  const usage = chatResp?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const output: ResponsesItem[] = [];

  // reasoning 暂跳过 (chat 协议没这概念)
  // function_call → function_call item
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      output.push({
        type: 'function_call',
        id: `fc_${tc.id ?? Math.random().toString(36).slice(2, 10)}`,
        call_id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments ?? '{}',
      });
    }
  }
  // text → message item
  if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
    output.push({
      type: 'message',
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: msg.content, annotations: [] }],
    });
  }
  // 没内容时给空 message (Responses 协议要求 output 非空)
  if (output.length === 0) {
    output.push({
      type: 'message',
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '', annotations: [] }],
    });
  }

  // 状态映射
  const fr = choice?.finish_reason;
  let status: ResponsesOutput['status'] = 'completed';
  if (fr === 'length') status = 'incomplete';
  else if (fr === 'content_filter') status = 'incomplete';

  return {
    id: requestId ?? chatResp?.id ?? `resp_${Math.random().toString(36).slice(2, 10)}`,
    object: 'response',
    created_at: chatResp?.created ?? Math.floor(Date.now() / 1000),
    model: chatResp?.model ?? model,
    status,
    instructions: null,
    output,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    },
  };
}

/* ---------- 出站 (流): chat SSE → Responses SSE events ----------
 *
 * 事件顺序 (简化, 匹配 OpenAI Responses 流):
 *  response.created             {type, response:{... status:'in_progress'}}
 *  response.in_progress         (周期性, 可选)
 *  response.output_item.added   {type, output_index, item:{type:'message'|'function_call', ...}}
 *  response.content_part.added  {type, item_id, output_index, content_index, part:{...}}
 *  response.output_text.delta   {type, item_id, output_index, content_index, delta}
 *  response.function_call_arguments.delta {type, item_id, output_index, delta}
 *  response.content_part.done   (聚合 part)
 *  response.output_item.done    {type, output_index, item:{...status:'completed'}}
 *  response.completed           {type, response:{... status:'completed'}}
 */

export interface ResponsesStreamState {
  responseId: string;
  createdAt: number;
  model: string;
  startedItems: boolean;       // message item 是否已 added
  currentItemId: string | null;
  currentItemType: 'message' | 'function_call' | null;
  currentOutputIndex: number;
  currentContentIndex: number;
  toolCallByIndex: Map<number, { id: string; name: string; argsSoFar: string; itemId: string }>;
  messageItemId: string | null;
  totalOutputTokens: number;
}

export function createResponsesStreamState(model: string, responseId: string, createdAt: number): ResponsesStreamState {
  return {
    responseId,
    createdAt,
    model,
    startedItems: false,
    currentItemId: null,
    currentItemType: null,
    currentOutputIndex: -1,
    currentContentIndex: 0,
    toolCallByIndex: new Map(),
    messageItemId: null,
    totalOutputTokens: 0,
  };
}

/** 处理一个 OpenAI chat chunk, 返回 Responses SSE events */
export function* processChatChunkToResponses(
  state: ResponsesStreamState,
  chunk: any,
): Generator<{ event: string; data: any }> {
  const choice = chunk?.choices?.[0];
  if (!choice) return;
  const delta = choice.delta ?? {};
  const finishReason = choice.finish_reason;

  // 1) text delta
  const textDelta = delta.content;
  if (typeof textDelta === 'string' && textDelta.length > 0) {
    // 第一次 text: output_item.added (message) + content_part.added
    if (!state.startedItems) {
      state.currentOutputIndex += 1;
      const itemId = `msg_${Math.random().toString(36).slice(2, 10)}`;
      state.messageItemId = itemId;
      state.currentItemId = itemId;
      state.currentItemType = 'message';
      state.startedItems = true;
      yield {
        event: 'response.output_item.added',
        data: {
          type: 'response.output_item.added',
          output_index: state.currentOutputIndex,
          item: {
            id: itemId,
            type: 'message',
            role: 'assistant',
            status: 'in_progress',
            content: [],
          },
        },
      };
      yield {
        event: 'response.content_part.added',
        data: {
          type: 'response.content_part.added',
          item_id: itemId,
          output_index: state.currentOutputIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        },
      };
    }
    state.totalOutputTokens += Math.ceil(textDelta.length / 4);
    yield {
      event: 'response.output_text.delta',
      data: {
        type: 'response.output_text.delta',
        item_id: state.messageItemId,
        output_index: state.currentOutputIndex,
        content_index: 0,
        delta: textDelta,
      },
    };
  }

  // 2) tool_calls delta
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      let s = state.toolCallByIndex.get(idx);
      if (!s) {
        // 第一次: close message item (if open), open function_call item
        if (state.messageItemId) {
          yield {
            event: 'response.content_part.done',
            data: {
              type: 'response.content_part.done',
              item_id: state.messageItemId,
              output_index: state.currentOutputIndex,
              content_index: 0,
              part: { type: 'output_text', text: '', annotations: [] },
            },
          };
          yield {
            event: 'response.output_item.done',
            data: {
              type: 'response.output_item.done',
              output_index: state.currentOutputIndex,
              item: {
                id: state.messageItemId,
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: '', annotations: [] }],
              },
            },
          };
          state.messageItemId = null;
        }
        state.currentOutputIndex += 1;
        const itemId = `fc_${Math.random().toString(36).slice(2, 10)}`;
        s = {
          id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name: tc.function?.name ?? '',
          argsSoFar: '',
          itemId,
        };
        state.toolCallByIndex.set(idx, s);
        state.currentItemId = itemId;
        state.currentItemType = 'function_call';
        yield {
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            output_index: state.currentOutputIndex,
            item: {
              id: itemId,
              type: 'function_call',
              call_id: s.id,
              name: s.name,
              arguments: '',
              status: 'in_progress',
            },
          },
        };
      }
      // 累积 arguments
      const argDelta = tc.function?.arguments;
      if (typeof argDelta === 'string' && argDelta.length > 0) {
        s.argsSoFar += argDelta;
        state.totalOutputTokens += Math.ceil(argDelta.length / 4);
        yield {
          event: 'response.function_call_arguments.delta',
          data: {
            type: 'response.function_call_arguments.delta',
            item_id: s.itemId,
            output_index: state.currentOutputIndex,
            delta: argDelta,
          },
        };
      }
    }
  }

  // 3) finish: 关掉所有 open items + 发 response.completed
  if (finishReason) {
    // 关闭未关闭的 message item
    if (state.messageItemId) {
      yield {
        event: 'response.content_part.done',
        data: {
          type: 'response.content_part.done',
          item_id: state.messageItemId,
          output_index: state.currentOutputIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        },
      };
      yield {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: state.currentOutputIndex,
          item: {
            id: state.messageItemId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: '', annotations: [] }],
          },
        },
      };
    }
    // 关闭所有 function_call item
    for (const [, s] of state.toolCallByIndex) {
      yield {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: state.currentOutputIndex,  // 实际每个 fc 有自己 index, 简化用 last
          item: {
            id: s.itemId,
            type: 'function_call',
            call_id: s.id,
            name: s.name,
            arguments: s.argsSoFar,
            status: 'completed',
          },
        },
      };
    }
    // response.completed
    const completedResponse: any = {
      id: state.responseId,
      object: 'response',
      created_at: state.createdAt,
      model: state.model,
      status: finishReason === 'length' ? 'incomplete' : 'completed',
      output: [],  // 简化为空 (客户端已从 done 事件拿到完整 items)
      usage: {
        input_tokens: 0,
        output_tokens: state.totalOutputTokens,
        total_tokens: state.totalOutputTokens,
      },
    };
    yield {
      event: 'response.completed',
      data: { type: 'response.completed', response: completedResponse },
    };
  }
}

/** 首事件: response.created (sseEvent 形式) */
export function* responsesCreatedEvent(state: ResponsesStreamState): Generator<{ event: string; data: any }> {
  yield {
    event: 'response.created',
    data: {
      type: 'response.created',
      response: {
        id: state.responseId,
        object: 'response',
        created_at: state.createdAt,
        model: state.model,
        status: 'in_progress',
        output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    },
  };
}
