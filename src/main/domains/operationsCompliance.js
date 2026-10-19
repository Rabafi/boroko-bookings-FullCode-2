// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

// ── Linen & Laundry Enhanced ─────────────────────────────────────────────────
/** @param {unknown} items @param {unknown} [lodgeIdArg] */
export async function createLinenStocktake(items, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('create_linen_stocktake', {
    p_lodge_id: currentLodgeId,
    p_items: items
  })
  if (error) throw error
  return data
}

const LINEN_DASHBOARD_CACHE = 'linen-dashboard'

/** @param {...unknown} _args */
async function _getLinenDashboard(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_linen_dashboard', { p_lodge_id: currentLodgeId })
    if (error) throw error
    writeCache(LINEN_DASHBOARD_CACHE, data)
    return data
  } catch (e) {
    return readCache(LINEN_DASHBOARD_CACHE) || null
  }
}

/** @param {...unknown} args */
export const getLinenDashboard = (...args) => dedupePromise('getLinenDashboard', () => _getLinenDashboard(...args))

/** @param {unknown} itemId @param {unknown} quantity @param {unknown} reason @param {unknown} [lodgeIdArg] */
export async function reportDamagedLinen(itemId, quantity, reason, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('report_damaged_linen', {
    p_item_id: itemId,
    p_lodge_id: currentLodgeId,
    p_quantity: quantity,
    p_reason: reason
  })
  if (error) throw error
  return data
}

/** @param {unknown} bookingId @param {unknown} linenItemId @param {unknown} quantity @param {unknown} amount @param {unknown} [lodgeIdArg] */
export async function chargeDamagedLinen(bookingId, linenItemId, quantity, amount, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('charge_damaged_linen_to_booking', {
    p_lodge_id: currentLodgeId,
    p_booking_id: bookingId,
    p_linen_item_id: linenItemId,
    p_quantity: quantity,
    p_amount: amount
  })
  if (error) throw error
  return data
}

// ── Lost & Found Enhanced ────────────────────────────────────────────────────
/** @param {unknown} itemId @param {unknown} claimerName @param {unknown} claimerContact @param {unknown} disposition @param {unknown} [lodgeIdArg] */
export async function claimLostFoundItem(itemId, claimerName, claimerContact, disposition, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('claim_lost_found_item', {
    p_item_id: itemId,
    p_lodge_id: currentLodgeId,
    p_claimer_name: claimerName,
    p_claimer_contact: claimerContact,
    p_disposition: disposition
  })
  if (error) throw error
  return data
}

const LOST_FOUND_DASHBOARD_CACHE = 'lost-found-dashboard'

/** @param {...unknown} _args */
async function _getLostFoundDashboard(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_lost_found_dashboard', { p_lodge_id: currentLodgeId })
    if (error) throw error
    writeCache(LOST_FOUND_DASHBOARD_CACHE, data)
    return data
  } catch (e) {
    return readCache(LOST_FOUND_DASHBOARD_CACHE) || null
  }
}

/** @param {...unknown} args */
export const getLostFoundDashboard = (...args) => dedupePromise('getLostFoundDashboard', () => _getLostFoundDashboard(...args))

// ── Incident Log Enhanced ─────────────────────────────────────────────────────
/** @param {unknown} id @param {unknown} resolution @param {unknown} resolvedBy @param {unknown} [lodgeIdArg] */
export async function resolveIncident(id, resolution, resolvedBy, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('resolve_incident', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_resolution: resolution,
    p_resolved_by: resolvedBy
  })
  if (error) throw error
  return data
}

const INCIDENT_DASHBOARD_CACHE = 'incident-dashboard'

/** @param {...unknown} _args */
async function _getIncidentDashboard(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_incident_dashboard', { p_lodge_id: currentLodgeId })
    if (error) throw error
    writeCache(INCIDENT_DASHBOARD_CACHE, data)
    return data
  } catch (e) {
    const cached = readCache(INCIDENT_DASHBOARD_CACHE)
    if (cached != null) {
      const cachedFields = /** @type {Record<string, unknown>} */ (cached)
      const caught = /** @type {Record<string, unknown> | null | undefined} */ (e)
      return { ...cachedFields, fromCache: true, stale: true, warning: caught?.message || 'Showing cached incident dashboard' }
    }
    throw e
  }
}

/** @param {...unknown} args */
export const getIncidentDashboard = (...args) => dedupePromise('getIncidentDashboard', () => _getIncidentDashboard(...args))

// ── Visitor Register Enhanced ────────────────────────────────────────────────
const VISITOR_DASHBOARD_CACHE = 'visitor-dashboard'

/** @param {...unknown} _args */
async function _getVisitorDashboard(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_visitor_dashboard', { p_lodge_id: currentLodgeId })
    if (error) throw error
    writeCache(VISITOR_DASHBOARD_CACHE, data)
    return data
  } catch (e) {
    const cached = readCache(VISITOR_DASHBOARD_CACHE)
    if (cached != null) {
      const cachedFields = /** @type {Record<string, unknown>} */ (cached)
      const caught = /** @type {Record<string, unknown> | null | undefined} */ (e)
      return { ...cachedFields, fromCache: true, stale: true, warning: caught?.message || 'Showing cached visitor dashboard' }
    }
    throw e
  }
}

/** @param {...unknown} args */
export const getVisitorDashboard = (...args) => dedupePromise('getVisitorDashboard', () => _getVisitorDashboard(...args))

/** @param {unknown} startDate @param {unknown} endDate @param {unknown} [lodgeIdArg] */
export async function getVisitorHistory(startDate, endDate, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_visitor_history', {
    p_lodge_id: currentLodgeId,
    p_start_date: startDate,
    p_end_date: endDate
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// ── Emergency List ───────────────────────────────────────────────────────────
const EVACUATION_CACHE = 'evacuation-list'

/** @param {...unknown} _args */
async function _getEvacuationList(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_evacuation_list', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(EVACUATION_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(EVACUATION_CACHE)
    if (Array.isArray(cached) && cached.length > 0) {
      const caught = /** @type {Record<string, unknown> | null | undefined} */ (e)
      // Error's runtime constructor coerces any supplied value to a message; retain that existing behavior.
      const message = /** @type {string} */ (caught?.message || 'Failed to load evacuation list; showing cached data')
      const err = /** @type {Error & { code: string, cached: unknown }} */ (new Error(message))
      err.code = 'STALE_CACHE'
      err.cached = cached
      throw err
    }
    throw e
  }
}

/** @param {...unknown} args */
export const getEvacuationList = (...args) => dedupePromise('getEvacuationList', () => _getEvacuationList(...args))

/** @param {unknown} [lodgeIdArg] */
export async function exportEvacuationReport(lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('export_evacuation_report', { p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

// ── Shift Handover ───────────────────────────────────────────────────────────
const SHIFT_HANDOVER_CACHE = 'shift-handover-logs'

/** @param {...unknown} _args */
async function _getShiftHandoverHistory(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('get_shift_handover_history', { p_lodge_id: currentLodgeId, p_limit: 50 })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(SHIFT_HANDOVER_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(SHIFT_HANDOVER_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args */
export const getShiftHandoverHistory = (...args) => dedupePromise('getShiftHandoverHistory', () => _getShiftHandoverHistory(...args))

/** @param {unknown} data @param {unknown} [lodgeIdArg] */
export async function createComplianceShiftHandover(data, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('create_shift_handover', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {unknown} id @param {unknown} [lodgeIdArg] */
export async function completeShiftHandover(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await (/** @type {NonNullable<typeof state.supabase>} */ (state.supabase)).rpc('complete_shift_handover', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}
