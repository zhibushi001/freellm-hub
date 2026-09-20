/**
 * 端到端集成测试 (node:test)
 * 启 server + mock upstream, 完整跑一遍核心 flow
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
const port = 3035;
const mockPort = 3036;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hub-e2e-'));

  // 启 mock upstream - wait for it to be ready
  mock = spawn('node', ['-e', `
const http = require('http');
let callCount = 0;
http.createServer((req, res) => {
  console.error('MOCK GOT', req.method, req.url, 'auth=' + (req.headers.authorization || ''));
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({object: 'list', data: [{id: 'M3'}, {id: 'M4'}]}));
  } else if (req.url === '/v1/chat/completions') {
    callCount++;
    if (callCount === 1) {
      res.writeHead(401, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: {message: 'invalid', type: 'invalid_api_key'}}));
    } else {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({
        id: 'chatcmpl-' + callCount, model: 'M3',
        choices: [{index: 0, message: {role: 'assistant', content: 'ok from key ' + callCount}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 5, completion_tokens: 3, total_tokens: 8}
      }));
    }
  } else {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(${mockPort}, '127.0.0.1', () => console.error('mock up on ${mockPort}'));
`], { stdio: ['ignore', 'pipe', 'pipe'] });
  mock.stdout?.on('data', (d) => process.stderr.write(`[mock stdout] ${d}`));
  mock.stderr?.on('data', (d) => process.stderr.write(`[mock stderr] ${d}`));
  // 等待 mock 真的 listen + 至少 1 次能通
  let mockReady = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${mockPort}/v1/models`);
      if (r.status === 200) { mockReady = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  if (!mockReady) throw new Error('mock upstream failed to start on port ' + mockPort);

  // 启 server (直接用 tsx loader, 避免 npx 慢)
  console.log('Starting server...');
  server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, HUB_DATA_DIR: dataDir, HUB_PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  // 等 server 起来 - 查 health
  console.log('Waiting for server health...');
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (r.status === 200) { console.log('Server up at attempt', i); return; }
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

async function httpJson(path: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}

describe('E2E: 完整路由 + failover 流程', () => {
  it('注册 → 加 channel → 加 2 key → 探活 → 创建 Hub Key → chat (401 failover) → usage_logs', async () => {
    // 1. 注册
    let r = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(r.status, 200);
    const cookie = r.setCookie!.split(';')[0];

    // 2. 加 channel
    r = await httpForm('/api/admin/channels',
      `name=mock&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-a1&key_label=A1`,
      cookie);
    assert.equal(r.status, 200);
    const c = JSON.parse(r.text);
    assert.ok(c.provider_id && c.channel_id && c.key_id);

    // 3. 加 A2 key
    r = await httpForm('/api/admin/channels/1/keys', 'label=A2&api_key=sk-a2', cookie);
    assert.equal(r.status, 200);

    // 4. 探活 A1, A2 - 真的调 mock /v1/models
    for (const kid of [1, 2]) {
      r = await httpForm(`/api/admin/probe/${kid}`, '', cookie);
      assert.equal(r.status, 200);
      const data = JSON.parse(r.text);
      console.log(`probe ${kid} response:`, r.text);
      assert.equal(data.ok, true, `probe ${kid} should succeed`);
      assert.ok(data.models.length > 0, `should discover models`);
    }

    // 5. 创 Hub Key
    r = await httpForm('/api/admin/hub-keys', 'name=e2e-test', cookie);
    const hubKey = JSON.parse(r.text).plainKey;

    // 6. /v1/models
    let r2 = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${hubKey}` } });
    const modelsText = await r2.text();
    assert.equal(r2.status, 200);
    const modelsData = JSON.parse(modelsText);
    assert.ok(modelsData.data.length > 0, 'should list discovered models');

    // 7. /v1/chat/completions - 第一次 mock 401, failover 到 A2 (200)
    r2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hubKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const chatText = await r2.text();
    assert.equal(r2.status, 200, `chat should succeed via failover, body: ${chatText}`);
    const chatBody = JSON.parse(chatText);
    assert.ok(chatBody.choices?.[0]?.message?.content?.includes('key 2'), `should be response from key 2 (failover), got: ${chatText}`);

    // 8. 验证 usage_logs 记录
    const db = new DatabaseSync(join(dataDir, 'hub.db'));
    const usage = db.prepare('SELECT key_id, status, error_code FROM usage_logs ORDER BY id ASC').all() as any[];
    // 应该至少 2 行: A1 (401 error_code=401), A2 (success)
    assert.ok(usage.length >= 2, `expected ≥2 usage rows, got ${usage.length}: ${JSON.stringify(usage)}`);
    const a1 = usage.find(u => u.key_id === 1);
    const a2 = usage.find(u => u.key_id === 2);
    assert.ok(a1, 'A1 should have usage');
    assert.ok(a2, 'A2 should have usage');
    assert.equal(a1.status, 'error');
    assert.equal(a1.error_code, 401);
    assert.equal(a2.status, 'success');

    // 9. 验证 keys 表 success/failure 计数
    // 注: 401 不标 status=failed (会干扰同请求 failover), 只写 5min cooldown + 增 failure_count
    const keys = db.prepare('SELECT id, label, status, success_count, failure_count FROM keys').all() as any[];
    const a1Row = keys.find(k => k.id === 1);
    const a2Row = keys.find(k => k.id === 2);
    assert.equal(a1Row.failure_count, 2);  // probe 401 + chat 401
    assert.equal(a2Row.success_count, 2);  // probe + chat 都 200
    // 验证 A1 有 active 5min cooldown
    const cds = db.prepare("SELECT reason, source, recoverable FROM cooldowns WHERE key_id = 1 AND cleared_at IS NULL").all() as any[];
    assert.ok(cds.length > 0, 'A1 should have 401 cooldown');
    assert.equal(cds[0].reason, 'auth');
    assert.equal(cds[0].source, 'heuristic');
    assert.equal(cds[0].recoverable, 1);
  });
});
