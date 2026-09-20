-- 002_cooldowns.sql
-- Cooldown 表, 详见 docs/DESIGN.md §4.5 + freellmapi ratelimit.ts 启发
--
-- 一行表示某个 (key, reason, upstream_model) 当前处于 active cooldown
-- 设计:
--   - key + reason + upstream_model 唯一 (UNIQUE)
--   - recovered 通过 cleared_at + cleared_reason
--   - 短 cooldown 90s, 长 (quota_exhausted) 可到 24h
--   - recoverable=1: heuristic, 可被 cooldown-probe 早恢复
--   - recoverable=0: authoritative (provider 显式告知), 必须等时间到

CREATE TABLE cooldowns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id          INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,             -- 'rate_limit' | 'quota_exhausted' | 'transient_error' | 'auth_invalid'
  upstream_model  TEXT,                       -- NULL = key 级 (整个 key 都冷); 非 NULL = model 级 (只冷这个 model)
  recoverable     INTEGER NOT NULL DEFAULT 1,
  started_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  cleared_at      INTEGER,
  cleared_reason  TEXT,                       -- 'probe_success' | 'manual' | 'expired' | 'key_disabled'
  UNIQUE(key_id, reason, upstream_model)
);
CREATE INDEX idx_cooldowns_key      ON cooldowns(key_id);
CREATE INDEX idx_cooldowns_active   ON cooldowns(expires_at) WHERE cleared_at IS NULL;
CREATE INDEX idx_cooldowns_recover  ON cooldowns(recoverable, expires_at) WHERE cleared_at IS NULL;

-- 健康快照表 (后台定时汇总, 供 degradation 状态机使用)
CREATE TABLE health_snapshots (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at            INTEGER NOT NULL,
  total_keys          INTEGER NOT NULL,
  healthy_keys        INTEGER NOT NULL,
  failed_keys         INTEGER NOT NULL,
  cooldown_keys       INTEGER NOT NULL,
  quota_keys          INTEGER NOT NULL,
  disabled_keys       INTEGER NOT NULL,
  healthy_ratio       REAL NOT NULL
);
CREATE INDEX idx_snapshots_taken ON health_snapshots(taken_at);

-- 升级日志 (每条 audit 写入, 留接口)
-- audit_logs 表已经在 001 创建, 这里不重复
