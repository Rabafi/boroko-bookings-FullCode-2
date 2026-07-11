import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'night-audit-summary'

async function _runAuditChecks() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
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

async function _closeNightAudit(closedBy, notes) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('close_night_audit', { p_lodge_id: currentLodgeId, p_closed_by: closedBy, p_notes: notes || null })
  if (error) throw error
  return data
}

async function _reopenNightAudit(closeId, reopenedBy, reason) {
  const { data, error } = await state.supabase.rpc('reopen_night_audit', { p_close_id: closeId, p_reopened_by: reopenedBy, p_reason: reason || null })
  if (error) throw error
  return data
}

async function _getNightAuditSummary(date) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { close: null, stats: {} }
  try {
    const { data, error } = await state.supabase.rpc('get_night_audit_summary', { p_lodge_id: currentLodgeId, p_date: date || null })
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
  try {
    const { data, error } = await state.supabase.rpc('get_night_audit_history', { p_lodge_id: currentLodgeId, p_limit: limit || 30 })
    if (error) throw error
    return data
  } catch (e) {
    throw new Error(e?.message || 'Failed to load night audit history')
  }
}

async function _resolveException(exceptionId, resolvedBy, notes) {
  const { data, error } = await state.supabase.rpc('resolve_exception', { p_exception_id: exceptionId, p_resolved_by: resolvedBy, p_notes: notes || null })
  if (error) throw error
  return data
}

export const runAuditChecks = (...args) => dedupePromise('runAuditChecks', () => _runAuditChecks(...args))
export const closeNightAudit = (...args) => dedupePromise('closeNightAudit', () => _closeNightAudit(...args))
export const reopenNightAudit = (...args) => dedupePromise('reopenNightAudit', () => _reopenNightAudit(...args))
export const getNightAuditSummary = (...args) => dedupePromise('getNightAuditSummary', () => _getNightAuditSummary(...args))
export const getNightAuditHistory = (...args) => dedupePromise('getNightAuditHistory', () => _getNightAuditHistory(...args))
export const resolveException = (...args) => dedupePromise('resolveException', () => _resolveException(...args))
