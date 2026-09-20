/**
 * Channels repo
 */
import { getDb } from '../connection.js';

export interface Channel {
  id: number;
  provider_id: number;
  label: string | null;
  enabled: number;
  weight: number;
  priority: number;
  models: string | null;
  excluded_models: string | null;
  model_mapping: string | null;
  status_code_mapping: string | null;
  param_override: string | null;
  header_override: string | null;
  multi_key_mode: string;
  test_model: string | null;
  auto_ban: number;
  tag: string | null;
  capabilities: string | null;  // JSON: {"vision": true, "tools": true, "image": false}
  created_at: number;
  updated_at: number;
}

export interface ChannelWithProvider extends Channel {
  provider_name: string;
  provider_display_name: string | null;
  base_url: string;
  protocol: string;
  key_count: number;
}

export function listChannels(): ChannelWithProvider[] {
  return getDb()
    .prepare(
      `SELECT c.*, p.name as provider_name, p.display_name as provider_display_name,
              p.base_url, p.protocol,
              (SELECT COUNT(*) FROM keys k WHERE k.channel_id = c.id) as key_count
       FROM channels c
       JOIN providers p ON p.id = c.provider_id
       ORDER BY p.name, c.priority, c.id`,
    )
    .all() as unknown as ChannelWithProvider[];
}

export function listMockChannels(): ChannelWithProvider[] {
  return getDb()
    .prepare(
      `SELECT c.*, p.name as provider_name, p.display_name as provider_display_name,
              p.base_url, p.protocol,
              (SELECT COUNT(*) FROM keys k WHERE k.channel_id = c.id) as key_count
       FROM channels c
       JOIN providers p ON p.id = c.provider_id
       WHERE p.name IN ('mock', 'builtin')
       ORDER BY c.id`,
    )
    .all() as unknown as ChannelWithProvider[];
}

export function listRealChannels(): ChannelWithProvider[] {
  return getDb()
    .prepare(
      `SELECT c.*, p.name as provider_name, p.display_name as provider_display_name,
              p.base_url, p.protocol,
              (SELECT COUNT(*) FROM keys k WHERE k.channel_id = c.id) as key_count
       FROM channels c
       JOIN providers p ON p.id = c.provider_id
       WHERE p.name NOT IN ('mock', 'builtin')
       ORDER BY p.name, c.priority, c.id`,
    )
    .all() as unknown as ChannelWithProvider[];
}

export function getChannel(id: number): Channel | null {
  const row = getDb().prepare('SELECT * FROM channels WHERE id = ?').get(id);
  return (row as unknown as Channel) ?? null;
}

export function createChannel(input: {
  provider_id: number;
  label?: string | null;
  weight?: number;
  priority?: number;
  models?: string | null;
  excluded_models?: string | null;
  model_mapping?: string | null;
  status_code_mapping?: string | null;
  param_override?: string | null;
  header_override?: string | null;
  multi_key_mode?: string;
  test_model?: string | null;
  auto_ban?: number;
  tag?: string | null;
  capabilities?: string | null;
}): Channel {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO channels (provider_id, label, enabled, weight, priority,
        models, excluded_models, model_mapping, status_code_mapping, param_override, header_override,
        multi_key_mode, test_model, auto_ban, tag, capabilities,
        created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.provider_id,
      input.label ?? null,
      input.weight ?? 1,
      input.priority ?? 0,
      input.models ?? null,
      input.excluded_models ?? null,
      input.model_mapping ?? null,
      input.status_code_mapping ?? null,
      input.param_override ?? null,
      input.header_override ?? null,
      input.multi_key_mode ?? 'random',
      input.test_model ?? null,
      input.auto_ban ?? 1,
      input.tag ?? null,
      input.capabilities ?? null,
      now,
      now,
    );
  return getChannel(Number(info.lastInsertRowid))!;
}

export function updateChannel(id: number, patch: {
  label?: string;
  enabled?: number;
  weight?: number;
  priority?: number;
  models?: string | null;
  excluded_models?: string | null;
  model_mapping?: string | null;
  status_code_mapping?: string | null;
  param_override?: string | null;
  header_override?: string | null;
  multi_key_mode?: string;
  test_model?: string | null;
  auto_ban?: number;
  tag?: string | null;
  capabilities?: string | null;
}): Channel | null {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed = [
    'label', 'enabled', 'weight', 'priority',
    'models', 'excluded_models', 'model_mapping', 'status_code_mapping', 'param_override', 'header_override',
    'multi_key_mode', 'test_model', 'auto_ban', 'tag', 'capabilities',
  ] as const;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length === 0) return getChannel(id);
  fields.push('updated_at = ?');
  values.push(Date.now(), id);
  getDb().prepare(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getChannel(id);
}

export function deleteChannel(id: number): void {
  getDb().prepare('DELETE FROM channels WHERE id = ?').run(id);
}
