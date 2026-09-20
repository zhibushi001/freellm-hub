-- 019: 回退配置表
-- 用于配置模型回退策略（当主模型不可用时自动切换）

CREATE TABLE IF NOT EXISTS fallback_config (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_model   TEXT NOT NULL UNIQUE,
  fallback_models TEXT,              -- JSON 数组: ["model1", "model2"]
  strategy        TEXT DEFAULT 'sequential',  -- sequential, weighted, priority
  enabled         INTEGER DEFAULT 1,
  max_retries     INTEGER DEFAULT 3,
  retry_delay_ms  INTEGER DEFAULT 1000,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fallback_primary ON fallback_config(primary_model);
CREATE INDEX IF NOT EXISTS idx_fallback_enabled ON fallback_config(enabled);

-- 默认回退配置示例
INSERT OR IGNORE INTO fallback_config (primary_model, fallback_models, strategy, enabled, max_retries, retry_delay_ms, created_at, updated_at)
VALUES (
  'sensenova-6.8-flash-lite',
  '["sensenova-6.7-flash-lite", "deepseek-v4-flash"]',
  'sequential',
  1,
  3,
  1000,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
