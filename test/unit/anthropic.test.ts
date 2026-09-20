/**
 * Anthropic 适配器单元测试
 * 覆盖: messages 转换 / system 提取 / content blocks / 响应转换 / 错误映射 / SSE 流转换
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicToOpenAIMessages,
  openAIToAnthropicResponse,
  toAnthropicError,
  openAISseToAnthropicSse,
  type AnthropicRequest,
} from '/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/adapters/anthropic.js';

describe('Anthropic 适配器: 入站 (Anthropic → OpenAI)', () => {
  it('基本: messages + system string + max_tokens', () => {
    const req: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      system: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };
    const out = anthropicToOpenAIMessages(req);
    assert.equal(out.model, 'claude-3-5-sonnet-20241022');
    assert.equal(out.max_tokens, 1024);
    assert.equal(out.temperature, 0.7);
    assert.equal(out.messages.length, 4);  // system + 3 user/assistant
    assert.equal(out.messages[0].role, 'system');
    assert.equal(out.messages[0].content, 'You are a helpful assistant.');
    assert.equal(out.messages[1].role, 'user');
    assert.equal(out.messages[1].content, 'Hello');
    assert.equal(out.messages[2].role, 'assistant');
    assert.equal(out.messages[2].content, 'Hi there!');
    assert.equal(out.messages[3].content, 'How are you?');
  });

  it('system 缺失时不加 system 消息', () => {
    const req: AnthropicRequest = {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAIMessages(req);
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].role, 'user');
  });

  it('system 是 content blocks 数组 → 拼成字符串', () => {
    const req: AnthropicRequest = {
      model: 'm',
      system: [
        { type: 'text', text: 'First line.' },
        { type: 'text', text: 'Second line.' },
      ],
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAIMessages(req);
    assert.equal(out.messages[0].role, 'system');
    assert.equal(out.messages[0].content, 'First line.\nSecond line.');
  });

  it('单 text content block → 简化成 string', () => {
    const req: AnthropicRequest = {
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'just text' }] }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAIMessages(req);
    assert.equal(typeof out.messages[0].content, 'string');
    assert.equal(out.messages[0].content, 'just text');
  });

  it('多 content block (text + image base64) → OpenAI parts', () => {
    const req: AnthropicRequest = {
      model: 'm',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR...' } },
        ],
      }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAIMessages(req);
    assert.ok(Array.isArray(out.messages[0].content));
    const parts = out.messages[0].content as any[];
    assert.equal(parts.length, 2);
    assert.equal(parts[0].type, 'text');
    assert.equal(parts[0].text, 'What is in this image?');
    assert.equal(parts[1].type, 'image_url');
    assert.equal(parts[1].image_url.url, 'data:image/png;base64,iVBOR...');
  });

  it('多 content block (text + image url) → OpenAI parts', () => {
    const req: AnthropicRequest = {
      model: 'm',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image', source: { type: 'url', url: 'https://example.com/cat.jpg' } },
        ],
      }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAIMessages(req);
    const parts = out.messages[0].content as any[];
    assert.equal(parts[1].image_url.url, 'https://example.com/cat.jpg');
  });

  it('stop_sequences → OpenAI stop', () => {
    const req: AnthropicRequest = {
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 10,
      stop_sequences: ['END', 'STOP'],
    };
    const out = anthropicToOpenAIMessages(req);
    assert.deepEqual(out.stop, ['END', 'STOP']);
  });

  it('stream:true 透传', () => {
    const req: AnthropicRequest = {
      model: 'm', stream: true,
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 10,
    };
    const out = anthropicToOpenAIMessages(req);
    assert.equal(out.stream, true);
  });
});

describe('Anthropic 适配器: 出站 (OpenAI → Anthropic non-stream)', () => {
  it('基本响应转换', () => {
    const openaiResp = {
      id: 'chatcmpl-abc123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello there!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const out = openAIToAnthropicResponse(openaiResp, 'claude-3-5-sonnet-20241022', 'gpt-4o-mini');
    assert.equal(out.type, 'message');
    assert.equal(out.role, 'assistant');
    assert.equal(out.stop_reason, 'end_turn');
    assert.equal(out.stop_sequence, null);
    assert.equal(out.usage.input_tokens, 10);
    assert.equal(out.usage.output_tokens, 5);
    assert.equal(out.content[0].type, 'text');
    assert.equal((out.content[0] as any).text, 'Hello there!');
    // id 应保留 OpenAI id (或生成新)
    assert.ok(out.id.length > 0);
    // model 应是上游真实 model
    assert.equal(out.model, 'gpt-4o-mini');
  });

  it('finish_reason 映射: stop→end_turn, length→max_tokens, tool_calls→tool_use, content_filter→end_turn', () => {
    const mkResp = (fr: string) => ({
      choices: [{ message: { content: 'x' }, finish_reason: fr }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    assert.equal(openAIToAnthropicResponse(mkResp('stop'), 'm', 'u').stop_reason, 'end_turn');
    assert.equal(openAIToAnthropicResponse(mkResp('length'), 'm', 'u').stop_reason, 'max_tokens');
    assert.equal(openAIToAnthropicResponse(mkResp('tool_calls'), 'm', 'u').stop_reason, 'tool_use');
    assert.equal(openAIToAnthropicResponse(mkResp('function_call'), 'm', 'u').stop_reason, 'tool_use');
    assert.equal(openAIToAnthropicResponse(mkResp('content_filter'), 'm', 'u').stop_reason, 'end_turn');
    assert.equal(openAIToAnthropicResponse(mkResp('stop_sequence'), 'm', 'u').stop_reason, 'stop_sequence');
  });

  it('缺 usage 时默认为 0', () => {
    const out = openAIToAnthropicResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
    }, 'm', 'u');
    assert.equal(out.usage.input_tokens, 0);
    assert.equal(out.usage.output_tokens, 0);
  });

  it('缺 choices 时也能转 (兜底)', () => {
    const out = openAIToAnthropicResponse({}, 'm', 'u');
    assert.equal(out.content[0].type, 'text');
    assert.equal((out.content[0] as any).text, '');
    assert.equal(out.stop_reason, 'end_turn');
  });
});

describe('Anthropic 适配器: 错误映射', () => {
  it('HTTP 401 → authentication_error', () => {
    const e = toAnthropicError(401, 'invalid api key');
    assert.equal(e.type, 'error');
    assert.equal(e.error.type, 'authentication_error');
    assert.equal(e.error.message, 'invalid api key');
  });
  it('HTTP 403 → permission_error', () => {
    assert.equal(toAnthropicError(403, 'forbidden').error.type, 'permission_error');
  });
  it('HTTP 404 → not_found_error', () => {
    assert.equal(toAnthropicError(404, 'not found').error.type, 'not_found_error');
  });
  it('HTTP 429 → rate_limit_error', () => {
    assert.equal(toAnthropicError(429, 'too many').error.type, 'rate_limit_error');
  });
  it('HTTP 529 → overloaded_error', () => {
    assert.equal(toAnthropicError(529, 'overloaded').error.type, 'overloaded_error');
  });
  it('HTTP 503 → overloaded_error', () => {
    assert.equal(toAnthropicError(503, 'unavail').error.type, 'overloaded_error');
  });
  it('HTTP 400 → invalid_request_error', () => {
    assert.equal(toAnthropicError(400, 'bad').error.type, 'invalid_request_error');
  });
  it('HTTP 500 → api_error', () => {
    assert.equal(toAnthropicError(500, 'oops').error.type, 'api_error');
  });
  it('HTTP 502 → api_error', () => {
    assert.equal(toAnthropicError(502, 'gw').error.type, 'api_error');
  });
  it('errorType 透传', () => {
    const e = toAnthropicError(400, '', 'invalid_request_error');
    assert.equal(e.error.message, 'invalid_request_error');
  });
  it('errorMessage 缺失时 fallback 到 HTTP code', () => {
    const e = toAnthropicError(500, '');
    assert.equal(e.error.message, 'HTTP 500');
  });
});

describe('Anthropic 适配器: SSE 流转换', () => {
  /** 工具: 把 OpenAI SSE 字节流转成 Anthropic 事件字符串 */
  async function collectAnthropicEvents(openaiSseStr: string, requestModel = 'claude', upstreamModel = 'gpt-4o-mini'): Promise<string[]> {
    const bytes = new TextEncoder().encode(openaiSseStr);
    const events: string[] = [];
    for await (const ev of openAISseToAnthropicSse(
      (async function* () { yield bytes; })(),
      requestModel,
      upstreamModel,
    )) {
      events.push(ev);
    }
    return events;
  }

  it('空流 (无 delta) → 只 3 个事件 (start/delta empty/stop)', async () => {
    // 实际: message_start + message_delta + message_stop
    // text content_block_start 延迟到第一个 text delta 才发 (避免空 text 块)
    const events = await collectAnthropicEvents('');
    assert.ok(events.length >= 3, `expect ≥3 events, got ${events.length}`);
    // 第一个应是 message_start
    assert.match(events[0], /event: message_start/);
    // 最后一个应是 message_stop
    assert.match(events[events.length - 1], /event: message_stop/);
  });

  it('有 delta 的正常流 → 6+ 事件, 含 content_block_delta', async () => {
    const sse = [
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      '',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      '',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      '',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const events = await collectAnthropicEvents(sse);
    // 找到 content_block_delta
    const deltas = events.filter(e => e.includes('content_block_delta'));
    assert.equal(deltas.length, 2);  // "Hello" + " world"
    assert.match(deltas[0], /Hello/);
    assert.match(deltas[1], / world/);
    // message_delta 应有 stop_reason: end_turn
    const msgDelta = events.find(e => e.startsWith('event: message_delta'));
    assert.ok(msgDelta);
    assert.match(msgDelta!, /end_turn/);
  });

  it('finish_reason=length → stop_reason: max_tokens', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"abc"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const events = await collectAnthropicEvents(sse);
    const msgDelta = events.find(e => e.startsWith('event: message_delta'));
    assert.match(msgDelta!, /max_tokens/);
  });

  it('含无效 JSON 的行被跳过, 不 crash', async () => {
    const sse = [
      'data: not valid json',
      '',
      'data: {"choices":[{"delta":{"content":"good"},"finish_reason":null}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const events = await collectAnthropicEvents(sse);
    const deltas = events.filter(e => e.includes('content_block_delta'));
    assert.equal(deltas.length, 1);
    assert.match(deltas[0], /good/);
  });

  it('多 chunk 分批到达也能正确组装', async () => {
    // 把 1 个完整 SSE 拆成 2 个 chunk (中间切在 "Hello" 字符串)
    const sse1 = 'data: {"choices":[{"delta":{"content":"Hel';
    const sse2 = 'lo"},"finish_reason":"stop"}]}\ndata: [DONE]\n';
    const bytes1 = new TextEncoder().encode(sse1);
    const bytes2 = new TextEncoder().encode(sse2);
    const events: string[] = [];
    for await (const ev of openAISseToAnthropicSse(
      (async function* () { yield bytes1; yield bytes2; })(),
      'claude', 'gpt',
    )) {
      events.push(ev);
    }
    const deltas = events.filter(e => e.includes('content_block_delta'));
    assert.equal(deltas.length, 1);
    assert.match(deltas[0], /Hello/);
  });
});
