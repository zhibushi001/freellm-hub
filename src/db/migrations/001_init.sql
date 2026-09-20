-- 001_init.sql
-- FreeLLM Hub v2 initial schema
-- 完整数据模型参见 docs/DESIGN.md §3

-- 站点设置 KV 表
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 上游 Provider 定义
CREATE TABLE providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  base_url      TEXT NOT NULL,
  protocol      TEXT NOT NULL DEFAULT 'openai',
  api_path      TEXT NOT NULL DEFAULT '/chat/completions',
  models_path   TEXT NOT NULL DEFAULT '/models',
  extra_config  TEXT,
  signup_url    TEXT,
  notes         TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Channel
CREATE TABLE channels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label        TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  weight       INTEGER NOT NULL DEFAULT 1,
  priority     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_channels_provider ON channels(provider_id);

-- Key
CREATE TABLE keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id      INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  label           TEXT,
  api_key_enc     BLOB NOT NULL,
  api_key_hint    TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  tags            TEXT,
  status          TEXT NOT NULL DEFAULT 'unknown',
  status_reason   TEXT,
  status_since    INTEGER,
  rpm_used        INTEGER NOT NULL DEFAULT 0,
  rpd_used        INTEGER NOT NULL DEFAULT 0,
  tpm_used        INTEGER NOT NULL DEFAULT 0,
  tpd_used        INTEGER NOT NULL DEFAULT 0,
  window_reset_at INTEGER,
  avg_latency_ms  INTEGER,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  last_probe_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_keys_channel ON keys(channel_id);
CREATE INDEX idx_keys_status  ON keys(status);

-- 探测到的模型缓存
CREATE TABLE discovered_models (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id        INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  upstream_id   TEXT NOT NULL,
  discovered_at INTEGER NOT NULL,
  UNIQUE(key_id, upstream_id)
);
CREATE INDEX idx_discovered_key ON discovered_models(key_id);

-- VirtualModel (对外暴露的逻辑模型名)
CREATE TABLE virtual_models (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  display_name TEXT,
  description  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- ModelCandidate (VirtualModel 下的具体候选)
CREATE TABLE model_candidates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  virtual_model_id  INTEGER NOT NULL REFERENCES virtual_models(id) ON DELETE CASCADE,
  key_id            INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  upstream_model    TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 0,
  weight            INTEGER NOT NULL DEFAULT 1,
  enabled           INTEGER NOT NULL DEFAULT 1,
  pinned            INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  UNIQUE(virtual_model_id, key_id, upstream_model)
);
CREATE INDEX idx_candidates_vm ON model_candidates(virtual_model_id);
CREATE INDEX idx_candidates_key ON model_candidates(key_id);

-- 模型重定向
CREATE TABLE model_mappings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_model  TEXT NOT NULL UNIQUE,
  to_model    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- Hub Key (客户端访问凭证)
CREATE TABLE hub_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash        TEXT NOT NULL UNIQUE,
  key_prefix      TEXT NOT NULL,
  name            TEXT NOT NULL,
  notes           TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  rate_limit_rpm  INTEGER,
  expires_at      INTEGER,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_hub_keys_prefix ON hub_keys(key_prefix);

-- 用量日志
CREATE TABLE usage_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_key_id        INTEGER REFERENCES hub_keys(id),
  virtual_model_id  INTEGER REFERENCES virtual_models(id),
  candidate_id      INTEGER REFERENCES model_candidates(id),
  key_id            INTEGER REFERENCES keys(id),
  provider_name     TEXT,
  request_model     TEXT,
  routed_model      TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  latency_ms        INTEGER,
  status            TEXT NOT NULL,
  error_code        INTEGER,
  error_type        TEXT,
  error_message     TEXT,
  stream            INTEGER NOT NULL DEFAULT 0,
  is_benchmark      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_usage_created ON usage_logs(created_at);
CREATE INDEX idx_usage_key     ON usage_logs(key_id, created_at);
CREATE INDEX idx_usage_hub     ON usage_logs(hub_key_id, created_at);

-- 用量日聚合
CREATE TABLE usage_daily (
  key_id            INTEGER NOT NULL,
  day               TEXT NOT NULL,
  requests          INTEGER NOT NULL DEFAULT 0,
  successes         INTEGER NOT NULL DEFAULT 0,
  failures          INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms    INTEGER,
  PRIMARY KEY (key_id, day)
);

-- 审计日志
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
