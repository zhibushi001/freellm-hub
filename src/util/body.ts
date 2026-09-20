/**
 * 兼容 JSON 和表单数据两种请求体格式
 * React 前端发 JSON (含数字/布尔), 后端期望所有值为 string
 * 此函数将任意 body 值转为 string
 */
export function str(body: any, key: string, fallback = ''): string {
  const v = body?.[key];
  if (v === undefined || v === null) return fallback;
  return String(v);
}

/**
 * 将整个 body 转为 Record<string, string>
 */
export function toStrBody(body: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!body || typeof body !== 'object') return result;
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    result[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return result;
}
