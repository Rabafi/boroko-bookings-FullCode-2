import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) {
    const err = new Error('Asset registry requires an internet connection')
    err.onlineOnly = true
    throw err
  }
}

const ASSETS_CACHE = 'property-assets'
const VENDORS_CACHE = 'maintenance-vendors'

// ── Assets ──────────────────────────────────────────────────────────────────
async function _getPropertyAssets(assetType, status) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_property_assets', {
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
export const getPropertyAssets = (...args) => dedupePromise('getPropertyAssets', () => _getPropertyAssets(...args))

export async function createPropertyAsset(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_property_asset', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updatePropertyAsset(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_property_asset', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deletePropertyAsset(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_property_asset', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

async function _getAssetMaintenanceHistory(assetId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_maintenance_history', {
      p_asset_id: assetId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    return data || []
  } catch (e) {
    return []
  }
}
export const getAssetMaintenanceHistory = (...args) => dedupePromise('getAssetMaintenanceHistory', () => _getAssetMaintenanceHistory(...args))

export async function logAssetMaintenance(assetId, maintenanceTicketId, description, cost, vendorId) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('log_asset_maintenance', {
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
async function _getMaintenanceVendors(specialisation) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_maintenance_vendors', {
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
export const getMaintenanceVendors = (...args) => dedupePromise('getMaintenanceVendors', () => _getMaintenanceVendors(...args))

export async function createMaintenanceVendor(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_maintenance_vendor', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updateMaintenanceVendor(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_maintenance_vendor', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteMaintenanceVendor(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_maintenance_vendor', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}
