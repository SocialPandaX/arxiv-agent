import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * 敏感配置（如 LLM API Key）的加密存储。
 * 使用 AES-256-GCM，密钥由环境变量 ENCRYPTION_KEY 派生，
 * 保证数据库泄露时密钥不会直接暴露。
 *
 * 存储格式：enc:v1:<iv>:<authTag>:<ciphertext>（均为 base64）
 */

const PREFIX = 'enc:v1:'

function getDerivedKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error('ENCRYPTION_KEY 环境变量未设置，无法加密/解密敏感配置')
  }
  // 归一化为 32 字节密钥，允许用户填任意长度的口令
  return createHash('sha256').update(secret).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getDerivedKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

/**
 * 解密失败（如 ENCRYPTION_KEY 被更换）时抛出异常，由调用方决定降级策略
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':')
  const decipher = createDecipheriv('aes-256-gcm', getDerivedKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
