/**
 * Phase 5: Provider 预设 + 分类 E2E
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
const port = 3049;
const mockPort = 3050;

before(async () => {
  try { await exec('fuser -k 3049/tcp 3050/tcp 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-prov-'));

  mockFile = join(tmpdir(), `mock-prov-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/v1/models' || req.url === '/v1/models/') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[
      {id:'gpt-4o-mini', owned_by:'openai'},
      {id:'gpt-4o', owned_by:'openai'},
      {id:'gpt-3.5-turbo', owned_by:'openai'},
    ]}));
    return;
  }
  if (req.url === '/v1/chat/completions' || req.url === '/v1/chat/completions/') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({id:'cmpl',model:'gpt-4o-mini',
      choices:[{index:0,message:{role:'assistant',content:'hi'},finish_reason:'stop'}],
      usage:{prompt_tokens:5,completion_tokens:1,total_tokens:6}}));
    return;
  }
  res.writeHead(404); res.end();
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('prov mock up\\n'));
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

describe('E2E: Provider 预设 (Phase 5)', () => {
  it('setup + login', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200);
    cookie = (sr.setCookie ?? '').split(';')[0];
  });

  it('GET /api/admin/providers 返回 ≥ 20 个预置, 含 minimax / ollama / openai, 分类对', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/providers`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.providers.length >= 20, `expected >=20 providers, got ${data.providers.length}`);

    const byName = Object.fromEntries(data.providers.map((p: any) => [p.name, p]));
    assert.ok(byName['minimax'], 'minimax missing');
    assert.equal(byName['minimax'].is_free, 0);
    assert.equal(byName['minimax'].base_url, 'https://api.minimax.chat/v1');
    assert.equal(byName['minimax'].protocol, 'openai');
    assert.equal(byName['minimax'].api_path, '/chat/completions');

    assert.ok(byName['ollama'], 'ollama missing');
    assert.equal(byName['ollama'].is_free, 1);
    assert.equal(byName['ollama'].category, 'self-hosted');

    assert.ok(byName['anthropic'], 'anthropic missing');
    assert.equal(byName['anthropic'].protocol, 'anthropic');
    // anthropic 默认 api_path 是 /messages (OpenAI 风格, 适配器内部处理)
    assert.equal(byName['anthropic'].api_path, '/messages');
  });

  it('channels page 返回 React SPA (添加渠道入口由前端渲染)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/admin/channels`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('FreeLLM Hub'), 'should have SPA title');
    assert.ok(html.includes('id="root"'), 'should have React root div');
    assert.ok(html.includes('module'), 'should have JS module script');
  });

  it('用预置 provider 加 channel + key, 验证 base_url 自动填充', async () => {
    // 找 ollama provider
    const list = await (await fetch(`http://127.0.0.1:${port}/api/admin/providers`, { headers: { cookie } })).json();
    const ollama = list.providers.find((p: any) => p.name === 'ollama');
    assert.ok(ollama, 'ollama not in list');

    // 用 ollama (改 base_url 指 mock, 保持 ollama 默认的 api_path/models_path)
    const r = await httpForm('/api/admin/channels',
      `provider_id=${ollama.id}&name=prov-test&provider_label=Provider Test&base_url=http://127.0.0.1:${mockPort}/v1&api_path=/chat/completions&models_path=/models&label=Test&api_key=sk-test&key_label=Test1`,
      cookie);
    assert.equal(r.status, 200, `add channel failed: ${r.text}`);
    const body = JSON.parse(r.text);
    assert.ok(body.ok);
    assert.ok(body.channel, `no channel in response: ${r.text}`);
    assert.ok(body.key_id, 1);
    assert.equal(body.channel_id, 1);
    // 因为我们传了 base_url=mock (与 ollama 默认不同), 创建了新的 provider
    assert.notEqual(body.provider_id, ollama.id, 'override base_url 应创建新 provider');
    assert.ok(body.provider_id > ollama.id, '新 provider id 应大于原 id');
    assert.equal(body.channel.base_url, `http://127.0.0.1:${mockPort}/v1`);
  });

  it('probe key 1, 验证从上游 /models 拉到了模型列表', async () => {
    const r = await httpForm('/api/admin/probe/1', '', cookie);
    if (r.status !== 200) {
      console.log('PROBE FAIL', r.status, r.text);
    }
    const data = JSON.parse(r.text);
    assert.ok(data.ok || data.status === 'ok', `probe failed: ${r.text}`);
    assert.ok(Array.isArray(data.models));
    assert.equal(data.models.length, 3);
    assert.ok(data.models.includes('gpt-4o-mini'));
    assert.ok(data.models.includes('gpt-4o'));
  });

  it('GET /api/admin/keys/1/models 返回该 key 的 discovered models', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/keys/1/models`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.keyId, 1);
    assert.ok(data.models.length >= 3);
    const ids = data.models.map((m: any) => m.upstream_id);
    assert.ok(ids.includes('gpt-4o-mini'));
  });

  it('未登录 /api/admin/providers → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/providers`);
    assert.equal(r.status, 401);
  });
});
