/**
 * Migration runner
 * 启动时按文件名顺序执行 SQL migration 文件
 * 已执行的 migration 记录在 schema_migrations 表中
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname);

export function runMigrations(db: DatabaseSync): void {
  // 创建迁移表
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT name FROM schema_migrations')
    .all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((r) => r.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    // 测试用: 跳过 seed (避免 'minimax' / 'ollama' 等固定名与测试冲突)
    .filter((f) => !(f.startsWith('00') && f.includes('seed') && process.env.HUB_SKIP_SEED === '1'))
    .sort();

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN');
    try {
      // 拆分 statements (按 ;) 然后 逐个执行, 忽略 "duplicate column" 错误 (idempotent ALTER)
      const statements = sql
        .split(/;\s*(?=\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (e: any) {
          // 容忍 idempotent ADD COLUMN (新表可能已有该列)
          if (e.code === 'ERR_SQLITE_ERROR' && /duplicate column/i.test(e.message || '')) {
            console.log(`[migration] skipped (dup column): ${file}`);
            continue;
          }
          throw e;
        }
      }
      insertMigration.run(file, Date.now());
      db.exec('COMMIT');
      console.log(`[migration] applied: ${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
