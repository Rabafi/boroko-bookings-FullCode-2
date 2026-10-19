// @ts-check
import { state } from '../state.js'
import { dedupePromise } from './cacheStore.js'

/** @typedef {'get_hotel_role_templates' | 'get_role_capabilities'} HotelRolesRpcName */
/** @typedef {{ get_hotel_role_templates: {}; get_role_capabilities: { p_role_key: string } }} HotelRolesRpcArgs */

/**
 * @template {HotelRolesRpcName} Name
 * @param {Name} fn
 * @param {HotelRolesRpcArgs[Name]} args
 * @returns {Promise<unknown>}
 */
async function callRolesRpc(fn, args) {
  // Both private callers synchronously guard state.supabase before invoking
  // this helper; this assertion adds no runtime check or fallback behavior.
  const client = /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
  const { data, error } = await client.rpc(fn, args)
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Hotel roles operation failed')
  return data
}

/** @returns {Promise<unknown[]>} */
async function _getHotelRoleTemplates() {
  if (!state.supabase) return []
  try {
    const data = await callRolesRpc('get_hotel_role_templates', {})
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** @returns {Promise<unknown[]>} */
export function getHotelRoleTemplates() {
  return dedupePromise('hotelRoles:templates', () => _getHotelRoleTemplates())
}

/** @param {string} roleKey @returns {Promise<unknown[]>} */
async function _getRoleCapabilities(roleKey) {
  if (!state.supabase) return []
  try {
    const data = await callRolesRpc('get_role_capabilities', { p_role_key: roleKey })
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** @param {string} roleKey @returns {Promise<unknown[]>} */
export function getRoleCapabilities(roleKey) {
  return dedupePromise(`hotelRoles:capabilities:${roleKey}`, () => _getRoleCapabilities(roleKey))
}
