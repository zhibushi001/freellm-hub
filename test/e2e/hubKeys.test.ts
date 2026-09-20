/**
 * Phase 5: Hub Keys UI / API E2E
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let server: ChildProcess;
const port = 3058;

before(async () => {
  try { const { exec } = await import('node:child_process'); await new Promise<void>((r) => exec(`fuser -k ${port}/tcp 2>/dev/null`, () => r())); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-hubkeys-'));

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

describe('E2E: Hub Keys (Phase 5)', () => {
  it('setup + login', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200);
    cookie = (sr.setCookie ?? '').split(';')[0];
  });

  it('GET /api/admin/hub-keys 返回空 list (还没建)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.ok, true);
    assert.equal(d.keys.length, 0);
  });

  it('POST /api/admin/hub-keys 创建 (urlencoded)', async () => {
    const r = await httpForm('/api/admin/hub-keys', 'name=iPhone-Cline', cookie);
    assert.equal(r.status, 200);
    const d = JSON.parse(r.text);
    assert.equal(d.ok, true);
    assert.ok(d.plainKey.startsWith('fh_'), `plainKey should start with fh_, got: ${d.plainKey.slice(0, 5)}`);
    assert.ok(d.prefix);
  });

  it('创建后 GET /api/admin/hub-keys 返 1 个', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys`, { headers: { cookie } });
    const d = await r.json();
    assert.equal(d.keys.length, 1);
    assert.equal(d.keys[0].name, 'iPhone-Cline');
    assert.equal(d.keys[0].prefix.slice(0, 3), 'fh_');
    // plainKey 不应被返回 (安全)
    assert.equal(d.keys[0].plainKey, undefined);
  });

  it('GET /admin/hub-keys 页面渲染, 含 API 地址指引', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/admin/hub-keys`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.includes('FreeLLM Hub'), 'should have SPA title');
    assert.ok(text.includes('id="root"'), 'should have React root div');
    assert.ok(text.includes('module'), 'should have JS module script');
  });

  it('Regenerate API: 拿新 plainKey', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1/regenerate`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.ok, true);
    assert.ok(d.plainKey.startsWith('fh_'));
  });

  it('Toggle 启用/禁用', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1/toggle`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.ok, true);
    // toggle 端点返回的是 boolean (k.enabled === 0)
    assert.equal(d.enabled, false, 'first toggle should disable');

    // 再 toggle 回启用
    const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1/toggle`, { method: 'POST', headers: { cookie } });
    const d2 = await r2.json();
    assert.equal(d2.enabled, true, 'second toggle should re-enable');
  });

  it('用禁用的 hub key 调 /v1/chat/completions → 401', async () => {
    // 先查当前 enabled 状态
    const cur = await (await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys`, { headers: { cookie } })).json();
    const isEnabled = cur.keys[0].enabled;
    // 如果是 disabled, toggle 一次变 enabled
    if (!isEnabled) {
      await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1/toggle`, { method: 'POST', headers: { cookie } });
    }
    // 重新生成拿 plainKey
    const regenR = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1/regenerate`, { method: 'POST', headers: { cookie } });
    const regenD = await regenR.json();
    const plainKey = regenD.plainKey;

    // 用该 key 调, 应通过
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${plainKey}` } });
    assert.equal(r.status, 200, `enabled key should work, got ${r.status}: ${await r.text()}`);

    // 再 toggle 禁用
    await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1/toggle`, { method: 'POST', headers: { cookie } });
    const r2 = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${plainKey}` } });
    assert.equal(r2.status, 401, `disabled key should be 401`);
  });

  it('DELETE /api/admin/hub-keys/1', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/1`, { method: 'DELETE', headers: { cookie } });
    assert.equal(r.status, 200);
    const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys`, { headers: { cookie } });
    const d = await r2.json();
    assert.equal(d.keys.length, 0);
  });

  it('未登录调 GET /api/admin/hub-keys → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys`);
    assert.equal(r.status, 401);
  });

  it('GET /api/admin/hub-keys/:id/plain 拿完整明文 key (新建的)', async () => {
    // 先建一个
    const createR = await httpForm('/api/admin/hub-keys', 'name=plain-test', cookie);
    const createD = JSON.parse(createR.text);
    const id = createD.id;
    const originalKey = createD.plainKey;

    // 拿 plain
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/${id}/plain`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.ok, true);
    assert.equal(d.plain_key, originalKey, 'should return same plain key as was created');
    assert.equal(d.name, 'plain-test');
  });

  it('GET /api/admin/hub-keys/:id/plain 未登录 → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/2/plain`);
    assert.equal(r.status, 401);
  });

  it('GET /api/admin/hub-keys/:id/plain 不存在的 id → 404', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/hub-keys/99999/plain`, { headers: { cookie } });
    assert.equal(r.status, 404);
  });

  it('GET /admin/hub-keys 页面渲染 (React SPA)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/admin/hub-keys`, { headers: { cookie } });
    const text = await r.text();
    assert.ok(text.includes('id="root"'), 'should have React root div');
    assert.ok(text.includes('module'), 'should have JS module script');
  });
});
