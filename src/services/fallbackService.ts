/**
 * 回退配置服务
 * 用于配置模型回退策略
 */
import { getDb } from '../db/connection.js';

export interface FallbackConfig {
  id: number;
  primaryModel: string;
  fallbackModels: string[];
  strategy: 'sequential' | 'weighted' | 'priority';
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 获取回退配置
 */
export function getFallbackConfig(primaryModel: string): FallbackConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM fallback_config WHERE primary_model = ?")
    .get(primaryModel);
  
  if (!row) return null;
  
  let fallbackModels: string[] = [];
  try {
    fallbackModels = JSON.parse((row.fallback_models as string) || '[]');
  } catch {
    fallbackModels = [];
  }
  
  return {
    id: row.id as number,
    primaryModel: row.primary_model as string,
    fallbackModels,
    strategy: row.strategy as 'sequential' | 'weighted' | 'priority',
    enabled: (row.enabled as number) === 1,
    maxRetries: row.max_retries as number,
    retryDelayMs: row.retry_delay_ms as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * 列出所有回退配置
 */
export function listFallbackConfigs(): FallbackConfig[] {
  const rows = getDb()
    .prepare("SELECT * FROM fallback_config ORDER BY created_at DESC")
    .all() as any[];
  
  return rows.map((row: any) => {
    let fallbackModels: string[] = [];
    try {
      fallbackModels = JSON.parse((row.fallback_models as string) || '[]');
    } catch {
      fallbackModels = [];
    }
    
    return {
      id: row.id as number,
      primaryModel: row.primary_model as string,
      fallbackModels,
      strategy: row.strategy as 'sequential' | 'weighted' | 'priority',
      enabled: (row.enabled as number) === 1,
      maxRetries: row.max_retries as number,
      retryDelayMs: row.retry_delay_ms as number,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  });
}

/**
 * 创建或更新回退配置
 */
export function upsertFallbackConfig(config: {
  primaryModel: string;
  fallbackModels: string[];
  strategy?: 'sequential' | 'weighted' | 'priority';
  enabled?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}): FallbackConfig {
  const now = Date.now();
  const primaryModel = config.primaryModel;
  const fallbackModels = JSON.stringify(config.fallbackModels || []);
  const strategy = config.strategy || 'sequential';
  const enabled = config.enabled !== undefined ? config.enabled : true;
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  
  const existing = getDb()
    .prepare("SELECT id FROM fallback_config WHERE primary_model = ?")
    .get(primaryModel) as any;
  
  if (existing) {
    getDb()
      .prepare(
        `UPDATE fallback_config SET 
          fallback_models = ?, strategy = ?, enabled = ?, max_retries = ?, retry_delay_ms = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(fallbackModels, strategy, enabled ? 1 : 0, maxRetries, retryDelayMs, now, existing.id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO fallback_config 
         (primary_model, fallback_models, strategy, enabled, max_retries, retry_delay_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(primaryModel, fallbackModels, strategy, enabled ? 1 : 0, maxRetries, retryDelayMs, now, now);
  }
  
  return getFallbackConfig(primaryModel)!;
}

/**
 * 删除回退配置
 */
export function deleteFallbackConfig(id: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM fallback_config WHERE id = ?")
    .run(id);
  return result.changes > 0;
}
