/**
 * SQLite 数据库备份
 *
 * node:sqlite 是同步 API, 直接 copy 文件可能拿到 WAL 未 checkpoint 的旧数据。
 * 用 VACUUM INTO 生成一个干净的、完全自包含的备份副本。
 */
import { resolve, join, basename } from 'node:path';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { config } from '../config/env.js';
import { getDb } from '../db/connection.js';
import { logger } from '../util/logger.js';

const BACKUP_DIR = resolve(config.dataDir, 'backups');
const MAX_BACKUPS = parseInt(process.env.HUB_MAX_BACKUPS || '7', 10);
const RETENTION_DAYS = parseInt(process.env.HUB_BACKUP_RETENTION_DAYS || '30', 10);

/**
 * 执行一次完整备份, 返回备份文件路径
 */
export function backupDatabase(): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = join(BACKUP_DIR, `hub-${ts}.db`);

  const db = getDb();
  // VACUUM INTO: 生成一个干净的、紧凑的完整副本 (含所有 WAL 数据)
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

  const size = statSync(backupPath).size;
  logger.info({ backupPath, sizeKB: Math.round(size / 1024) }, 'Database backup created');
  return backupPath;
}

/**
 * 清理过期备份 (超过 RETENTION_DAYS 天) 和超量备份 (超过 MAX_BACKUPS 个)
 */
export function pruneBackups(): number {
  if (!existsSync(BACKUP_DIR)) return 0;
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('hub-') && f.endsWith('.db'))
    .map((f) => {
      const path = join(BACKUP_DIR, f);
      const stat = statSync(path);
      return { name: f, path, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime); // 最新的在前

  const now = Date.now();
  const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const tooOld = now - f.mtime > maxAgeMs;
    const tooMany = i >= MAX_BACKUPS;
    if (tooOld || tooMany) {
      unlinkSync(f.path);
      deleted++;
      logger.info({ file: f.name, reason: tooOld ? 'expired' : 'excess' }, 'Backup pruned');
    }
  }
  return deleted;
}

/**
 * 列出现有备份
 */
export function listBackups(): Array<{ name: string; size: number; mtime: string }> {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('hub-') && f.endsWith('.db'))
    .map((f) => {
      const stat = statSync(join(BACKUP_DIR, f));
      return { name: f, size: stat.size, mtime: new Date(stat.mtimeMs).toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}
