/**
 * 探测服务单元测试
 * 用 node:test (Node 自带, 不依赖 Vite, 完美支持 node:sqlite)
 *
 * 设计: probeService 接受 setHttpSendForTest 注入的 mock httpSend,
 * 避免依赖外部 mock 库.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('probeService', () => {
  let dataDir: string;
  let db: DatabaseSync;
  let mockResponse: any;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    process.env.HUB_DATA_DIR = dataDir;
    process.env.HUB_PORT = '0';
    mockResponse = { status: 200, body: '{"data":[]}' };
    const { runMigrations } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/migrations/runner.js');
    db = new DatabaseSync(join(dataDir, 'hub.db'));
    process.env.HUB_SKIP_SEED = process.env.HUB_SKIP_SEED ?? '1'; runMigrations(db);
    const conn = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/connection.js');
    conn.setDbForTest(db);
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  });

  async function setupKey(label: string) {
    const providers = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/providers.js');
    const channels = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/channels.js');
    const keys = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const p = providers.createProvider({ name: 'minimax', base_url: 'https://api.test/v1' });
    const c = channels.createChannel({ provider_id: p.id, label: 'main' });
    return keys.createKey({ channel_id: c.id, label, apiKey: 'sk-test-1234' });
  }

  it('200 with models → discovered_models populated, key healthy', async () => {
    const key = await setupKey('test-key');
    const probe = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/services/probeService.js');
    probe.setHttpSendForTest(async () => ({
      status: 200,
      body: JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5' }] }),
      headers: {},
      latencyMs: 50,
    }));

    const result = await probe.probeKey(key.id);
    assert.equal(result.ok, true);
    assert.deepEqual(result.models, ['gpt-4o', 'gpt-3.5']);

    const { getDiscoveredModelsForKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/discoveredModels.js');
    const discovered = getDiscoveredModelsForKey(key.id);
    assert.deepEqual(discovered.map(d => d.upstream_id).sort(), ['gpt-3.5', 'gpt-4o']);

    const { getKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    assert.equal(getKey(key.id)?.status, 'healthy');
  });

  it('401 → key 5min cooldown (不标 failed - 让 cooldown 控 failover)', async () => {
    // 设计变更: 401 不标 status=failed, 只写 cooldown.
    // 之前版本用 status=failed, 但这干扰同请求内 failover (rankPool 永久排除 failed key)
    // 修: 401 → 5min heuristic cooldown, status 保持 unknown
    const key = await setupKey('bad-key');
    const probe = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/services/probeService.js');
    probe.setHttpSendForTest(async () => ({
      status: 401, body: JSON.stringify({ error: 'invalid_api_key' }),
      headers: {}, latencyMs: 30,
    }));
    const result = await probe.probeKey(key.id);
    assert.equal(result.ok, false);
    const { getKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const updated = getKey(key.id);
    assert.equal(updated?.status, 'unknown');  // 不变, 让 cooldown 控访问
    const { getAllActiveCooldownsForKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    const cds = getAllActiveCooldownsForKey(key.id);
    assert.ok(cds.length > 0, 'should have 401 cooldown');
    assert.equal(cds[0].reason, 'auth');
  });

  it('429 → key marked cooldown', async () => {
    const key = await setupKey('rl-key');
    const probe = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/services/probeService.js');
    probe.setHttpSendForTest(async () => ({
      status: 429, body: JSON.stringify({ error: 'rate_limit' }),
      headers: {}, latencyMs: 30,
    }));
    await probe.probeKey(key.id);
    const { getKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    assert.equal(getKey(key.id)?.status, 'cooldown');
  });

  it('402 / insufficient_quota → key marked quota_exhausted', async () => {
    const key = await setupKey('q-key');
    const probe = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/services/probeService.js');
    probe.setHttpSendForTest(async () => ({
      status: 402, body: JSON.stringify({ error: { type: 'insufficient_quota' } }),
      headers: {}, latencyMs: 30,
    }));
    await probe.probeKey(key.id);
    const { getKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    assert.equal(getKey(key.id)?.status, 'quota_exhausted');
  });

  it('network error → key cooldown + status unchanged', async () => {
    // freellmapi/one-api 共识: 网络错不杀 key (busy ≠ quota)
    // 标 failed 太激进, 一次 ECONNREFUSED 不能 kill 一个好 key
    const key = await setupKey('net-key');
    const probe = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/services/probeService.js');
    probe.setHttpSendForTest(async () => { throw new Error('ECONNREFUSED'); });
    const result = await probe.probeKey(key.id);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'ECONNREFUSED');
    const { getKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const updated = getKey(key.id);
    assert.equal(updated?.status, 'unknown');  // 保持 unknown, 不杀
    // 但应该写了一个 cooldown
    const { getAllActiveCooldownsForKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    const cds = getAllActiveCooldownsForKey(key.id);
    assert.ok(cds.length > 0, 'should have at least one cooldown');
    assert.equal(cds[0].reason, 'transient_error');
  });
});
