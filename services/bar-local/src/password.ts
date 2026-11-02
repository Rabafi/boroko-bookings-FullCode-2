import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'sha256'
const KEY_BYTES = 32
const SALT_BYTES = 32
export const OWNER_PASSWORD_ITERATIONS = 600_000
const MAX_PASSWORD_ITERATIONS = 2_000_000

export interface PasswordVerifier {
  password_hash: string
  password_salt: string
  password_iterations: number
}

export interface PasswordRecord {
  password_hash?: unknown
  password_salt?: unknown
  password_iterations?: unknown
}

export function normalizeOwnerEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter the owner email address.')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid owner email address.')
  }
  return email
}

export function assertOwnerPassword(value: unknown, field = 'password'): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || value.trim() !== value) {
    throw new Error(`${field} must be 12–128 characters and cannot start or end with spaces.`)
  }
  return value
}

function derive(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, KEY_BYTES, ALGORITHM, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashOwnerPassword(value: unknown): Promise<PasswordVerifier> {
  const password = assertOwnerPassword(value)
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, OWNER_PASSWORD_ITERATIONS)
  return { password_hash: key.toString('hex'), password_salt: salt.toString('hex'), password_iterations: OWNER_PASSWORD_ITERATIONS }
}

export async function verifyOwnerPassword(value: unknown, record: PasswordRecord | null | undefined): Promise<boolean> {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) return false
  const iterations = Number(record?.password_iterations)
  const saltHex = String(record?.password_salt ?? '')
  const hashHex = String(record?.password_hash ?? '')
  if (!Number.isInteger(iterations) || iterations < OWNER_PASSWORD_ITERATIONS || iterations > MAX_PASSWORD_ITERATIONS
      || !/^[0-9a-f]{64}$/i.test(saltHex) || !/^[0-9a-f]{64}$/i.test(hashHex)) return false
  const actual = await derive(value, Buffer.from(saltHex, 'hex'), iterations)
  return timingSafeEqual(actual, Buffer.from(hashHex, 'hex'))
}

export async function dummyOwnerPasswordVerify(value: unknown): Promise<void> {
  const password = typeof value === 'string' && value.length <= 128 ? value : ''
  await derive(password, Buffer.alloc(SALT_BYTES, 0x6b), OWNER_PASSWORD_ITERATIONS)
}
