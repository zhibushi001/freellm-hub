import type { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/index.js';

export const HUB_KEY_PREFIX = 'fh_';

export interface HubKey {
  id: string;
  label: string;
  keyPrefix: string; // first 12 chars of the key, e.g. "fh_a1b2c3d4"
  enabled: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      hubKey?: HubKey;
    }
  }
}

interface HubKeyRow {
  id: string;
  label: string;
  key_hash: string;
  key_prefix: string;
  enabled: number;
  created_at: number;
  last_used_at: number | null;
}

function rowToHubKey(row: HubKeyRow): HubKey {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** Generate a new hub key. Returns { fullKey, record }. The fullKey is shown ONCE. */
export function generateHubKey(label: string): { fullKey: string; record: HubKey } {
  const suffix = randomBytes(32).toString('hex'); // 64 chars
  const fullKey = `${HUB_KEY_PREFIX}${suffix}`;
  const keyHash = createHash('sha256').update(fullKey).digest('hex');
  const keyPrefix = fullKey.slice(0, 12); // "fh_" + 8 hex chars
  const id = `hk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO hub_keys (id, label, key_hash, key_prefix, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(id, label, keyHash, keyPrefix, now);
  return {
    fullKey,
    record: { id, label, keyPrefix, enabled: true, createdAt: now, lastUsedAt: null },
  };
}

/** Middleware: require a valid hub key in `Authorization: Bearer fh_...`. */
export function requireHubKey(req: Request, res: Response, next: NextFunction): void {
  const auth = req.header('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(fh_[a-f0-9]{64})$/i);
  if (!m) {
    res.status(401).json({ error: { message: 'Missing or invalid Authorization header. Use: Bearer fh_<64hex>' } });
    return;
  }
  const fullKey = m[1].toLowerCase();
  const keyHash = createHash('sha256').update(fullKey).digest('hex');
  const row = getDb()
    .prepare('SELECT * FROM hub_keys WHERE key_hash = ?')
    .get(keyHash) as HubKeyRow | undefined;
  if (!row) {
    res.status(401).json({ error: { message: 'Unknown hub key' } });
    return;
  }
  if (!row.enabled) {
    res.status(403).json({ error: { message: 'Hub key disabled' } });
    return;
  }
  // Async update last_used_at (fire and forget)
  getDb()
    .prepare('UPDATE hub_keys SET last_used_at = ? WHERE id = ?')
    .run(Date.now(), row.id);
  req.hubKey = rowToHubKey(row);
  next();
}
