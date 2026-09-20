/**
 * SQLite-backed session store for @fastify/session
 * - Survives container restarts
 * - Auto-cleans expired sessions on get/set
 */
import { getDb } from '../db/connection.js';
import { logger } from '../util/logger.js';

// 用 any 跳过 fastify 复杂的 Session 类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySession = any;

export class SqliteSessionStore {
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 每 10 分钟清一次过期 session
    this.cleanupInterval = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(sessionId: string, session: AnySession, callback: (err?: any) => void): void {
    try {
      const db = getDb();
      const expires = typeof session.expires === 'number' ? session.expires : Date.now() + 7 * 24 * 60 * 60 * 1000;
      const data = { ...session };
      delete data.expires;  // 单独存
      db.prepare(
        'INSERT OR REPLACE INTO sessions (id, data, expires_at) VALUES (?, ?, ?)'
      ).run(sessionId, JSON.stringify(data), expires);
      callback();
    } catch (e) {
      callback(e);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(sessionId: string, callback: (err: any, session?: AnySession | null) => void): void {
    try {
      const db = getDb();
      const row = db.prepare('SELECT data, expires_at FROM sessions WHERE id = ?').get(sessionId) as { data: string; expires_at: number } | undefined;
      if (!row) return callback(null, null);
      if (row.expires_at < Date.now()) {
        this.destroy(sessionId, () => {});
        return callback(null, null);
      }
      const data = JSON.parse(row.data);
      callback(null, { ...data, expires: row.expires_at });
    } catch (e) {
      callback(e);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  destroy(sessionId: string, callback: (err?: any) => void): void {
    try {
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      callback();
    } catch (e) {
      callback(e);
    }
  }

  private cleanup(): void {
    try {
      const r = getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      if (r.changes > 0) {
        logger.info({ cleaned: r.changes }, '[session] cleaned expired sessions');
      }
    } catch (e) {
      // ignore
    }
  }
}
