import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'property-groups'

async function _getAllPropertyGroups() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_all_property_groups', {})
    if (error) throw error
    const groups = data?.groups || (Array.isArray(data) ? data : [])
    writeCache(CACHE_KEY, groups)
    return groups
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    if (Array.isArray(cached) && cached.length > 0) {
      const err = new Error(e?.message || 'Failed to load property groups; showing cached data')
      err.code = 'STALE_CACHE'
      err.cached = cached
      throw err
    }
    throw e
  }
}

export const getAllPropertyGroups = (...args) => dedupePromise('getAllPropertyGroups', () => _getAllPropertyGroups(...args))

export async function createPropertyGroup(data) {
  const { data: result, error } = await state.supabase.rpc('create_property_group', {
    p_name: data.name,
    p_description: data.description || '',
    p_central_office_address: data.central_office_address || '',
    p_central_office_contact: data.central_office_contact || ''
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not create property group')
  return result
}

export async function updatePropertyGroup(id, data) {
  const { data: result, error } = await state.supabase.rpc('update_property_group', {
    p_group_id: id,
    p_name: data.name || null,
    p_description: data.description || null,
    p_central_office_address: data.central_office_address || null,
    p_central_office_contact: data.central_office_contact || null
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not update property group')
  return result
}

export async function deletePropertyGroup(id) {
  const { data: result, error } = await state.supabase.rpc('delete_property_group', {
    p_group_id: id
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not delete property group')
  return result
}

export async function getGroupProperties(groupId) {
  const { data, error } = await state.supabase.rpc('get_group_properties', {
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export async function addPropertyToGroup(groupId, lodgeId, role) {
  const { data: result, error } = await state.supabase.rpc('add_property_to_group', {
    p_group_id: groupId,
    p_lodge_id: lodgeId,
    p_role: role || 'member'
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not add property to group')
  return result
}

export async function removePropertyFromGroup(groupId, lodgeId) {
  const { data: result, error } = await state.supabase.rpc('remove_property_from_group', {
    p_group_id: groupId,
    p_lodge_id: lodgeId
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not remove property from group')
  return result
}

export async function getGroupSettings(groupId) {
  const { data, error } = await state.supabase.rpc('get_group_settings', {
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export async function updateGroupSettings(groupId, key, value) {
  const { data: result, error } = await state.supabase.rpc('update_group_setting', {
    p_group_id: groupId,
    p_key: key,
    p_value: value
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not update group setting')
  return result
}

export async function getConsolidatedDashboard(groupId) {
  const { data, error } = await state.supabase.rpc('get_consolidated_dashboard', {
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export async function getConsolidatedOccupancyReport(groupId, startDate, endDate) {
  const { data, error } = await state.supabase.rpc('get_consolidated_occupancy_report', {
    p_group_id: groupId,
    p_start_date: startDate,
    p_end_date: endDate
  })
  if (error) throw error
  return data
}

export async function getConsolidatedFinancialSummary(groupId, startDate, endDate) {
  const { data, error } = await state.supabase.rpc('get_consolidated_financial_summary', {
    p_group_id: groupId,
    p_start_date: startDate,
    p_end_date: endDate
  })
  if (error) throw error
  return data
}

async function _getSharedGuestProfiles(groupId) {
  const { data, error } = await state.supabase.rpc('get_shared_guest_profiles', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export const getSharedGuestProfiles = (...args) => dedupePromise('getSharedGuestProfiles', () => _getSharedGuestProfiles(...args))

export async function shareGuestProfile(groupId, guestId, notes) {
  const { data: result, error } = await state.supabase.rpc('share_guest_profile', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId,
    p_guest_id: guestId,
    p_notes: notes || ''
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not share guest profile')
  return result
}

export async function unshareGuestProfile(groupId, guestId) {
  const { data: result, error } = await state.supabase.rpc('unshare_guest_profile', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId,
    p_guest_id: guestId
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not unshare guest profile')
  return result
}

async function _getSharedBlacklist(groupId) {
  const { data, error } = await state.supabase.rpc('get_shared_blacklist', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export const getSharedBlacklist = (...args) => dedupePromise('getSharedBlacklist', () => _getSharedBlacklist(...args))

export async function addBlacklistEntry(groupId, guestId, email, phone, reason) {
  const { data: result, error } = await state.supabase.rpc('add_blacklist_entry', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId,
    p_guest_id: guestId || null,
    p_guest_email: email || null,
    p_guest_phone: phone || null,
    p_reason: reason || ''
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not add blacklist entry')
  return result
}

export async function removeBlacklistEntry(groupId, entryId) {
  const { data: result, error } = await state.supabase.rpc('remove_blacklist_entry', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId,
    p_entry_id: entryId
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not remove blacklist entry')
  return result
}

async function _getSharedCorporateAccounts(groupId) {
  const { data, error } = await state.supabase.rpc('get_shared_corporate_accounts', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export const getSharedCorporateAccounts = (...args) => dedupePromise('getSharedCorporateAccounts', () => _getSharedCorporateAccounts(...args))

export async function shareCorporateAccount(groupId, corporateAccountId, shareLevel) {
  const { data: result, error } = await state.supabase.rpc('share_corporate_account', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId,
    p_corporate_account_id: corporateAccountId,
    p_share_level: shareLevel || 'read'
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not share corporate account')
  return result
}

export async function unshareCorporateAccount(groupId, corporateAccountId) {
  const { data: result, error } = await state.supabase.rpc('unshare_corporate_account', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId,
    p_corporate_account_id: corporateAccountId
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not unshare corporate account')
  return result
}

async function _getGroupMemberLodges(groupId) {
  const { data, error } = await state.supabase.rpc('get_group_member_lodges', {
    p_lodge_id: state.lodgeId,
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

export const getGroupMemberLodges = (...args) => dedupePromise('getGroupMemberLodges', () => _getGroupMemberLodges(...args))

/**
 * Switch active property. Fail closed: never update local lodge scope when the
 * server rejects the switch. Surfaces property isolation messaging on error.
 */
export async function switchActiveProperty(lodgeId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) {
    throw new Error('No active property selected. Cannot switch until the current property session is established.')
  }
  if (!lodgeId) {
    throw new Error('Target property is required for switch.')
  }
  if (String(lodgeId) === String(currentLodgeId)) {
    return {
      success: true,
      switched: false,
      lodge_id: currentLodgeId,
      message: 'Already on the selected property.'
    }
  }

  let result
  try {
    const { data, error } = await state.supabase.rpc('switch_active_property', {
      p_lodge_id: currentLodgeId,
      p_new_lodge_id: lodgeId
    })
    if (error) throw error
    result = data
  } catch (e) {
    const err = new Error(
      e?.message
      || 'Property switch failed. The active property was not changed (fail closed for lodge isolation).'
    )
    err.code = 'PROPERTY_SWITCH_FAILED'
    err.current_lodge_id = currentLodgeId
    err.target_lodge_id = lodgeId
    throw err
  }

  if (!result?.success) {
    const err = new Error(
      result?.error
      || 'Property switch was rejected. The active property was not changed to protect data isolation.'
    )
    err.code = 'PROPERTY_SWITCH_REJECTED'
    err.current_lodge_id = currentLodgeId
    err.target_lodge_id = lodgeId
    throw err
  }

  // Only update local state after authoritative success.
  const nextLodgeId = result.new_lodge_id || result.lodge_id || lodgeId
  if (nextLodgeId) {
    state.lodgeId = nextLodgeId
  }

  return {
    ...result,
    success: true,
    switched: true,
    previous_lodge_id: currentLodgeId,
    lodge_id: nextLodgeId,
    isolation_message: 'Property scope switched. All subsequent reads and writes use the selected lodge only.'
  }
}
