/**
 * 主加密密钥 (KEK - Key Encryption Key) 管理
 *
 * - 首次启动：随机生成 32 字节主密钥，存到 data/master.key
 * - 后续启动：从文件读取
 * - 丢失此文件 = 失去所有加密的上游 API Key（必须重新输入所有 Key）
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { config } from '../config/env.js';

const KEY_FILE = config.masterKeyPath;
let _key: Buffer | null = null;

/**
 * 获取（或初始化）主加密密钥
 */
export function getMasterKey(): Buffer {
  if (_key) return _key;

  if (existsSync(KEY_FILE)) {
    const buf = readFileSync(KEY_FILE);
    if (buf.length !== 32) {
      throw new Error(
        `master.key 文件长度异常 (期望 32 字节, 实际 ${buf.length}). ` +
          '可能是文件损坏或被截断. 恢复后会失去所有上游 API Key.',
      );
    }
    _key = buf;
    return _key;
  }

  // 首次启动：生成
  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key, { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  _key = key;
  console.log(`[kek] 已生成主加密密钥: ${KEY_FILE}`);
  console.log(`[kek] ⚠️  请务必备份此文件！丢失 = 所有上游 API Key 不可解密`);
  return _key;
}

/**
 * 重置主密钥（仅用于完全清空 + 重新开始场景）
 */
export function resetMasterKey(): Buffer {
  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key, { mode: 0o600 });
  _key = key;
  return _key;
}
