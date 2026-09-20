-- Phase 6+: Session store (server-side, survives restart)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,         -- sessionId
  data TEXT NOT NULL,          -- JSON 序列化的 session 数据
  expires_at INTEGER NOT NULL  -- 过期时间 (ms)
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
