/**
 * Phase 4.C: In-flight tracker E2E
 * 模拟慢 mock, 启动 1 个请求 (不读完), 检查 /api/admin/inflight 显示 in-flight=1
 * 然后收完 body, 验证 in-flight=0
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
const port = 3047;
const mockPort = 3048;

before(async () => {
  try { await exec('fuser -k 3047/tcp 3048/tcp 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-inflight-'));

  mockFile = join(tmpdir(), `mock-inflight-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
http.createServer((req, res) => {
  process.stderr.write('MOCK got ' + req.method + ' ' + req.url + '\\n');
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'gpt-4o-mini'}]}));
    return;
  }
  if (req.url === '/v1/chat/completions') {
    // 慢响应: 1500ms 后才返, 给 client 时间查 in-flight
    setTimeout(() => {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({
        id: 'cmpl-1', model: 'gpt-4o-mini',
        choices: [{index:0, message:{role:'assistant',content:'done'}, finish_reason:'stop'}],
        usage: {prompt_tokens:5, completion_tokens:1, total_tokens:6}
      }));
    }, 1500);
    return;
  }
  res.writeHead(404); res.end();
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('inflight mock up\\n'));
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
  server.stdout?.on('data', (d) => process.stderr.write(`[server-out] ${d}`));
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

describe('E2E: In-flight tracker (Phase 4.C)', () => {
  it('setup + 加 channel/key + 调 1 个慢请求 + inflight 跟踪', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200, `setup: ${sr.text}`);
    const cookie = sr.setCookie!.split(';')[0];

    let r = await httpForm('/api/admin/channels',
      `name=inflight&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-test&key_label=I`,
      cookie);
    assert.equal(r.status, 200, `add channel: ${r.text}`);
    r = await httpForm('/api/admin/probe/1', '', cookie);
    assert.equal(r.status, 200, `probe: ${r.text}`);

    r = await httpForm('/api/admin/hub-keys', 'name=inflight-hub', cookie);
    assert.equal(r.status, 200, `hub-key: ${r.text}`);
    const hubKey = JSON.parse(r.text).plainKey;

    // 检查初始 inflight = 0
    let inflight = await (await fetch(`http://127.0.0.1:${port}/api/admin/inflight`, { headers: { cookie } })).json();
    assert.equal(inflight.items.length, 0);

    // 启动 1 个慢请求 (不 await)
    const chatPromise = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hubKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    });
    // 200ms 后打 hub 看 log
    setTimeout(() => {
      fetch(`http://127.0.0.1:${port}/v1/health`).catch(() => {});
    }, 200);

    // 500ms 后 (mock 还没返 1.5s), 检查 inflight
    await new Promise(r => setTimeout(r, 500));
    inflight = await (await fetch(`http://127.0.0.1:${port}/api/admin/inflight`, { headers: { cookie } })).json();
    if (inflight.items.length === 0) {
      // debug: 看看 hub 端 chat route 处理了啥
      process.stdout.write(`DEBUG: chat is in-flight, server log not showing. hub key=${hubKey}\n`);
      process.stdout.flush?.();
    }
    assert.equal(inflight.items.length, 1, `expected 1 in-flight, got ${JSON.stringify(inflight.items)}`);
    assert.equal(inflight.items[0].keyId, 1);
    assert.equal(inflight.items[0].model, 'gpt-4o-mini');
    assert.equal(inflight.items[0].count, 1);

    // 等 mock 返
    const chatRes = await chatPromise;
    assert.equal(chatRes.status, 200);
    await chatRes.text();

    // 等 100ms 让 onStreamEnd 触发
    await new Promise(r => setTimeout(r, 100));
    inflight = await (await fetch(`http://127.0.0.1:${port}/api/admin/inflight`, { headers: { cookie } })).json();
    assert.equal(inflight.items.length, 0, `expected 0 after end, got ${JSON.stringify(inflight.items)}`);
  });
});
