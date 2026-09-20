import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAuthorizeShiftId } from '../src/shared/tillAuthorizeShift.js'
import { createTillOperatorSessionStore } from '../src/main/domains/tillOperatorSession.js'
import { state } from '../src/main/state.js'
import {
  resolvePosSubmitAttempt,
  hasPosSubmitAttempt,
  getPosSubmitAttempt
} from '../src/main/domains/posSubmitJournal.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const STALE = '5d1897d1-98f6-451e-a464-fed0a5e65854'
const CURRENT = '08d98088-0000-4000-a000-000000000000'
const OUTLET = 'c0b07cea-941b-4561-bcb4-2f01d7d16af6'
const BRIAN = 'c2a62587-c4e4-4853-bcac-9a8cc055b062'

test('stale retry shift reattributes to the current open shift for authorize', () => {
  assert.equal(
    resolveAuthorizeShiftId({
      requestedShiftId: STALE,
      outletId: OUTLET,
      openShift: { id: CURRENT, status: 'open', outlet_id: OUTLET }
    }),
    CURRENT
  )
})

test('authorize inputs that must stay untouched (fail closed)', () => {
  const open = { id: CURRENT, status: 'open', outlet_id: OUTLET }
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: CURRENT, outletId: OUTLET, openShift: open }), CURRENT)
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: STALE, outletId: OUTLET, openShift: null }), STALE)
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: STALE, outletId: OUTLET, openShift: { id: CURRENT, status: 'closed', outlet_id: OUTLET } }), STALE)
  assert.equal(
    resolveAuthorizeShiftId({ requestedShiftId: STALE, outletId: OUTLET, openShift: { id: CURRENT, status: 'open', outlet_id: 'other-outlet' } }),
    STALE,
    'never jump outlets'
  )
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: null, outletId: OUTLET, openShift: open }), null)
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: '', outletId: OUTLET, openShift: open }), '')
  // Missing outlet on either side still resolves: single-outlet bars carry no outlet on cached rows.
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: STALE, outletId: null, openShift: open }), CURRENT)
  assert.equal(resolveAuthorizeShiftId({ requestedShiftId: STALE, outletId: OUTLET, openShift: { id: CURRENT } }), CURRENT)
})

test('Lounge P5 shape: stale shift fails authorize, resolved shift passes', () => {
  const store = createTillOperatorSessionStore()
  const webContentsId = 7
  store.create({
    webContentsId,
    staffId: BRIAN,
    staffName: 'Brian Rabafi',
    outletId: OUTLET,
    shiftId: CURRENT,
    mode: 'shift',
    inactivityMinutes: 30,
    operatorProof: 'proof-1'
  })
  const stale = store.authorize(webContentsId, { outletId: OUTLET, operatorId: BRIAN, shiftId: STALE })
  assert.equal(stale.success, false)
  assert.equal(stale.code, 'till_operator_shift_mismatch')
  // Mismatch clears the session: recreate it as a fresh unlock would.
  store.create({
    webContentsId,
    staffId: BRIAN,
    staffName: 'Brian Rabafi',
    outletId: OUTLET,
    shiftId: CURRENT,
    mode: 'shift',
    inactivityMinutes: 30,
    operatorProof: 'proof-1'
  })
  const resolvedShiftId = resolveAuthorizeShiftId({
    requestedShiftId: STALE,
    outletId: OUTLET,
    openShift: { id: CURRENT, status: 'open', outlet_id: OUTLET }
  })
  const retried = store.authorize(webContentsId, { outletId: OUTLET, operatorId: BRIAN, shiftId: resolvedShiftId })
  assert.equal(retried.success, true)
})

test('main gate resolves the shift before authorize and leaves payloads intact', () => {
  const source = read('src/main/index.js')
  const resolveAt = source.indexOf('resolveAuthorizeShiftId({ requestedShiftId: shiftId')
  assert.ok(resolveAt > -1, 'index.js resolves the authorize shift')
  const authorizeAt = source.indexOf('sharedTillOperatorSessions.authorize(event?.sender?.id', resolveAt)
  assert.ok(authorizeAt > resolveAt, 'resolution runs before authorize')
  const authorizeBlock = source.slice(resolveAt, authorizeAt + 200)
  assert.match(authorizeBlock, /shiftId: authorizeShiftId/)
  // The downstream payload/journal path is untouched: still built from data.
  assert.match(source, /db\.createPosOrder\(buildAuthoritativeTillPayload\(data, tillContext, 'order'\)\)/)
})

