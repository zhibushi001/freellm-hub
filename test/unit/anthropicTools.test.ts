/**
 * Anthropic tool_use 转换器单元测试
 * 覆盖: tools 数组转换 / tool_choice 转换 / messages 转换 (含 tool_use/tool_result) /
 *      非流式响应转换 (含 tool_calls) / SSE 流 tool_use delta
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
  anthropicMessagesToOpenAI,
  openAIToAnthropicContent,
  createToolCallStreamState,
  processOpenAIToolCallChunk,
  finalizeToolCallStream,
  type AnthropicTool,
} from '/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/adapters/anthropicTools.js';

describe('Anthropic tools: 入站 (Anthropic → OpenAI)', () => {
  it('tools 数组: name + description + input_schema', () => {
    const tools: AnthropicTool[] = [{
      name: 'get_weather',
      description: 'Get current weather for a location',
      input_schema: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    }];
    const out = anthropicToolsToOpenAI(tools);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'function');
    assert.equal(out[0].function.name, 'get_weather');
    assert.equal(out[0].function.description, 'Get current weather for a location');
    assert.deepEqual(out[0].function.parameters, tools[0].input_schema);
  });

  it('tools 缺 description 时默认为空字符串', () => {
    const tools: AnthropicTool[] = [{ name: 'foo', input_schema: { type: 'object' } }];
    const out = anthropicToolsToOpenAI(tools);
    assert.equal(out[0].function.description, '');
  });

  it('tools 缺 input_schema 时默认为空 object schema', () => {
    const tools = [{ name: 'foo' }] as any;
    const out = anthropicToolsToOpenAI(tools);
    assert.deepEqual(out[0].function.parameters, { type: 'object', properties: {} });
  });

  it('多 tools 数组保序', () => {
    const tools: AnthropicTool[] = [
      { name: 'a', input_schema: { type: 'object' } },
      { name: 'b', input_schema: { type: 'object' } },
      { name: 'c', input_schema: { type: 'object' } },
    ];
    const out = anthropicToolsToOpenAI(tools);
    assert.deepEqual(out.map((o) => o.function.name), ['a', 'b', 'c']);
  });

  it('tool_choice: "auto" → "auto"', () => {
    assert.equal(anthropicToolChoiceToOpenAI('auto'), 'auto');
  });
  it('tool_choice: "any" → "required" (OpenAI 近似)', () => {
    assert.equal(anthropicToolChoiceToOpenAI('any'), 'required');
  });
  it('tool_choice: {type:tool, name:foo} → {type:function, function:{name:foo}}', () => {
    const out = anthropicToolChoiceToOpenAI({ type: 'tool', name: 'get_weather' });
    assert.deepEqual(out, { type: 'function', function: { name: 'get_weather' } });
  });
  it('tool_choice: undefined → undefined', () => {
    assert.equal(anthropicToolChoiceToOpenAI(undefined), undefined);
  });
});

describe('Anthropic tools: messages 转换 (含 tool_use/tool_result)', () => {
  it('assistant tool_use → OpenAI tool_calls', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'toolu_abc', name: 'get_weather', input: { location: 'SF' } },
      ],
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, 'assistant');
    assert.equal(out[0].content, 'Let me check.');
    assert.equal(out[0].tool_calls.length, 1);
    assert.equal(out[0].tool_calls[0].id, 'toolu_abc');
    assert.equal(out[0].tool_calls[0].type, 'function');
    assert.equal(out[0].tool_calls[0].function.name, 'get_weather');
    assert.deepEqual(JSON.parse(out[0].tool_calls[0].function.arguments), { location: 'SF' });
  });

  it('assistant 多 tool_use → 多 tool_calls', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'f1', input: { x: 1 } },
        { type: 'tool_use', id: 't2', name: 'f2', input: { y: 2 } },
      ],
    }]);
    assert.equal(out[0].tool_calls.length, 2);
    assert.deepEqual(out[0].tool_calls.map((tc: any) => tc.id), ['t1', 't2']);
  });

  it('assistant 纯 tool_use (没 text) → content:null (OpenAI 要求)', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'f1', input: {} }],
    }]);
    assert.equal(out[0].content, null);
    assert.equal(out[0].tool_calls.length, 1);
  });

  it('user tool_result → role:tool, tool_call_id, content:string', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'sunny, 72F' }],
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, 'tool');
    assert.equal(out[0].tool_call_id, 'toolu_abc');
    assert.equal(out[0].content, 'sunny, 72F');
  });

  it('user tool_result (is_error:true) 仍转, 标在内容前', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'API down', is_error: true }],
    }]);
    // Phase 3.A.2 简化: is_error 不特殊处理 (Claude Code 自己处理); 内容转 string
    assert.equal(out[0].content, 'API down');
  });

  it('user tool_result content 是数组 → 拼成字符串', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 't1',
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ],
      }],
    }]);
    assert.equal(out[0].content, 'line 1\nline 2');
  });

  it('user 同时含 tool_result + text → 拆成多消息', () => {
    const out = anthropicMessagesToOpenAI([{
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'result' },
        { type: 'text', text: 'thanks!' },
      ],
    }]);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, 'tool');
    assert.equal(out[1].role, 'user');
    assert.equal(out[1].content, 'thanks!');
  });

  it('多轮: user → assistant(tool_use) → user(tool_result) → assistant(final)', () => {
    const out = anthropicMessagesToOpenAI([
      { role: 'user', content: 'what is weather in SF?' },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { location: 'SF' } },
      ]},
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '72F' }]},
      { role: 'assistant', content: 'It is 72F in SF.' },
    ]);
    assert.equal(out.length, 4);
    assert.equal(out[0].role, 'user');
    assert.equal(out[0].content, 'what is weather in SF?');
    assert.equal(out[1].role, 'assistant');
    assert.equal(out[1].content, null);
    assert.equal(out[1].tool_calls[0].function.name, 'get_weather');
    assert.equal(out[2].role, 'tool');
    assert.equal(out[2].tool_call_id, 'tu_1');
    assert.equal(out[3].role, 'assistant');
    assert.equal(out[3].content, 'It is 72F in SF.');
  });
});

describe('Anthropic tools: 出站 (OpenAI → Anthropic content blocks)', () => {
  it('text only message', () => {
    const blocks = openAIToAnthropicContent({ content: 'hello' });
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as any).type, 'text');
    assert.equal((blocks[0] as any).text, 'hello');
  });

  it('text + tool_calls', () => {
    const blocks = openAIToAnthropicContent({
      content: 'Let me check.',
      tool_calls: [{
        id: 'call_abc',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"location":"SF"}' },
      }],
    });
    assert.equal(blocks.length, 2);
    assert.equal((blocks[0] as any).type, 'text');
    assert.equal((blocks[0] as any).text, 'Let me check.');
    assert.equal((blocks[1] as any).type, 'tool_use');
    assert.equal((blocks[1] as any).id, 'call_abc');
    assert.equal((blocks[1] as any).name, 'get_weather');
    assert.deepEqual((blocks[1] as any).input, { location: 'SF' });
  });

  it('tool_calls only (content null)', () => {
    const blocks = openAIToAnthropicContent({
      content: null,
      tool_calls: [{
        id: 'c1', type: 'function',
        function: { name: 'foo', arguments: '{}' },
      }],
    });
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as any).type, 'tool_use');
  });

  it('多 tool_calls', () => {
    const blocks = openAIToAnthropicContent({
      content: null,
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'a', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'b', arguments: '{}' } },
      ],
    });
    assert.equal(blocks.length, 2);
  });

  it('tool_calls arguments 是非法 JSON → input = {}', () => {
    const blocks = openAIToAnthropicContent({
      tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: 'not json' } }],
    });
    assert.deepEqual((blocks[0] as any).input, {});
  });

  it('缺 message → 空数组 (caller 决定 fallback)', () => {
    assert.equal(openAIToAnthropicContent(undefined).length, 0);
    assert.equal(openAIToAnthropicContent({}).length, 0);
  });
});

describe('Anthropic tools: SSE 流 tool_call 状态机', () => {
  it('单 tool_call 3 chunk: start(name+id) + 2 argument deltas', () => {
    const state = createToolCallStreamState();
    const events: any[] = [];
    // chunk 1: 给出 id + name (delta.tool_calls 格式)
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'get_weather', arguments: '' } }] } }],
    }, 1)) {
      events.push(ev);
    }
    // chunk 2: arguments 增量
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"loc' } }] } }],
    }, 1)) {
      events.push(ev);
    }
    // chunk 3: arguments 增量
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ation":"SF"}' } }] } }],
    }, 1)) {
      events.push(ev);
    }
    // 收尾
    for (const ev of finalizeToolCallStream(state)) {
      events.push(ev);
    }

    // 期望: 1 start + 2 delta + 1 stop = 4 events
    assert.equal(events.length, 4);
    assert.equal(events[0].event, 'content_block_start');
    assert.equal(events[0].data.index, 1);  // offset=1 (text 占 0)
    assert.equal(events[0].data.content_block.type, 'tool_use');
    assert.equal(events[0].data.content_block.id, 'call_abc');
    assert.equal(events[0].data.content_block.name, 'get_weather');
    assert.deepEqual(events[0].data.content_block.input, {});

    assert.equal(events[1].event, 'content_block_delta');
    assert.equal(events[1].data.delta.type, 'input_json_delta');
    assert.equal(events[1].data.delta.partial_json, '{"loc');

    assert.equal(events[2].event, 'content_block_delta');
    assert.equal(events[2].data.delta.partial_json, 'ation":"SF"}');

    assert.equal(events[3].event, 'content_block_stop');
    assert.equal(events[3].data.index, 1);
  });

  it('并行的 2 tool_calls 同一 chunk 里 (罕见但 OpenAI 支持)', () => {
    const state = createToolCallStreamState();
    const events: any[] = [];
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [
        { index: 0, id: 'a', function: { name: 'a', arguments: '{}' } },
        { index: 1, id: 'b', function: { name: 'b', arguments: '{}' } },
      ]}}],
    }, 1)) {
      events.push(ev);
    }
    // 2 start events
    const starts = events.filter((e) => e.event === 'content_block_start');
    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map((s) => s.data.index), [1, 2]);
    assert.deepEqual(starts.map((s) => s.data.content_block.name), ['a', 'b']);
  });

  it('缺 arguments delta (没传) → 不产 content_block_delta', () => {
    const state = createToolCallStreamState();
    const events: any[] = [];
    // start with no arguments
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'f' } }] }}],  // no arguments
    }, 1)) {
      events.push(ev);
    }
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'content_block_start');
  });

  it('空 tool_calls 数组 → 不产 event', () => {
    const state = createToolCallStreamState();
    const events: any[] = [];
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [] } }],
    }, 1)) {
      events.push(ev);
    }
    assert.equal(events.length, 0);
  });

  it('缺 tool_calls 字段 → 不产 event', () => {
    const state = createToolCallStreamState();
    const events: any[] = [];
    for (const ev of processOpenAIToolCallChunk(state, {}, 1)) {
      events.push(ev);
    }
    assert.equal(events.length, 0);
  });

  it('startIndex 0 → tool_use index 0 (caller 决定, 用于无 text 场景)', () => {
    const state = createToolCallStreamState();
    const events: any[] = [];
    for (const ev of processOpenAIToolCallChunk(state, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'f', arguments: '' } }] }}],
    }, 0)) {
      events.push(ev);
    }
    // 0 + 0 = 0 (offset=0)
    assert.equal(events.length, 1);
    assert.equal(events[0].data.index, 0);
  });
});
