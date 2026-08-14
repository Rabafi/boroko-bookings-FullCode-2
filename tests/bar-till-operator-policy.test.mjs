import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_TILL_OPERATOR_INACTIVITY_MINUTES,
  DEFAULT_TILL_OPERATOR_MODE,
  MAX_TILL_OPERATOR_INACTIVITY_MINUTES,
  MIN_TILL_OPERATOR_INACTIVITY_MINUTES,
  TILL_OPERATOR_MODES,
  getTillOperatorPolicy,
  normalizeTillOperatorInactivityMinutes,
  normalizeTillOperatorMode,
  tillOperatorPolicyToProfileValue
} from '../src/shared/tillOperatorPolicy.js'
import { buildOperatingProfile } from '../src/shared/propertyTypes.js'
import { createTillOperatorSessionStore, TILL_OPERATOR_SESSION_CODES } from '../src/main/domains/tillOperatorSession.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('missing or invalid configuration fails closed to strict mode', () => {
  assert.equal(normalizeTillOperatorMode(''), DEFAULT_TILL_OPERATOR_MODE)
  assert.equal(normalizeTillOperatorMode('unknown'), DEFAULT_TILL_OPERATOR_MODE)
  assert.deepEqual(getTillOperatorPolicy({ operating_profile: {} }), {
    mode: TILL_OPERATOR_MODES.STRICT,
    inactivityMinutes: DEFAULT_TILL_OPERATOR_INACTIVITY_MINUTES
  })
})

test('shift mode normalizes and clamps the inactivity timeout', () => {
  assert.equal(normalizeTillOperatorInactivityMinutes(30), 30)
  assert.equal(normalizeTillOperatorInactivityMinutes(1), MIN_TILL_OPERATOR_INACTIVITY_MINUTES)
  assert.equal(normalizeTillOperatorInactivityMinutes(999), MAX_TILL_OPERATOR_INACTIVITY_MINUTES)
  assert.deepEqual(getTillOperatorPolicy({ operating_profile: { till_operator_policy: { mode: 'shift', inactivity_minutes: 30 } } }), {
    mode: TILL_OPERATOR_MODES.SHIFT,
    inactivityMinutes: 30
  })
  assert.deepEqual(tillOperatorPolicyToProfileValue({ mode: 'shift', inactivityMinutes: 30 }), {
    mode: 'shift',
    inactivity_minutes: 30
  })
})

test('operating profile carries explicit Till policy without changing strict default', () => {
  const strict = buildOperatingProfile('restaurant', 'Starter', [], {})
  assert.equal(strict.till_operator_policy, undefined)

  const shift = buildOperatingProfile('restaurant', 'Starter', [], {
    hospitalityMode: 'bar_only',
    tillOperatorPolicy: { mode: 'shift', inactivity_minutes: 30 }
  })
  assert.deepEqual(shift.till_operator_policy, { mode: 'shift', inactivity_minutes: 30 })
})

test('POS surfaces enforce policy and preserve operator identity', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const main = read('src/main/index.js')
  const settings = read('src/renderer/src/components/Settings.jsx')
  const attributionMigration = read('supabase/migrations/20260716033000_pos_order_operator_from_shift.sql')
  assert.match(settings, /Strict — PIN for every order \(default\)/)
  assert.match(settings, /Shift — PIN once, then stay unlocked/)
  assert.match(terminal, /tillOperatorPolicy\.mode === TILL_OPERATOR_MODES\.STRICT/)
  assert.match(terminal, /Till will lock after/)
  assert.match(main, /till_operator_session_expired/)
  assert.match(main, /SHARED_TILL_ROLES/)
  assert.match(main, /buildAuthoritativeTillPayload/)
  assert.match(main, /touchSharedTillOperator/)
  assert.match(main, /clearMatching/)
  assert.match(main, /pos:openTableSession/)
  assert.match(attributionMigration, /create or replace function public\.assign_pos_order_operator_from_shift/)
  assert.match(attributionMigration, /new\.cashier_id := v_shift\.cashier_id/)
  assert.match(attributionMigration, /trg_pos_orders_assign_operator_from_shift/)
})

test('session manager expires without reads extending the lease', () => {
  let now = 1000
  const store = createTillOperatorSessionStore({ clock: () => now })
  store.create({ webContentsId: 1, staffId: 'staff-1', staffName: 'A', outletId: 'outlet-1', shiftId: 'shift-1', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 1 })
  now += 59_999
  assert.equal(store.get(1)?.staffId, 'staff-1')
  now += 2
  assert.equal(store.get(1), null)
})

test('session manager renews only validated Shift activity', () => {
  let now = 10_000
  const store = createTillOperatorSessionStore({ clock: () => now })
  store.create({ webContentsId: 2, staffId: 'staff-2', outletId: 'outlet-2', shiftId: 'shift-2', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 1 })
  now += 30_000
  const touched = store.touch(2, { outletId: 'outlet-2' })
  assert.equal(touched.success, true)
  assert.equal(touched.session.lastActivityAt, now)
  assert.equal(touched.session.expiresAt, now + 60_000)
  const wrongOutlet = store.touch(2, { outletId: 'outlet-other' })
  assert.equal(wrongOutlet.code, TILL_OPERATOR_SESSION_CODES.OUTLET_CHANGED)
  assert.equal(store.get(2), null)
})

test('session manager rejects missing or mismatched attribution and never renews it', () => {
  let now = 20_000
  const store = createTillOperatorSessionStore({ clock: () => now })
  store.create({ webContentsId: 3, staffId: 'staff-3', outletId: 'outlet-3', shiftId: 'shift-3', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 1 })
  now += 10_000
  const missingOperator = store.authorize(3, { outletId: 'outlet-3', shiftId: 'shift-3' })
  assert.equal(missingOperator.code, TILL_OPERATOR_SESSION_CODES.OPERATOR_MISMATCH)
  assert.equal(store.get(3), null)

  store.create({ webContentsId: 4, staffId: 'staff-4', outletId: 'outlet-4', shiftId: 'shift-4', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 1 })
  const mismatch = store.authorize(4, { outletId: 'outlet-4', operatorId: 'staff-other', shiftId: 'shift-4' })
  assert.equal(mismatch.code, TILL_OPERATOR_SESSION_CODES.OPERATOR_MISMATCH)
  assert.equal(store.get(4), null)
})

test('Strict sessions are not touch-renewable and are consumed after success', () => {
  const store = createTillOperatorSessionStore({ clock: () => 30_000 })
  store.create({ webContentsId: 5, staffId: 'staff-5', outletId: 'outlet-5', shiftId: 'shift-5', mode: TILL_OPERATOR_MODES.STRICT, inactivityMinutes: 30 })
  assert.equal(store.touch(5, { outletId: 'outlet-5' }).code, TILL_OPERATOR_SESSION_CODES.STRICT)
  assert.ok(store.get(5))
  store.consumeStrict(5)
  assert.equal(store.get(5), null)
})

test('shift close can clear only the affected staff/outlet/shift sessions', () => {
  const store = createTillOperatorSessionStore({ clock: () => 40_000 })
  store.create({ webContentsId: 6, staffId: 'staff-6', outletId: 'outlet-6', shiftId: 'shift-6', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  store.create({ webContentsId: 7, staffId: 'staff-7', outletId: 'outlet-6', shiftId: 'shift-7', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  store.clearMatching({ staffId: 'staff-6', outletId: 'outlet-6', shiftId: 'shift-6' })
  assert.equal(store.get(6), null)
  assert.ok(store.get(7))
})
