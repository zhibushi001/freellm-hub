/**
 * Phase 5.F: /v1/models 公开端点 E2E
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let server: ChildProcess;
const port = 3053;

before(async () => {
  try { const { exec } = await import('node:child_process'); await new Promise<void>((r) => exec(`fuser -k ${port}/tcp 2>/dev/null`, () => r())); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-models-'));

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
  await killAndWait(server);
  setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }, 60_000);
});

async function httpForm(path: string, body: string, cookie?: string): Promise<{ status: number; text: string; setCookie: string | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') };
}

let cookie = '';
let hubKey = '';

describe('E2E: /v1/models 公开端点 (Phase 5.F)', () => {
  it('setup + login', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200);
    cookie = (sr.setCookie ?? '').split(';')[0];

    // 创建 hub key
    const r = await httpForm('/api/admin/hub-keys', 'name=models-test', cookie);
    assert.equal(r.status, 200, `hub-key create failed: ${r.text}`);
    hubKey = JSON.parse(r.text).plainKey;
    assert.ok(hubKey, 'plainKey should be present');
  });

  it('GET /v1/models (无 hub key) → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(r.status, 401);
  });

  it('GET /v1/models 返空 list (没 channel)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${hubKey}` },
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.object, 'list');
    assert.ok(Array.isArray(data.data));
    assert.equal(data.data.length, 0);
  });

  it('加一个 mock channel + models="gpt-4o,claude-3", /v1/models 应暴露 2 个', async () => {
    // 用 mock 地址 (随便一个不会 work 的, 但不需要 work, 只要 channel 存在)
    const r = await httpForm('/api/admin/channels',
      `name=models-test&base_url=http://127.0.0.1:3054&api_path=/v1/chat/completions&models_path=/v1/models&api_key=sk-fake&label=ModelsTest&models=gpt-4o-mini,gpt-4o,claude-3-haiku`,
      cookie);
    assert.equal(r.status, 200, `add failed: ${r.text}`);
    const data = JSON.parse(r.text);
    assert.equal(data.ok, true);
    const channelId = data.channel_id;

    // 列出模型
    const r2 = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${hubKey}` },
    });
    const d2 = await r2.json();
    const ids = d2.data.map((m: any) => m.id);
    assert.ok(ids.includes('gpt-4o-mini'), `expected gpt-4o-mini, got: ${ids.join(',')}`);
    assert.ok(ids.includes('gpt-4o'), `expected gpt-4o`);
    assert.ok(ids.includes('claude-3-haiku'), `expected claude-3-haiku`);

    // 验证 owned_by 是 provider name
    const gpt = d2.data.find((m: any) => m.id === 'gpt-4o');
    assert.equal(gpt.owned_by, 'models-test', `expected owned_by=models-test, got ${gpt.owned_by}`);

    // 禁用的 channel 不应暴露 models
    await fetch(`http://127.0.0.1:${port}/api/admin/channels/${channelId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: 0 }),
    });
    const r3 = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${hubKey}` },
    });
    const d3 = await r3.json();
    assert.equal(d3.data.length, 0, `disabled channel 不应暴露 models, got: ${d3.data.map((m: any) => m.id).join(',')}`);

    // 恢复 enabled
    await fetch(`http://127.0.0.1:${port}/api/admin/channels/${channelId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: 1 }),
    });
  });

  it('GET /v1/models 返回 OpenAI 标准格式 (object=list, data=[{id, object, owned_by, created}])', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${hubKey}` },
    });
    const d = await r.json();
    assert.equal(d.object, 'list');
    for (const m of d.data) {
      assert.equal(m.object, 'model');
      assert.ok(typeof m.id === 'string' && m.id.length > 0);
      assert.ok(typeof m.owned_by === 'string');
      assert.ok(typeof m.created === 'number' && m.created > 0, `created 应是 unix epoch seconds`);
    }
  });
});
