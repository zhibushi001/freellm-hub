-- Hub Key 支持模型白名单 (per-hub-key model restrictions)
-- 当 allowed_models 为 NULL/空: 该 Hub Key 可调用任意模型 (不限制)
-- 当 allowed_models 为 JSON 数组: 该 Hub Key 只能调用列表中的模型
ALTER TABLE hub_keys ADD COLUMN allowed_models TEXT;
