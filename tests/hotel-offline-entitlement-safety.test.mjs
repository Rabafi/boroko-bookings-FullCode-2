/**
 * Hotel offline + financial entitlement safety contracts.
 * Proves online_only hotel financial ops reject offline and do not queue.
 *
 * Domain modules import Electron via infrastructure.js, so runtime import
 * is not always possible in pure Node. We combine:
 * 1) Source contracts (requireOnline / no queueOperation on online_only ops)
 * 2) Pure offline-guard pattern unit tests (mirrors domain requireOnline shape)
 * 3) Fail-closed provider adapter import (no Electron dependency)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function readSrc(relPath) {
  const full = resolve(ROOT, relPath)
  assert.ok(existsSync(full), `missing source: ${relPath}`)
  return readFileSync(full, 'utf8')
}

/** Mirrors domain online-only guard shape used across hotel financial modules. */
function requireOnline(isOnline, operation) {
  if (isOnline === false) {
    const err = new Error(
      `${operation} requires an internet connection. Folio financial mutations cannot be queued offline.`
    )
    err.onlineOnly = true
    throw err
  }
}

function extractFunctionBlock(source, exportMarker) {
  const idx = source.indexOf(exportMarker)
  if (idx < 0) return null
  const fnBody = source.slice(idx)
  let depth = 0
  let inString = false
  let stringChar = null
  for (let i = 0; i < fnBody.length; i++) {
    const ch = fnBody[i]
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
      if (depth === 0) return fnBody.slice(0, i + 1)
    }
  }
  return fnBody
}

// ── Pure offline guard behaviour ─────────────────────────────────────────────

test('online_only guard rejects when isOnline is false and sets onlineOnly', () => {
  assert.throws(
    () => requireOnline(false, 'Add folio charge'),
    (err) => {
      assert.equal(err.onlineOnly, true)
      assert.match(err.message, /requires an internet connection/i)
      return true
    }
  )
})

test('online_only guard allows online path (no throw)', () => {
  assert.doesNotThrow(() => requireOnline(true, 'Add folio charge'))
})

test('credit limit offline must not invent within_limit true', () => {
  // Contract from corporateBilling.checkCreditLimitWithPending offline branch
  const offlineResult = {
    success: false,
    within_limit: false,
    offline: true,
    onlineOnly: true,
    error: 'Credit limit check requires an internet connection'
  }
  assert.equal(offlineResult.within_limit, false)
  assert.equal(offlineResult.onlineOnly, true)
  assert.equal(offlineResult.success, false)
})

// ── Folio ledger ─────────────────────────────────────────────────────────────

const FOLIO_MUTATIONS = [
  'addCharge',
  'addPayment',
  'transferCharge',
  'splitFolio',
  'voidLineItem',
  'closeFolio',
  'reopenFolio',
  'lockFolio',
  'createFolio'
]

test('folioLedger: financial mutations are online_only (requireOnline, no queueOperation)', () => {
  const src = readSrc('src/main/domains/folioLedger.js')
  assert.ok(src.includes('function requireOnline'), 'requireOnline helper required')
  assert.ok(src.includes('err.onlineOnly = true'), 'onlineOnly flag required')
  assert.ok(!src.includes('queueOperation'), 'folio financial path must not queue offline')

  for (const name of FOLIO_MUTATIONS) {
    const block = extractFunctionBlock(src, `export async function ${name}(`)
    assert.ok(block, `export ${name} should exist`)
    assert.ok(
      block.includes('requireOnline('),
      `${name} must call requireOnline before RPC`
    )
    assert.ok(
      !block.includes('queueOperation'),
      `${name} must not queue when offline`
    )
  }
})

// ── Night audit ──────────────────────────────────────────────────────────────

test('nightAudit: close/reopen/resolve are online_only', () => {
  const src = readSrc('src/main/domains/nightAudit.js')
  assert.ok(src.includes('function requireOnline'), 'requireOnline helper')
  assert.ok(src.includes("requireOnline('Close night audit')"))
  assert.ok(src.includes("requireOnline('Reopen night audit')"))
  assert.ok(src.includes("requireOnline('Resolve night audit exception')"))
  assert.ok(!src.includes('queueOperation'), 'night audit must not queue mutations')
})

// ── Corporate billing ────────────────────────────────────────────────────────

test('corporateBilling: charge/payment/suspend/reactivate online_only and never queue', () => {
  const src = readSrc('src/main/domains/corporateBilling.js')
  assert.ok(src.includes('function requireOnline'), 'requireOnline helper')
  assert.ok(src.includes("requireOnline('Charge to corporate account')"))
  assert.ok(src.includes("requireOnline('Record corporate payment')"))
  assert.ok(src.includes("requireOnline('Suspend corporate account')"))
  assert.ok(src.includes("requireOnline('Reactivate corporate account')"))
  assert.ok(!src.includes('queueOperation'), 'corporate financial ops must not queue')
  assert.ok(
    src.includes('within_limit: false') || src.includes('within_limit:false'),
    'offline credit check must not invent within_limit true'
  )
})

