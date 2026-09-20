/**
 * SQLite 单例连接 (使用 Node 22+ 内置 node:sqlite, 无 native 依赖)
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config/env.js';
import { runMigrations } from './migrations/runner.js';

let _db: DatabaseSync | null = null;

/**
 * 获取（或初始化）DB 连接
 * 同步 API, 必须在 server 接受请求前完成
 */
export function getDb(): DatabaseSync {
  if (_db) return _db;
  const dbPath = config.db.path;
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  // node:sqlite 默认开启外键, 但显式设置更稳
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');

  runMigrations(db);
  _db = db;
  return db;
}

/** 仅测试用: 注入一个外部 db 实例 */
export function setDbForTest(db: DatabaseSync): void {
  _db = db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
