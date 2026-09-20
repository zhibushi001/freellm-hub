-- 021: 渠道标签表
-- 用于渠道分组管理

CREATE TABLE IF NOT EXISTS channel_tags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  color           TEXT,              -- 标签颜色
  channel_count   INTEGER DEFAULT 0, -- 关联渠道数量（冗余字段）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON channel_tags(name);

-- 渠道标签关联表
CREATE TABLE IF NOT EXISTS channel_tag_links (
  channel_id      INTEGER NOT NULL,
  tag_id          INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (channel_id, tag_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES channel_tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tag_links_channel ON channel_tag_links(channel_id);
CREATE INDEX IF NOT EXISTS idx_tag_links_tag ON channel_tag_links(tag_id);
