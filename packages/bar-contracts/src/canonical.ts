import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { BAR_LOCAL_ERROR_CODES, BarLocalError } from './errors.js'

export interface DecimalOptions {
  allowZero?: boolean
  maxScale?: number
  maxIntegerDigits?: number
}

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

export function assertDecimalString(value: unknown, field = 'value', options: DecimalOptions = {}): string {
  const { allowZero = true, maxScale = 6, maxIntegerDigits = 14 } = options
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${field} must be a decimal string`)
  }
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole = '', fraction = ''] = unsigned.split('.')
  if (whole.length > maxIntegerDigits) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${field} has too many integer digits`)
  }
  if (fraction.length > maxScale) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${field} has too many decimal places`)
  }
  if (!allowZero && /^0(?:\.0+)?$/.test(unsigned)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${field} must be greater than zero`)
  }
  return value
}

export function isDecimalString(value: unknown, options?: DecimalOptions): boolean {
  try {
    assertDecimalString(value, 'value', options)
    return true
  } catch {
    return false
  }
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function canonicalValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null'
  const type = typeof value
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path} contains an unpaired UTF-16 surrogate`)
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path} must be an integer; use a decimal string for money and quantities`)
    }
    return String(value)
  }
  if (typeof value === 'undefined') {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path} is undefined`)
  }
  if (type !== 'object' || value === null) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path} has unsupported type ${type}`)
  }
  const objectValue = value as object
  if (seen.has(objectValue)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path} contains a cycle`)
  }
  seen.add(objectValue)
  try {
    if (Array.isArray(value)) {
      const parts: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path}[${index}] is a sparse array hole`)
        }
        parts.push(canonicalValue(value[index], `${path}[${index}]`, seen))
      }
      return `[${parts.join(',')}]`
    }
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto !== Object.prototype && proto !== null) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${path} must be a plain object`)
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key], `${path}.${key}`, seen)}`)
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(objectValue)
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, '$', new Set())
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}

export function hmacSha256Hex(key: string, text: string): string {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex')
}

export function safeEqualHex(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false
  try {
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  } catch {
    return false
  }
}

export interface OperationEnvelopeLike {
  contract_version?: number
  command?: string
  payload_version?: number
  authority_id?: string
  authority_epoch?: number
  business_id?: string
  outlet_id?: string
  device_id?: string
  payload?: unknown
}

export function operationPayloadHash(envelope: OperationEnvelopeLike | null | undefined): string {
  return canonicalHash({
    contract_version: envelope?.contract_version,
    command: envelope?.command,
    payload_version: envelope?.payload_version,
    authority_id: envelope?.authority_id,
    authority_epoch: envelope?.authority_epoch,
    business_id: envelope?.business_id,
    outlet_id: envelope?.outlet_id,
    device_id: envelope?.device_id,
    payload: envelope?.payload
  })
}

export function approvalPayloadHash(envelope: OperationEnvelopeLike | null | undefined): string {
  const payload = envelope?.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload)
    ? Object.fromEntries(Object.entries(envelope.payload as Record<string, unknown>).filter(([key]) => key !== 'approval_id'))
    : envelope?.payload
  return operationPayloadHash({ ...envelope, payload })
}