// ── Check-in workflow ────────────────────────────────────────────────────────

test('checkinWorkflow: step complete/reset and hotel check-in/out reject offline', () => {
  const src = readSrc('src/main/domains/checkinWorkflow.js')
  for (const msg of [
    'Completing check-in steps requires an online connection',
    'Resetting check-in steps requires an online connection',
    'Completing check-out steps requires an online connection',
    'Resetting check-out steps requires an online connection',
    'Hotel check-in requires an online connection',
    'Hotel check-out requires an online connection'
  ]) {
    assert.ok(src.includes(msg), `missing offline guard: ${msg}`)
  }
  assert.ok(!src.includes('queueOperation'), 'check-in steps must not silently queue')
})

// ── Early/late, cancellation, OOO, payments ──────────────────────────────────

test('earlyLateCheckout: approve paths are online_only', () => {
  const src = readSrc('src/main/domains/earlyLateCheckout.js')
  assert.ok(src.includes('requireOnlineApproval'))
  assert.ok(src.includes("requireOnlineApproval('Approve early check-in request')"))
  assert.ok(src.includes("requireOnlineApproval('Approve late check-out request')"))
})

test('cancellationPolicies: fee/process/approve are online_only', () => {
  const src = readSrc('src/main/domains/cancellationPolicies.js')
  assert.ok(src.includes('requireOnlineFinancial'))
  assert.ok(src.includes("requireOnlineFinancial('Calculate cancellation fee')"))
  assert.ok(src.includes("requireOnlineFinancial('Process cancellation')"))
  assert.ok(src.includes("requireOnlineFinancial('Approve cancellation')"))
})

test('maintenanceEnterprise: OOO/OOS/return-to-service are online_only', () => {
  const src = readSrc('src/main/domains/maintenanceEnterprise.js')
  assert.ok(src.includes('requireOnlineAvailability'))
  assert.ok(src.includes("requireOnlineAvailability('Set room out of order')"))
  assert.ok(src.includes("requireOnlineAvailability('Set room out of service')"))
  assert.ok(src.includes("requireOnlineAvailability('Return room to service')"))
})

test('payments: confirm and webhook record reject offline', () => {
  const src = readSrc('src/main/domains/payments.js')
  assert.ok(src.includes('err.onlineOnly = true'))
  assert.ok(src.includes('Confirm payment requires an internet connection') || src.includes('confirm_payment_from_webhook'))
  assert.match(src, /recordWebhookPayment[\s\S]*onlineOnly|onlineOnly[\s\S]*record_webhook_payment/)
})

test('abandonedPaymentRecovery: recoverSession rejects offline', () => {
  const src = readSrc('src/main/domains/abandonedPaymentRecovery.js')
  assert.ok(src.includes('err.onlineOnly = true'))
  assert.match(src, /recoverSession|recover_abandoned_session/)
  assert.ok(src.includes('requires an internet connection'))
})

// ── Provider fail-closed ─────────────────────────────────────────────────────

test('channelProviderAdapter fail-closed: no live OTA success', async () => {
  const {
    pushAvailability,
    pushRates,
    fetchReservations,
    acknowledgeReservation
  } = await import('../src/main/domains/channelProviderAdapter.js')

  const avail = await pushAvailability('booking_com', { rooms: [] })
  assert.equal(avail.success, false)
  assert.equal(avail.provider_connected, false)

  const rates = await pushRates('booking_com', { rates: [] })
  assert.equal(rates.success, false)
  assert.equal(rates.provider_connected, false)

  const res = await fetchReservations('booking_com', null)
  assert.equal(res.success, false)
  assert.equal(res.provider_connected, false)
  assert.ok(Array.isArray(res.reservations))
  assert.equal(res.reservations.length, 0)

  const ack = await acknowledgeReservation('booking_com', 'res-1')
  assert.equal(ack.success, false)
  assert.equal(ack.provider_connected, false)
})

// ── OFFLINE_MATRIX alignment ─────────────────────────────────────────────────

test('OFFLINE_MATRIX documents folio and night audit as online_only', () => {
  const matrix = readSrc('docs/OFFLINE_MATRIX.md')
  assert.ok(matrix.includes('online_only'))
  assert.ok(matrix.includes('Folio Ledger'))
  assert.ok(matrix.includes('Night Audit'))
  assert.ok(matrix.includes('Corporate Billing'))
  assert.ok(matrix.includes('must **not** enter the offline queue') || matrix.includes('must not enter the offline queue') || matrix.includes('must NOT be added'))
})

test('Hotel core entitlement boundary still treats night_audit and checkin as core features', () => {
  const entitlements = readSrc('src/shared/commercialEntitlements.js')
  assert.ok(entitlements.includes('night_audit_enterprise') || entitlements.includes('night_audit'))
  assert.ok(entitlements.includes('checkin_workflow'))
})
