import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'night-audit-summary'

/**
 * Night audit financial close mutations are ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
 */
function requireOnline(operation) {
  if (!state.isOnline) {
    const err = new Error(
      `${operation} requires an internet connection. Night audit mutations cannot run offline.`
    )
    err.onlineOnly = true
    throw err
  }
}

async function _runAuditChecks() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) {
    const cached = readCache(CACHE_KEY)
    if (cached) return cached
    throw new Error('Night audit checks require an internet connection when no cached result is available')
  }
  try {
    const { data, error } = await state.supabase.rpc('run_night_audit_checks', { p_lodge_id: currentLodgeId })
    if (error) throw error
    writeCache(CACHE_KEY, data)
    return data
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    if (cached) return cached
    throw new Error(e?.message || 'Night audit checks failed')
  }
}

async function _closeNightAudit(closedBy, notes, force = false) {
  requireOnline('Close night audit')
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (force === true && !String(notes || '').trim()) {
    // Force close still allowed with empty notes at RPC layer, but domain prefers a reason when forcing.
  }
  const { data, error } = await state.supabase.rpc('close_night_audit', {
    p_lodge_id: currentLodgeId,
    p_closed_by: closedBy,
    p_notes: notes || null,
    p_force: force === true
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Night audit close failed')
  return data
}

async function _reopenNightAudit(closeId, reopenedBy, reason) {
  requireOnline('Reopen night audit')
  if (!String(reason || '').trim()) {
    throw new Error('A reason is required to reopen night audit')
  }
  const { data, error } = await state.supabase.rpc('reopen_night_audit', {
    p_close_id: closeId,
    p_reopened_by: reopenedBy,
    p_reason: reason || null
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Night audit reopen failed')
  return data
}

async function _getNightAuditSummary(date) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { close: null, stats: {} }
  try {
    if (!state.isOnline) {
      const cached = readCache(CACHE_KEY)
      return cached || { close: null, stats: {} }
    }
    const { data, error } = await state.supabase.rpc('get_night_audit_summary', {
      p_lodge_id: currentLodgeId,
      p_date: date || null
    })
    if (error) throw error
    writeCache(CACHE_KEY, data)
    return data
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    return cached || { close: null, stats: {} }
  }
}

async function _getNightAuditHistory(limit) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { closes: [], count: 0 }
  if (!state.isOnline) {
    throw Object.assign(new Error('Night audit history requires an internet connection'), { onlineOnly: true })
  }
  try {
    const { data, error } = await state.supabase.rpc('get_night_audit_history', {
      p_lodge_id: currentLodgeId,
      p_limit: limit || 30
    })
    if (error) throw error
    return data
  } catch (e) {
    throw new Error(e?.message || 'Failed to load night audit history')
  }
}

async function _resolveException(exceptionId, resolvedBy, notes) {
  requireOnline('Resolve night audit exception')
  const { data, error } = await state.supabase.rpc('resolve_exception', {
    p_exception_id: exceptionId,
    p_resolved_by: resolvedBy,
    p_notes: notes || null
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not resolve exception')
  return data
}

export const runAuditChecks = (...args) => dedupePromise('runAuditChecks', () => _runAuditChecks(...args))
export const closeNightAudit = (...args) => dedupePromise('closeNightAudit', () => _closeNightAudit(...args))
export const reopenNightAudit = (...args) => dedupePromise('reopenNightAudit', () => _reopenNightAudit(...args))
export const getNightAuditSummary = (...args) => dedupePromise('getNightAuditSummary', () => _getNightAuditSummary(...args))
export const getNightAuditHistory = (...args) => dedupePromise('getNightAuditHistory', () => _getNightAuditHistory(...args))
export const resolveException = (...args) => dedupePromise('resolveException', () => _resolveException(...args))

export { requireOnline as requireNightAuditOnline }
