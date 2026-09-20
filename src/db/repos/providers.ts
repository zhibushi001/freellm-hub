/**
 * Providers repo
 */
import { getDb } from '../connection.js';

export interface Provider {
  id: number;
  name: string;
  display_name: string | null;
  base_url: string;
  protocol: string;
  api_path: string;
  models_path: string;
  extra_config: string | null;
  signup_url: string | null;
  notes: string | null;
  enabled: number;
  is_free: number;
  category: string | null;
  docs_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateProviderInput {
  name: string;
  display_name?: string;
  base_url: string;
  protocol?: string;
  api_path?: string;
  models_path?: string;
  extra_config?: string;
  signup_url?: string;
  notes?: string;
}

export function listProviders(): Provider[] {
  return getDb()
    .prepare('SELECT * FROM providers ORDER BY name')
    .all() as unknown as Provider[];
}

export function getProvider(id: number): Provider | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id);
  return (row as unknown as Provider) ?? null;
}

export function getProviderByName(name: string): Provider | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE name = ?').get(name);
  return (row as unknown as Provider) ?? null;
}

export function createProvider(input: CreateProviderInput): Provider {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO providers
       (name, display_name, base_url, protocol, api_path, models_path, extra_config, signup_url, notes, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.name,
      input.display_name ?? null,
      input.base_url,
      input.protocol ?? 'openai',
      input.api_path ?? '/chat/completions',
      input.models_path ?? '/models',
      input.extra_config ?? null,
      input.signup_url ?? null,
      input.notes ?? null,
      now,
      now,
    );
  return getProvider(Number(info.lastInsertRowid))!;
}

export function updateProvider(
  id: number,
  patch: Partial<CreateProviderInput> & { enabled?: number },
): Provider | null {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: Array<keyof CreateProviderInput | 'enabled'> = [
    'display_name', 'base_url', 'protocol', 'api_path', 'models_path',
    'extra_config', 'signup_url', 'notes', 'enabled',
  ];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length === 0) return getProvider(id);
  fields.push('updated_at = ?');
  values.push(Date.now(), id);
  getDb().prepare(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProvider(id);
}

export function deleteProvider(id: number): void {
  getDb().prepare('DELETE FROM providers WHERE id = ?').run(id);
}

/** UI 用, 包含 is_free / category, 按 is_free 升序(免费在前), name 升序 */
export function listProvidersForAdmin(): Provider[] {
  return getDb()
    .prepare('SELECT * FROM providers ORDER BY is_free DESC, name ASC')
    .all() as unknown as Provider[];
}
