/**
 * Hub Key repo
 * Hub Key 是 fh_<64hex> 格式, 存 SHA256 哈希
 */
import { randomBytes, createHash } from 'node:crypto';
import { getDb } from '../connection.js';

export interface HubKey {
  id: number;
  key_prefix: string;
  name: string;
  notes: string | null;
  enabled: number;
  rate_limit_rpm: number | null;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  plain_key: string | null;
  /** JSON 数组字符串; null/空 = 不限制, 可调用任意模型 */
  allowed_models: string | null;
}

const PREFIX = 'fh_';
export function generateHubKeyPlain(): string {
  return PREFIX + randomBytes(32).toString('hex');
}

export function hashHubKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export interface CreateHubKeyInput {
  name: string;
  notes?: string;
  rate_limit_rpm?: number;
  expires_at?: number;
  allowed_models?: string[] | null;  // null/空 = 不限制
}

export interface CreateHubKeyResult {
  id: number;
  plainKey: string;       // 只在创建时返回一次
  prefix: string;
  name: string;
}

/** 把 allowed_models 数组规范化为存储形式: null 或 JSON 字符串 */
export function serializeAllowedModels(models: string[] | null | undefined): string | null {
  if (!models || models.length === 0) return null;
  const filtered = models.filter((m) => typeof m === 'string' && m.length > 0);
  return filtered.length > 0 ? JSON.stringify(filtered) : null;
}

/** 把 DB 里的 allowed_models 字符串解析为数组; null/空 = 不限制 */
export function parseAllowedModels(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const list = parsed.filter((m: any) => typeof m === 'string' && m.length > 0);
      return list.length > 0 ? list : null;
    }
  } catch { /* 坏数据视为不限制 */ }
  return null;
}

export function createHubKey(input: CreateHubKeyInput): CreateHubKeyResult {
  const plain = generateHubKeyPlain();
  const hash = hashHubKey(plain);
  const prefix = plain.slice(0, 12);

  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO hub_keys (key_hash, key_prefix, name, notes, enabled, rate_limit_rpm, expires_at, plain_key, allowed_models, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(hash, prefix, input.name, input.notes ?? null, input.rate_limit_rpm ?? null, input.expires_at ?? null, plain, serializeAllowedModels(input.allowed_models), now);
  return {
    id: Number(info.lastInsertRowid),
    plainKey: plain,
    prefix,
    name: input.name,
  };
}

export function listHubKeys(): HubKey[] {
  return getDb()
    .prepare('SELECT * FROM hub_keys ORDER BY created_at DESC')
    .all() as unknown as HubKey[];
}

export function getHubKeyById(id: number): HubKey | null {
  const row = getDb().prepare('SELECT * FROM hub_keys WHERE id = ?').get(id);
  return (row as unknown as HubKey) ?? null;
}

export function getHubKeyByHash(plain: string): HubKey | null {
  const hash = hashHubKey(plain);
  const row = getDb().prepare('SELECT * FROM hub_keys WHERE key_hash = ?').get(hash);
  return (row as unknown as HubKey) ?? null;
}

export function setHubKeyEnabled(id: number, enabled: boolean): void {
  getDb().prepare('UPDATE hub_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

/** 更新 Hub Key 的可变元数据 (name / notes / rate_limit_rpm / expires_at / allowed_models) */
export function updateHubKey(
  id: number,
  patch: {
    name?: string;
    notes?: string | null;
    rate_limit_rpm?: number | null;
    expires_at?: number | null;
    allowed_models?: string[] | null;
  },
): HubKey | null {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
  if (patch.notes !== undefined) { fields.push('notes = ?'); values.push(patch.notes); }
  if (patch.rate_limit_rpm !== undefined) { fields.push('rate_limit_rpm = ?'); values.push(patch.rate_limit_rpm); }
  if (patch.expires_at !== undefined) { fields.push('expires_at = ?'); values.push(patch.expires_at); }
  if (patch.allowed_models !== undefined) {
    fields.push('allowed_models = ?'); values.push(serializeAllowedModels(patch.allowed_models));
  }
  if (fields.length === 0) return getHubKeyById(id);
  values.push(id);
  getDb().prepare(`UPDATE hub_keys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getHubKeyById(id);
}

/** 重生成: 创建新 key + 删旧 (保持 id 不变, 简化 client 端更新) */
export function regenerateHubKey(id: number): CreateHubKeyResult {
  const old = getHubKeyById(id);
  if (!old) throw new Error('Hub key not found');
  const plain = generateHubKeyPlain();
  const hash = hashHubKey(plain);
  const prefix = plain.slice(0, 12);
  getDb()
    .prepare('UPDATE hub_keys SET key_hash = ?, key_prefix = ?, plain_key = ?, last_used_at = NULL WHERE id = ?')
    .run(hash, prefix, plain, id);
  return { id, plainKey: plain, prefix, name: old.name };
}

export function deleteHubKey(id: number): void {
  // usage_logs.hub_key_id 引用 hub_keys(id) 且未设 ON DELETE CASCADE, 需先清理
  getDb().prepare('DELETE FROM usage_logs WHERE hub_key_id = ?').run(id);
  getDb().prepare('DELETE FROM hub_keys WHERE id = ?').run(id);
}

export function recordHubKeyUsage(id: number): void {
  getDb()
    .prepare('UPDATE hub_keys SET last_used_at = ? WHERE id = ?')
    .run(Date.now(), id);
}
