/**
 * Phase 5: Admin 改密码 / 用户名 E2E
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let server: ChildProcess;
const port = 3057;

before(async () => {
  try { const { exec } = await import('node:child_process'); await new Promise<void>((r) => exec(`fuser -k ${port}/tcp 2>/dev/null`, () => r())); } catch {}
  await new Promise(r => setTimeout(r, 500));

  dataDir = mkdtempSync(join(tmpdir(), 'hub-profile-'));

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

describe('E2E: Admin profile (改密码/用户名) (Phase 5)', () => {
  it('setup: create admin admin/Test1234Pass', async () => {
    const sr = await httpForm('/api/setup', 'username=admin&password=Test1234Pass&password2=Test1234Pass');
    assert.equal(sr.status, 200);
    cookie = (sr.setCookie ?? '').split(';')[0];
  });

  it('GET /api/admin/auth/me 返回当前用户名', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/me`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.ok, true);
    assert.equal(d.username, 'admin');
  });

  it('GET /admin/profile 页面渲染 (React SPA)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/admin/profile`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.includes('FreeLLM Hub'), 'should have SPA title');
    assert.ok(text.includes('id="root"'), 'should have React root div');
  });

  it('未登录访问 /admin/profile → 返回 200 (SPA 由客户端处理跳转)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/admin/profile`, { redirect: 'manual' });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.includes('id="root"'), 'SPA shell should be served');
  });

  it('改密码: 旧密码错 → 400', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ old_password: 'WrongPassword1!', new_password: 'NewPassword123!' }),
    });
    assert.equal(r.status, 400);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.match(d.error, /旧密码/);
  });

  it('改密码: 新密码太弱 → 400', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ old_password: 'Test1234Pass', new_password: 'weak' }),
    });
    assert.equal(r.status, 400);
  });

  it('改密码: 缺 old_password → 400', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ new_password: 'NewPassword123!' }),
    });
    assert.equal(r.status, 400);
  });

  it('改密码成功 → 旧密码登入失败, 新密码登入成功', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ old_password: 'Test1234Pass', new_password: 'NewSecret456!' }),
    });
    const rText = await r.text();
    assert.equal(r.status, 200, `body: ${rText}`);
    const d = JSON.parse(rText);
    assert.equal(d.ok, true);

    // 旧密码登入 → 失败
    const oldR = await httpForm('/api/admin/auth/login', 'username=admin&password=Test1234Pass');
    assert.notEqual(oldR.status, 200, `旧密码居然登入成功了: ${oldR.text}`);

    // 新密码登入 → 成功
    const newR = await httpForm('/api/admin/auth/login', 'username=admin&password=NewSecret456!');
    assert.equal(newR.status, 200, `new password login failed: ${newR.text}`);
    cookie = (newR.setCookie ?? '').split(';')[0];
  });

  it('改用户名: admin → newadmin', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ new_username: 'newadmin' }),
    });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.ok, true);
    assert.equal(d.username, 'newadmin');
  });

  it('改用户名: 太短 → 400', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ new_username: 'ab' }),
    });
    assert.equal(r.status, 400);
  });

  it('改用户名: 含特殊字符 → 400', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/auth/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ new_username: 'bad@user' }),
    });
    assert.equal(r.status, 400);
  });

  it('用新用户名 + 新密码登入', async () => {
    const r = await httpForm('/api/admin/auth/login', 'username=newadmin&password=NewSecret456!');
    assert.equal(r.status, 200);
    cookie = (r.setCookie ?? '').split(';')[0];

    const me = await fetch(`http://127.0.0.1:${port}/api/admin/auth/me`, { headers: { cookie } });
    const d = await me.json();
    assert.equal(d.username, 'newadmin');
  });
});
