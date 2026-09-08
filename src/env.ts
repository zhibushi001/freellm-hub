import { config } from 'dotenv';
// override: true ensures .env values win over inherited shell vars (e.g. PORT=41246 from openclaw)
config({ override: true });

const required = (key: string, fallback?: string): string => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3030'), 10),
  host: optional('HOST', '0.0.0.0'),
  encryptionKey: optional('ENCRYPTION_KEY', 'dev-only-do-not-use-in-prod-' + '0'.repeat(30)),
  databasePath: optional('DATABASE_PATH', './data/freellm-hub.db'),
  logLevel: optional('LOG_LEVEL', 'info'),
  isDev: process.env.NODE_ENV !== 'production',
} as const;

// Silence the "required" unused warning while keeping the helper
void required;
