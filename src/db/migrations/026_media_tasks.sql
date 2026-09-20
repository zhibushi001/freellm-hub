-- 多媒体异步任务表
-- 视频生成 (MiniMax / Agnes) 是异步的: 创建时返回 task_id，客户端轮询本表 + 上游刷新状态
CREATE TABLE IF NOT EXISTS media_tasks (
  id            TEXT PRIMARY KEY,          -- 上游 task_id
  provider      TEXT NOT NULL,             -- minimax / agnes / ...
  model         TEXT NOT NULL,
  type          TEXT NOT NULL,             -- video / video_edit
  hub_key_id    INTEGER,                   -- 归属的 Hub Key
  channel_key_id INTEGER,                  -- 实际调用的上游 Key
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / completed / failed
  result        TEXT,                      -- JSON: { url, duration, ... }
  error         TEXT,                      -- JSON: { message, code }
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_tasks_hub_key ON media_tasks(hub_key_id);
CREATE INDEX IF NOT EXISTS idx_media_tasks_status ON media_tasks(status);
