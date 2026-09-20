/**
 * 端点工具: 本地 vs 远程, RFC1918 私有网段识别
 *
 * 仿 freellmapi: 本地 endpoint (loopback / RFC1918) 永远 5s cooldown,
 * 绝不进 ladder - 因为本地 ollama 等报 429 是 busy 不是 quota.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,              // loopback
  /^10\./,               // 10.0.0.0/8
  /^192\.168\./,         // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
  /^169\.254\./,         // link-local
  /^::1$/,               // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,    // IPv6 unique local
  /^fe80:/i,             // IPv6 link-local
];

const LOCAL_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', 'host.docker.internal']);

export function isLocalEndpoint(baseUrl: string): boolean {
  if (!baseUrl) return false;
  let url: URL;
  try { url = new URL(baseUrl); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  return PRIVATE_IP_PATTERNS.some(p => p.test(host));
}