test('server-payload rewrite still owns the journal-original-bytes contract', () => {
  const source = read('src/main/domains/pos.js')
  assert.match(source, /retry_shift_rewritten/)
  assert.match(source, /journal keeps the original bytes/)
})

function withJournalFile(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'till-retry-shift-journal-'))
  const previous = state.cacheDir
  state.cacheDir = dir
  try {
    return run()
  } finally {
    state.cacheDir = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const buildEnvelope = (overrides = {}) => ({
  id: 'intent-retry-1',
  submit_intent_id: 'intent-retry-1',
  created_at_client: '2026-09-13T10:57:46.000Z',
  outlet_id: 'outlet-1',
  shift_id: 'shift-old',
  cashier_id: 'staff-1',
  waiter_id: 'staff-1',
  items: [{ menu_item_id: 'granpa', quantity: 1 }],
  payment_method: 'cash',
  payment_breakdown: [{ method: 'cash', amount: 5 }],
  catalog_snapshot_id: 'snap-v9',
  total: 5,
  ...overrides
})

test('journal exposes the stored envelope for same-intent retries', () =>
  withJournalFile(() => {
    assert.equal(getPosSubmitAttempt('intent-retry-1'), null)
    assert.equal(getPosSubmitAttempt(''), null)
    const first = resolvePosSubmitAttempt({
      submitIntentId: 'intent-retry-1',
      orderId: 'intent-retry-1',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildEnvelope()
    })
    assert.equal(first.conflict, false)
    assert.equal(hasPosSubmitAttempt('intent-retry-1'), true)
    const stored = getPosSubmitAttempt('intent-retry-1')
    assert.equal(stored?.payload?.catalog_snapshot_id, 'snap-v9')
    assert.equal(stored?.status, 'pending')
  }))

test('Lounge P5 shape: rebuilt envelope conflicts, stored-bytes retry reuses', () =>
  withJournalFile(() => {
    const original = buildEnvelope()
    const first = resolvePosSubmitAttempt({
      submitIntentId: 'intent-retry-1',
      orderId: 'intent-retry-1',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: original
    })
    assert.equal(first.conflict, false)
    // Days later the Till rebuilds the envelope: fresh snapshot, new shift.
    const rebuilt = buildEnvelope({ catalog_snapshot_id: 'snap-v14', shift_id: 'shift-new', total: 5 })
    const conflict = resolvePosSubmitAttempt({
      submitIntentId: 'intent-retry-1',
      orderId: 'intent-retry-1',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: rebuilt
    })
    assert.equal(conflict.conflict, true, 'rebuilt bytes must never silently replace the journalled envelope')
    // Fixed caller pattern (mirrors the offline path): swap stored bytes first.
    let v3Payload = { ...rebuilt }
    if (hasPosSubmitAttempt('intent-retry-1')) {
      const storedRetry = getPosSubmitAttempt('intent-retry-1')
      if (storedRetry?.payload) v3Payload = { ...storedRetry.payload }
    }
    const retried = resolvePosSubmitAttempt({
      submitIntentId: 'intent-retry-1',
      orderId: 'intent-retry-1',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: v3Payload
    })
    assert.equal(retried.conflict, false)
    assert.equal(retried.reused, true)
    assert.equal(retried.attempt.payload.catalog_snapshot_id, 'snap-v9')
  }))

test('online path swaps journalled bytes before recording the attempt', () => {
  const source = read('src/main/domains/pos.js')
  const swapAt = source.indexOf('const storedRetry = getPosSubmitAttempt(submitIntentId)')
  assert.ok(swapAt > -1, 'pos.js loads the stored retry envelope')
  const recordAt = source.indexOf('const onlineAttemptError = recordAttempt(v3Payload)')
  assert.ok(recordAt > swapAt, 'swap runs before the online journal record')
})
