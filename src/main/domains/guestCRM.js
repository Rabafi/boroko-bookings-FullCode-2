import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const VIP_CACHE = 'guest-crm-vip-list'
const NOTES_CACHE_PREFIX = 'guest-crm-notes:'

export async function getGuestCRMProfile(customerId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  if (!customerId) throw new Error('Customer id is required')
  const { data, error } = await state.supabase.rpc('get_guest_crm_profile', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'CRM profile not found')

  // Attach notes when available (RPC or empty list — never silent).
  let notes = []
  let notesError = null
  try {
    notes = await listGuestNotes(customerId)
  } catch (e) {
    notesError = e?.message || 'Could not load CRM notes'
    notes = []
  }

  return {
    ...(data && typeof data === 'object' ? data : { profile: data }),
    notes,
    notesError
  }
}

export async function updateGuestCRMProfile(customerId, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!customerId) throw new Error('Customer id is required')
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
  if (!customerId) throw new Error('Customer id is required')
  const { data: result, error } = await state.supabase.rpc('set_vip_level', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_level: level,
    p_approved_by: approvedBy || state.user?.id || null
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not set VIP level')
  return result
}

export async function addGuestPreference(customerId, key, value) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!customerId) throw new Error('Customer id is required')
  if (!key || !String(key).trim()) throw new Error('Preference key is required')
  const { data: result, error } = await state.supabase.rpc('add_guest_preference', {
    p_customer_id: customerId,
    p_lodge_id: currentLodgeId,
    p_preference_key: key,
    p_preference_value: value == null ? '' : String(value)
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not add preference')
  return result
}

export async function setBlacklistStatus(customerId, blacklisted, reason) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!customerId) throw new Error('Customer id is required')
  if (blacklisted && !String(reason || '').trim()) {
    throw new Error('A reason is required when blacklisting a guest')
  }
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
  if (!customerId) throw new Error('Customer id is required')
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
  if (!customerId) throw new Error('Customer id is required')
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
  return data?.results || (Array.isArray(data) ? data : [])
}

async function _getVIPList() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_vip_list', { p_lodge_id: currentLodgeId })
  if (error) throw error
  const list = data?.vip_list || (Array.isArray(data) ? data : [])
  writeCache(VIP_CACHE, list)
  return list
}

export const getVIPList = (...args) => dedupePromise('getVIPList', () => _getVIPList(...args))

/**
 * List CRM notes for a guest.
 * Prefers dedicated RPC; falls back to enterprise_guest_crm_notes via RPC-shaped payload.
 * Never swallows errors into empty success without signalling.
 */
export async function listGuestNotes(customerId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  if (!customerId) throw new Error('Customer id is required')

  // Preferred RPC (may exist on newer deployments).
  try {
    const { data, error } = await state.supabase.rpc('get_guest_crm_notes', {
      p_customer_id: customerId,
      p_lodge_id: currentLodgeId
    })
    if (!error) {
      const notes = Array.isArray(data) ? data : (data?.notes || [])
      writeCache(NOTES_CACHE_PREFIX + customerId, notes)
      return notes
    }
    // Fall through on missing function
    if (!/function|does not exist|404|PGRST202/i.test(String(error.message || ''))) {
      throw error
    }
  } catch (e) {
    if (!/function|does not exist|404|PGRST202/i.test(String(e?.message || ''))) {
      throw e
    }
  }

  // Table read fallback through PostgREST (RLS may deny; surface that).
  const { data, error } = await state.supabase
    .from('enterprise_guest_crm_notes')
    .select('*')
    .eq('lodge_id', currentLodgeId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  const notes = Array.isArray(data) ? data : []
  writeCache(NOTES_CACHE_PREFIX + customerId, notes)
  return notes
}

export async function addGuestNote(customerId, noteText, noteType = 'general') {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!customerId) throw new Error('Customer id is required')
  const text = String(noteText || '').trim()
  if (!text) throw new Error('Note text is required')

  const payload = {
    text,
    author_id: state.user?.id || null,
    author_name: state.user?.name || state.user?.email || null
  }

  try {
    const { data: result, error } = await state.supabase.rpc('add_guest_crm_note', {
      p_customer_id: customerId,
      p_lodge_id: currentLodgeId,
      p_note_type: noteType || 'general',
      p_payload: payload
    })
    if (!error) {
      if (result?.success === false) throw new Error(result.error || 'Could not add note')
      return result
    }
    if (!/function|does not exist|404|PGRST202/i.test(String(error.message || ''))) {
      throw error
    }
  } catch (e) {
    if (!/function|does not exist|404|PGRST202/i.test(String(e?.message || ''))) {
      throw e
    }
  }

  const { data, error } = await state.supabase
    .from('enterprise_guest_crm_notes')
    .insert({
      lodge_id: currentLodgeId,
      customer_id: customerId,
      note_type: noteType || 'general',
      visibility: 'staff',
      payload
    })
    .select()
    .single()

  if (error) throw error
  return { success: true, note: data }
}
