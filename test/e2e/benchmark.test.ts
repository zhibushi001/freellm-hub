/**
 * Phase 4.B: Benchmark 测速端到端测试
 * 模拟不同延迟的 mock, 测 5 次, 验证 successRate / latency / score
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
const port = 3045;
const mockPort = 3046;

before(async () => {
  // 清理端口
  try { await exec('fuser -k 3045/tcp 3046/tcp 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-bench-'));

  mockFile = join(tmpdir(), `mock-bench-${Date.now()}.js`);
  writeFileSync(mockFile, `
const http = require('http');
let callCount = 0;
http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'gpt-4o-mini'}]}));
    return;
  }
  callCount++;
  // 第一次: 慢 (300ms), 后续: 快 (10ms)
  const delay = callCount === 1 ? 300 : 10;
  setTimeout(() => {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({
      id: 'cmpl-' + callCount,
      model: 'gpt-4o-mini',
      choices: [{index:0, message:{role:'assistant',content:'ok'}, finish_reason:'stop'}],
      usage: {prompt_tokens: 12, completion_tokens: 1, total_tokens: 13}
    }));
  }, delay);
}).listen(${mockPort}, '127.0.0.1', () => process.stderr.write('bench mock up\\n'));
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

describe('E2E: Benchmark (Phase 4.B)', () => {
  it('先 setup', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200, `setup: ${sr.text}`);
  });

  it('未登录调用 /api/admin/benchmark/:id → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/benchmark/1`, { method: 'POST' });
    assert.equal(r.status, 401);
  });

  it('未登录调用 /api/admin/benchmark-all → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/benchmark-all`, { method: 'POST' });
    assert.equal(r.status, 401);
  });

  it('加 channel/key + benchmark 5 次, 验证 successRate + latency', async () => {
    const lr = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    const cookie = lr.setCookie!.split(';')[0];

    // 加 channel + key
    let r = await httpForm('/api/admin/channels',
      `name=bench&base_url=http://127.0.0.1:${mockPort}&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-test&key_label=B`,
      cookie);
    assert.equal(r.status, 200, `add channel: ${r.text}`);
    r = await httpForm('/api/admin/probe/1', '', cookie);
    assert.equal(r.status, 200);

    // benchmark key 1, 5 samples
    const b = await fetch(`http://127.0.0.1:${port}/api/admin/benchmark/1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ samples: 5 }),
    });
    assert.equal(b.status, 200);
    const result = await b.json();
    assert.equal(result.keyId, 1);
    assert.equal(result.samples, 5);
    assert.equal(result.successes, 5);
    assert.equal(result.errors, 0);
    assert.equal(result.successRate, 1.0);
    // mock 第一次 300ms, 后续 10ms. 5 次总 ~ 350ms, avg ~ 70ms, p95 ~ 300ms
    assert.ok(result.avgLatencyMs > 0);
    assert.ok(result.avgLatencyMs < 1000, `avg too high: ${result.avgLatencyMs}`);
    assert.ok(result.p50LatencyMs <= result.avgLatencyMs + 50, `p50 should be near avg: p50=${result.p50LatencyMs} avg=${result.avgLatencyMs}`);
    assert.ok(result.p95LatencyMs >= 200, `p95 should catch the slow first call: ${result.p95LatencyMs}`);
    assert.ok(result.totalTokens === 5 * 13, `expected 65 tokens, got ${result.totalTokens}`);
    assert.ok(result.score >= 90, `score should be high for fast key: ${result.score}`);
    assert.equal(result.perSample.length, 5);
    assert.ok(result.perSample.every((s: any) => s.ok));
  });

  it('benchmark-all: 测所有 enabled keys, 返回数组', async () => {
    const lr = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    const cookie = lr.setCookie!.split(';')[0];

    const b = await fetch(`http://127.0.0.1:${port}/api/admin/benchmark-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ samples: 2 }),
    });
    assert.equal(b.status, 200);
    const result = await b.json();
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.results));
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].keyId, 1);
  });

  it('不存在的 key → 返回 error field', async () => {
    const lr = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    const cookie = lr.setCookie!.split(';')[0];

    const b = await fetch(`http://127.0.0.1:${port}/api/admin/benchmark/999`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ samples: 1 }),
    });
    assert.equal(b.status, 200);
    const result = await b.json();
    assert.match(result.error, /not found/i);
    assert.equal(result.successes, 0);
    assert.equal(result.score, 0);
  });
});
