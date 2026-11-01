import { BAR_LOCAL_ERROR_CODES, BarLocalError } from './errors.js'
import { assertDecimalString } from './canonical.js'
import type { DecimalOptions } from './canonical.js'

export type Payload = Record<string, unknown>

export interface StringOptions {
  min?: number
  max?: number
  pattern?: RegExp | null
  trim?: boolean
}

export interface IntegerOptions {
  min?: number
  max?: number
}

export interface MoneyOptions {
  allowZero?: boolean
  maxScale?: number
  maxIntegerDigits?: number
}

export interface Item {
  product_id: string
  quantity: string
  notes: string | null
  modifiers?: string[]
}

export interface Tender {
  method: string
  amount: string
  tendered: string | null
  reference: string | null
  provider_status: string | null
  voucher_code: string | null
  customer_id: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/

export function fail(field: string, message: string): never {
  throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${field} ${message}`)
}

export function object(value: unknown, field: string, options: { allowEmpty?: boolean } = {}): Payload {
  const { allowEmpty = true } = options
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object')
  const proto = Object.getPrototypeOf(value) as unknown
  if (proto !== Object.prototype && proto !== null) fail(field, 'must be a plain object')
  const record = value as Payload
  if (!allowEmpty && Object.keys(record).length === 0) fail(field, 'must not be empty')
  return record
}

export function keys(value: Payload, field: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${field}.${key}`, 'is not an allowed field')
  }
}

export function string(value: unknown, field: string, options: StringOptions = {}): string {
  const { min = 0, max = 500, pattern = null, trim = false } = options
  if (typeof value !== 'string') fail(field, 'must be a string')
  const text = trim ? value.trim() : value
  if (text.length < min) fail(field, `must be at least ${min} characters`)
  if (text.length > max) fail(field, `must be at most ${max} characters`)
  if (pattern && !pattern.test(text)) fail(field, 'has an invalid format')
  return text
}

export function optionalString(value: unknown, field: string, options?: StringOptions): string | null {
  if (value === undefined || value === null || value === '') return null
  return string(value, field, options)
}

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(field, 'must be a UUID')
  return value.toLowerCase()
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return uuid(value, field)
}

export function integer(value: unknown, field: string, options: IntegerOptions = {}): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(field, 'must be a safe integer')
  if (value < min || value > max) fail(field, `must be between ${min} and ${max}`)
  return value
}

export function optionalInteger(value: unknown, field: string, options?: IntegerOptions): number | null {
  if (value === undefined || value === null) return null
  return integer(value, field, options)
}

export function money(value: unknown, field: string, options: MoneyOptions = {}): string {
  return assertDecimalString(value, field, options as DecimalOptions)
}

export function optionalMoney(value: unknown, field: string, options?: MoneyOptions): string | null {
  if (value === undefined || value === null || value === '') return null
  return money(value, field, options)
}

export function quantity(value: unknown, field: string, options: { allowZero?: boolean; maxScale?: number } = {}): string {
  const { allowZero = false, maxScale = 6 } = options
  return assertDecimalString(value, field, { allowZero, maxScale, maxIntegerDigits: 12 })
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field, 'must be a boolean')
  return value
}

export function optionalBoolean(value: unknown, field: string, fallback: boolean | null = null): boolean | null {
  if (value === undefined || value === null) return fallback
  return boolean(value, field)
}

export function enumeration<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(field, `must be one of ${allowed.join(', ')}`)
  return value as T
}

export function array(value: unknown, field: string, options: { min?: number; max?: number } = {}): unknown[] {
  const { min = 0, max = 500 } = options
  if (!Array.isArray(value)) fail(field, 'must be an array')
  if (value.length < min) fail(field, `must contain at least ${min} item(s)`)
  if (value.length > max) fail(field, `must contain at most ${max} item(s)`)
  return value
}

export function dateString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) fail(field, 'must be a YYYY-MM-DD date')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(field, 'must be a real date')
  return value
}

export function monthString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) fail(field, 'must be a YYYY-MM month')
  return value
}

export function pin(value: unknown, field = 'pin'): string {
  if (typeof value !== 'string' || !/^\d{4,12}$/.test(value)) fail(field, 'must be 4 to 12 digits')
  return value
}

export function longText(value: unknown, field: string, max = 4000): string {
  return string(value, field, { min: 1, max, trim: true })
}

export function validateItemModifiers(
  modifiers: unknown,
  field = 'modifiers',
  options: { max?: number } = {}
): string[] {
  const { max = 50 } = options
  if (modifiers === undefined || modifiers === null) return []
  const ids = array(modifiers, field, { max }).map((modifier, index) => {
    const path = `${field}[${index}]`
    if (typeof modifier === 'string') return uuid(modifier, path)
    const row = object(modifier, path)
    keys(row, path, ['option_id'])
    return uuid(row.option_id, `${path}.option_id`)
  })
  if (new Set(ids).size !== ids.length) fail(field, 'must not contain duplicate options')
  return ids
}

export function validateItems(items: unknown, field = 'items', options: { max?: number } = {}): Item[] {
  const { max = 200 } = options
  return array(items, field, { min: 1, max }).map((item, index) => {
    const path = `${field}[${index}]`
    const row = object(item, path)
    keys(row, path, ['product_id', 'quantity', 'notes', 'modifiers'])
    const validated: Item = {
      product_id: uuid(row.product_id, `${path}.product_id`),
      quantity: quantity(row.quantity, `${path}.quantity`),
      notes: optionalString(row.notes, `${path}.notes`, { max: 500, trim: true })
    }
    if (row.modifiers !== undefined && row.modifiers !== null) {
      validated.modifiers = validateItemModifiers(row.modifiers, `${path}.modifiers`)
    }
    return validated
  })
}

export const TENDER_METHODS = Object.freeze([
  'cash',
  'card',
  'mobile_money',
  'bank_transfer',
  'customer_credit',
  'voucher',
  'room_charge',
  'external'
] as const)

export const PROVIDER_STATUSES = Object.freeze([
  'not_applicable', 'locally_asserted', 'provider_pending', 'provider_confirmed'
] as const)

export function validateTenders(tenders: unknown, field = 'tenders', options: { max?: number } = {}): Tender[] {
  const { max = 20 } = options
  return array(tenders, field, { min: 1, max }).map((tender, index) => {
    const path = `${field}[${index}]`
    const row = object(tender, path)
    keys(row, path, ['method', 'amount', 'tendered', 'reference', 'provider_status', 'voucher_code', 'customer_id'])
    const method = enumeration(row.method, `${path}.method`, TENDER_METHODS)
    const amount = money(row.amount, `${path}.amount`, { allowZero: false, maxScale: 2 })
    const tendered = optionalMoney(row.tendered, `${path}.tendered`, { allowZero: false, maxScale: 2 })
    const providerStatus = row.provider_status === undefined
      ? null
      : enumeration(row.provider_status, `${path}.provider_status`, PROVIDER_STATUSES)
    return {
      method,
      amount,
      tendered,
      reference: optionalString(row.reference, `${path}.reference`, { max: 120, trim: true }),
      provider_status: providerStatus,
      voucher_code: optionalString(row.voucher_code, `${path}.voucher_code`, { max: 60, trim: true }),
      customer_id: optionalUuid(row.customer_id, `${path}.customer_id`)
    }
  })
}
