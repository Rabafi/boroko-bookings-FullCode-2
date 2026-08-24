import { TILL_OPERATOR_MODES } from '../../shared/tillOperatorPolicy.js'

export const TILL_OPERATOR_SESSION_CODES = Object.freeze({
  REQUIRED: 'till_operator_session_required',
  EXPIRED: 'till_operator_session_expired',
  OUTLET_CHANGED: 'till_operator_outlet_changed',
  OPERATOR_MISMATCH: 'till_operator_mismatch',
  SHIFT_MISMATCH: 'till_operator_shift_mismatch',
  STRICT: 'till_operator_strict'
})

function asId(value) {
  const text = String(value || '').trim()
  return text || null
}

function cloneSession(session) {
  if (!session) return null
  const { operatorProof, ...publicSession } = session
  return { ...publicSession }
}

export function createTillOperatorSessionStore({ clock = () => Date.now() } = {}) {
  const sessions = new Map()

  const now = () => {
    const value = Number(clock())
    return Number.isFinite(value) ? value : Date.now()
  }

  function clear(webContentsId) {
    if (webContentsId !== null && webContentsId !== undefined) sessions.delete(webContentsId)
  }

  function get(webContentsId) {
    const session = sessions.get(webContentsId)
    if (!session) return null
    if (session.expiresAt <= now()) {
      clear(webContentsId)
      return null
    }
    return cloneSession(session)
  }

  function getOperatorProof(webContentsId) {
    const session = sessions.get(webContentsId)
    if (!session) return null
    if (session.expiresAt <= now()) {
      clear(webContentsId)
      return null
    }
    return session.operatorProof || null
  }

  function create({ webContentsId, staffId, staffName, outletId, shiftId, mode, inactivityMinutes, operatorProof } = {}) {
    const normalizedStaffId = asId(staffId)
    if (webContentsId === null || webContentsId === undefined || !normalizedStaffId) return null
    const minutes = Math.max(1, Number(inactivityMinutes) || 30)
    const timestamp = now()
    const session = {
      staffId: normalizedStaffId,
      staffName: staffName || 'Till operator',
      outletId: asId(outletId),
      shiftId: asId(shiftId),
      mode: mode === TILL_OPERATOR_MODES.SHIFT ? TILL_OPERATOR_MODES.SHIFT : TILL_OPERATOR_MODES.STRICT,
      inactivityMinutes: minutes,
      operatorProof: asId(operatorProof),
      lastActivityAt: timestamp,
      expiresAt: timestamp + minutes * 60 * 1000
    }
    sessions.set(webContentsId, session)
    return cloneSession(session)
  }

  function reject(webContentsId, code, error) {
    clear(webContentsId)
    return { success: false, code, error, session: null }
  }

  function authorize(webContentsId, { outletId, operatorId, shiftId, renew = true } = {}) {
    const session = get(webContentsId)
    if (!session) return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.REQUIRED, 'Unlock Till with the Staff PIN before continuing.')

    const requestedOutlet = asId(outletId)
    const requestedOperator = asId(operatorId)
    const requestedShift = asId(shiftId)
    if (!requestedOutlet || session.outletId !== requestedOutlet) {
      return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.OUTLET_CHANGED, 'Unlock Till again for this outlet.')
    }
    if (!requestedOperator || session.staffId !== requestedOperator) {
      return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.OPERATOR_MISMATCH, 'The selected Till operator does not match the active PIN session.')
    }
    if (!requestedShift || (session.shiftId && session.shiftId !== requestedShift)) {
      return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.SHIFT_MISMATCH, 'Unlock Till again with the operator\'s open shift.')
    }

    if (renew && session.mode === TILL_OPERATOR_MODES.SHIFT) {
      const timestamp = now()
      session.lastActivityAt = timestamp
      session.expiresAt = timestamp + session.inactivityMinutes * 60 * 1000
    }
    return { success: true, code: null, error: null, session: cloneSession(session) }
  }

  function touch(webContentsId, { outletId, operatorId, shiftId } = {}) {
    const session = get(webContentsId)
    if (!session) return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.EXPIRED, 'Till has locked. Verify the operator PIN to continue.')
    if (session.mode !== TILL_OPERATOR_MODES.SHIFT) {
      return { success: false, code: TILL_OPERATOR_SESSION_CODES.STRICT, error: 'Strict mode requires a Staff PIN for each order.', session: cloneSession(session) }
    }
    if (!outletId || session.outletId !== asId(outletId)) {
      return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.OUTLET_CHANGED, 'Unlock Till again for this outlet.')
    }
    if (!operatorId || session.staffId !== asId(operatorId)) {
      return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.OPERATOR_MISMATCH, 'The selected Till operator does not match the active PIN session.')
    }
    if (!shiftId || (session.shiftId && session.shiftId !== asId(shiftId))) {
      return reject(webContentsId, TILL_OPERATOR_SESSION_CODES.SHIFT_MISMATCH, 'Unlock Till again with the operator\'s open shift.')
    }
    const timestamp = now()
    session.lastActivityAt = timestamp
    session.expiresAt = timestamp + session.inactivityMinutes * 60 * 1000
    return { success: true, code: null, error: null, session: cloneSession(session) }
  }

  function consumeStrict(webContentsId) {
    const session = get(webContentsId)
    if (session?.mode === TILL_OPERATOR_MODES.STRICT) clear(webContentsId)
    return session
  }

  function clearMatching({ staffId, outletId, shiftId } = {}) {
    const expectedStaff = asId(staffId)
    const expectedOutlet = asId(outletId)
    const expectedShift = asId(shiftId)
    for (const [webContentsId, session] of sessions.entries()) {
      if (expectedStaff && session.staffId !== expectedStaff) continue
      if (expectedOutlet && session.outletId !== expectedOutlet) continue
      if (expectedShift && session.shiftId !== expectedShift) continue
      clear(webContentsId)
    }
  }

  function clearAll() {
    sessions.clear()
  }

  return Object.freeze({ create, get, getOperatorProof, authorize, touch, consumeStrict, clear, clearMatching, clearAll })
}
