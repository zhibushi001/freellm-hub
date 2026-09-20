/**
 * API Key AES-256-GCM 加解密
 *
 * 密文格式: [12 bytes IV][N bytes ciphertext][16 bytes auth tag]
 * 总长度 = 12 + plaintext.length + 16
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getMasterKey } from './kek.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptApiKey(plaintext: string): Buffer {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]);
}

export function decryptApiKey(ciphertext: Buffer): string {
  if (ciphertext.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('密文长度异常');
  }
  const key = getMasterKey();
  const iv = ciphertext.subarray(0, IV_LENGTH);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const encrypted = ciphertext.subarray(IV_LENGTH, ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * 给 API Key 生成 hint (用于 UI 展示，绝不暴露完整 Key)
 * 规则: 前 4 位 + 中间... + 末 4 位
 */
export function makeApiKeyHint(apiKey: string): string {
  if (apiKey.length <= 12) {
    return apiKey.slice(0, 2) + '...' + apiKey.slice(-2);
  }
  return apiKey.slice(0, 4) + '...' + apiKey.slice(-4);
}
