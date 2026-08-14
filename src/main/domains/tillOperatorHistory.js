import { TILL_OPERATOR_SESSION_CODES } from './tillOperatorSession.js'

export const TILL_SHIFT_CLOSED_CODE = 'till_shift_closed'

// A shared Till keeps a device session open for speed, but sales history must
// remain scoped to the PIN-verified operator. Resolving history access is a
// read: it must never renew the session lease, consume a Strict session, or
// accept a renderer-supplied operator id. The session store is the authority.
export async function resolveSharedTillHistoryAccess({ sessions, webContentsId, policy, isOnline, getOpenShift }) {
  const operator = sessions.get(webContentsId)
  if (!operator) {
    return { session: null, code: TILL_OPERATOR_SESSION_CODES.REQUIRED, error: 'Unlock Till with your Staff PIN to view your sales history.' }
  }
  if (operator.mode !== policy?.mode || operator.inactivityMinutes !== policy?.inactivityMinutes) {
    sessions.clear(webContentsId)
    return { session: null, code: TILL_OPERATOR_SESSION_CODES.EXPIRED, error: 'Till settings changed. Verify the operator PIN again.' }
  }
  if (isOnline && operator.shiftId && typeof getOpenShift === 'function') {
    const openShift = await getOpenShift(operator.staffId)
    if (!openShift?.id || openShift.id !== operator.shiftId || String(openShift.status || 'open').toLowerCase() !== 'open') {
      sessions.clear(webContentsId)
      return { session: null, code: TILL_SHIFT_CLOSED_CODE, error: 'The operator shift is closed. Start or select an open shift before continuing.' }
    }
  }
  return { session: operator, code: null, error: null }
}
