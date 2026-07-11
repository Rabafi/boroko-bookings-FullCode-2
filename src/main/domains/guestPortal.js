import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CONFIG_CACHE = 'guest-portal-config'
const REQUESTS_CACHE = 'guest-portal-requests'

async function _getPortalConfig() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_guest_portal_config', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    const config = rows.length > 0 ? rows[0] : null
    writeCache(CONFIG_CACHE, config)
    return config
  } catch (e) {
    return readCache(CONFIG_CACHE) || null
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
  return result
}

export async function createPortalSession(email, bookingRef) {
  const { data, error } = await state.supabase.rpc('create_guest_portal_session', {
    p_customer_email: email,
    p_booking_reference: bookingRef || ''
  })
  if (error) throw error
  return data
}

export async function validatePortalSession(token) {
  const { data, error } = await state.supabase.rpc('validate_guest_portal_session', {
    p_token: token
  })
  if (error) throw error
  return data
}

export async function submitPortalRequest(token, requestType, payload) {
  const { data, error } = await state.supabase.rpc('submit_guest_portal_request', {
    p_token: token,
    p_request_type: requestType,
    p_payload: payload || {}
  })
  if (error) throw error
  return data
}

export async function getPortalBookingDetails(token) {
  const { data, error } = await state.supabase.rpc('get_guest_portal_booking_details', {
    p_token: token
  })
  if (error) throw error
  return data
}

export async function getPortalDocuments(token) {
  const { data, error } = await state.supabase.rpc('get_guest_portal_documents', {
    p_token: token
  })
  if (error) throw error
  return data
}

async function _getPendingRequests() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_pending_guest_portal_requests', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(REQUESTS_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(REQUESTS_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getPendingRequests = (...args) => dedupePromise('getPendingRequests', () => _getPendingRequests(...args))
