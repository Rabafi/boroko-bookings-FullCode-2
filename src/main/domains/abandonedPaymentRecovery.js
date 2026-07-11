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
  const { data, error } = await state.supabase.rpc('recover_abandoned_session', {
    p_lodge_id: state.lodgeId,
    p_session_token: sessionToken
  })
  if (error) throw error
  return data
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
