-- Phase 5.A: providers 扩展字段 (独立于 seed, 测试环境也会跑)
-- runner 会容忍 duplicate column 错误 (idempotent)
ALTER TABLE providers ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN category TEXT;
ALTER TABLE providers ADD COLUMN docs_url TEXT;
