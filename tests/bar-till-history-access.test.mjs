import test from 'node:test'
import assert from 'node:assert/strict'

import { TILL_OPERATOR_MODES } from '../src/shared/tillOperatorPolicy.js'
import { createTillOperatorSessionStore, TILL_OPERATOR_SESSION_CODES } from '../src/main/domains/tillOperatorSession.js'
import { resolveSharedTillHistoryAccess, TILL_SHIFT_CLOSED_CODE } from '../src/main/domains/tillOperatorHistory.js'

const SHIFT_POLICY = { mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 }
const openShift = (shiftId = 'shift-1') => ({ id: shiftId, status: 'open' })

test('a valid PIN session resolves and history reads never renew the lease', async () => {
  let now = 1_000
  const sessions = createTillOperatorSessionStore({ clock: () => now })
  sessions.create({ webContentsId: 1, staffId: 'staff-1', staffName: 'A', outletId: 'outlet-1', shiftId: 'shift-1', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  const before = sessions.get(1)

  now += 15_000
  const access = await resolveSharedTillHistoryAccess({
    sessions,
    webContentsId: 1,
    policy: SHIFT_POLICY,
    isOnline: true,
    getOpenShift: () => Promise.resolve(openShift())
  })
  assert.equal(access.session.staffId, 'staff-1')
  assert.equal(access.code, null)
  const after = sessions.get(1)
  assert.equal(after.lastActivityAt, before.lastActivityAt)
  assert.equal(after.expiresAt, before.expiresAt)
})

test('an expired session fails closed and is cleared', async () => {
  let now = 2_000
  const sessions = createTillOperatorSessionStore({ clock: () => now })
  sessions.create({ webContentsId: 2, staffId: 'staff-2', outletId: 'outlet-2', shiftId: 'shift-2', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 1 })
  now += 61_000
  const access = await resolveSharedTillHistoryAccess({ sessions, webContentsId: 2, policy: SHIFT_POLICY, isOnline: false })
  assert.equal(access.session, null)
  assert.equal(access.code, TILL_OPERATOR_SESSION_CODES.REQUIRED)
  assert.equal(sessions.get(2), null)
})

test('one terminal cannot read another terminal’s operator history', async () => {
  const sessions = createTillOperatorSessionStore({ clock: () => 3_000 })
  sessions.create({ webContentsId: 10, staffId: 'staff-a', outletId: 'outlet-1', shiftId: 'shift-a', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  const access = await resolveSharedTillHistoryAccess({ sessions, webContentsId: 11, policy: SHIFT_POLICY, isOnline: false })
  assert.equal(access.session, null)
  assert.equal(access.code, TILL_OPERATOR_SESSION_CODES.REQUIRED)
})

test('a changed Till policy invalidates the session instead of reading stale history', async () => {
  const sessions = createTillOperatorSessionStore({ clock: () => 4_000 })
  sessions.create({ webContentsId: 3, staffId: 'staff-3', outletId: 'outlet-3', shiftId: 'shift-3', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  const access = await resolveSharedTillHistoryAccess({
    sessions,
    webContentsId: 3,
    policy: { mode: TILL_OPERATOR_MODES.STRICT, inactivityMinutes: 30 },
    isOnline: false
  })
  assert.equal(access.session, null)
  assert.equal(access.code, TILL_OPERATOR_SESSION_CODES.EXPIRED)
  assert.equal(sessions.get(3), null)
})

test('a closed or mismatched shift fails the read when online', async () => {
  const sessions = createTillOperatorSessionStore({ clock: () => 5_000 })
  sessions.create({ webContentsId: 4, staffId: 'staff-4', outletId: 'outlet-4', shiftId: 'shift-4', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })

  const closed = await resolveSharedTillHistoryAccess({
    sessions,
    webContentsId: 4,
    policy: SHIFT_POLICY,
    isOnline: true,
    getOpenShift: () => Promise.resolve({ id: 'shift-4', status: 'closed' })
  })
  assert.equal(closed.session, null)
  assert.equal(closed.code, TILL_SHIFT_CLOSED_CODE)
  assert.equal(sessions.get(4), null)

  sessions.create({ webContentsId: 5, staffId: 'staff-5', outletId: 'outlet-5', shiftId: 'shift-5', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  const mismatched = await resolveSharedTillHistoryAccess({
    sessions,
    webContentsId: 5,
    policy: SHIFT_POLICY,
    isOnline: true,
    getOpenShift: () => Promise.resolve(openShift('shift-other'))
  })
  assert.equal(mismatched.session, null)
  assert.equal(mismatched.code, TILL_SHIFT_CLOSED_CODE)
  assert.equal(sessions.get(5), null)
})

test('the shift check is skipped while offline but the PIN session is still required', async () => {
  const sessions = createTillOperatorSessionStore({ clock: () => 6_000 })
  let shiftQueried = false
  sessions.create({ webContentsId: 6, staffId: 'staff-6', outletId: 'outlet-6', shiftId: 'shift-6', mode: TILL_OPERATOR_MODES.SHIFT, inactivityMinutes: 30 })
  const access = await resolveSharedTillHistoryAccess({
    sessions,
    webContentsId: 6,
    policy: SHIFT_POLICY,
    isOnline: false,
    getOpenShift: () => { shiftQueried = true; return Promise.resolve(openShift()) }
  })
  assert.equal(access.session.staffId, 'staff-6')
  assert.equal(shiftQueried, false)
  assert.equal(sessions.get(6).staffId, 'staff-6')
})
