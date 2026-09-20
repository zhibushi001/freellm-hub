/**
 * Phase 5: Channel newapi 风格字段 + Test API E2E
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, exec as execCb, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execCb);

let dataDir: string;
let server: ChildProcess;
let mock: ChildProcess;
let mockFile: string;
const port = 3051;
const mockPort = 3052;

before(async () => {
  try { await exec('fuser -k 3051/tcp 3052/tcp 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-newapi-'));

  // mock 提供 /v1/models 和 /v1/chat/completions
  mockFile = join(tmpdir(), `mock-newapi-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
let n = 0;
http.createServer((req, res) => {
  if (req.url === '/v1/models' || req.url === '/v1/models/') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[
      {id:'gpt-4o-mini', owned_by:'openai'},
      {id:'gpt-4o', owned_by:'openai'},
      {id:'claude-3-haiku', owned_by:'anthropic'},
    ]}));
    return;
  }
  if (req.url === '/v1/chat/completions' || req.url === '/v1/chat/completions/') {
    n++;
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      // 简单 model mapping 模拟: 请求 gpt-4o -> 返回 custom-model
      const m = parsed.model || 'unknown';
      // status mapping: 模拟 401 时实际返 200
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({
        id: 'cmpl-' + n, model: m,
        choices: [{index:0, message:{role:'assistant',content:'ok from ' + m}, finish_reason:'stop'}],
        usage: {prompt_tokens:5, completion_tokens:2, total_tokens:7}
      }));
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('newapi mock up\\n'));
`);

  mock = spawn('node', [mockFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  mock.stderr?.on('data', (d) => process.stderr.write(`[mock] ${d}`));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${mockPort}/v1/models`); if (r.status === 200) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, HUB_DATA_DIR: dataDir, HUB_PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/v1/health`); if (r.status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server failed to start');
});

after(async () => {
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
  }, 60_000);
});

async function httpForm(path: string, body: string, cookie?: string): Promise<{ status: number; text: string; setCookie: string | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') };
}

let cookie = '';

describe('E2E: Channel newapi 风格 (Phase 5)', () => {
  it('setup + login', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200);
    cookie = (sr.setCookie ?? '').split(';')[0];
  });

  it('Provider 列表 ≥ 50 个 (扩了 freellmapi 风格 + 完整聚合)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/providers`, { headers: { cookie } });
    const data = await r.json();
    assert.ok(data.providers.length >= 50, `expected >=50 providers, got ${data.providers.length}`);
    const byName = Object.fromEntries(data.providers.map((p: any) => [p.name, p]));
    // 验证 free 类 provider
    for (const name of ['cerebras', 'huggingface', 'pollinations', 'siliconflow', 'kilo', 'modelscope', 'baidu-qianfan', 'volcengine-ark', 'nvidia-nim', 'aihorde']) {
      assert.ok(byName[name], `expected provider ${name}`);
      assert.equal(byName[name].is_free, 1, `${name} should be free`);
    }
  });

  it('Batch add: 一次性加 3 个 channel (一行一个 key)', async () => {
    const r = await httpForm('/api/admin/channels',
      `name=batch-test&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_keys_batch=sk-key-1%0Ask-key-2%0Ask-key-3&label=BatchTest&models=gpt-4o,claude-3&multi_key_mode=polling&test_model=gpt-4o-mini&tag=batch-test`,
      cookie);
    assert.equal(r.status, 200, `batch add failed: ${r.text}`);
    const data = JSON.parse(r.text);
    assert.equal(data.ok, true);
    assert.equal(data.batch, true);
    assert.equal(data.created_count, 3);
    assert.equal(data.created[0].channel_id, 1);
    assert.equal(data.created[1].channel_id, 2);
    assert.equal(data.created[2].channel_id, 3);
  });

  it('GET /api/admin/channels/1 返回完整字段 (含 model_mapping 等 JSON 解析后)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/channels/1`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.ok);
    assert.equal(data.channel.id, 1);
    assert.equal(data.channel.models, 'gpt-4o,claude-3');
    assert.equal(data.channel.multi_key_mode, 'polling');
    assert.equal(data.channel.test_model, 'gpt-4o-mini');
    assert.equal(data.channel.tag, 'batch-test');
    // JSON 字段应是 object (不是 string)
    assert.equal(typeof data.channel.model_mapping, 'object');
    assert.equal(typeof data.channel.status_code_mapping, 'object');
    assert.equal(typeof data.channel.param_override, 'object');
    assert.equal(typeof data.channel.header_override, 'object');
  });

  it('PUT /api/admin/channels/1 改 model_mapping, GET 验证', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/channels/1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        model_mapping: { 'gpt-4o': 'claude-3-haiku' },
        test_model: 'gpt-4o',
      }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.ok, true);
    assert.equal(data.channel.test_model, 'gpt-4o');

    const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/channels/1`, { headers: { cookie } });
    const d2 = await r2.json();
    assert.deepEqual(d2.channel.model_mapping, { 'gpt-4o': 'claude-3-haiku' });
  });

  it('POST /api/admin/channels/1/test 用默认 model 调用', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/channels/1/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'ping' }),
    });
    const text = await r.text();
    const data = JSON.parse(text);
    assert.equal(r.status, 200, `test failed: ${r.status} ${text}`);
    // 用了 test_model = gpt-4o
    assert.equal(data.model, 'gpt-4o');
    // 但 model_mapping 把它映射到 claude-3-haiku
    assert.equal(data.upstream_model, 'claude-3-haiku', `expected mapped, got ${data.upstream_model}`);
    assert.equal(data.ok, true, `data.ok false, full: ${text}`);
    assert.equal(data.status, 200);
    assert.ok(data.latencyMs > 0);
  });

  it('POST /api/admin/channels/1/test 显式 model 覆盖 test_model', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/channels/1/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ model: 'gpt-4o-mini', message: 'ping' }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.model, 'gpt-4o-mini');
    // gpt-4o-mini 没在 mapping, upstream 应等于 model
    assert.equal(data.upstream_model, 'gpt-4o-mini');
  });

  it('未登录调 /api/admin/channels/1/test → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/channels/1/test`, { method: 'POST' });
    assert.equal(r.status, 401);
  });

  it('Single add (有 provider_id 复用预置)', async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/api/admin/providers`, { headers: { cookie } })).json();
    const cerebras = list.providers.find((p: any) => p.name === 'cerebras');
    assert.ok(cerebras, 'cerebras not in list');
    // 用 cerebras 预置, base_url override 指 mock
    const r = await httpForm('/api/admin/channels',
      `provider_id=${cerebras.id}&name=single-newapi&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-single&label=Single&model_mapping=%7B%22claude-3%22%3A%22gpt-4o-mini%22%7D`,
      cookie);
    assert.equal(r.status, 200, `single add: ${r.text}`);
    const data = JSON.parse(r.text);
    assert.equal(data.ok, true);
    // provider_id 应是新建的 (base_url 改了), 不是 cerebras
    assert.notEqual(data.provider_id, cerebras.id, 'override base_url 应创建新 provider');
  });

  it('Batch add 空字符串 → 400', async () => {
    const r = await httpForm('/api/admin/channels',
      `name=empty&base_url=http://x&api_keys_batch=`,
      cookie);
    // 没 api_key 也没 batch → 400
    assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  });
});
