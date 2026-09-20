-- 020: 请求尝试追踪表
-- 用于追踪每次请求的尝试详情（包括失败重试）

CREATE TABLE IF NOT EXISTS request_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      INTEGER NOT NULL,  -- 关联 usage_logs.id
  attempt_number  INTEGER NOT NULL,
  key_id          INTEGER,
  provider_name   TEXT,
  upstream_model  TEXT,
  status_code     INTEGER,
  latency_ms      INTEGER,
  error_message   TEXT,
  is_success      INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_request ON request_attempts(request_id);
CREATE INDEX IF NOT EXISTS idx_attempts_key ON request_attempts(key_id);
CREATE INDEX IF NOT EXISTS idx_attempts_created ON request_attempts(created_at);
