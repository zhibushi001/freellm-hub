/**
 * Resolver 单元测试
 * 详见 docs/DESIGN.md §4.2
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('resolver', () => {
  let dataDir: string;
  let db: DatabaseSync;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    process.env.HUB_DATA_DIR = dataDir;
    process.env.HUB_PORT = '0';
    const { runMigrations } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/migrations/runner.js');
    db = new DatabaseSync(join(dataDir, 'hub.db'));
    process.env.HUB_SKIP_SEED = process.env.HUB_SKIP_SEED ?? '1'; runMigrations(db);
    const conn = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/connection.js');
    conn.setDbForTest(db);

    // 创建 2 个 provider, 3 个 key
    const providers = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/providers.js');
    const channels = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/channels.js');
    const keys = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');

    const p1 = providers.createProvider({ name: 'minimax', base_url: 'https://api.minimax/v1' });
    const p2 = providers.createProvider({ name: 'openrouter', base_url: 'https://openrouter.ai/api/v1' });
    const c1 = channels.createChannel({ provider_id: p1.id });
    const c2 = channels.createChannel({ provider_id: p2.id });
    keys.createKey({ channel_id: c1.id, label: 'A1-主力', apiKey: 'sk-a1' });
    keys.createKey({ channel_id: c1.id, label: 'A2-备用', apiKey: 'sk-a2' });
    keys.createKey({ channel_id: c2.id, label: 'B1', apiKey: 'sk-b1' });
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  });

  it('纯 model 名 → 第一个可用 key', async () => {
    const { listKeys } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const { resolveModel } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/resolver.js');
    const allKeys = listKeys();
    const r = resolveModel('M3', allKeys);
    assert.ok('key' in r);
    assert.equal(r.key.provider_name, 'minimax');
    assert.equal(r.upstreamModel, 'M3');
  });

  it('provider/model → 该 provider 下选第一个', async () => {
    const { listKeys } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const { resolveModel } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/resolver.js');
    const r = resolveModel('openrouter/M3', listKeys());
    assert.ok('key' in r);
    assert.equal(r.key.provider_name, 'openrouter');
    assert.equal(r.upstreamModel, 'M3');
  });

  it('provider/key/model 三段 → 强制指定', async () => {
    const { listKeys } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const { resolveModel } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/resolver.js');
    const r = resolveModel('minimax/A2-备用/M3', listKeys());
    assert.ok('key' in r);
    assert.equal(r.key.label, 'A2-备用');
    assert.equal(r.key.provider_name, 'minimax');
  });

  it('不存在的 provider → 错误', async () => {
    const { listKeys } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const { resolveModel } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/resolver.js');
    const r = resolveModel('nosuch/M3', listKeys());
    assert.ok('error' in r);
    assert.match(r.error, /没有可用 Key/);
  });

  it('没有 key → 错误', async () => {
    // 禁用所有 key
    const { listKeys, updateKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const { resolveModel } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/resolver.js');
    for (const k of listKeys()) updateKey(k.id, { enabled: 0 });
    const r = resolveModel('M3', listKeys());
    assert.ok('error' in r);
  });

  it('failed 状态的 key 不会被选中', async () => {
    const { listKeys, updateKey } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const { resolveModel } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/resolver.js');
    const keys = listKeys();
    updateKey(keys[0].id, { status: 'failed' });
    const r = resolveModel('M3', listKeys());
    // 应选第二个 key (minimax A2) 而不是第一个
    assert.ok('key' in r);
    assert.notEqual(r.key.id, keys[0].id);
  });
});
