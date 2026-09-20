-- Phase 6+: Channel 暴露模型控制
--   models: allow list (现有, 留空=透传所有)
--   excluded_models: deny list (从上游拿到的模型里排除这些, 优先级最高)
ALTER TABLE channels ADD COLUMN excluded_models TEXT;  -- 逗号分隔, 排除的模型
