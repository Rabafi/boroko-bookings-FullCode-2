import { pbkdf2, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const PIN_RE = /^\d{4,12}$/
const KEY_BYTES = 32
const SALT_BYTES = 16

export interface PinVerifier {
  pin_hash: string
  pin_salt: string
  pin_iterations: number
}

export interface PinRecord {
  pin_hash?: unknown
  pin_salt?: unknown
  pin_iterations?: unknown
}

export function assertPinFormat(pin: unknown, field = 'pin'): string {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
    throw new Error(`${field} must be 4 to 12 digits`)
  }
  return pin
}

export function hashPin(pin: unknown, iterations: number): PinVerifier {
  const validPin = assertPinFormat(pin)
  if (!Number.isInteger(iterations) || iterations < 100000) {
    throw new Error('PIN hashing requires at least 100000 iterations')
  }
  const salt = randomBytes(SALT_BYTES)
  const hash = pbkdf2Sync(validPin, salt, iterations, KEY_BYTES, 'sha256')
  return {
    pin_hash: hash.toString('hex'),
    pin_salt: salt.toString('hex'),
    pin_iterations: iterations
  }
}

export function verifyPin(pin: unknown, record: PinRecord | null | undefined): boolean {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) return false
  const iterations = Number(record?.pin_iterations)
  if (!Number.isInteger(iterations) || iterations < 1) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(String(record?.pin_salt ?? ''), 'hex')
    expected = Buffer.from(String(record?.pin_hash ?? ''), 'hex')
  } catch {
    return false
  }
  if (salt.length < 8 || expected.length < 16) return false
  const actual = pbkdf2Sync(pin, salt, iterations, expected.length, 'sha256')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function dummyPinVerify(pin: unknown, iterations: number): false {
  const salt = Buffer.alloc(SALT_BYTES, 0x5a)
  pbkdf2Sync(typeof pin === 'string' ? pin : '', salt, iterations, KEY_BYTES, 'sha256')
  return false
}

// Approval lookup may inspect several eligible identities. Keep PBKDF2 off the
// service event loop and bound corrupt verifier work before scheduling it.
export async function verifyPinAsync(pin: unknown, record: PinRecord | null | undefined): Promise<boolean> {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) return false
  const iterations=Number(record?.pin_iterations)
  if (!Number.isInteger(iterations) || iterations<100000 || iterations>2000000) return false
  const saltHex=String(record?.pin_salt??'')
  const hashHex=String(record?.pin_hash??'')
  if(!/^(?:[0-9a-f]{2}){8,64}$/i.test(saltHex)||!/^[0-9a-f]{64}$/i.test(hashHex))return false
  const salt=Buffer.from(saltHex,'hex')
  const expected=Buffer.from(hashHex,'hex')
  if(salt.length<8 || salt.length>64 || expected.length!==KEY_BYTES)return false
  const actual=await new Promise<Buffer>((resolve,reject)=>{
    pbkdf2(pin,salt,iterations,KEY_BYTES,'sha256',(error,value)=>error?reject(error):resolve(value))
  })
  return timingSafeEqual(actual,expected)
}
