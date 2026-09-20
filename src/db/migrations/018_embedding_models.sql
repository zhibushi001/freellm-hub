-- 018: 嵌入模型配置表
-- 用于配置嵌入模型（Embeddings API）

CREATE TABLE IF NOT EXISTS embedding_models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  provider_name   TEXT NOT NULL,
  base_url        TEXT NOT NULL,
  api_path        TEXT DEFAULT '/v1/embeddings',
  supported_models TEXT,              -- 逗号分隔的模型列表
  dimensions      INTEGER,            -- 向量维度
  max_tokens      INTEGER DEFAULT 8192,
  enabled         INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_provider ON embedding_models(provider_name);
CREATE INDEX IF NOT EXISTS idx_embedding_enabled ON embedding_models(enabled);
