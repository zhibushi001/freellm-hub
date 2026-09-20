-- Phase 5: 渠道 Key 支持模型白名单 (per-key model restrictions)
-- 当 allowed_models 为 NULL/空: 该 key 可服务所有模型 (不限制)
-- 当 allowed_models 为 JSON 数组: 该 key 只能服务列表中的模型
ALTER TABLE keys ADD COLUMN allowed_models TEXT;
