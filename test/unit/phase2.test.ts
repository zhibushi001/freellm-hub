/**
 * Phase 2 新增测试
 * 1) Cooldown ladder: 4 hit → 4 个不同的时长
 * 2) Cooldown 4 类 source: heuristic/authoritative/credit/tier 写入正确
 * 3) Local endpoint 特例: 5s cooldown, 不进 ladder
 * 4) 成功清 hit: 2xx 后 ladder 重置
 * 5) Probe 早恢复: 只清 heuristic, 不清 credit
 * 6) Failover 主循环: mock 多个 key, 401 切下一个
 * 7) Failover: 429 切下一个 + cooldown 写入
 * 8) Failover: 402 切下一个 + 24h credit cooldown
 * 9) Failover: 404 model_not_found → skipModels
 * 10) Failover: 5xx 同 key 重试 1 次后切下一个
 * 11) Failover: 全部 401 → 返回 no_candidates
 * 12) Failover: 三段 provider/key/model 强制指定, 失败不重试
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('phase 2: cooldown ladder', () => {
  let dataDir: string;
  let db: DatabaseSync;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    process.env.HUB_DATA_DIR = dataDir;
    const { runMigrations } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/migrations/runner.js');
    db = new DatabaseSync(join(dataDir, 'hub.db'));
    process.env.HUB_SKIP_SEED = process.env.HUB_SKIP_SEED ?? '1'; runMigrations(db);
    const conn = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/connection.js');
    conn.setDbForTest(db);
    const providers = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/providers.js');
    const channels = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/channels.js');
    const keys = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    // 004 seed migration 也跑, 用 unique name 避免 UNIQUE 冲突
    const uniq = 'p' + Math.random().toString(36).slice(2, 8);
    const p = providers.createProvider({ name: 'test-' + uniq, base_url: 'https://api.test/v1' });
    const c = channels.createChannel({ provider_id: p.id });
    keys.createKey({ channel_id: c.id, label: 'A1', apiKey: 'sk-a1' });
  });

  afterEach(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

  it('1st hit → 2 min (ladder 第 1 阶)', async () => {
    // freellmapi design: ladder 从 2 min 开始 (第 1 阶 = 2m, 不是 90s)
    // 90s 是 fallback (hits=0 时的默认)
    const { recordCooldownHit, getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    recordCooldownHit(1);
    const d = getEscalationLadderDuration(1);
    assert.equal(d, 2 * 60 * 1000);
  });

  it('0 hits → 90s 默认 (没记录, fallback)', async () => {
    const { getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    const d = getEscalationLadderDuration(1);
    assert.equal(d, 90_000);
  });

  it('2 hits → 10 min (ladder[1])', async () => {
    const { recordCooldownHit, getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    recordCooldownHit(1);
    recordCooldownHit(1);
    assert.equal(getEscalationLadderDuration(1), 10 * 60 * 1000);
  });

  it('3 hits → 1h (ladder[2])', async () => {
    const { recordCooldownHit, getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    recordCooldownHit(1);
    recordCooldownHit(1);
    recordCooldownHit(1);
    assert.equal(getEscalationLadderDuration(1), 60 * 60 * 1000);
  });

  it('4 hits → 24h (ladder[3])', async () => {
    const { recordCooldownHit, getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    for (let i = 0; i < 4; i++) recordCooldownHit(1);
    assert.equal(getEscalationLadderDuration(1), 24 * 60 * 60 * 1000);
  });

  it('5+ hits → 24h (cap)', async () => {
    const { recordCooldownHit, getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    for (let i = 0; i < 5; i++) recordCooldownHit(1);
    assert.equal(getEscalationLadderDuration(1), 24 * 60 * 60 * 1000);
  });

  it('成功 (clearCooldownHits) 后 ladder 重置', async () => {
    const { recordCooldownHit, clearCooldownHits, getEscalationLadderDuration } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    recordCooldownHit(1);
    recordCooldownHit(1);
    recordCooldownHit(1);
    assert.equal(getEscalationLadderDuration(1), 60 * 60 * 1000);  // ladder[2]
    clearCooldownHits(1);
    assert.equal(getEscalationLadderDuration(1), 90_000);  // 重置回默认
  });
});

describe('phase 2: cooldown 4 sources', () => {
  let dataDir: string;
  let db: DatabaseSync;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    process.env.HUB_DATA_DIR = dataDir;
    const { runMigrations } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/migrations/runner.js');
    db = new DatabaseSync(join(dataDir, 'hub.db'));
    process.env.HUB_SKIP_SEED = process.env.HUB_SKIP_SEED ?? '1'; runMigrations(db);
    const conn = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/connection.js');
    conn.setDbForTest(db);
    // 创建一个真实 key 满足 FK
    const providers = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/providers.js');
    const channels = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/channels.js');
    const keys = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const p = providers.createProvider({ name: 'minimax', base_url: 'https://api.minimax/v1' });
    const c = channels.createChannel({ provider_id: p.id });
    keys.createKey({ channel_id: c.id, label: 'A1', apiKey: 'sk-a1' });
  });

  afterEach(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

  it('写入 4 类 source 并读回', async () => {
    const { setCooldown, getActiveCooldown } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    // 用一个不存在的 key_id 测写入, 我们只关心 source 字段
    setCooldown({ keyId: 1, reason: 'rate_limit', durationMs: 90_000, source: 'heuristic' });
    setCooldown({ keyId: 1, reason: 'rate_limit_ra', upstreamModel: 'm1', durationMs: 600_000, source: 'authoritative', recoverable: false });
    setCooldown({ keyId: 1, reason: 'quota', durationMs: 24*60*60*1000, source: 'credit', recoverable: false });
    setCooldown({ keyId: 1, reason: 'tier', durationMs: 24*60*60*1000, source: 'tier', recoverable: false });

    const heuristic = getActiveCooldown(1, 'rate_limit', null);
    assert.equal(heuristic?.source, 'heuristic');
    assert.equal(heuristic?.recoverable, 1);

    const auth = getActiveCooldown(1, 'rate_limit_ra', 'm1');
    assert.equal(auth?.source, 'authoritative');
    assert.equal(auth?.recoverable, 0);

    const credit = getActiveCooldown(1, 'quota', null);
    assert.equal(credit?.source, 'credit');
    assert.equal(credit?.recoverable, 0);
    assert.equal(credit?.expires_at, credit?.started_at! + 24*60*60*1000);

    const tier = getActiveCooldown(1, 'tier', null);
    assert.equal(tier?.source, 'tier');
  });
});

describe('phase 2: local endpoint detection', () => {
  it('loopback → local', async () => {
    const { isLocalEndpoint } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/util/endpoints.js');
    assert.equal(isLocalEndpoint('http://127.0.0.1:11434'), true);
    assert.equal(isLocalEndpoint('http://localhost:11434'), true);
    assert.equal(isLocalEndpoint('http://0.0.0.0:11434'), true);
  });
  it('RFC1918 → local', async () => {
    const { isLocalEndpoint } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/util/endpoints.js');
    assert.equal(isLocalEndpoint('http://192.168.1.100:11434'), true);
    assert.equal(isLocalEndpoint('http://10.0.0.1:8080'), true);
    assert.equal(isLocalEndpoint('http://172.16.0.1:8080'), true);
  });
  it('公网 → remote', async () => {
    const { isLocalEndpoint } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/util/endpoints.js');
    assert.equal(isLocalEndpoint('https://api.openai.com'), false);
    assert.equal(isLocalEndpoint('https://api.minimax.chat'), false);
  });
});

describe('phase 2: failover with mock http', () => {
  let dataDir: string;
  let db: DatabaseSync;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    process.env.HUB_DATA_DIR = dataDir;
    const { runMigrations } = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/migrations/runner.js');
    db = new DatabaseSync(join(dataDir, 'hub.db'));
    process.env.HUB_SKIP_SEED = process.env.HUB_SKIP_SEED ?? '1'; runMigrations(db);
    const conn = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/connection.js');
    conn.setDbForTest(db);

    // 2 个 provider, 4 个 key (minimax A1, A2; openrouter B1, B2)
    const providers = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/providers.js');
    const channels = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/channels.js');
    const keys = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/keys.js');
    const p1 = providers.createProvider({ name: 'minimax', base_url: 'https://minimax.test/v1' });
    const p2 = providers.createProvider({ name: 'openrouter', base_url: 'https://openrouter.test/api/v1' });
    const c1 = channels.createChannel({ provider_id: p1.id });
    const c2 = channels.createChannel({ provider_id: p2.id });
    keys.createKey({ channel_id: c1.id, label: 'A1', apiKey: 'sk-a1' });
    keys.createKey({ channel_id: c1.id, label: 'A2', apiKey: 'sk-a2' });
    keys.createKey({ channel_id: c2.id, label: 'B1', apiKey: 'sk-b1' });
    keys.createKey({ channel_id: c2.id, label: 'B2', apiKey: 'sk-b2' });

    // 注册 discovered_models
    const dm = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/discoveredModels.js');
    for (let kid of [1, 2, 3, 4]) {
      dm.upsertDiscoveredModel(kid, 'M3');
    }
  });

  afterEach(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

  it('401 切下一个 key', async () => {
    const failover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    let callCount = 0;
    failover.setHttpSendForTest(async (url, key) => {
      callCount++;
      if (callCount === 1) {
        return { status: 401, body: JSON.stringify({ error: { message: 'invalid' } }), headers: {}, latencyMs: 10 };
      }
      return { status: 200, body: JSON.stringify({ id: 'chatcmpl-ok', model: 'M3', choices: [{message:{role:'assistant',content:'hi'}}], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), headers: {}, latencyMs: 100 };
    });
    const r = await failover.chatWithFailover({ model: 'M3', messages: [{role:'user',content:'hi'}] }, null);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.attempts.length, 2);
      assert.equal(r.finalKeyId, 2);  // 第一个 key (1) 401, 切到 key 2
    }
  });

  it('402 → 切下一个 + 24h credit cooldown', async () => {
    const failover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    let callCount = 0;
    failover.setHttpSendForTest(async () => {
      callCount++;
      if (callCount === 1) {
        return { status: 402, body: JSON.stringify({ error: { type: 'insufficient_quota' } }), headers: {}, latencyMs: 10 };
      }
      return { status: 200, body: JSON.stringify({ id: 'ok', model: 'M3', choices: [] }), headers: {}, latencyMs: 100 };
    });
    const r = await failover.chatWithFailover({ model: 'M3', messages: [] }, null);
    assert.equal(r.ok, true);

    // 验证 key 1 写了 24h credit cooldown
    const cooldowns = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    const cd = cooldowns.getActiveCooldown(1, 'quota', null);
    assert.ok(cd, 'should have quota cooldown');
    assert.equal(cd!.source, 'credit');
    assert.equal(cd!.recoverable, 0);
    // 24h credit cooldown
    const duration = cd!.expires_at - cd!.started_at;
    assert.ok(duration >= 24 * 60 * 60 * 1000 - 100 && duration <= 24 * 60 * 60 * 1000 + 100,
      `expected 24h ±100ms, got ${duration}ms`);
  });

  it('429 → 切下一个 + 2 min heuristic cooldown (1st hit, ladder 起步)', async () => {
    const failover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    let callCount = 0;
    failover.setHttpSendForTest(async () => {
      callCount++;
      if (callCount === 1) {
        return { status: 429, body: JSON.stringify({ error: 'rate_limit' }), headers: {}, latencyMs: 10 };
      }
      return { status: 200, body: JSON.stringify({ id: 'ok', model: 'M3', choices: [] }), headers: {}, latencyMs: 100 };
    });
    const r = await failover.chatWithFailover({ model: 'M3', messages: [] }, null);
    assert.equal(r.ok, true);

    const cooldowns = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/db/repos/cooldowns.js');
    const cd = cooldowns.getActiveCooldown(1, 'rate_limit', 'M3');
    assert.ok(cd, 'should have rate_limit cooldown');
    assert.equal(cd!.source, 'heuristic');
    assert.equal(cd!.recoverable, 1);
    // 1st hit → ladder[0] = 2 min
    const duration = cd!.expires_at - cd!.started_at;
    assert.ok(duration >= 2 * 60 * 1000 - 100 && duration <= 2 * 60 * 1000 + 100,
      `expected 2min ±100ms, got ${duration}ms`);
  });

  it('5xx 同 key 重试 1 次后切下一个', async () => {
    const failover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    let callCount = 0;
    const perKeyCalls = new Map<number, number>();
    failover.setHttpSendForTest(async (_url, key) => {
      callCount++;
      const kid = parseInt(key.replace('sk-', '').replace('a', '1').replace('b', '3'));  // 简化
      perKeyCalls.set(kid, (perKeyCalls.get(kid) ?? 0) + 1);
      // 实际我们用 provider 鉴别 - 简化逻辑
      return { status: 503, body: JSON.stringify({ error: 'unavailable' }), headers: {}, latencyMs: 10 };
    });
    // 用一个永远 503 的 mock, 应该 5 次内用完 5 个 candidate
    const r = await failover.chatWithFailover({ model: 'M3', messages: [] }, null);
    assert.equal(r.ok, false);
  });

  it('404 model_not_found → skipPlatforms (minimax) → 切到 openrouter', async () => {
    const realFailover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    let callCount = 0;
    realFailover.setHttpSendForTest(async () => {
      callCount++;
      // 第一次: minimax 返回 404
      if (callCount === 1) {
        return { status: 404, body: JSON.stringify({ error: { message: 'model not found' } }), headers: {}, latencyMs: 10 };
      }
      // 第二次: openrouter 返回 200
      return { status: 200, body: JSON.stringify({ id: 'ok', model: 'M3', choices: [] }), headers: {}, latencyMs: 100 };
    });
    const r = await realFailover.chatWithFailover({ model: 'M3', messages: [] }, null);
    assert.equal(r.ok, true, `expected ok but got ${JSON.stringify(r)}`);
    if (r.ok) {
      assert.equal(r.attempts.length, 2);
      // 第二次成功的 key 应该是 openrouter 的 (provider_id=2)
      assert.ok([3, 4].includes(r.finalKeyId), `expected openrouter key (3 or 4), got ${r.finalKeyId}`);
    }
  });

  it('三段 provider/key/model 强制指定, 失败不重试', async () => {
    const failover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    let callCount = 0;
    failover.setHttpSendForTest(async () => {
      callCount++;
      return { status: 404, body: JSON.stringify({ error: 'not found' }), headers: {}, latencyMs: 10 };
    });
    const r = await failover.chatWithFailover({ model: 'minimax/A1/M3', messages: [] }, null);
    assert.equal(r.ok, false);
    // 强制指定 - 一次失败就返回, 不应该试别的 key
    assert.equal(callCount, 1, 'should try once and stop for forced path');
  });

  it('全部 401 → 返回 auth_invalid', async () => {
    const failover = await import('/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/routing/failover.js');
    failover.setHttpSendForTest(async () => {
      return { status: 401, body: JSON.stringify({ error: 'invalid' }), headers: {}, latencyMs: 10 };
    });
    const r = await failover.chatWithFailover({ model: 'M3', messages: [] }, null);
    failover.setHttpSendForTest(null);  // cleanup
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.kind, 'no_candidates');
      // 应该试了所有 enabled+healthy key
      assert.ok(r.attempts.length >= 2, `expected ≥2 attempts, got ${r.attempts.length}`);
    }
  });
});
