/**
 * 内容护栏服务
 * 用于配置输入/输出的内容过滤规则
 */
import { getDb } from '../db/connection.js';

export interface GuardrailConfig {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  inputFilter: boolean;
  outputFilter: boolean;
  rules: {
    blocked_keywords: string[];
    pii_detection: boolean;
    max_input_length: number;
    max_output_length: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface GuardrailCheckResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * 获取默认护栏配置
 */
export function getGuardrailConfig(): GuardrailConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM guardrails WHERE name = 'default'")
    .get();
  
  if (!row) return null;
  
  let rules: any = {
    blocked_keywords: [],
    pii_detection: false,
    max_input_length: 4096,
    max_output_length: 4096,
  };
  
  try {
    rules = JSON.parse((row.rules as string) || '{}');
  } catch {
    // 使用默认值
  }
  
  return {
    id: row.id as number,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    enabled: (row.enabled as number) === 1,
    inputFilter: (row.input_filter as number) === 1,
    outputFilter: (row.output_filter as number) === 1,
    rules: {
      blocked_keywords: rules.blocked_keywords || [],
      pii_detection: rules.pii_detection || false,
      max_input_length: rules.max_input_length || 4096,
      max_output_length: rules.max_output_length || 4096,
    },
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * 检查输入内容
 */
export function checkInputContent(text: string): GuardrailCheckResult {
  const config = getGuardrailConfig();
  if (!config || !config.enabled || !config.inputFilter) {
    return { allowed: true, reason: null };
  }
  
  // 检查最大长度
  if (text.length > config.rules.max_input_length) {
    return {
      allowed: false,
      reason: `输入内容超过最大长度限制 (${text.length} > ${config.rules.max_input_length})`,
    };
  }
  
  // 检查屏蔽词
  const keywords = config.rules.blocked_keywords;
  if (keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return {
          allowed: false,
          reason: `输入内容包含屏蔽词: ${keyword}`,
        };
      }
    }
  }
  
  // PII 检测（简化版本）
  if (config.rules.pii_detection) {
    // 检测邮箱
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    if (emailRegex.test(text)) {
      return {
        allowed: false,
        reason: '输入内容包含邮箱地址',
      };
    }
    // 检测电话号码（简化）
    const phoneRegex = /(\+?\d{1,3}[- ]?)?\(?\d{3,4}\)?[- ]?\d{3,4}[- ]?\d{4}/g;
    if (phoneRegex.test(text) && text.length < 100) {
      return {
        allowed: false,
        reason: '输入内容可能包含电话号码',
      };
    }
  }
  
  return { allowed: true, reason: null };
}

/**
 * 检查输出内容
 */
export function checkOutputContent(text: string): GuardrailCheckResult {
  const config = getGuardrailConfig();
  if (!config || !config.enabled || !config.outputFilter) {
    return { allowed: true, reason: null };
  }
  
  // 检查最大长度
  if (text.length > config.rules.max_output_length) {
    return {
      allowed: false,
      reason: `输出内容超过最大长度限制 (${text.length} > ${config.rules.max_output_length})`,
    };
  }
  
  // 检查屏蔽词
  const keywords = config.rules.blocked_keywords;
  if (keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return {
          allowed: false,
          reason: `输出内容包含屏蔽词: ${keyword}`,
        };
      }
    }
  }
  
  return { allowed: true, reason: null };
}

/**
 * 更新护栏配置
 */
export function updateGuardrailConfig(config: Partial<GuardrailConfig>): GuardrailConfig | null {
  const now = Date.now();
  
  getDb()
    .prepare(
      `UPDATE guardrails SET 
        description = ?, enabled = ?, input_filter = ?, output_filter = ?, 
        rules = ?, updated_at = ? 
       WHERE name = 'default'`
    )
    .run(
      config.description ?? null,
      config.enabled ? 1 : 0,
      config.inputFilter ? 1 : 0,
      config.outputFilter ? 1 : 0,
      JSON.stringify(config.rules || {}),
      now,
    );
  
  return getGuardrailConfig();
}
