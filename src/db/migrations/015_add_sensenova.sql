-- Phase 5.6: 添加商汤 SenseNova 免费 Provider
-- SenseNova 6.8 Flash Lite - 轻量级多模态智能体模型
-- 免费公测期: 1,500 次调用 / 5 小时

INSERT OR IGNORE INTO providers (name, display_name, base_url, protocol, api_path, models_path, category, is_free, signup_url, docs_url, notes, created_at, updated_at) VALUES
  ('sensenova-free', '商汤 SenseNova (免费)', 'https://token.sensenova.cn/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://platform.sensenova.cn/console/keys', 'https://platform.sensenova.cn/docs', 'SenseNova 6.8 Flash Lite, 免费公测 1500次/5h, 模型名: sensenova-6.8-flash-lite (小写)', strftime('%s','now')*1000, strftime('%s','now')*1000);
