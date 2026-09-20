-- Phase 5: Channel 扩展字段 (newapi 风格)
ALTER TABLE channels ADD COLUMN models TEXT;  -- 逗号分隔, 该 channel 暴露的模型 (留空 = 透传)
ALTER TABLE channels ADD COLUMN model_mapping TEXT;  -- JSON: {"gpt-4o": "DeepSeek-V3", ...}
ALTER TABLE channels ADD COLUMN status_code_mapping TEXT;  -- JSON: {"400": "500", ...}
ALTER TABLE channels ADD COLUMN param_override TEXT;  -- JSON: {"temperature": 0.7}
ALTER TABLE channels ADD COLUMN header_override TEXT;  -- JSON: {"X-Custom": "value"}
ALTER TABLE channels ADD COLUMN multi_key_mode TEXT NOT NULL DEFAULT 'random';  -- random | polling
ALTER TABLE channels ADD COLUMN test_model TEXT;  -- 测试时用的模型
ALTER TABLE channels ADD COLUMN auto_ban INTEGER NOT NULL DEFAULT 1;  -- 失败 N 次自动禁用
ALTER TABLE channels ADD COLUMN tag TEXT;  -- 标签, 批量管理用
