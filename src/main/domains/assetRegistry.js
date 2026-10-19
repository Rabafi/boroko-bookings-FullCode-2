// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

/** @typedef {Error & {onlineOnly: boolean}} AssetRegistryOnlineError */

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // The existing RPC paths dereference this client without a null guard.
  // It is created by authClients.applyBackendSession or infrastructure.initializeSupabase;
  // if either setup path has not run, this view preserves the same native TypeError.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

function requireOnline() {
  if (!state.isOnline) {
    const err = /** @type {AssetRegistryOnlineError} */ (new Error('Asset registry requires an internet connection'))
    err.onlineOnly = true
    throw err
  }
}

const ASSETS_CACHE = 'property-assets'
const VENDORS_CACHE = 'maintenance-vendors'

// ── Assets ──────────────────────────────────────────────────────────────────
/** @param {unknown} assetType @param {unknown} status @returns {Promise<unknown>} */
async function _getPropertyAssets(assetType, status) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('get_property_assets', {
      p_lodge_id: currentLodgeId,
      p_asset_type: assetType || null,
      p_status: status || null
    })
    if (error) throw error
    writeCache(ASSETS_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(ASSETS_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
/** @param {unknown[]} args @returns {Promise<unknown>} */
export const getPropertyAssets = (...args) => dedupePromise('getPropertyAssets', () => _getPropertyAssets(args[0], args[1]))

/** @param {unknown} data @returns {Promise<unknown>} */
export async function createPropertyAsset(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('create_property_asset', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {unknown} id @param {unknown} data @returns {Promise<unknown>} */
export async function updatePropertyAsset(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('update_property_asset', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function deletePropertyAsset(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('delete_property_asset', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

/** @param {unknown} assetId @returns {Promise<unknown>} */
async function _getAssetMaintenanceHistory(assetId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('get_asset_maintenance_history', {
      p_asset_id: assetId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    return data || []
  } catch (e) {
    return []
  }
}
/** @param {unknown[]} args @returns {Promise<unknown>} */
export const getAssetMaintenanceHistory = (...args) => dedupePromise('getAssetMaintenanceHistory', () => _getAssetMaintenanceHistory(args[0]))

/** @param {unknown} assetId @param {unknown} maintenanceTicketId @param {unknown} description @param {unknown} cost @param {unknown} vendorId @returns {Promise<unknown>} */
export async function logAssetMaintenance(assetId, maintenanceTicketId, description, cost, vendorId) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('log_asset_maintenance', {
    p_lodge_id: currentLodgeId,
    p_asset_id: assetId,
    p_maintenance_ticket_id: maintenanceTicketId || null,
    p_description: description || null,
    p_cost: cost || 0,
    p_vendor_id: vendorId || null
  })
  if (error) throw error
  return result
}

// ── Vendors ─────────────────────────────────────────────────────────────────
/** @param {unknown} specialisation @returns {Promise<unknown>} */
async function _getMaintenanceVendors(specialisation) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await supabaseForDomainRpc().rpc('get_maintenance_vendors', {
      p_lodge_id: currentLodgeId,
      p_specialisation: specialisation || null
    })
    if (error) throw error
    writeCache(VENDORS_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(VENDORS_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
/** @param {unknown[]} args @returns {Promise<unknown>} */
export const getMaintenanceVendors = (...args) => dedupePromise('getMaintenanceVendors', () => _getMaintenanceVendors(args[0]))

/** @param {unknown} data @returns {Promise<unknown>} */
export async function createMaintenanceVendor(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('create_maintenance_vendor', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {unknown} id @param {unknown} data @returns {Promise<unknown>} */
export async function updateMaintenanceVendor(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('update_maintenance_vendor', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function deleteMaintenanceVendor(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await supabaseForDomainRpc().rpc('delete_maintenance_vendor', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}
