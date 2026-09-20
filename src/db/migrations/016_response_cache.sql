-- 016: 响应缓存表
-- 用于缓存相同的请求结果，减少重复请求

CREATE TABLE IF NOT EXISTS response_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key       TEXT NOT NULL UNIQUE,
  request_model   TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  upstream_model  TEXT,
  provider_name   TEXT,
  key_id          INTEGER,
  prompt_tokens   INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  latency_ms      INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  hit_count       INTEGER DEFAULT 0,
  last_hit_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cache_key ON response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_created ON response_cache(created_at);
