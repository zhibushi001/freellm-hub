/**
 * Anthropic /v1/messages 端到端测试
 * 模拟 Claude Code 发送请求, 验证:
 *  1. 非流式: Anthropic 请求 → OpenAI 上游 → Anthropic 响应
 *  2. 流式: Anthropic 请求 → OpenAI SSE 上游 → Anthropic SSE 响应
 *  3. 多 Key failover
 *  4. 错误转换 (401 → authentication_error)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let dataDir: string;
let server: ChildProcess;
let mock: ChildProcess;
const port = 3037;
const mockPort = 3038;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hub-anthropic-'));

  // 启 mock upstream (OpenAI 格式)
  mock = spawn('node', ['-e', `
const http = require('http');
let callCount = 0;
http.createServer((req, res) => {
  console.error('MOCK', req.method, req.url);
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({object: 'list', data: [{id: 'claude-3-5-sonnet-20241022'}, {id: 'gpt-4o-mini'}]}));
  } else if (req.url === '/v1/chat/completions') {
    callCount++;
    // Anthropic 客户端用 max_tokens 但上游 OpenAI 也能吃 max_tokens 字段
    // body 含 stream: true → 返回 SSE
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      const isStream = body.includes('"stream":true');
      // 第一次 401, 之后 200 (failover 测试)
      if (callCount === 1) {
        res.writeHead(401, {'content-type': 'application/json'});
        res.end(JSON.stringify({error: {message: 'invalid', type: 'invalid_api_key'}}));
        return;
      }
      if (!isStream) {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({
          id: 'chatcmpl-' + callCount,
          model: 'gpt-4o-mini',
          choices: [{index: 0, message: {role: 'assistant', content: 'Hi from key ' + callCount}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 8, completion_tokens: 4, total_tokens: 12}
        }));
      } else {
        // SSE 流
        res.writeHead(200, {'content-type': 'text/event-stream'});
        const chunks = [
          'data: {"id":"c","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\\n\\n',
          'data: {"id":"c","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\\n\\n',
          'data: {"id":"c","choices":[{"index":0,"delta":{"content":" from"},"finish_reason":null}]}\\n\\n',
          'data: {"id":"c","choices":[{"index":0,"delta":{"content":" stream"},"finish_reason":null}]}\\n\\n',
          'data: {"id":"c","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\\n\\n',
          'data: [DONE]\\n\\n',
        ];
        for (const c of chunks) {
          res.write(c);
        }
        res.end();
      }
    });
  } else {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(${mockPort}, '127.0.0.1', () => console.error('anthropic mock up'));
`], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  }, 5 * 60_000);
});

async function httpForm(path: string, body: string, cookie?: string): Promise<{ status: number; text: string; setCookie: string | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') };
}

describe('E2E: Anthropic /v1/messages', () => {
  it('非流式: Anthropic 请求 → OpenAI 上游 → Anthropic 响应 + 401 failover', async () => {
    // setup
    let r = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(r.status, 200);
    const cookie = r.setCookie!.split(';')[0];

    // 1 channel + 2 key
    r = await httpForm('/api/admin/channels',
      `name=mock&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-a1&key_label=A1`,
      cookie);
    assert.equal(r.status, 200);
    r = await httpForm('/api/admin/channels/1/keys', 'label=A2&api_key=sk-a2', cookie);
    assert.equal(r.status, 200);

    // 探活
    for (const kid of [1, 2]) {
      r = await httpForm(`/api/admin/probe/${kid}`, '', cookie);
      assert.equal(r.status, 200);
    }

    // 创建 Hub Key
    r = await httpForm('/api/admin/hub-keys', 'name=claude', cookie);
    const hubKey = JSON.parse(r.text).plainKey;

    // 1. 缺鉴权 → 401 authentication_error (Anthropic route 鉴权先行)
    r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      }),
    });
    const noauthText = await r.text();
    assert.equal(r.status, 401, `expected 401, got ${r.status}: ${noauthText}`);
    const noauthBody = JSON.parse(noauthText);
    assert.equal(noauthBody.error.type, 'authentication_error');

    // 2. 缺 max_tokens → 400 invalid_request_error
    r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': hubKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const errText = await r.text();
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${errText}`);
    const errBody = JSON.parse(errText);
    assert.equal(errBody.type, 'error');
    assert.equal(errBody.error.type, 'invalid_request_error');

    // 3. 正常请求 → A1 401 → failover A2 → 200 Anthropic 格式
    r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': hubKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        system: 'You are helpful.',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'tell me a joke' },
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });
    const respText = await r.text();
    assert.equal(r.status, 200, `chat should succeed: ${respText}`);
    const body = JSON.parse(respText);
    assert.equal(body.type, 'message');
    assert.equal(body.role, 'assistant');
    assert.equal(body.stop_reason, 'end_turn');
    assert.equal(body.usage.input_tokens, 8);
    assert.equal(body.usage.output_tokens, 4);
    assert.equal(body.content[0].type, 'text');
    assert.match(body.content[0].text, /Hi from key 2/);
    assert.ok(body.id.startsWith('chatcmpl-') || body.id.startsWith('msg_'));
  });

  it('流式: Anthropic stream 请求 → OpenAI SSE → Anthropic SSE 事件', async () => {
    // 复用 test 1 的 setup (cookie 仍有效, channel/keys 已存在), 直接创个新 hub key 走流式
    // 先重新 login (cookie 可能过期)
    const lr = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    assert.equal(lr.status, 200, `login should succeed, got ${lr.status}: ${lr.text}`);
    const cookie = lr.setCookie!.split(';')[0];

    const hkr = await httpForm('/api/admin/hub-keys', 'name=claude2', cookie);
    assert.equal(hkr.status, 200, `hub key create: ${hkr.text}`);
    const hubKey = JSON.parse(hkr.text).plainKey;

    // 流式请求
    const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': hubKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'stream test' }],
        max_tokens: 100,
        stream: true,
      }),
    });
    assert.equal(r2.status, 200, `stream should return 200, got ${r2.status}`);
    assert.match(r2.headers.get('content-type') ?? '', /text\/event-stream/);

    const sseText = await r2.text();
    const events = sseText.split('\n\n').filter(Boolean);
    // 至少 6 个事件 (start + start + 3 deltas + delta + stop)
    assert.ok(events.length >= 6, `expected ≥6 events, got ${events.length}: ${sseText}`);

    // 第一个应是 message_start
    assert.match(events[0], /event: message_start/);
    // 第二个应是 content_block_start
    assert.match(events[1], /event: content_block_start/);
    // 3 个非空 content_block_delta
    const deltas = events.filter(e => e.includes('event: content_block_delta'));
    assert.equal(deltas.length, 3);  // "Hello" / " from" / " stream"
    const fullText = deltas.map(d => {
      const m = d.match(/"text":"([^"]*)"/);
      return m ? m[1] : '';
    }).join('');
    assert.equal(fullText, 'Hello from stream');
    // 最后是 message_stop
    assert.match(events[events.length - 1], /event: message_stop/);
    // message_delta 应有 stop_reason: end_turn
    const msgDelta = events.find(e => e.startsWith('event: message_delta'));
    assert.ok(msgDelta);
    assert.match(msgDelta!, /end_turn/);
  });
});
