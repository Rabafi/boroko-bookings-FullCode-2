import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASKET_DRAFT_TTL_MS,
  QUICK_CASH_AMOUNTS,
  basketScopeKey,
  computeCashTender,
  isDraftFresh,
  revalidateBasketLines,
  roundCash,
} from '../src/shared/tillBasketRecovery.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const receipt = () => read('src/renderer/src/components/shared/POSReceipt.jsx')

test('cash tendering never alters the sale allocation', () => {
  assert.deepEqual(computeCashTender('', 120), { ok: true, cashTender: null })
  assert.deepEqual(computeCashTender('   ', 120), { ok: true, cashTender: null })
  // P120 sale paid with P200: allocation stays P120, change is P80.
  assert.deepEqual(computeCashTender('200', 120), {
    ok: true,
    cashTender: { cash_received: 200, change_due: 80 },
  })
  assert.deepEqual(computeCashTender('120', 120), {
    ok: true,
    cashTender: { cash_received: 120, change_due: 0 },
  })
  // Rounding to minor units, half up.
  assert.equal(computeCashTender('200.005', 120).cashTender.cash_received, 200.01)
  // Insufficient cash is rejected with the figures for the caller to render.
  const short = computeCashTender('100', 120)
  assert.equal(short.ok, false)
  assert.equal(short.received, 100)
  assert.equal(short.due, 120)
  // Invalid input is rejected, never coerced.
  assert.equal(computeCashTender('abc', 120).ok, false)
  assert.equal(computeCashTender('-5', 120).ok, false)
  // Excess cash is change, never revenue or tip: allocation untouched.
  const over = computeCashTender('500', 120)
  assert.equal(over.cashTender.change_due, 380)
  assert.deepEqual(Object.keys(over.cashTender).sort(), ['cash_received', 'change_due'])
})

test('quick-cash defaults and rounding helpers are stable', () => {
  assert.deepEqual([...QUICK_CASH_AMOUNTS], [20, 50, 100, 200])
  assert.equal(roundCash(10.005), 10.01)
  assert.equal(roundCash(10.004), 10)
  assert.equal(basketScopeKey('lodge', 'outlet', 'op', 'shift'), 'lodge:outlet:op:shift')
  assert.notEqual(
    basketScopeKey('lodge', 'outlet', 'op', 'shift-a'),
    basketScopeKey('lodge', 'outlet', 'op', 'shift-b'),
    'different shifts must never share a draft key',
  )
  assert.equal(BASKET_DRAFT_TTL_MS, 24 * 60 * 60 * 1000)
})

test('F8: cash rounding is decimal-safe at half-unit edges', async () => {
  const { roundCash: round } = await import('../src/shared/tillBasketRecovery.js')
  assert.equal(round('1.005'), 1.01)
  assert.equal(round('2.675'), 2.68)
  assert.equal(round('0.125'), 0.13)
  assert.equal(round('10.004'), 10)
  assert.equal(round('10.005'), 10.01)
  assert.equal(round('0'), 0)
  assert.equal(round('200'), 200)
  assert.ok(Number.isNaN(round('abc')))
  assert.ok(Number.isNaN(round('')))
  // Split tenders never consume received/change: only exact-cash uses them.
  const source = terminal()
  assert.match(source, /!retryingSubmit && !chargeToAccount && paymentMethod === "cash"/)
})

test('draft freshness and catalogue revalidation protect restoration', () => {
  const now = 1_000_000_000
  assert.equal(isDraftFresh(null, now), false)
  assert.equal(isDraftFresh({ lines: [] }, now), false)
  assert.equal(isDraftFresh({ lines: [{ id: 1 }], savedAt: now }, now), true)
  assert.equal(isDraftFresh({ lines: [{ id: 1 }], savedAt: now - BASKET_DRAFT_TTL_MS - 1 }, now), false)
  const menu = [
    { id: 'm1', name: 'Heineken 330ml', price: 30, category: 'Beer' },
    { id: 'm2', name: 'Gone', price: 10, archived_at: '2026-01-01' },
    { id: 'm3', name: 'Sold out', price: 10, is_available: false },
  ]
  const result = revalidateBasketLines(
    [
      { id: 'l1', menu_item_id: 'm1', item_name: 'Old name', unit_price: 25, quantity: 2 },
      { id: 'l2', menu_item_id: 'm2', item_name: 'Gone', unit_price: 10, quantity: 1 },
      { id: 'l3', menu_item_id: 'm3', item_name: 'Sold out', unit_price: 10, quantity: 1 },
      { id: 'l4', menu_item_id: 'missing', item_name: 'Missing', unit_price: 5, quantity: 1 },
    ],
    menu,
  )
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].item_name, 'Heineken 330ml')
  assert.equal(result.lines[0].unit_price, 30)
  assert.equal(result.dropped, 3)
  assert.equal(result.repriced, 1)
})

test('Till wires draft precedence, hold intents, and receipt aids', () => {
  const source = terminal()
  // Payment recovery wins over drafts; resumed tabs win over everything.
  assert.match(source, /payment recovery always wins over/)
  assert.match(source, /if \(location\.state\?\.tabId\) \{/)
  assert.match(source, /recoveredAttempt \|\| submitEnvelopeRef\.current\?\.status === "pending"/)
  // Hold intent persisted before dispatch, reconciled by tab identity.
  assert.match(source, /Durable hold intent BEFORE dispatch/)
  assert.match(source, /holdIntentKey\(/)
  assert.match(source, /reconcileHoldIntent\(intent, openTabsBrief\)/)
  // Cash validation delegates to the shared helper; allocation untouched.
  assert.match(source, /computeCashTender\(cashReceived, tenderBreakdownResult\.total\)/)
  assert.match(source, /cashTender: cashTenderMeta,/)
  // Last receipt is per-outlet, this terminal only.
  assert.match(source, /lastReceiptKey\(/)
  assert.match(source, /Reprint last receipt/)
  assert.match(source, /Restore basket/)
})

test('receipt renders tendering aids only when recorded', () => {
  const source = receipt()
  assert.match(source, /order\?\.cash_received != null/)
  assert.match(source, /order\?\.change_due != null/)
  assert.match(source, /are never[\s\S]{0,30}back-filled/)
})

test('definitive replay refusals never block the Till; ambiguous ones still recover', () => {
  const infra = read('src/main/domains/infrastructure.js')
  // Only truly uncertain outcomes reopen the journal to pending.
  assert.match(infra, /isAmbiguousPosOrderReplayError/)
  assert.match(infra, /fetch failed\|network\|timeout/i)
  assert.match(infra, /reopenPosSubmitAttempt\(deadIntentId, errorMessage\)/)
  // Definitive refusals (e.g. Insufficient stock) clear the journal so the
  // Till stays sellable; the failed row + dead-letter remain for review.
  assert.match(infra, /clearPosSubmitAttempt\(deadIntentId\)/)
  assert.match(infra, /definitive/i)
  const journal = read('src/main/domains/posSubmitJournal.js')
  assert.match(journal, /countPendingPosSubmitAttempts/)
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /pendingCount: countPendingSubmitAttemptRecords/)
})

test('recovery banner persists collapse, shows stacked count, and offers re-check', () => {
  const source = terminal()
  assert.match(source, /hpos-recovery-collapsed:/)
  assert.match(source, /toggleRecoveryCollapsed/)
  assert.match(source, /pendingCount/)
  assert.match(source, /Re-check Sales/)
  assert.match(source, /recheckRecovery/)
  // Single-attempt copy is unchanged so existing guidance still matches.
  assert.match(source, /Earlier sale needs checking — tap for details\./)
})
