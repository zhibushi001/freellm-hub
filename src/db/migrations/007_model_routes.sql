-- Phase 5.E: Model routing rules
-- 允许用户配置: "gpt-4o" 请求 → 走 channel_id=5, 失败再试 channel_id=12
-- 比 channel-level model_mapping 更灵活 (跨 channel 路由)
CREATE TABLE IF NOT EXISTS model_routes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_model TEXT NOT NULL,            -- 用户请求的 model 名 (e.g. "gpt-4o", "claude-3-5-sonnet")
  -- 候选 channel 列表, 顺序即 failover 顺序 (JSON 数组)
  -- e.g. "[5, 12, 7]" 表示优先 ch5, 失败再 ch12, 再 ch7
  channel_ids  TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(request_model)
);
CREATE INDEX idx_model_routes_enabled ON model_routes(enabled);

-- Seed 几个例子
INSERT OR IGNORE INTO model_routes (request_model, channel_ids, enabled, notes, created_at, updated_at) VALUES
  ('gpt-4o',         '[]', 1, '示例: 留空 = 走任意 enabled channel (走原 resolver)', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('claude-3-5',     '[]', 1, '示例', strftime('%s','now')*1000, strftime('%s','now')*1000);
