-- 022: 聊天对话表
-- 用于存储用户与模型的对话历史

CREATE TABLE IF NOT EXISTS chat_conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  model           TEXT NOT NULL,
  channel_id      INTEGER,
  messages        TEXT NOT NULL,        -- JSON: [{role, content, created_at}]
  message_count   INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_created ON chat_conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conv_model ON chat_conversations(model);
CREATE INDEX IF NOT EXISTS idx_chat_conv_channel ON chat_conversations(channel_id);
