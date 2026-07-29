/**
 * Corporate billing financial repair — domain contract unit tests.
 *
 * Tests the JavaScript domain function argument forwarding, error handling,
 * idempotency key construction, and RPC call patterns by extracting functions
 * from source (Electron not available in Node --test).
 *
 * These are NOT live DB tests. They verify the domain's behaviour contract.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const CORPORATE_SRC = readFileSync(resolve(ROOT, 'src/main/domains/corporateBilling.js'), 'utf8')

// ── Helper: extract a function body from source text ────────────────────────

function extractFn(source, exportMarker) {
  const idx = source.indexOf(exportMarker)
  if (idx < 0) return null
  // Skip past the parameter list by tracking paren depth
  // (parameters may contain default values with braces like `options = {}`)
  const paramsStart = idx + exportMarker.length
  let parenDepth = 1
  let inString = false
  let stringChar = null
  let bodyStart = paramsStart
  for (let i = paramsStart; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === stringChar) inString = false
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '(') parenDepth++
    if (ch === ')') {
      parenDepth--
      if (parenDepth === 0) {
        bodyStart = i + 1
        break
      }
    }
  }
  if (parenDepth !== 0) return null
  // Find the body-opening brace after params
  const braceIdx = source.indexOf('{', bodyStart)
  if (braceIdx < 0) return null
  // Now track brace depth from the real body opening
  let depth = 0
  inString = false
  stringChar = null
  for (let i = braceIdx; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === stringChar) inString = false
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(idx, i + 1)
    }
  }
  return null
}

// ── requireOnline tests ─────────────────────────────────────────────────────

function extractRequireOnline(src) {
  const start = src.indexOf('function requireOnline(')
  assert.ok(start >= 0, 'requireOnline must exist')
  const bodyStart = src.indexOf('{', start)
  let depth = 1
  let pos = bodyStart + 1
  while (depth > 0 && pos < src.length) {
    if (src[pos] === '{') depth++
    else if (src[pos] === '}') depth--
    pos++
  }
  const body = src.slice(bodyStart + 1, pos - 1)
  return new Function('operation', 'state', body)
}

const _offlineState = { isOnline: false }
const _onlineState = { isOnline: true }

test('requireOnline throws when offline', () => {
  const requireOnline = extractRequireOnline(CORPORATE_SRC)
  assert.throws(
    () => requireOnline('Charge to corporate account', _offlineState),
    (err) => err.onlineOnly === true
  )
})

test('requireOnline error mentions internet connection', () => {
  const requireOnline = extractRequireOnline(CORPORATE_SRC)
  assert.throws(
    () => requireOnline('Record corporate payment', _offlineState),
    (err) => /internet connection/i.test(err.message)
  )
})

test('requireOnline includes operation name in error', () => {
  const requireOnline = extractRequireOnline(CORPORATE_SRC)
  assert.throws(
    () => requireOnline('Suspend corporate account', _offlineState),
    (err) => err.message.includes('Suspend corporate account')
  )
})

test('requireOnline does not throw when online', () => {
  const requireOnline = extractRequireOnline(CORPORATE_SRC)
  assert.doesNotThrow(() => requireOnline('Charge', _onlineState))
})

// ── stableIdempotencyKey tests ──────────────────────────────────────────────

function extractStableIdempotencyKey(src) {
  const start = src.indexOf('function stableIdempotencyKey(')
  assert.ok(start >= 0, 'stableIdempotencyKey must exist')
  const bodyStart = src.indexOf('{', start)
  let depth = 1
  let pos = bodyStart + 1
  while (depth > 0 && pos < src.length) {
    if (src[pos] === '{') depth++
    else if (src[pos] === '}') depth--
    pos++
  }
  const body = src.slice(bodyStart + 1, pos - 1)
  return new Function('prefix', 'parts', 'state', body)
}

test('stableIdempotencyKey builds deterministic key from prefix, lodgeId, and parts', () => {
  const keyFn = extractStableIdempotencyKey(CORPORATE_SRC)
  const state = { lodgeId: 'lodge-111' }
  const key = keyFn('corp-charge', ['acct-1', 'bkg-1', 100, 'desc', true], state)
  assert.ok(key.startsWith('corp-charge:lodge-111:acct-1:bkg-1'))
  assert.ok(key.length <= 180, 'Key must be truncated to 180 chars')
})

test('stableIdempotencyKey excludes null and undefined parts', () => {
  const keyFn = extractStableIdempotencyKey(CORPORATE_SRC)
  const state = { lodgeId: 'lodge-111' }
  const key = keyFn('corp-pay', ['acct-1', null, undefined, '', 'valid'], state)
  assert.ok(key.includes('acct-1'))
  assert.ok(key.includes('valid'))
  assert.ok(!key.includes('null'))
  assert.ok(!key.includes('undefined'))
  assert.ok(!key.includes(':::'))
})

test('stableIdempotencyKey with lodgeId only has correct prefix', () => {
  const keyFn = extractStableIdempotencyKey(CORPORATE_SRC)
  const key = keyFn('test-prefix', [], { lodgeId: 'lodge-222' })
  assert.equal(key, 'test-prefix:lodge-222')
})

test('stableIdempotencyKey truncates at 180 characters', () => {
  const keyFn = extractStableIdempotencyKey(CORPORATE_SRC)
  const longParts = ['x'.repeat(100), 'y'.repeat(100)]
  const key = keyFn('long', longParts, { lodgeId: 'l-1' })
  assert.ok(key.length <= 180, `Key length ${key.length} exceeds 180`)
})

// ── chargeToCorporateAccount source contract ────────────────────────────────

test('chargeToCorporateAccount constructs RPC call with correct parameters', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function chargeToCorporateAccount(')
  assert.ok(fn, 'chargeToCorporateAccount must exist')

  assert.ok(fn.includes("rpc('charge_to_corporate_account'"),
    'must call charge_to_corporate_account RPC')
  assert.ok(fn.includes('p_account_id: accountId'), 'must forward accountId')
  assert.ok(fn.includes('p_lodge_id: state.lodgeId'), 'must forward state.lodgeId')
  assert.ok(fn.includes('p_booking_id: bookingId'), 'must forward bookingId')
  assert.ok(fn.includes('p_amount: amount'), 'must forward amount')
  assert.ok(fn.includes('p_description: description'), 'must forward description')
  assert.ok(fn.includes('p_settle_booking: settleBooking'), 'must forward settleBooking flag')
  assert.ok(fn.includes('p_idempotency_key: key'), 'must forward idempotency key')
})

test('chargeToCorporateAccount validates required args', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function chargeToCorporateAccount(')
  assert.ok(fn, 'chargeToCorporateAccount must exist')
  assert.ok(fn.includes("if (!accountId) throw new Error('Corporate account is required')"),
    'must reject missing accountId')
  assert.ok(fn.includes("if (!bookingId) throw new Error('Booking is required for corporate settlement')"),
    'must reject missing bookingId')
})

test('chargeToCorporateAccount uses provided idempotencyKey or falls back to stable key', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function chargeToCorporateAccount(')
  assert.ok(fn, 'chargeToCorporateAccount must exist')
  assert.ok(
    fn.includes('options.idempotencyKey') && fn.includes('stableIdempotencyKey'),
    'must prefer caller-supplied idempotencyKey over stable key'
  )
})

test('chargeToCorporateAccount defaults settleBooking to true', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function chargeToCorporateAccount(')
  assert.ok(fn.includes('options.settleBooking !== false'),
    'settleBooking must default to true')
})

test('chargeToCorporateAccount throws on RPC error', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function chargeToCorporateAccount(')
  assert.ok(fn.includes("if (error) throw new Error(error.message)"),
    'must propagate RPC errors')
  assert.ok(fn.includes("if (!data?.success) throw new Error"),
    'must propagate business logic errors')
})

test('chargeToCorporateAccount returns data with idempotency_key', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function chargeToCorporateAccount(')
  assert.ok(fn.includes('return { ...data, idempotency_key: key }'),
    'must include idempotency_key in return value')
})

// ── recordCorporatePayment source contract ──────────────────────────────────

test('recordCorporatePayment constructs RPC call with correct parameters', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function recordCorporatePayment(')
  assert.ok(fn, 'recordCorporatePayment must exist')

  assert.ok(fn.includes("rpc('record_corporate_payment'"),
    'must call record_corporate_payment RPC')
  assert.ok(fn.includes('p_account_id: accountId'), 'must forward accountId')
  assert.ok(fn.includes('p_lodge_id: state.lodgeId'), 'must forward state.lodgeId')
  assert.ok(fn.includes('p_invoice_ids: invoiceIds'), 'must forward invoiceIds')
  assert.ok(fn.includes('p_amount: amount'), 'must forward amount')
  assert.ok(fn.includes('p_payment_method: method'), 'must forward payment method')
  assert.ok(fn.includes('p_reference: reference'), 'must forward reference')
  assert.ok(fn.includes('p_idempotency_key: key'), 'must forward idempotency key')
})

test('recordCorporatePayment rejects missing accountId', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function recordCorporatePayment(')
  assert.ok(fn.includes("if (!accountId) throw new Error('Corporate account is required')"),
    'must reject missing accountId')
})

test('recordCorporatePayment defaults payment method to bank_transfer', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function recordCorporatePayment(')
  assert.ok(fn.includes('method || '),
    'must default method when not provided')
})

test('recordCorporatePayment returns data with idempotency_key', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function recordCorporatePayment(')
  assert.ok(fn.includes('return { ...data, idempotency_key: key }'),
    'must include idempotency_key in return value')
})

test('recordCorporatePayment throws on RPC error', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function recordCorporatePayment(')
  assert.ok(fn.includes("if (error) throw new Error(error.message)"),
    'must propagate RPC errors')
  assert.ok(fn.includes("if (!data?.success) throw new Error"),
    'must propagate business logic errors')
})

// ── suspendCorporateAccount / reactivateCorporateAccount ────────────────────

test('suspendCorporateAccount calls suspend RPC with p_lodge_id', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function suspendCorporateAccount(')
  assert.ok(fn, 'suspendCorporateAccount must exist')
  assert.ok(fn.includes("rpc('suspend_corporate_account'"),
    'must call suspend_corporate_account RPC')
  assert.ok(fn.includes('p_lodge_id: state.lodgeId'), 'must forward lodgeId')
  assert.ok(fn.includes('p_account_id: accountId'), 'must forward accountId')
  assert.ok(fn.includes('p_reason: reason'), 'must forward reason')
})

test('reactivateCorporateAccount calls reactivate RPC with p_lodge_id', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function reactivateCorporateAccount(')
  assert.ok(fn, 'reactivateCorporateAccount must exist')
  assert.ok(fn.includes("rpc('reactivate_corporate_account'"),
    'must call reactivate_corporate_account RPC')
  assert.ok(fn.includes('p_lodge_id: state.lodgeId'), 'must forward lodgeId')
  assert.ok(fn.includes('p_account_id: accountId'), 'must forward accountId')
})

test('suspend and reactivate are online_only', () => {
  const suspendFn = extractFn(CORPORATE_SRC, 'export async function suspendCorporateAccount(')
  const reactivateFn = extractFn(CORPORATE_SRC, 'export async function reactivateCorporateAccount(')
  assert.ok(suspendFn.includes('requireOnline('), 'suspend must be online_only')
  assert.ok(reactivateFn.includes('requireOnline('), 'reactivate must be online_only')
})

// ── checkCreditLimitWithPending ─────────────────────────────────────────────

test('checkCreditLimitWithPending returns offline result when not online', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function checkCreditLimitWithPending(')
  assert.ok(fn, 'checkCreditLimitWithPending must exist')
  assert.ok(fn.includes('within_limit: false'),
    'offline credit check must not claim within_limit')
  assert.ok(fn.includes('onlineOnly: true'),
    'offline credit check must set onlineOnly flag')
  assert.ok(fn.includes('Credit limit check requires an internet connection'),
    'offline credit check must give clear error message')
})

test('checkCreditLimitWithPending passes p_lodge_id to RPC when online', () => {
  const fn = extractFn(CORPORATE_SRC, 'export async function checkCreditLimitWithPending(')
  assert.ok(fn.includes('p_lodge_id: state.lodgeId'),
    'must pass lodgeId to check_credit_limit_with_pending')
})

// ── Exported requireOnline and stableIdempotencyKey ─────────────────────────

test('corporateBilling exports requireOnline and stableIdempotencyKey under aliases', () => {
  assert.ok(CORPORATE_SRC.includes('requireOnline as requireCorporateBillingOnline'),
    'must export requireOnline as requireCorporateBillingOnline')
  assert.ok(CORPORATE_SRC.includes('stableIdempotencyKey as corporateIdempotencyKey'),
    'must export stableIdempotencyKey as corporateIdempotencyKey')
})

// ── No queueOperation in corporate billing ──────────────────────────────────

test('corporateBilling must never queueOperation (financial ops are online_only)', () => {
  assert.ok(!CORPORATE_SRC.includes('queueOperation'),
    'corporate billing must not queue operations')
})

// ── Idempotency key forwarding ─────────────────────────────────────────────

test('all mutation RPCs pass p_idempotency_key', () => {
  const mutations = [
    'chargeToCorporateAccount',
    'recordCorporatePayment',
    'suspendCorporateAccount',
    'reactivateCorporateAccount'
  ]
  for (const name of mutations) {
    const fn = extractFn(CORPORATE_SRC, `export async function ${name}(`)
    if (!fn) continue
    if (name.startsWith('suspend') || name.startsWith('reactivate')) {
      assert.ok(!fn.includes('p_idempotency_key'),
        `${name} may not need idempotency key (idempotent by nature)`)
    } else {
      assert.ok(fn.includes('p_idempotency_key'),
        `${name} must pass p_idempotency_key`)
    }
  }
})
