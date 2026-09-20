/**
 * Phase 4.A 修补: Admin Web UI 端到端测试
 * 浏览器风格: 模拟 FormData 提交 (urlencoded) + dashboard / channels / usage
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
const port = 3043;
const mockPort = 3044;

before(async () => {
  try { await exec('fuser -k 3043/tcp 3044/tcp 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-adminUi-'));

  mockFile = join(tmpdir(), `mock-adminUi-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
let n = 0;
http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'gpt-4o-mini'}]}));
    return;
  }
  n++;
  res.writeHead(200, {'content-type':'application/json'});
  res.end(JSON.stringify({
    id: 'cmpl-' + n, model: 'gpt-4o-mini',
    choices: [{index:0, message:{role:'assistant',content:'hi'}, finish_reason:'stop'}],
    usage: {prompt_tokens:5, completion_tokens:1, total_tokens:6}
  }));
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('adminUi mock up\\n'));
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

let lastCookie = '';

async function httpForm(path: string, body: string, cookie?: string): Promise<{ status: number; text: string; setCookie: string | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') };
}

async function login(admin = 'admin', pwd = 'Test1234Pass'): Promise<string> {
  const r = await httpForm('/api/admin/auth/login', `username=${encodeURIComponent(admin)}&password=${encodeURIComponent(pwd)}`);
  assert.equal(r.status, 200, `login: ${r.status} ${r.text}`);
  const data = JSON.parse(r.text);
  assert.ok(data.ok, `login ok: ${r.text}`);
  lastCookie = (r.setCookie ?? '').split(';')[0];
  return lastCookie;
}

describe('E2E: Admin Web UI (Phase 4.A)', () => {
  it('先 setup', async () => {
    const r = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(r.status, 200, `setup: ${r.text}`);
    lastCookie = (r.setCookie ?? '').split(';')[0];
  });

  it('未登录访问 /api/admin/dashboard → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/dashboard`);
    assert.equal(r.status, 401);
  });

  it('未登录访问 /api/admin/channels/list → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/channels/list`);
    assert.equal(r.status, 401);
  });

  it('未登录访问 /api/admin/usage/trend → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/usage/trend?days=7`);
    assert.equal(r.status, 401);
  });

  it('/admin/dashboard 渲染 + nav 出现', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/admin/dashboard`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('FreeLLM Hub'));
    assert.ok(html.includes('id="root"'), `expected React root div, got: ${html.slice(0, 300)}`);
    assert.ok(html.includes('module'), `expected script module tag, got: ${html.slice(0, 300)}`);
  });

  it('/api/admin/dashboard 返回正确 JSON', async () => {
    const cookie = lastCookie || await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/dashboard`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(typeof data.channelCount, 'number');
    assert.equal(typeof data.keyCount, 'number');
    assert.ok(data.last24h);
  });

  it('/admin/usage 渲染 + trend API 返回空数据', async () => {
    const cookie = lastCookie || await login();
    const r1 = await fetch(`http://127.0.0.1:${port}/admin/usage`, { headers: { cookie } });
    assert.equal(r1.status, 200);
    const html = await r1.text();
    assert.ok(html.includes('FreeLLM Hub'), `expected SPA shell, got: ${html.slice(0, 300)}`);
    assert.ok(html.includes('id="root"'), `expected React root div, got: ${html.slice(0, 300)}`);
    const r2 = await (await fetch(`http://127.0.0.1:${port}/api/admin/usage/trend?days=7`, { headers: { cookie } })).json();
    assert.ok(r2.data);
    assert.ok(Array.isArray(r2.data));
  });

  it('加 channel + key + chat → dashboard 数字 + channels/list + usage/trend 反映', async () => {
    const cookie = lastCookie || await login();

    let r = await httpForm('/api/admin/channels',
      `name=uimock&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-test&key_label=B`,
      cookie);
    assert.equal(r.status, 200, `add channel: ${r.text}`);
    r = await httpForm('/api/admin/probe/1', '', cookie);
    assert.equal(r.status, 200);

    r = await httpForm('/api/admin/hub-keys', 'name=adm-ui-hub-' + Date.now(), cookie);
    assert.equal(r.status, 200, `hub-key: ${r.text}`);
    const hubKey = JSON.parse(r.text).plainKey;

    // 调 1 个 chat, 写 usage_log
    const chat = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(chat.status, 200);
    await chat.text();

    // dashboard 数字
    const dash = await (await fetch(`http://127.0.0.1:${port}/api/admin/dashboard`, { headers: { cookie } })).json();
    assert.equal(dash.channelCount, 1);
    assert.equal(dash.keyCount, 1);
    assert.ok(dash.last24h.total_requests >= 1, `expected total_requests >= 1, got ${dash.last24h.total_requests}`);

    // channels/list
    const cl = await (await fetch(`http://127.0.0.1:${port}/api/admin/channels/list`, { headers: { cookie } })).json();
    assert.ok(cl.channels.length >= 1);
    assert.ok(cl.keysByChannel['1']);
    assert.equal(cl.channels[0].provider_name, 'uimock');
    assert.equal(cl.keysByChannel['1'][0].id, 1);
    assert.ok(!cl.keysByChannel['1'][0].api_key_enc, 'api_key_enc 应被剥离');

    // usage/trend API
    const trend = await (await fetch(`http://127.0.0.1:${port}/api/admin/usage/trend?days=7`, { headers: { cookie } })).json();
    assert.ok(trend.data.length >= 1, `expected at least 1 row, got ${JSON.stringify(trend.data)}`);
    const today = trend.data.find((d: any) => d.day === new Date().toISOString().slice(0, 10));
    assert.ok(today, `today's row missing; data=${JSON.stringify(trend.data)}`);
    assert.ok(today.total >= 1, `expected today.total >= 1, got ${today.total}`);
  });
});
