/**
 * OpenAI Responses 端到端测试
 * 模拟 Codex CLI / Agents SDK (用 Responses 协议) → hub → OpenAI mock → Responses 响应
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
const port = 3041;
const mockPort = 3042;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hub-resp-'));

  mockFile = join(tmpdir(), `mock-resp-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
let callCount = 0;
http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'gpt-4o-mini'}]}));
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
    const req2 = JSON.parse(body);
    const hasToolResult = req2.messages && req2.messages.some(m => m.role === 'tool');

    if (!isStream) {
      if (!hasToolResult) {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({
          id: 'chatcmpl-resp-' + callCount,
          model: 'gpt-4o-mini',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'It is 72F and sunny in San Francisco.',
              tool_calls: [{
                id: 'call_get_weather',
                type: 'function',
                function: { name: 'get_weather', arguments: JSON.stringify({location: 'San Francisco'}) }
              }]
            },
            finish_reason: 'tool_calls'
          }],
          usage: {prompt_tokens: 15, completion_tokens: 12, total_tokens: 27}
        }));
      } else {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({
          id: 'chatcmpl-resp-final-' + callCount,
          model: 'gpt-4o-mini',
          choices: [{
            index: 0,
            message: {role: 'assistant', content: 'Based on the data, SF is 72F and sunny.'},
            finish_reason: 'stop'
          }],
          usage: {prompt_tokens: 30, completion_tokens: 8, total_tokens: 38}
        }));
      }
    } else {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      // 用 JSON.stringify 处理嵌套, 避免手写转义错
      const argJson = JSON.stringify({ location: 'SF' });
      const chunks = [
        'data: {"id":"c","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"content":"It is "},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"content":"72F"},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_w","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":' + JSON.stringify(argJson) + '}}]},"finish_reason":null}]}\\n\\n',
        'data: {"id":"c","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\\n\\n',
        'data: [DONE]\\n\\n',
      ];
      for (const c of chunks) res.write(c);
      res.end();
    }
  });
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('resp mock up\\n'));
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
  server.stdout?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  server.stderr?.on('data', (d) => process.stderr.write(`[server-err] ${d}`));
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
  const killAndWait = (p: any) => new Promise<void>((resolve) => {
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

async function setupHub(): Promise<{ cookie: string; hubKey: string }> {
  // 用 login 复用之前的 admin (可能已存在)
  let r = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
  let cookie: string;
  if (r.status === 200) {
    cookie = r.setCookie!.split(';')[0];
  } else {
    r = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(r.status, 200);
    cookie = r.setCookie!.split(';')[0];
  }

  // channel: 试用 channel id 1 (probe 通过即可), 不再新建
  // 探活现有 key
  r = await httpForm('/api/admin/probe/1', '', cookie);
  if (r.status !== 200) {
    // 没 key 1, 加 channel + 2 key
    r = await httpForm('/api/admin/channels',
      `name=mock&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk&key_label=K`,
      cookie);
    if (r.status !== 200) {
      console.error('channel add failed:', r.status, r.text);
    }
    r = await httpForm('/api/admin/probe/1', '', cookie);
  }

  // hub key
  const ts = Date.now();
  r = await httpForm('/api/admin/hub-keys', `name=resp-${ts}`, cookie);
  if (r.status !== 200) {
    console.error('hub-key failed:', r.status, r.text);
  }
  return { cookie, hubKey: JSON.parse(r.text).plainKey };
}

describe('E2E: OpenAI Responses /v1/responses', () => {
  it('非流式: text + tool_calls → Responses output: [message, function_call]', async () => {
    const { hubKey } = await setupHub();
    const r = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: 'What is the weather in San Francisco?',
        instructions: 'You are a helpful weather assistant.',
        tools: [{
          type: 'function',
          name: 'get_weather',
          description: 'Get the current weather for a location',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        }],
      }),
    });
    assert.equal(r.status, 200);
    const body = JSON.parse(await r.text());
    assert.equal(body.object, 'response');
    assert.equal(body.status, 'completed');
    assert.ok(body.id.startsWith('resp_'));
    // output: message + function_call (因为 mock chat 返 text + tool_calls, chatToResponses 先放 fc 再放 msg)
    assert.equal(body.output.length, 2);
    // 找 message 和 function_call
    const msg = body.output.find((o: any) => o.type === 'message');
    const fc = body.output.find((o: any) => o.type === 'function_call');
    assert.ok(msg);
    assert.ok(fc);
    assert.equal(msg.content[0].text, 'It is 72F and sunny in San Francisco.');
    assert.equal(fc.name, 'get_weather');
    assert.equal(fc.call_id, 'call_get_weather');
    assert.deepEqual(JSON.parse(fc.arguments), { location: 'San Francisco' });
    assert.equal(body.usage.input_tokens, 15);
    assert.equal(body.usage.output_tokens, 12);
  });

  it('多轮: user → assistant(fc) → function_call_output → final', async () => {
    const { hubKey } = await setupHub();
    const r = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SF weather?' }] },
          {
            type: 'function_call', call_id: 'call_1', name: 'get_weather',
            arguments: '{"location":"SF"}',
          },
          {
            type: 'function_call_output', call_id: 'call_1', output: '72F and sunny',
          },
        ],
        tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }],
      }),
    });
    assert.equal(r.status, 200);
    const body = JSON.parse(await r.text());
    assert.equal(body.status, 'completed');
    // mock 返纯 text → 1 message item
    assert.equal(body.output.length, 1);
    assert.equal(body.output[0].type, 'message');
    assert.match(body.output[0].content[0].text, /72F/);
  });

  it('流式: response.created + output_item + output_text.delta + tool_call + completed', async () => {
    const { hubKey } = await setupHub();
    const r = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: 'stream test',
        stream: true,
        tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }],
      }),
    });
    assert.equal(r.status, 200);
    const sseText = await r.text();
    const events = sseText.split('\n\n').filter(Boolean);

    // 1. response.created
    const created = events.find((e) => e.startsWith('event: response.created'));
    assert.ok(created);
    assert.match(created!, /"status":"in_progress"/);

    // 2. text deltas (2 个: "It is " + "72F")
    const textDeltas = events.filter((e) => e.includes('response.output_text.delta'));
    assert.equal(textDeltas.length, 2);

    // 3. function_call_arguments.delta (1 个)
    const argDelta = events.find((e) => e.includes('response.function_call_arguments.delta'));
    assert.ok(argDelta);
    assert.match(argDelta!, /"partial_json":|"delta":/);

    // 4. response.completed
    const completed = events.find((e) => e.startsWith('event: response.completed'));
    assert.ok(completed);
    assert.match(completed!, /"status":"completed"|"status":"incomplete"/);
  });
});
