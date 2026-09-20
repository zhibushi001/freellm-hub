/**
 * 环境变量配置
 * 所有环境变量集中在 env.ts 解析，避免散落各处的 process.env
 */
import { resolve } from 'node:path';

function envStr(key: string, defaultValue?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (defaultValue === undefined) {
      throw new Error(`Required env var ${key} is not set`);
    }
    return defaultValue;
  }
  return v;
}

function envInt(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${key} is not a number: ${v}`);
  return n;
}

const dataDir = envStr('HUB_DATA_DIR', './data');

export const config = {
  env: envStr('NODE_ENV', 'development'),
  port: envInt('HUB_PORT', 3030),
  host: envStr('HUB_HOST', '0.0.0.0'),
  publicUrl: envStr('HUB_PUBLIC_URL', ''),
  dataDir,
  db: {
    path: resolve(dataDir, 'hub.db'),
  },
  masterKeyPath: resolve(dataDir, 'master.key'),
  sessionSecretPath: resolve(dataDir, 'session.secret'),
  log: {
    level: envStr('LOG_LEVEL', 'info'),
  },
  rateLimit: {
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 3 * 60 * 1000), // 3 min
    webMax: envInt('WEB_RATE_LIMIT_MAX', 200),
    apiMax: envInt('API_RATE_LIMIT_MAX', 600),
    loginMax: envInt('LOGIN_RATE_LIMIT_MAX', 5),
  },
} as const;

export type AppConfig = typeof config;
