/**
 * Checksum 工具
 *
 * 用于 Evidence / Fragment 内容校验
 * 确保原始内容不被篡改
 */

import crypto from 'crypto';

/**
 * 计算内容的 SHA-256 校验和
 * @param content 原始内容
 * @returns 64 字符十六进制哈希
 */
export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 验证内容校验和是否匹配
 * @param content 内容
 * @param checksum 预期校验和
 * @returns 是否匹配
 */
export function verifyChecksum(content: string, checksum: string): boolean {
  return computeChecksum(content) === checksum;
}
