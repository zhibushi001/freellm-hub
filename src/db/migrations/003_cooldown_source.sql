-- 003_cooldown_source.sql
-- 补 cooldowns.source 字段 (4 类: heuristic/authoritative/credit/tier)
-- 见 docs/PHASE2_DESIGN.md §2

ALTER TABLE cooldowns ADD COLUMN source TEXT NOT NULL DEFAULT 'heuristic';

-- Escalation ladder hit 计数表
-- 24h 内 hit 次数决定下次 cooldown 时长 (2m/10m/1h/24h)
-- 成功 2xx 调用会清计数 (reversibility)
-- AUTOINCREMENT id 是必要的, 否则同毫秒多个 hit 会被 (key_id, hit_at) 复合主键去重
CREATE TABLE IF NOT EXISTS cooldown_hits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id          INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  hit_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hits_key_time ON cooldown_hits(key_id, hit_at);
