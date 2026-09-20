/**
 * Phase 4.C: In-flight tracker 单元测试
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  inflightStart, inflightEnd, inflightGet, inflightGetAll,
  inflightWeightPenalty, inflightClear,
} from '/vol1/@appshare/fn-deepseek-harness/zbs/freellm-hub-v2/src/services/inflightTracker.js';

describe('In-flight tracker', () => {
  beforeEach(() => inflightClear());

  it('start / end 增加和减少计数', () => {
    assert.equal(inflightGet(1, 'gpt-4o'), 0);
    inflightStart(1, 'gpt-4o');
    assert.equal(inflightGet(1, 'gpt-4o'), 1);
    inflightStart(1, 'gpt-4o');
    assert.equal(inflightGet(1, 'gpt-4o'), 2);
    inflightEnd(1, 'gpt-4o', 100);
    assert.equal(inflightGet(1, 'gpt-4o'), 1);
    inflightEnd(1, 'gpt-4o', 100);
    assert.equal(inflightGet(1, 'gpt-4o'), 0);
  });

  it('end 不会减到负数', () => {
    inflightEnd(1, 'gpt-4o', 100);  // 没 start 直接 end
    assert.equal(inflightGet(1, 'gpt-4o'), 0);
  });

  it('不同 (key, model) 独立计数', () => {
    inflightStart(1, 'gpt-4o');
    inflightStart(2, 'gpt-4o');
    inflightStart(1, 'gpt-4o-mini');
    assert.equal(inflightGet(1, 'gpt-4o'), 1);
    assert.equal(inflightGet(2, 'gpt-4o'), 1);
    assert.equal(inflightGet(1, 'gpt-4o-mini'), 1);
  });

  it('inflightGetAll 返回所有 active', () => {
    inflightStart(1, 'a');
    inflightStart(2, 'b');
    const all = inflightGetAll();
    assert.equal(all.length, 2);
    const m1 = all.find((x) => x.keyId === 1);
    assert.equal(m1?.count, 1);
    assert.equal(m1?.model, 'a');
  });

  it('weight penalty: 0 in-flight → 1.0', () => {
    assert.equal(inflightWeightPenalty(1, 'm'), 1.0);
  });
  it('weight penalty: 1 → 0.5', () => {
    inflightStart(1, 'm');
    assert.equal(inflightWeightPenalty(1, 'm'), 0.5);
  });
  it('weight penalty: 2 → 0.333', () => {
    inflightStart(1, 'm');
    inflightStart(1, 'm');
    const p = inflightWeightPenalty(1, 'm');
    assert.ok(Math.abs(p - 0.333) < 0.01, `expected ~0.333, got ${p}`);
  });
  it('weight penalty: 3 → 0.25', () => {
    inflightStart(1, 'm');
    inflightStart(1, 'm');
    inflightStart(1, 'm');
    assert.equal(inflightWeightPenalty(1, 'm'), 0.25);
  });
  it('end 后 penalty 恢复', () => {
    inflightStart(1, 'm');
    inflightStart(1, 'm');
    inflightEnd(1, 'm', 100);
    inflightEnd(1, 'm', 100);
    assert.equal(inflightWeightPenalty(1, 'm'), 1.0);
  });

  it('count=0 时 entry 从 map 删除', () => {
    inflightStart(1, 'm');
    inflightEnd(1, 'm', 100);
    assert.equal(inflightGetAll().length, 0);
  });
});
