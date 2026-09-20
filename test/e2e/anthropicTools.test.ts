/**
 * Anthropic tool_use 端到端测试
 * 模拟 Claude Code 用 tools 调
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let server: ChildProcess;
let mock: ChildProcess;
let mockFile: string;
const port = 3039;
const mockPort = 3040;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hub-tool-'));

  // 写 mock 到独立文件 (避免 spawn -e 转义地狱)
  mockFile = join(tmpdir(), `mock-tool-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
let callCount = 0;
http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'claude-3-5-sonnet-20241022'}]}));
    return;
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404); res.end(); return;
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    callCount++;
    const isStream = body.includes('"stream":true');
    const hasToolResult = body.includes('"role":"tool"');

    if (!isStream) {
      if (!hasToolResult) {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({
          id: 'chatcmpl-tool-' + callCount,
          model: 'gpt-4o-mini',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'Let me check the weather for you.',
              tool_calls: [{
                id: 'call_weather_1',
                type: 'function',
                function: { name: 'get_weather', arguments: JSON.stringify({location: 'SF'}) }
              }]
            },
            finish_reason: 'tool_calls'
          }],
          usage: {prompt_tokens: 20, completion_tokens: 15, total_tokens: 35}
        }));
      } else {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({
          id: 'chatcmpl-final-' + callCount,
          model: 'gpt-4o-mini',
          choices: [{
            index: 0,
            message: {role: 'assistant', content: 'It is 72F and sunny in your location.'},
            finish_reason: 'stop'
          }],
          usage: {prompt_tokens: 40, completion_tokens: 10, total_tokens: 50}
        }));
      }
    } else {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      // JSON.stringify 处理转义, 然后按 SSE 格式包装
      const arg1 = JSON.stringify({ location: 'SF' });  // {"location":"SF"}
      const argPart1 = arg1.slice(0, 6);  // {"loc
      const argPart2 = arg1.slice(6);     // ation":"SF"}
      const chunks = [
        'data: {"id":"c","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"content":"Let me check"},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_w","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":' + JSON.stringify(argPart1) + '}}]},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":' + JSON.stringify(argPart2) + '}}]},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\\n\\n',
        'data: [DONE]\\n\\n',
      ];
      for (const c of chunks) res.write(c);
      res.end();
    }
  });
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('tool mock up\\n'));
`);

  mock = spawn('node', [mockFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  mock.stderr?.on('data', (d) => process.stderr.write(`[mock] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${mockPort}/v1/models`);
      if (r.status === 200) break;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, HUB_DATA_DIR: dataDir, HUB_PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (r.status === 200) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server failed to start');
});

after(async () => {
  console.log('data dir kept for debug:', dataDir);
  // 等子进程真正退出 (避免 node --test 不知有 child process)
  const killAndWait = (p) => new Promise<void>((resolve) => {
    if (!p || p.killed || p.exitCode !== null) return resolve();
    p.once('exit', () => resolve());
    p.kill('SIGTERM');
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 1500);
  });
  await Promise.all([killAndWait(mock), killAndWait(server)]);
  setTimeout(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    try { if (mockFile) rmSync(mockFile, { force: true }); } catch {}
  }, 5 * 60_000);
});

async function httpForm(path: string, body: string, cookie?: string): Promise<{ status: number; text: string; setCookie: string | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') };
}

describe('E2E: Anthropic tool_use', () => {
  it('非流式: 第一次返 tool_use', async () => {
    let r = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(r.status, 200);
    const cookie = r.setCookie!.split(';')[0];

    r = await httpForm('/api/admin/channels',
      `name=mock&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk&key_label=K`,
      cookie);
    assert.equal(r.status, 200);
    r = await httpForm('/api/admin/probe/1', '', cookie);
    assert.equal(r.status, 200);

    r = await httpForm('/api/admin/hub-keys', 'name=claude-tool', cookie);
    const hubKey = JSON.parse(r.text).plainKey;

    const r1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': hubKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Weather in SF?' }],
        max_tokens: 500,
        tools: [{
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
        }],
      }),
    });
    assert.equal(r1.status, 200);
    const body1 = JSON.parse(await r1.text());
    assert.equal(body1.type, 'message');
    assert.equal(body1.stop_reason, 'tool_use');
    assert.equal(body1.content.length, 2);
    assert.equal(body1.content[0].type, 'text');
    assert.equal(body1.content[1].type, 'tool_use');
    assert.equal(body1.content[1].id, 'call_weather_1');
    assert.equal(body1.content[1].name, 'get_weather');
    assert.deepEqual(body1.content[1].input, { location: 'SF' });
  });

  it('多轮: user → assistant(tool_use) → user(tool_result) → final', async () => {
    const lr = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    assert.equal(lr.status, 200, `login: ${lr.text}`);
    const cookie = lr.setCookie!.split(';')[0];

    const hkr = await httpForm('/api/admin/hub-keys', 'name=claude-tool2', cookie);
    const hubKey = JSON.parse(hkr.text).plainKey;

    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': hubKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'Weather in SF?' },
          { role: 'assistant', content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'call_weather_1', name: 'get_weather', input: { location: 'SF' } },
          ]},
          { role: 'user', content: [
            { type: 'tool_result', tool_use_id: 'call_weather_1', content: '72F and sunny' },
          ]},
        ],
        max_tokens: 500,
        tools: [{
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: { type: 'object', properties: { location: { type: 'string' } } },
        }],
      }),
    });
    assert.equal(r.status, 200);
    const body = JSON.parse(await r.text());
    assert.equal(body.stop_reason, 'end_turn');
    assert.equal(body.content.length, 1);
    assert.equal(body.content[0].type, 'text');
    assert.match(body.content[0].text, /72F/);
  });

  it('流式: tool_use delta 序列', async () => {
    const lr = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    const cookie = lr.setCookie!.split(';')[0];

    const hkr = await httpForm('/api/admin/hub-keys', 'name=claude-stream-tool', cookie);
    const hubKey = JSON.parse(hkr.text).plainKey;

    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': hubKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'stream + tool test' }],
        max_tokens: 500,
        stream: true,
        tools: [{
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { location: { type: 'string' } } },
        }],
      }),
    });
    assert.equal(r.status, 200);
    const sseText = await r.text();
    const events = sseText.split('\n\n').filter(Boolean);
    assert.ok(events.length >= 10, `expected ≥10 events, got ${events.length}: ${sseText}`);

    // 1. message_start
    assert.match(events[0], /event: message_start/);
    // 2. text content_block_start (index 0)
    const textStart = events.find(e => e.includes('content_block_start') && e.includes('"index":0'));
    assert.ok(textStart, 'should have text content_block_start at index 0');
    // 3. text delta
    const textDelta = events.find(e => e.includes('content_block_delta') && e.includes('"index":0') && e.includes('text_delta'));
    assert.ok(textDelta);
    assert.match(textDelta!, /Let me check/);
    // 4. text stop
    const textStop = events.find(e => e.includes('content_block_stop') && e.includes('"index":0'));
    assert.ok(textStop);
    // 5. tool_use content_block_start (index 1)
    const toolStart = events.find(e => e.includes('content_block_start') && e.includes('"index":1'));
    assert.ok(toolStart);
    assert.match(toolStart!, /"type":"tool_use"/);
    assert.match(toolStart!, /"name":"get_weather"/);
    // 6-7. input_json_delta (2 个)
    const jsonDeltas = events.filter(e => e.includes('content_block_delta') && e.includes('input_json_delta'));
    assert.equal(jsonDeltas.length, 2, `expected 2 json deltas, got ${jsonDeltas.length}`);
    // 拼起来应等于 '{"location":"SF"}'
    const fullJson = jsonDeltas.map(d => {
      const m = d.match(/"partial_json":"(.*?)(?<!\\)"/);
      return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
    }).join('');
    assert.equal(fullJson, '{"location":"SF"}', `fullJson = ${fullJson}`);
    // 8. tool_use stop
    const toolStop = events.find(e => e.includes('content_block_stop') && e.includes('"index":1'));
    assert.ok(toolStop);
    // 9. message_delta stop_reason: tool_use
    const msgDelta = events.find(e => e.startsWith('event: message_delta'));
    assert.ok(msgDelta);
    assert.match(msgDelta!, /tool_use/);
    // 10. message_stop
    assert.match(events[events.length - 1], /event: message_stop/);
  });
});
