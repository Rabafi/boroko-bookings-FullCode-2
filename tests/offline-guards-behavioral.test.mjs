/**
 * Behavioral tests for offline guards in financial domain modules.
 * Extracts the actual requireOnline implementation from source and proves
 * the error contract (onlineOnly property, message pattern) at runtime.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const folioLedgerSrc = readFileSync(resolve(ROOT, 'src/main/domains/folioLedger.js'), 'utf8')
const corporateSrc = readFileSync(resolve(ROOT, 'src/main/domains/corporateBilling.js'), 'utf8')
const foliosUi = readFileSync(resolve(ROOT, 'src/renderer/src/components/Folios.jsx'), 'utf8')
const corporateUi = readFileSync(resolve(ROOT, 'src/renderer/src/components/CorporateBilling.jsx'), 'utf8')

/**
 * Build the exact requireOnline function from the domain source.
 * Each domain module defines its own requireOnline with the same contract.
 */
function extractRequireOnline(src) {
  const start = src.indexOf('function requireOnline(')
  if (start < 0) throw new Error('requireOnline not found')
  const bodyStart = src.indexOf('{', start)
  if (bodyStart < 0) throw new Error('body start not found')
  let depth = 1
  let pos = bodyStart + 1
  while (depth > 0 && pos < src.length) {
    if (src[pos] === '{') depth++
    else if (src[pos] === '}') depth--
    pos++
  }
  const body = src.slice(bodyStart + 1, pos - 1)
  // state is a module-level binding; provide it via synthetic scope
  return new Function('operation', 'state', body)
}

// ── Folio requireOnline behavioral tests ──────────────────────────────────

const _offlineState = { isOnline: false }
const _onlineState = { isOnline: true }

test('folio requireOnline throws with onlineOnly=true when offline', () => {
  const requireOnline = extractRequireOnline(folioLedgerSrc)
  assert.throws(
    () => requireOnline('Add folio charge', _offlineState),
    (err) => err.onlineOnly === true
  )
})

test('folio requireOnline error message mentions internet connection', () => {
  const requireOnline = extractRequireOnline(folioLedgerSrc)
  assert.throws(
    () => requireOnline('Add folio charge', _offlineState),
    (err) => /internet connection/i.test(err.message)
  )
})

test('folio requireOnline error message includes the operation name', () => {
  const requireOnline = extractRequireOnline(folioLedgerSrc)
  assert.throws(
    () => requireOnline('Close folio', _offlineState),
    (err) => err.message.includes('Close folio')
  )
})

test('folio requireOnline does not throw when online', () => {
  const requireOnline = extractRequireOnline(folioLedgerSrc)
  assert.doesNotThrow(() => requireOnline('Add folio charge', _onlineState))
})

// ── Corporate requireOnline behavioral tests ──────────────────────────────

test('corporate requireOnline throws with onlineOnly=true when offline', () => {
  const requireOnline = extractRequireOnline(corporateSrc)
  assert.throws(
    () => requireOnline('Charge to corporate account', _offlineState),
    (err) => err.onlineOnly === true
  )
})

test('corporate requireOnline error message includes internet connection', () => {
  const requireOnline = extractRequireOnline(corporateSrc)
  assert.throws(
    () => requireOnline('Record corporate payment', _offlineState),
    (err) => /internet connection/i.test(err.message)
  )
})

// ── Source-invariant: every mutator calls requireOnline ────────────────────

const FOLIO_MUTATORS = [
  'createFolio', 'addCharge', 'addPayment',
  'transferCharge', 'splitFolio', 'voidLineItem',
  'closeFolio', 'reopenFolio', 'lockFolio'
]

for (const name of FOLIO_MUTATORS) {
  test(`folio ${name} source calls requireOnline`, () => {
    const idx = folioLedgerSrc.indexOf(`export async function ${name}(`)
    assert.ok(idx >= 0, `${name} must exist in source`)
    const body = folioLedgerSrc.slice(idx, idx + 1000)
    assert.ok(body.includes('requireOnline('), `${name} must call requireOnline`)
  })
}

const CORPORATE_MUTATORS = [
  'chargeToCorporateAccount', 'recordCorporatePayment',
  'suspendCorporateAccount', 'reactivateCorporateAccount'
]

for (const name of CORPORATE_MUTATORS) {
  test(`corporate ${name} source calls requireOnline`, () => {
    const idx = corporateSrc.indexOf(`export async function ${name}(`)
    assert.ok(idx >= 0, `${name} must exist in source`)
    const body = corporateSrc.slice(idx, idx + 1000)
    assert.ok(body.includes('requireOnline('), `${name} must call requireOnline`)
  })
}

// ── Source-invariant: no mutator uses queueOperation ──────────────────────

test('folio source never calls queueOperation', () => {
  assert.ok(!folioLedgerSrc.includes('queueOperation('), 'folio must not queue offline')
})

test('corporate source never calls queueOperation', () => {
  assert.ok(!corporateSrc.includes('queueOperation('), 'corporate must not queue offline')
})

