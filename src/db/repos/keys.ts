/**
 * Keys repo (含加密的 API Key)
 */
import { getDb } from '../connection.js';
import { encryptApiKey, decryptApiKey, makeApiKeyHint } from '../../crypto/apiKeyCrypto.js';

export interface Key {
  id: number;
  channel_id: number;
  label: string | null;
  api_key_hint: string | null;
  enabled: number;
  tags: string | null;
  allowed_models: string | null;  // JSON 数组字符串, null/空 = 不限制
  status: string;
  status_reason: string | null;
  status_since: number | null;
  rpm_used: number;
  rpd_used: number;
  tpm_used: number;
  tpd_used: number;
  window_reset_at: number | null;
  avg_latency_ms: number | null;
  success_count: number;
  failure_count: number;
  last_used_at: number | null;
  last_probe_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface KeyWithChannel extends Key {
  channel_label: string | null;
  provider_id: number;
  provider_name: string;
  base_url: string;
  protocol: string;
  api_path: string;
  models_path: string;
}

export interface CreateKeyInput {
  channel_id: number;
  label?: string | null;
  apiKey: string;
  tags?: string[];
  allowed_models?: string[] | null;  // null/空 = 不限制
}

export function listKeys(): KeyWithChannel[] {
  return getDb()
    .prepare(
      `SELECT k.*, c.label as channel_label, c.provider_id, p.name as provider_name,
              p.base_url, p.protocol, p.api_path, p.models_path
       FROM keys k
       JOIN channels c ON c.id = k.channel_id
       JOIN providers p ON p.id = c.provider_id
       ORDER BY p.name, c.priority, k.id`,
    )
    .all() as unknown as KeyWithChannel[];
}

export function listKeysByChannel(channelId: number): KeyWithChannel[] {
  return getDb()
    .prepare(
      `SELECT k.*, c.label as channel_label, c.provider_id, p.name as provider_name,
              p.base_url, p.protocol, p.api_path, p.models_path
       FROM keys k
       JOIN channels c ON c.id = k.channel_id
       JOIN providers p ON p.id = c.provider_id
       WHERE k.channel_id = ?
       ORDER BY k.id`,
    )
    .all(channelId) as unknown as KeyWithChannel[];
}

export function getKey(id: number): KeyWithChannel | null {
  const row = getDb()
    .prepare(
      `SELECT k.*, c.label as channel_label, c.provider_id, p.name as provider_name,
              p.base_url, p.protocol, p.api_path, p.models_path
       FROM keys k
       JOIN channels c ON c.id = k.channel_id
       JOIN providers p ON p.id = c.provider_id
       WHERE k.id = ?`,
    )
    .get(id);
  return (row as unknown as KeyWithChannel) ?? null;
}

export function createKey(input: CreateKeyInput): Key {
  const now = Date.now();
  const enc = encryptApiKey(input.apiKey);
  const hint = makeApiKeyHint(input.apiKey);
  const allowedModels = input.allowed_models && input.allowed_models.length > 0
    ? JSON.stringify(input.allowed_models) : null;
  const info = getDb()
    .prepare(
      `INSERT INTO keys
       (channel_id, label, api_key_enc, api_key_hint, enabled, tags, status,
        status_reason, status_since, allowed_models, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 'unknown', NULL, NULL, ?, ?, ?)`,
    )
    .run(
      input.channel_id,
      input.label ?? null,
      enc,
      hint,
      input.tags ? JSON.stringify(input.tags) : null,
      allowedModels,
      now,
      now,
    );
  return getKey(Number(info.lastInsertRowid))!;
}

export function getDecryptedApiKey(id: number): string {
  const row = getDb()
    .prepare('SELECT api_key_enc FROM keys WHERE id = ?')
    .get(id) as { api_key_enc: Uint8Array } | undefined;
  if (!row) throw new Error(`Key ${id} not found`);
  // node:sqlite returns BLOB as Uint8Array; crypto APIs accept both but be explicit
  return decryptApiKey(Buffer.from(row.api_key_enc));
}

export function updateKey(
  id: number,
  patch: { label?: string | null; enabled?: number; tags?: string[]; status?: string; status_reason?: string | null; allowed_models?: string[] | null },
): Key | null {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.label !== undefined) { fields.push('label = ?'); values.push(patch.label); }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled); }
  if (patch.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(patch.tags)); }
  if (patch.status !== undefined) {
    fields.push('status = ?'); values.push(patch.status);
    fields.push('status_since = ?'); values.push(Date.now());
  }
  if (patch.status_reason !== undefined) { fields.push('status_reason = ?'); values.push(patch.status_reason); }
  if (patch.allowed_models !== undefined) {
    const v = patch.allowed_models && patch.allowed_models.length > 0
      ? JSON.stringify(patch.allowed_models) : null;
    fields.push('allowed_models = ?'); values.push(v);
  }
  if (fields.length === 0) return getKey(id);
  fields.push('updated_at = ?');
  values.push(Date.now(), id);
  getDb().prepare(`UPDATE keys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getKey(id);
}

export function deleteKey(id: number): void {
  getDb().prepare('DELETE FROM keys WHERE id = ?').run(id);
}

/**
 * 更新 key 的健康度指标
 *
 * 新设计: 失败不再永久禁用渠道 — 评分系统自动降权，成功一次自动恢复
 * 状态转换:
 *   healthy  (failure_count=0)
 *   degraded (1-4 次连续失败)
 *   failed   (5+ 次连续失败，但渠道仍然可用，靠评分降权)
 */
export function recordKeyUsage(id: number, ok: boolean, latencyMs: number): void {
  if (ok) {
    getDb()
      .prepare(
        `UPDATE keys SET
           success_count = success_count + 1,
           failure_count = 0,
           avg_latency_ms = COALESCE(avg_latency_ms, ?) * 0.8 + ? * 0.2,
           last_used_at = ?, status = 'healthy', status_reason = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(latencyMs, latencyMs, Date.now(), Date.now(), id);
  } else {
    getDb()
      .prepare(
        `UPDATE keys SET
           failure_count = failure_count + 1,
           last_used_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), id);

    // 状态转换 (不自动禁用渠道)
    const k = getKey(id);
    if (k) {
      if (k.failure_count >= 5) {
        updateKey(id, { status: 'failed', status_reason: `连续 ${k.failure_count} 次失败` });
      } else if (k.failure_count >= 2) {
        updateKey(id, { status: 'degraded', status_reason: `连续 ${k.failure_count} 次失败` });
      } else {
        updateKey(id, { status: 'degraded', status_reason: '首次失败' });
      }
    }
  }
}
