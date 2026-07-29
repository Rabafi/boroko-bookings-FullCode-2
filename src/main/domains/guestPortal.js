import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CONFIG_CACHE = 'guest-portal-config'
const REQUESTS_CACHE = 'guest-portal-requests'

function withMeta(value, meta = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value, ...meta }
  }
  return { data: value, ...meta }
}

async function _getPortalConfig() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_guest_portal_config', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : (data ? [data] : [])
    const config = rows.length > 0 ? rows[0] : null
    writeCache(CONFIG_CACHE, config)
    return config
  } catch (e) {
    const cached = readCache(CONFIG_CACHE)
    if (cached != null) {
      return withMeta(cached, {
        fromCache: true,
        stale: true,
        warning: e?.message || 'Could not refresh portal config; showing cached configuration'
      })
    }
    throw e
  }
}

export const getPortalConfig = (...args) => dedupePromise('getPortalConfig', () => _getPortalConfig(...args))

export async function updatePortalConfig(config) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_guest_portal_config', {
    p_lodge_id: currentLodgeId,
    p_config: config
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not update portal config')
  writeCache(CONFIG_CACHE, null)
  return result
}

export async function createPortalSession(email, bookingRef) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!email || !String(email).trim()) throw new Error('Guest email is required')
  const { data, error } = await state.supabase.rpc('create_guest_portal_session', {
    p_customer_email: email,
    p_booking_reference: bookingRef || '',
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not create portal session')
  return data
}

export async function validatePortalSession(token) {
  if (!token || !String(token).trim()) {
    return { success: false, error: 'No session token provided' }
  }
  const { data, error } = await state.supabase.rpc('validate_guest_portal_session', {
    p_token: token
  })
  if (error) throw error
  if (!data || data.success === false) {
    return {
      success: false,
      error: data?.error || 'Invalid or expired session'
    }
  }
  return { success: true, ...data }
}

export async function submitPortalRequest(token, requestType, payload) {
  if (!token) throw new Error('Session token is required')
  if (!requestType) throw new Error('Request type is required')
  const { data, error } = await state.supabase.rpc('submit_guest_portal_request', {
    p_token: token,
    p_request_type: requestType,
    p_payload: payload || {}
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not submit portal request')
  return data
}

export async function getPortalBookingDetails(token) {
  if (!token) throw new Error('Session token is required')
  const { data, error } = await state.supabase.rpc('get_guest_portal_booking_details', {
    p_token: token
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not load booking details')
  return data
}

export async function getPortalDocuments(token) {
  if (!token) throw new Error('Session token is required')
  const { data, error } = await state.supabase.rpc('get_guest_portal_documents', {
    p_token: token
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not load documents')
  return data
}

async function _getPendingRequests() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_pending_guest_portal_requests', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : (data?.requests || [])
    writeCache(REQUESTS_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(REQUESTS_CACHE)
    if (Array.isArray(cached) && cached.length > 0) {
      const err = new Error(e?.message || 'Failed to load pending requests; showing cached data')
      err.code = 'STALE_CACHE'
      err.cached = cached
      throw err
    }
    throw e
  }
}

export const getPendingRequests = (...args) => dedupePromise('getPendingRequests', () => _getPendingRequests(...args))
