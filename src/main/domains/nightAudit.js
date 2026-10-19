// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'night-audit-summary'

/** @typedef {Record<string, unknown>} NightAuditPropertyView */
/** @typedef {Error & {onlineOnly: boolean}} NightAuditOnlineError */

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // Preserve the existing unguarded RPC dereference when client setup is absent.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @param {unknown} message @returns {Error} */
function errorWithUnknownMessage(message) {
  return Reflect.construct(Error, [message])
}

/** @param {unknown} error @returns {unknown} */
function readThrownMessage(error) {
  if (error === null || error === undefined) return undefined
  return /** @type {NightAuditPropertyView} */ (error).message
}

/**
 * Night audit financial close mutations are ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
 * @param {string} operation
 */
function requireOnline(operation) {
  if (!state.isOnline) {
    const err = /** @type {NightAuditOnlineError} */ (new Error(
      `${operation} requires an internet connection. Night audit mutations cannot run offline.`
    ))
    err.onlineOnly = true
    throw err
  }
}

/** @returns {Promise<unknown>} */
async function _runAuditChecks() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) {
    const cached = readCache(CACHE_KEY)
    if (cached) return cached
    throw new Error('Night audit checks require an internet connection when no cached result is available')
  }
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('run_night_audit_checks', { p_lodge_id: currentLodgeId })
    if (error) throw error
    writeCache(CACHE_KEY, data)
    return data
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    if (cached) return cached
    throw errorWithUnknownMessage(readThrownMessage(e) || 'Night audit checks failed')
  }
}

/** @param {unknown} closedBy @param {unknown} notes @param {unknown} [force] @returns {Promise<unknown>} */
async function _closeNightAudit(closedBy, notes, force = false) {
  requireOnline('Close night audit')
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (force === true && !String(notes || '').trim()) {
    // Force close still allowed with empty notes at RPC layer, but domain prefers a reason when forcing.
  }
  const { data, error } = await supabaseForDomainRpc().rpc('close_night_audit', {
    p_lodge_id: currentLodgeId,
    p_closed_by: closedBy,
    p_notes: notes || null,
    p_force: force === true
  })
  if (error) throw error
  const resultView = /** @type {NightAuditPropertyView | null | undefined} */ (data)
  if (resultView?.success === false) throw errorWithUnknownMessage(resultView.error || 'Night audit close failed')
  return data
}

/** @param {unknown} closeId @param {unknown} reopenedBy @param {unknown} reason @returns {Promise<unknown>} */
async function _reopenNightAudit(closeId, reopenedBy, reason) {
  requireOnline('Reopen night audit')
  if (!String(reason || '').trim()) {
    throw new Error('A reason is required to reopen night audit')
  }
  const { data, error } = await supabaseForDomainRpc().rpc('reopen_night_audit', {
    p_close_id: closeId,
    p_reopened_by: reopenedBy,
    p_reason: reason || null
  })
  if (error) throw error
  const resultView = /** @type {NightAuditPropertyView | null | undefined} */ (data)
  if (resultView?.success === false) throw errorWithUnknownMessage(resultView.error || 'Night audit reopen failed')
  return data
}

/** @param {unknown} date @returns {Promise<unknown>} */
async function _getNightAuditSummary(date) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { close: null, stats: {} }
  try {
    if (!state.isOnline) {
      const cached = readCache(CACHE_KEY)
      return cached || { close: null, stats: {} }
    }
    const { data, error } = await supabaseForDomainRpc().rpc('get_night_audit_summary', {
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

/** @param {unknown} limit @returns {Promise<unknown>} */
async function _getNightAuditHistory(limit) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { closes: [], count: 0 }
  if (!state.isOnline) {
    throw Object.assign(/** @type {NightAuditOnlineError} */ (new Error('Night audit history requires an internet connection')), { onlineOnly: true })
  }
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('get_night_audit_history', {
      p_lodge_id: currentLodgeId,
      p_limit: limit || 30
    })
    if (error) throw error
    return data
  } catch (e) {
    throw errorWithUnknownMessage(readThrownMessage(e) || 'Failed to load night audit history')
  }
}

/** @param {unknown} exceptionId @param {unknown} resolvedBy @param {unknown} notes @returns {Promise<unknown>} */
async function _resolveException(exceptionId, resolvedBy, notes) {
  requireOnline('Resolve night audit exception')
  const { data, error } = await supabaseForDomainRpc().rpc('resolve_exception', {
    p_exception_id: exceptionId,
    p_resolved_by: resolvedBy,
    p_notes: notes || null
  })
  if (error) throw error
  const resultView = /** @type {NightAuditPropertyView | null | undefined} */ (data)
  if (resultView?.success === false) throw errorWithUnknownMessage(resultView.error || 'Could not resolve exception')
  return data
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const runAuditChecks = (...args) => dedupePromise('runAuditChecks', () => _runAuditChecks())
/** @param {...unknown} args @returns {Promise<unknown>} */
export const closeNightAudit = (...args) => dedupePromise('closeNightAudit', () => _closeNightAudit(args[0], args[1], args[2]))
/** @param {...unknown} args @returns {Promise<unknown>} */
export const reopenNightAudit = (...args) => dedupePromise('reopenNightAudit', () => _reopenNightAudit(args[0], args[1], args[2]))
/** @param {...unknown} args @returns {Promise<unknown>} */
export const getNightAuditSummary = (...args) => dedupePromise('getNightAuditSummary', () => _getNightAuditSummary(args[0]))
/** @param {...unknown} args @returns {Promise<unknown>} */
export const getNightAuditHistory = (...args) => dedupePromise('getNightAuditHistory', () => _getNightAuditHistory(args[0]))
/** @param {...unknown} args @returns {Promise<unknown>} */
export const resolveException = (...args) => dedupePromise('resolveException', () => _resolveException(args[0], args[1], args[2]))

export { requireOnline as requireNightAuditOnline }
