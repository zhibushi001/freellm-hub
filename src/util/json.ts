/**
 * JSON 解析工具
 * 统一所有 tryParse / tryParseJson / tryParseJSON 的实现
 */

import { logger } from './logger.js';

/**
 * 安全解析 JSON 字符串
 * - 解析成功: 返回解析后的对象
 * - 解析失败 / 输入为空: 返回 fallback (默认 null)
 * - 返回类型永远是 `any` (与 JSON.parse 行为一致), 调用方按需强转
 */
export function parseJsonSafe(
  raw: string | null | undefined,
  fallback?: any,
  opts: { logOnFail?: boolean; context?: string } = {},
): any {
  if (raw == null || raw === '') return fallback ?? null;
  try {
    return JSON.parse(raw);
  } catch (e: any) {
    if (opts.logOnFail) {
      logger.debug({ err: e.message, context: opts.context }, 'JSON parse failed');
    }
    return fallback ?? null;
  }
}

/**
 * 同步别名: 兼容老代码
 * @deprecated 用 parseJsonSafe
 */
export const tryParse = parseJsonSafe;

