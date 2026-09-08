import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '../env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const SALT = 'freellm-hub-v1'; // fixed salt for key derivation

// Derive a 32-byte key from ENCRYPTION_KEY env var (handles arbitrary-length keys)
function getKey(): Buffer {
  return scryptSync(env.encryptionKey, SALT, 32);
}

export interface EncryptedBlob {
  iv: string;       // hex
  ciphertext: string; // hex
  tag: string;      // hex
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns {iv, ciphertext, tag} all as hex strings, safe to store in SQLite TEXT columns.
 */
export function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    ciphertext: enc.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an EncryptedBlob back to plaintext. Throws on auth tag mismatch (tampering).
 */
export function decrypt(blob: EncryptedBlob): string {
  const iv = Buffer.from(blob.iv, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'hex');
  const tag = Buffer.from(blob.tag, 'hex');
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Convenience: encrypt a string into a single colon-joined string (for storage in a single column).
 */
export function encryptToString(plaintext: string): string {
  const { iv, ciphertext, tag } = encrypt(plaintext);
  return `${iv}:${ciphertext}:${tag}`;
}

/**
 * Inverse of encryptToString.
 */
export function decryptFromString(s: string): string {
  const [iv, ciphertext, tag] = s.split(':');
  if (!iv || !ciphertext || !tag) throw new Error('Invalid encrypted string format');
  return decrypt({ iv, ciphertext, tag });
}
