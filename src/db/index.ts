import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../env.js';

let _db: Database.Database | null = null;

/**
 * Get or initialize the SQLite database (singleton).
 * Creates parent directory if missing, applies schema migrations on first run.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure parent dir exists
  mkdirSync(dirname(env.databasePath), { recursive: true });

  const db = new Database(env.databasePath);
  db.pragma('journal_mode = WAL'); // better concurrency
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  applySchema(db);
  _db = db;
  return db;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    -- API providers (OpenAI-compatible backends)
    CREATE TABLE IF NOT EXISTS providers (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL UNIQUE,
      base_url     TEXT NOT NULL,
      api_path     TEXT NOT NULL DEFAULT '/chat/completions',
      models_path  TEXT NOT NULL DEFAULT '/models',
      enabled      INTEGER NOT NULL DEFAULT 1,
      is_builtin   INTEGER NOT NULL DEFAULT 0,
      notes        TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    -- Encrypted provider API keys (one per provider for now)
    CREATE TABLE IF NOT EXISTS provider_keys (
      provider_id  TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
      api_key_enc  TEXT NOT NULL,  -- encrypted with ENCRYPTION_KEY
      updated_at   INTEGER NOT NULL
    );

    -- Cached model lists (per provider) — refreshed on /v1/models
    CREATE TABLE IF NOT EXISTS provider_models (
      provider_id  TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id     TEXT NOT NULL,
      fetched_at   INTEGER NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    );

    -- Hub's own API keys (user uses these to call the hub)
    CREATE TABLE IF NOT EXISTS hub_keys (
      id            TEXT PRIMARY KEY,
      label         TEXT NOT NULL,
      key_hash      TEXT NOT NULL UNIQUE,  -- sha256 of full key, for lookup
      key_prefix    TEXT NOT NULL,         -- e.g. "fh_a1b2..." for UI display
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      last_used_at  INTEGER
    );

    -- Per-provider routing (fallback chain)
    CREATE TABLE IF NOT EXISTS routing_rules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hub_key_id    TEXT NOT NULL REFERENCES hub_keys(id) ON DELETE CASCADE,
      model_pattern TEXT NOT NULL,         -- e.g. "gpt-*" or "glm-*"
      provider_id   TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      priority      INTEGER NOT NULL DEFAULT 100,
      enabled       INTEGER NOT NULL DEFAULT 1
    );

    -- Audit log
    CREATE TABLE IF NOT EXISTS request_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hub_key_id    TEXT,
      provider_id   TEXT,
      model         TEXT,
      status        INTEGER,
      duration_ms   INTEGER,
      error         TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_log_created_at ON request_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
  `);
}

/** Close the DB (for tests / shutdown) */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
