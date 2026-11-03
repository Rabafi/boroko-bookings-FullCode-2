import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { canonicalJson } from '@tsa-bonno/bar-contracts'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const sign = (secret: string, value: unknown) => createHmac('sha256', secret).update(canonicalJson(value)).digest('hex')
export function equalSignature(actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}
export function seal(value: unknown, master: string): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(master).digest(), nonce)
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64')
}
export function unseal<T>(value: string, master: string): T {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length < 29 || bytes.length > 65536) throw new Error('Protected owner-link record is invalid.')
  const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(master).digest(), bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T
}
