-- 017: 内容护栏配置表
-- 用于配置输入/输出的内容过滤规则

CREATE TABLE IF NOT EXISTS guardrails (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  description     TEXT,
  enabled         INTEGER DEFAULT 1,
  input_filter    INTEGER DEFAULT 0,  -- 是否过滤输入
  output_filter   INTEGER DEFAULT 0,  -- 是否过滤输出
  rules           TEXT,               -- JSON: 过滤规则配置
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- 默认护栏配置
INSERT OR IGNORE INTO guardrails (name, description, enabled, input_filter, output_filter, rules, created_at, updated_at)
VALUES (
  'default',
  '默认内容护栏',
  0,
  0,
  0,
  '{"blocked_keywords": [], "pii_detection": false, "max_input_length": 4096, "max_output_length": 4096}',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
