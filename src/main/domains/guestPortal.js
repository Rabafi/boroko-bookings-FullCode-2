// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CONFIG_CACHE = 'guest-portal-config'
const REQUESTS_CACHE = 'guest-portal-requests'

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // Preserve the existing unguarded RPC dereference if session/client setup is absent.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @typedef {Record<string, unknown>} GuestPortalPropertyView */
/** @typedef {Error & {code: string, cached: unknown[]}} StaleGuestPortalCacheError */

/** @param {unknown} value @param {Record<string, unknown>} [meta] @returns {unknown} */
function withMeta(value, meta = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { .../** @type {GuestPortalPropertyView} */ (value), ...meta }
  }
  return { data: value, ...meta }
}

/** @returns {Promise<unknown>} */
async function _getPortalConfig() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('get_guest_portal_config', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? /** @type {unknown[]} */ (data) : (data ? [/** @type {unknown} */ (data)] : [])
    const config = rows.length > 0 ? rows[0] : null
    writeCache(CONFIG_CACHE, config)
    return config
  } catch (e) {
    const cached = readCache(CONFIG_CACHE)
    const errorView = /** @type {GuestPortalPropertyView | null | undefined} */ (e)
    if (cached != null) {
      return withMeta(cached, {
        fromCache: true,
        stale: true,
        warning: errorView?.message || 'Could not refresh portal config; showing cached configuration'
      })
    }
    throw e
  }
}

/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getPortalConfig = (...args) => dedupePromise('getPortalConfig', () => _getPortalConfig())

/** @param {unknown} config @returns {Promise<unknown>} */
export async function updatePortalConfig(config) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('update_guest_portal_config', {
    p_lodge_id: currentLodgeId,
    p_config: config
  })
  if (error) throw error
  const resultView = /** @type {GuestPortalPropertyView | null | undefined} */ (result)
  if (resultView?.success === false) throw new Error(String(resultView.error || 'Could not update portal config'))
  writeCache(CONFIG_CACHE, null)
  return result
}

/** @param {unknown} email @param {unknown} bookingRef @returns {Promise<unknown>} */
export async function createPortalSession(email, bookingRef) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!email || !String(email).trim()) throw new Error('Guest email is required')
  const { data, error } = await supabaseForDomainRpc().rpc('create_guest_portal_session', {
    p_customer_email: email,
    p_booking_reference: bookingRef || '',
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  const response = /** @type {GuestPortalPropertyView | null | undefined} */ (data)
  if (response?.success === false) throw new Error(String(response.error || 'Could not create portal session'))
  return data
}

/** @param {unknown} token @returns {Promise<Record<string, unknown>>} */
export async function validatePortalSession(token) {
  if (!token || !String(token).trim()) {
    return { success: false, error: 'No session token provided' }
  }
  const { data, error } = await supabaseForDomainRpc().rpc('validate_guest_portal_session', {
    p_token: token
  })
  if (error) throw error
  const response = /** @type {GuestPortalPropertyView | null | undefined} */ (data)
  if (!response || response.success === false) {
    return {
      success: false,
      error: response?.error || 'Invalid or expired session'
    }
  }
  return { success: true, ...response }
}

/** @param {unknown} token @param {unknown} requestType @param {unknown} payload @returns {Promise<unknown>} */
export async function submitPortalRequest(token, requestType, payload) {
  if (!token) throw new Error('Session token is required')
  if (!requestType) throw new Error('Request type is required')
  const { data, error } = await supabaseForDomainRpc().rpc('submit_guest_portal_request', {
    p_token: token,
    p_request_type: requestType,
    p_payload: payload || {}
  })
  if (error) throw error
  const response = /** @type {GuestPortalPropertyView | null | undefined} */ (data)
  if (response?.success === false) throw new Error(String(response.error || 'Could not submit portal request'))
  return data
}

/** @param {unknown} token @returns {Promise<unknown>} */
export async function getPortalBookingDetails(token) {
  if (!token) throw new Error('Session token is required')
  const { data, error } = await supabaseForDomainRpc().rpc('get_guest_portal_booking_details', {
    p_token: token
  })
  if (error) throw error
  const response = /** @type {GuestPortalPropertyView | null | undefined} */ (data)
  if (response?.success === false) throw new Error(String(response.error || 'Could not load booking details'))
  return data
}

/** @param {unknown} token @returns {Promise<unknown>} */
export async function getPortalDocuments(token) {
  if (!token) throw new Error('Session token is required')
  const { data, error } = await supabaseForDomainRpc().rpc('get_guest_portal_documents', {
    p_token: token
  })
  if (error) throw error
  const response = /** @type {GuestPortalPropertyView | null | undefined} */ (data)
  if (response?.success === false) throw new Error(String(response.error || 'Could not load documents'))
  return data
}

/** @returns {Promise<unknown>} */
async function _getPendingRequests() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('get_pending_guest_portal_requests', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const response = /** @type {GuestPortalPropertyView | null | undefined} */ (data)
    const rows = Array.isArray(data) ? /** @type {unknown[]} */ (data) : (response?.requests || [])
    writeCache(REQUESTS_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(REQUESTS_CACHE)
    const errorView = /** @type {GuestPortalPropertyView | null | undefined} */ (e)
    if (Array.isArray(cached) && cached.length > 0) {
      const err = /** @type {StaleGuestPortalCacheError} */ (new Error(String(errorView?.message || 'Failed to load pending requests; showing cached data')))
      err.code = 'STALE_CACHE'
      err.cached = /** @type {unknown[]} */ (cached)
      throw err
    }
    throw e
  }
}

/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getPendingRequests = (...args) => dedupePromise('getPendingRequests', () => _getPendingRequests())