// ── Renderer: every mutation generates crypto.randomUUID() ─────────────────

const FOLIO_MUTATOR_CALLS = [
  'folioLedger.splitFolio(',
  'folioLedger.transferCharge(',
  'folioLedger.addCharge(',
  'folioLedger.addPayment(',
  'folioLedger.closeFolio(',
  'folioLedger.reopenFolio(',
  'folioLedger.lockFolio(',
  'folioLedger.voidLineItem(',
]

test('Folios.jsx generates crypto.randomUUID() before each mutation', () => {
  const uuidCount = (foliosUi.match(/crypto\.randomUUID\(\)/g) || []).length
  assert.ok(uuidCount >= 6, `expected >=6 crypto.randomUUID() calls in Folios.jsx, got ${uuidCount}`)
})

for (const call of FOLIO_MUTATOR_CALLS) {
  test(`Folios.jsx calls ${call.replace('(', '')} with intentId`, () => {
    const idx = foliosUi.indexOf(call)
    assert.ok(idx >= 0, `${call} must exist in UI`)
    // Each mutator call should be preceded by crypto.randomUUID()
    const before = foliosUi.slice(Math.max(0, idx - 400), idx)
    assert.ok(before.includes('crypto.randomUUID()'), `${call} must be preceded by crypto.randomUUID()`)
  })
}

const CORPORATE_MUTATOR_CALLS = [
  'corporateBilling.charge(',
  'corporateBilling.recordPayment(',
]

for (const call of CORPORATE_MUTATOR_CALLS) {
  test(`CorporateBilling.jsx calls ${call.replace('(', '')} with intentId`, () => {
    const idx = corporateUi.indexOf(call)
    assert.ok(idx >= 0, `${call} must exist in UI`)
    const before = corporateUi.slice(Math.max(0, idx - 200), idx)
    assert.ok(before.includes('crypto.randomUUID()'), `${call} must be preceded by crypto.randomUUID()`)
  })
}

// ── Lodge offline honesty: silent loss / silent zeros must fail visibly ────

const roomAttributesSrc = readFileSync(resolve(ROOT, 'src/main/domains/roomAttributes.js'), 'utf8')
const dayUseConfigSrc = readFileSync(resolve(ROOT, 'src/main/domains/dayUseConfig.js'), 'utf8')
const reportsSrc = readFileSync(resolve(ROOT, 'src/main/domains/reports.js'), 'utf8')
const reportsUi = readFileSync(resolve(ROOT, 'src/renderer/src/components/Reports.jsx'), 'utf8')

test('roomAttributes never queues fake types that no replay branch handles', () => {
  assert.ok(!roomAttributesSrc.includes("queueOperation('roomAttributes:"), 'fake queue types silently deleted as success')
  assert.ok(!roomAttributesSrc.includes('queueOperation('), 'config RPCs carry no idempotency key; fail closed instead')
})

// Main-process domains import electron transitively, so plain-node runtime
// imports fail here; pin the fail-closed contracts statically instead.
test('roomAttributes fail closed offline with reconnect guidance', () => {
  for (const fn of ['_create', '_update', '_remove']) {
    const start = roomAttributesSrc.indexOf(`async function ${fn}(`)
    assert.ok(start >= 0, `${fn} must exist`)
    const body = roomAttributesSrc.slice(start, roomAttributesSrc.indexOf('\n}\n', start))
    assert.ok(body.includes('!state.isOnline'), `${fn} must gate on offline`)
    assert.ok(/throw new Error\('Room attributes need an internet connection/i.test(body), `${fn} must throw reconnect guidance`)
  }
})

test('dayUseConfig offline save reports device-only persistence', () => {
  assert.ok(dayUseConfigSrc.includes("persistence: 'device_only'"), 'offline save must report device-only persistence')
  assert.ok(dayUseConfigSrc.includes('retryRequired'), 'operator must get a recovery step')
  assert.ok(dayUseConfigSrc.includes('includeMeta'), 'meta envelope must be opt-in so cache rows stay clean')
  const mainIndex = readFileSync(resolve(ROOT, 'src/main/index.js'), 'utf8')
  assert.ok(mainIndex.includes("db.saveDayUseConfig(data, { includeMeta: true })"), 'IPC must request the meta envelope')
})

test('reports snapshot withholds revenue when the payments source is missing', () => {
  assert.ok(reportsSrc.includes('paymentsAvailable'), 'snapshot must gate revenue on source presence')
  assert.ok(reportsSrc.includes('monthRev: paymentsAvailable ?'), 'missing source must not report confirmed zero')
  assert.ok(reportsSrc.includes('revenueUnavailable: !paymentsAvailable'), 'missing source must be flagged')
})

test('Reports.jsx renders withheld revenue as Unavailable, never 0', () => {
  assert.ok(reportsUi.includes("value={summaryNetCash == null ? 'Unavailable'"), 'cash card must show Unavailable')
  assert.ok(reportsUi.includes('snapshotRevenueMissing'), 'null snapshot revenue must stay unavailable')
})
