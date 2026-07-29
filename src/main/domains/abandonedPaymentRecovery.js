import { state } from '../state.js'
import { dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'abandoned-payments'

async function _logAbandonedSession(bookingId, amount, provider, sessionToken, expiresAt) {
  const { data, error } = await state.supabase.rpc('log_abandoned_session', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_amount: amount,
    p_payment_provider: provider || null,
    p_session_token: sessionToken,
    p_expires_at: expiresAt || null
  })
  if (error) throw error
  return data
}

export function logAbandonedSession(bookingId, amount, provider, sessionToken, expiresAt) {
  return dedupePromise('logAbandonedSession', () => _logAbandonedSession(bookingId, amount, provider, sessionToken, expiresAt))
}

async function _getAbandonedSessions(statusFilter) {
  const { data, error } = await state.supabase.rpc('get_abandoned_sessions', {
    p_lodge_id: state.lodgeId,
    p_status_filter: statusFilter || null
  })
  if (error) throw error
  return data
}

export function getAbandonedSessions(statusFilter) {
  return dedupePromise('getAbandonedSessions', () => _getAbandonedSessions(statusFilter))
}

async function _recoverSession(sessionToken) {
  if (!state.lodgeId) throw new Error('No lodge selected')
  if (!sessionToken) throw new Error('Session token is required')
  // Payment recovery is ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
  if (state.isOnline === false) {
    const err = new Error(
      'Recover abandoned payment session requires an internet connection. Payment recovery cannot be queued offline.'
    )
    err.onlineOnly = true
    throw err
  }
  const { data, error } = await state.supabase.rpc('recover_abandoned_session', {
    p_lodge_id: state.lodgeId,
    p_session_token: sessionToken
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not recover abandoned session')

  // Recovery updates abandoned session state only.
  // Never author payment_status / amount_paid from the client.
  const session = data && typeof data === 'object' ? { ...data } : { result: data }
  delete session.payment_status
  delete session.amount_paid
  delete session.paid
  delete session.is_paid

  return {
    success: true,
    recovery_status: session.status || 'recovered',
    session,
    payment_confirmed: false,
    note: 'Abandoned session marked recovered. Booking payment totals remain server-authoritative.'
  }
}

export function recoverSession(sessionToken) {
  return dedupePromise('recoverSession', () => _recoverSession(sessionToken))
}

async function _expireSessions() {
  const { data, error } = await state.supabase.rpc('expire_abandoned_sessions', {
    p_lodge_id: state.lodgeId
  })
  if (error) throw error
  return data
}

export function expireSessions() {
  return dedupePromise('expireSessions', () => _expireSessions())
}

async function _getPendingRecoverySessions() {
  const { data, error } = await state.supabase.rpc('get_pending_recovery_sessions', {
    p_lodge_id: state.lodgeId
  })
  if (error) throw error
  return data
}

export function getPendingRecoverySessions() {
  return dedupePromise('getPendingRecoverySessions', () => _getPendingRecoverySessions())
}
