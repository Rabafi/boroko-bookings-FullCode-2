import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const VIP_CACHE = 'guest-crm-vip-list'

export async function getGuestCRMProfile(customerId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  const { data, error } = await state.supabase.rpc('get_guest_crm_profile', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

export async function updateGuestCRMProfile(customerId, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_guest_crm_profile', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_data: data
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not update CRM profile')
  return result
}

export async function setVipLevel(customerId, level, approvedBy) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('set_vip_level', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_level: level,
    p_approved_by: approvedBy || null
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not set VIP level')
  return result
}

export async function addGuestPreference(customerId, key, value) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('add_guest_preference', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_preference_key: key,
    p_preference_value: value
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not add preference')
  return result
}

export async function setBlacklistStatus(customerId, blacklisted, reason) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('set_blacklist_status', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_blacklisted: blacklisted,
    p_reason: reason || ''
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not set blacklist status')
  return result
}

export async function getGuestStayHistory(customerId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_guest_stay_history', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function recordGuestConsent(customerId, consentType, granted, ipAddress) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('record_guest_consent', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_consent_type: consentType,
    p_granted: granted,
    p_ip_address: ipAddress || ''
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not record consent')
  return result
}

export async function searchGuestsCRM(query) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('search_guests_crm', {
    p_lodge_id: currentLodgeId,
    p_search: query || ''
  })
  if (error) throw error
  return data?.results || []
}

async function _getVIPList() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_vip_list', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const list = data?.vip_list || []
    writeCache(VIP_CACHE, list)
    return list
  } catch (e) {
    const cached = readCache(VIP_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getVIPList = (...args) => dedupePromise('getVIPList', () => _getVIPList(...args))
