import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) {
    const err = new Error('Asset management requires an internet connection')
    err.onlineOnly = true
    throw err
  }
}

const CATEGORIES_CACHE = 'asset-categories'
const WARRANTIES_CACHE = 'asset-warranties'
const INSPECTIONS_CACHE = 'asset-inspections'
const ATTACHMENTS_CACHE = 'asset-attachments'
const COSTS_CACHE = 'asset-costs'
const COST_SUMMARY_CACHE = 'asset-cost-summary'
const TEMPLATES_CACHE = 'preventive-templates'
const ASSIGNMENTS_CACHE = 'preventive-assignments'
const DASHBOARD_CACHE = 'asset-dashboard'

// ── Categories ───────────────────────────────────────────────────────────
async function _getAssetCategories() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_categories', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(CATEGORIES_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(CATEGORIES_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getAssetCategories = (...args) => dedupePromise('getAssetCategories', () => _getAssetCategories(...args))

export async function createAssetCategory(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_asset_category', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updateAssetCategory(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_asset_category', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteAssetCategory(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_asset_category', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

// ── Warranties ───────────────────────────────────────────────────────────
async function _getAssetWarranties(assetId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_warranties', {
      p_lodge_id: currentLodgeId,
      p_asset_id: assetId || null
    })
    if (error) throw error
    writeCache(WARRANTIES_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(WARRANTIES_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getAssetWarranties = (...args) => dedupePromise('getAssetWarranties', () => _getAssetWarranties(...args))

export async function createAssetWarranty(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_asset_warranty', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updateAssetWarranty(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_asset_warranty', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteAssetWarranty(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_asset_warranty', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

// ── Inspections ──────────────────────────────────────────────────────────
async function _getAssetInspections(assetId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_inspections', {
      p_lodge_id: currentLodgeId,
      p_asset_id: assetId || null
    })
    if (error) throw error
    writeCache(INSPECTIONS_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(INSPECTIONS_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getAssetInspections = (...args) => dedupePromise('getAssetInspections', () => _getAssetInspections(...args))

export async function createAssetInspection(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_asset_inspection', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteAssetInspection(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_asset_inspection', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

// ── Attachments ──────────────────────────────────────────────────────────
async function _getAssetAttachments(assetId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_attachments', {
      p_lodge_id: currentLodgeId,
      p_asset_id: assetId || null
    })
    if (error) throw error
    writeCache(ATTACHMENTS_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(ATTACHMENTS_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getAssetAttachments = (...args) => dedupePromise('getAssetAttachments', () => _getAssetAttachments(...args))

export async function createAssetAttachment(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_asset_attachment', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteAssetAttachment(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_asset_attachment', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

// ── Costs ────────────────────────────────────────────────────────────────
async function _getAssetCosts(assetId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_costs', {
      p_lodge_id: currentLodgeId,
      p_asset_id: assetId || null
    })
    if (error) throw error
    writeCache(COSTS_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(COSTS_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getAssetCosts = (...args) => dedupePromise('getAssetCosts', () => _getAssetCosts(...args))

export async function recordAssetCost(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('record_asset_cost', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

async function _getAssetCostSummary(startDate, endDate) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_asset_cost_summary', {
      p_lodge_id: currentLodgeId,
      p_start_date: startDate || null,
      p_end_date: endDate || null
    })
    if (error) throw error
    writeCache(COST_SUMMARY_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(COST_SUMMARY_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getAssetCostSummary = (...args) => dedupePromise('getAssetCostSummary', () => _getAssetCostSummary(...args))

// ── Preventive Templates ─────────────────────────────────────────────────
async function _getPreventiveTemplates(categoryId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_preventive_templates', {
      p_lodge_id: currentLodgeId,
      p_category_id: categoryId || null
    })
    if (error) throw error
    writeCache(TEMPLATES_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(TEMPLATES_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getPreventiveTemplates = (...args) => dedupePromise('getPreventiveTemplates', () => _getPreventiveTemplates(...args))

export async function createPreventiveTemplate(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_preventive_template', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updatePreventiveTemplate(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_preventive_template', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deletePreventiveTemplate(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_preventive_template', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

// ── Preventive Assignments ───────────────────────────────────────────────
async function _getPreventiveAssignments(assetId, status) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_preventive_assignments', {
      p_lodge_id: currentLodgeId,
      p_asset_id: assetId || null,
      p_status: status || null
    })
    if (error) throw error
    writeCache(ASSIGNMENTS_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(ASSIGNMENTS_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getPreventiveAssignments = (...args) => dedupePromise('getPreventiveAssignments', () => _getPreventiveAssignments(...args))

export async function createPreventiveAssignment(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_preventive_assignment', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function completePreventiveAssignment(id, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('complete_preventive_assignment', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_notes: notes || null
  })
  if (error) throw error
  return result
}

export async function skipPreventiveAssignment(id, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('skip_preventive_assignment', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_notes: notes || null
  })
  if (error) throw error
  return result
}

export async function generatePreventiveAssignments() {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('generate_preventive_assignments', {
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

// ── Dashboard ────────────────────────────────────────────────────────────
async function _getAssetDashboard() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_asset_dashboard', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(DASHBOARD_CACHE, data || null)
    return data || null
  } catch (e) {
    const cached = readCache(DASHBOARD_CACHE)
    if (cached) return cached
    return null
  }
}
export const getAssetDashboard = (...args) => dedupePromise('getAssetDashboard', () => _getAssetDashboard(...args))

// ── Sellability ──────────────────────────────────────────────────────────
export async function setAssetRoomSellability(assetId, affectsSellability, sellabilityNotes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('set_asset_room_sellability', {
    p_lodge_id: currentLodgeId,
    p_asset_id: assetId,
    p_affects_sellability: affectsSellability,
    p_sellability_notes: sellabilityNotes || null
  })
  if (error) throw error
  return result
}
