-- 023: 给 discovered_models 加测试结果字段 (批量测速用)
ALTER TABLE discovered_models ADD COLUMN test_status TEXT DEFAULT NULL;  -- 'ok' | 'error' | NULL(未测试)
ALTER TABLE discovered_models ADD COLUMN test_latency_ms INTEGER DEFAULT NULL;
ALTER TABLE discovered_models ADD COLUMN test_error TEXT DEFAULT NULL;
ALTER TABLE discovered_models ADD COLUMN tested_at INTEGER DEFAULT NULL;
