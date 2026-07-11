import { state } from '../state.js'
import { dedupePromise } from './cacheStore.js'

async function callRolesRpc(fn, args) {
  const { data, error } = await state.supabase.rpc(fn, args)
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Hotel roles operation failed')
  return data
}

async function _getHotelRoleTemplates() {
  if (!state.supabase) return []
  try {
    const data = await callRolesRpc('get_hotel_role_templates', {})
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function getHotelRoleTemplates() {
  return dedupePromise('hotelRoles:templates', () => _getHotelRoleTemplates())
}

async function _getRoleCapabilities(roleKey) {
  if (!state.supabase) return []
  try {
    const data = await callRolesRpc('get_role_capabilities', { p_role_key: roleKey })
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function getRoleCapabilities(roleKey) {
  return dedupePromise(`hotelRoles:capabilities:${roleKey}`, () => _getRoleCapabilities(roleKey))
}
