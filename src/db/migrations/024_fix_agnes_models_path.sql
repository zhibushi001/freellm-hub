-- 修复 Agnes AI 的 models_path 配置
-- Agnes 的 models 端点是 /v1/models 而不是 /models
UPDATE providers SET models_path = '/v1/models' WHERE name = 'agnes-ai' AND models_path IS NULL;
