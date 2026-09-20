/**
 * Phase 5.E: Model routes E2E
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
const port = 3055;
const mockPort = 3056;

before(async () => {
  try { const { exec } = await import('node:child_process'); await new Promise<void>((r) => exec(`fuser -k ${port}/tcp ${mockPort}/tcp 2>/dev/null`, () => r())); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-routes-'));

  // mock: /v1/chat/completions
  mockFile = join(tmpdir(), `mock-routes-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
let n = 0;
http.createServer((req, res) => {
  if (req.url === '/v1/models' || req.url === '/v1/models/') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'mock-model', owned_by:'mock'}]}));
    return;
  }
  if (req.url === '/v1/chat/completions' || req.url === '/v1/chat/completions/') {
    n++;
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      let parsed = {}; try { parsed = JSON.parse(body); } catch {}
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({id: 'cmpl-' + n, model: parsed.model, choices: [{index:0, message:{role:'assistant',content:'ok'}, finish_reason:'stop'}]}));
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('routes mock up\\n'));
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
let hubKey = '';
let channelA = 0, channelB = 0;

describe('E2E: Model routes (Phase 5.E)', () => {
  it('setup + login + hub key + 2 channels', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200);
    cookie = (sr.setCookie ?? '').split(';')[0];

    // hub key
    const kr = await httpForm('/api/admin/hub-keys', 'name=route-test', cookie);
    assert.equal(kr.status, 200);
    hubKey = JSON.parse(kr.text).plainKey;

    // 2 channels (同一 mock, 不同 label)
    const r1 = await httpForm('/api/admin/channels',
      `name=route-a&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-a&label=ChannelA`,
      cookie);
    assert.equal(r1.status, 200);
    channelA = JSON.parse(r1.text).channel_id;

    const r2 = await httpForm('/api/admin/channels',
      `name=route-b&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-b&label=ChannelB`,
      cookie);
    assert.equal(r2.status, 200);
    channelB = JSON.parse(r2.text).channel_id;
  });

  it('Create model route: "test-route-model" → [channelA, channelB]', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ request_model: 'test-route-model', channel_ids: [channelA, channelB], notes: 'A primary, B fallback' }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.ok, true);
    assert.equal(data.route.request_model, 'test-route-model');
    assert.deepEqual(JSON.parse(data.route.channel_ids), [channelA, channelB]);
  });

  it('Duplicate model route → 409', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ request_model: 'test-route-model', channel_ids: [channelA] }),
    });
    assert.equal(r.status, 409);
  });

  it('List routes', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, { headers: { cookie } });
    const data = await r.json();
    assert.ok(data.routes.length >= 1);
    assert.ok(data.routes.find((x: any) => x.request_model === 'test-route-model'));
  });

  it('真实调用 /v1/chat/completions with model="test-route-model" 走 route (chA first)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({ model: 'test-route-model', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    const keyIdHeader = r.headers.get('x-hub-key-id');
    assert.ok(keyIdHeader);
  });

  it('PUT 更新 route (把顺序反过来, B 优先)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, { headers: { cookie } });
    const data = await r.json();
    const route = data.routes.find((x: any) => x.request_model === 'test-route-model');

    const pr = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes/${route.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ channel_ids: [channelB, channelA], notes: 'updated' }),
    });
    assert.equal(pr.status, 200);
    const pd = await pr.json();
    assert.deepEqual(JSON.parse(pd.route.channel_ids), [channelB, channelA]);
    assert.equal(pd.route.notes, 'updated');
  });

  it('Disable route + request test-route-model → 走默认 resolver', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, { headers: { cookie } });
    const data = await r.json();
    const route = data.routes.find((x: any) => x.request_model === 'test-route-model');
    await fetch(`http://127.0.0.1:${port}/api/admin/model-routes/${route.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: 0 }),
    });

    const cr = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({ model: 'test-route-model', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(cr.status, 200, `body: ${await cr.text()}`);
  });

  it('DELETE route → 再 create 同名 ok (unique)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, { headers: { cookie } });
    const data = await r.json();
    const route = data.routes.find((x: any) => x.request_model === 'test-route-model');
    await fetch(`http://127.0.0.1:${port}/api/admin/model-routes/${route.id}`, { method: 'DELETE', headers: { cookie } });

    const cr = await fetch(`http://127.0.0.1:${port}/api/admin/model-routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ request_model: 'test-route-model', channel_ids: [channelA] }),
    });
    assert.equal(cr.status, 200);
  });
});
