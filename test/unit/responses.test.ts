/**
 * OpenAI Responses API 转换器单元测试
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  responsesToChatRequest,
  chatToResponsesResponse,
  createResponsesStreamState,
  responsesCreatedEvent,
  processChatChunkToResponses,
  type ResponsesRequest,
} from '/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/adapters/responses.js';

describe('Responses: 入站 (Responses → chat)', () => {
  it('input 是 string → user 消息', () => {
    const chat = responsesToChatRequest({ model: 'gpt-4o', input: 'hello' });
    assert.equal(chat.messages.length, 1);
    assert.equal(chat.messages[0].role, 'user');
    assert.equal(chat.messages[0].content, 'hello');
  });

  it('instructions → system 消息', () => {
    const chat = responsesToChatRequest({ model: 'gpt-4o', input: 'hi', instructions: 'you are helpful' });
    assert.equal(chat.messages[0].role, 'system');
    assert.equal(chat.messages[0].content, 'you are helpful');
    assert.equal(chat.messages[1].role, 'user');
  });

  it('input items: message(user) + function_call(assistant) + function_call_output(tool)', () => {
    const chat = responsesToChatRequest({
      model: 'gpt-4o',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'weather?' }] },
        { type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{"location":"SF"}' },
        { type: 'function_call_output', call_id: 'c1', output: '72F' },
      ],
    });
    assert.equal(chat.messages.length, 3);
    assert.equal(chat.messages[0].role, 'user');
    assert.equal(chat.messages[0].content, 'weather?');
    assert.equal(chat.messages[1].role, 'assistant');
    assert.equal(chat.messages[1].content, null);
    assert.equal(chat.messages[1].tool_calls[0].function.name, 'get_weather');
    assert.equal(chat.messages[2].role, 'tool');
    assert.equal(chat.messages[2].tool_call_id, 'c1');
    assert.equal(chat.messages[2].content, '72F');
  });

  it('tools: Responses 格式 → chat 格式', () => {
    const chat = responsesToChatRequest({
      model: 'gpt-4o',
      input: 'hi',
      tools: [{
        type: 'function',
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { loc: { type: 'string' } } },
      }],
    });
    assert.equal(chat.tools.length, 1);
    assert.equal(chat.tools[0].type, 'function');
    assert.equal(chat.tools[0].function.name, 'get_weather');
    assert.equal(chat.tools[0].function.description, 'Get weather');
  });

  it('tools 缺 type 时默认 function', () => {
    const chat = responsesToChatRequest({
      model: 'gpt-4o',
      input: 'hi',
      tools: [{ name: 'foo', parameters: {} }] as any,
    });
    assert.equal(chat.tools[0].type, 'function');
  });

  it('function_call arguments 是 object → JSON 字符串', () => {
    const chat = responsesToChatRequest({
      model: 'gpt-4o',
      input: [
        { type: 'function_call', call_id: 'c1', name: 'f', arguments: { x: 1 } },
      ],
    });
    assert.equal(chat.messages[0].tool_calls[0].function.arguments, '{"x":1}');
  });

  it('reasoning item 被丢弃 (chat 协议没这概念)', () => {
    const chat = responsesToChatRequest({
      model: 'gpt-4o',
      input: [
        { type: 'reasoning', content: 'thinking...' },
        { type: 'message', role: 'user', content: 'hi' },
      ],
    });
    assert.equal(chat.messages.length, 1);
    assert.equal(chat.messages[0].content, 'hi');
  });

  it('stream 透传 + max_tokens/temperature 透传', () => {
    const chat = responsesToChatRequest({
      model: 'gpt-4o', input: 'hi', stream: true, max_tokens: 500, temperature: 0.7,
    });
    assert.equal(chat.stream, true);
    assert.equal(chat.max_tokens, 500);
    assert.equal(chat.temperature, 0.7);
  });
});

describe('Responses: 出站 (chat → Responses, 非流)', () => {
  it('text only → output: [message]', () => {
    const out = chatToResponsesResponse({
      id: 'chatcmpl-x',
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }, 'gpt-4o');
    assert.equal(out.object, 'response');
    assert.equal(out.status, 'completed');
    assert.equal(out.output.length, 1);
    assert.equal(out.output[0].type, 'message');
    assert.equal(out.output[0].role, 'assistant');
    assert.equal(out.output[0].content[0].text, 'hi');
    assert.equal(out.usage.input_tokens, 5);
    assert.equal(out.usage.output_tokens, 3);
  });

  it('tool_calls → output: [function_call]', () => {
    const out = chatToResponsesResponse({
      id: 'chatcmpl-x',
      model: 'gpt-4o',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_x', type: 'function',
            function: { name: 'get_weather', arguments: '{"loc":"SF"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }, 'gpt-4o');
    assert.equal(out.output.length, 1);
    assert.equal(out.output[0].type, 'function_call');
    assert.equal(out.output[0].name, 'get_weather');
    assert.equal(out.output[0].call_id, 'call_x');
  });

  it('text + tool_calls → output: [function_call, message]', () => {
    const out = chatToResponsesResponse({
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Let me check',
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }, 'gpt-4o');
    assert.equal(out.output.length, 2);
    assert.equal(out.output[0].type, 'function_call');
    assert.equal(out.output[1].type, 'message');
  });

  it('finish_reason=length → status:incomplete', () => {
    const out = chatToResponsesResponse({
      choices: [{ index: 0, message: { content: '...' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }, 'gpt-4o');
    assert.equal(out.status, 'incomplete');
  });

  it('空 content + 无 tool_calls → output: [空 message]', () => {
    const out = chatToResponsesResponse({
      choices: [{ index: 0, message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }, 'gpt-4o');
    assert.equal(out.output.length, 1);
    assert.equal(out.output[0].type, 'message');
  });
});

describe('Responses: SSE 流状态机', () => {
  it('response.created 是首事件', () => {
    const state = createResponsesStreamState('gpt-4o', 'resp_1', 1000);
    const ev = responsesCreatedEvent(state).next().value!;
    assert.equal(ev.event, 'response.created');
    assert.equal(ev.data.response.id, 'resp_1');
    assert.equal(ev.data.response.status, 'in_progress');
  });

  it('text delta: 触发 output_item.added + content_part.added + 多个 output_text.delta', () => {
    const state = createResponsesStreamState('gpt-4o', 'resp_1', 1000);
    const events: any[] = [];
    // 第 1 chunk: content 起始
    for (const ev of processChatChunkToResponses(state, {
      choices: [{ delta: { content: 'Hel' } }],
    })) events.push(ev);
    // 第 2 chunk: content 续
    for (const ev of processChatChunkToResponses(state, {
      choices: [{ delta: { content: 'lo' } }],
    })) events.push(ev);

    // 期望: output_item.added + content_part.added + delta(Hel) + delta(lo) = 4
    assert.equal(events.length, 4);
    assert.equal(events[0].event, 'response.output_item.added');
    assert.equal(events[0].data.item.type, 'message');
    assert.equal(events[1].event, 'response.content_part.added');
    assert.equal(events[2].event, 'response.output_text.delta');
    assert.equal(events[2].data.delta, 'Hel');
    assert.equal(events[3].event, 'response.output_text.delta');
    assert.equal(events[3].data.delta, 'lo');
  });

  it('finish: 关闭 message item + 发 response.completed', () => {
    const state = createResponsesStreamState('gpt-4o', 'resp_1', 1000);
    const events: any[] = [];
    for (const ev of processChatChunkToResponses(state, { choices: [{ delta: { content: 'hi' } }] })) events.push(ev);
    for (const ev of processChatChunkToResponses(state, { choices: [{ delta: {}, finish_reason: 'stop' }] })) events.push(ev);

    // 后 3 个事件: content_part.done + output_item.done + response.completed
    const tail = events.slice(-3);
    assert.equal(tail[0].event, 'response.content_part.done');
    assert.equal(tail[1].event, 'response.output_item.done');
    assert.equal(tail[1].data.item.status, 'completed');
    assert.equal(tail[2].event, 'response.completed');
    assert.equal(tail[2].data.response.status, 'completed');
  });

  it('tool_call: 关闭 text, 开 function_call, 累积 arguments', () => {
    const state = createResponsesStreamState('gpt-4o', 'resp_1', 1000);
    const events: any[] = [];
    // text
    for (const ev of processChatChunkToResponses(state, { choices: [{ delta: { content: 'Let me' } }] })) events.push(ev);
    // tool start (id+name)
    for (const ev of processChatChunkToResponses(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '' } }] } }],
    })) events.push(ev);
    // tool arg 1
    for (const ev of processChatChunkToResponses(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x' } }] } }],
    })) events.push(ev);
    // tool arg 2 + finish
    for (const ev of processChatChunkToResponses(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, finish_reason: 'tool_calls' }],
    })) events.push(ev);

    // 关键事件: response.function_call_arguments.delta 至少 2 个
    const argDeltas = events.filter((e) => e.event === 'response.function_call_arguments.delta');
    assert.equal(argDeltas.length, 2);
    assert.equal(argDeltas[0].data.delta, '{"x');
    // finish 时: function_call done + response.completed
    const completed = events.find((e) => e.event === 'response.completed');
    assert.ok(completed);
    assert.match(completed!.data.response.status, /completed|incomplete/);
  });

  it('空流 (没 chunk) → 不产事件 (除 callers 主动 response.created)', () => {
    const state = createResponsesStreamState('gpt-4o', 'resp_1', 1000);
    const events: any[] = [];
    for (const ev of processChatChunkToResponses(state, { choices: [] })) events.push(ev);
    assert.equal(events.length, 0);
  });
});
