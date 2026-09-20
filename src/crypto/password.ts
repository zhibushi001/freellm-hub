/**
 * 密码哈希 (argon2id)
 */
import argon2 from 'argon2';

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP minimum)
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * 密码强度校验 (注册时强制)
 * - 至少 10 字符
 * - 至少 1 个字母
 * - 至少 1 个数字
 */
export function validatePasswordStrength(pw: string): { ok: true } | { ok: false; reason: string } {
  if (pw.length < 10) {
    return { ok: false, reason: '密码至少 10 个字符' };
  }
  if (!/[a-zA-Z]/.test(pw)) {
    return { ok: false, reason: '密码必须包含至少一个字母' };
  }
  if (!/[0-9]/.test(pw)) {
    return { ok: false, reason: '密码必须包含至少一个数字' };
  }
  return { ok: true };
}
