import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const MODULE_KEY = 'venue_management'
const CACHE_LEADS = 'event-leads'
const CACHE_RULES = 'venue-availability-rules'
const CACHE_RUN_SHEETS = 'run-sheets'
const CACHE_SUPPLIERS = 'supplier-coordination'
const CACHE_MILESTONES = 'deposit-milestones'
const CACHE_SETTLEMENTS = 'event-settlements'

function requireOnline() {
  if (!state.isOnline) {
    const err = new Error('Venue management requires an internet connection')
    err.onlineOnly = true
    throw err
  }
}

function readCached(key) {
  try { return readCache(key) || [] } catch { return [] }
}

function writeCached(key, data, meta) {
  try { writeCache(key, data, meta) } catch {}
}

// ── Leads ─────────────────────────────────────────────────────────────────

async function _getEventLeads(status) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_event_leads', {
      p_lodge_id: currentLodgeId,
      p_status: status || null
    })
    if (error) throw error
    writeCached(CACHE_LEADS, data || [])
    return data || []
  } catch (e) {
    const cached = readCached(CACHE_LEADS)
    if (cached.length > 0 || !state.isOnline) return cached
    return []
  }
}
export const getEventLeads = (...args) => dedupePromise(`${MODULE_KEY}:getEventLeads`, () => _getEventLeads(...args))

export async function createEventLead(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('create_event_lead', {
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function updateEventLead(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('update_event_lead', {
      p_id: id,
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function convertLeadToBooking(leadId) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('convert_lead_to_booking', {
      p_lead_id: leadId,
      p_lodge_id: currentLodgeId
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ── Venue Availability ────────────────────────────────────────────────────

async function _getVenueAvailabilityRules(resourceKey) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_venue_availability_rules', {
      p_lodge_id: currentLodgeId,
      p_resource_key: resourceKey || null
    })
    if (error) throw error
    writeCached(CACHE_RULES, data || [])
    return data || []
  } catch (e) {
    const cached = readCached(CACHE_RULES)
    if (cached.length > 0 || !state.isOnline) return cached
    return []
  }
}
export const getVenueAvailabilityRules = (...args) => dedupePromise(`${MODULE_KEY}:getVenueAvailabilityRules`, () => _getVenueAvailabilityRules(...args))

export async function upsertVenueAvailabilityRule(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('upsert_venue_availability_rule', {
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function getVenueAvailabilityCalendar(resourceKey, startDate, endDate) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  if (!state.isOnline) return null
  try {
    const { data, error } = await state.supabase.rpc('get_venue_availability_calendar', {
      p_lodge_id: currentLodgeId,
      p_resource_key: resourceKey,
      p_start_date: startDate,
      p_end_date: endDate
    })
    if (error) throw error
    return data
  } catch {
    return null
  }
}

// ── Run Sheets ────────────────────────────────────────────────────────────

async function _getRunSheet(eventBookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId || !eventBookingId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_run_sheet', {
      p_event_booking_id: eventBookingId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    if (data && data.id) {
      const existing = readCached(CACHE_RUN_SHEETS).filter((r) => r.event_booking_id !== eventBookingId)
      writeCached(CACHE_RUN_SHEETS, [...existing, data])
    }
    return data
  } catch {
    const cached = readCached(CACHE_RUN_SHEETS).find((r) => r.event_booking_id === eventBookingId) || null
    return cached
  }
}
export const getRunSheet = (...args) => dedupePromise(`${MODULE_KEY}:getRunSheet`, () => _getRunSheet(...args))

export async function createRunSheet(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('create_run_sheet', {
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function updateRunSheet(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('update_run_sheet', {
      p_id: id,
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function finalizeRunSheet(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('finalize_run_sheet', {
      p_id: id,
      p_lodge_id: currentLodgeId
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function executeRunSheet(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('execute_run_sheet', {
      p_id: id,
      p_lodge_id: currentLodgeId
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ── Suppliers ─────────────────────────────────────────────────────────────

async function _getEventSuppliers(eventBookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId || !eventBookingId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_event_suppliers', {
      p_event_booking_id: eventBookingId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    const filtered = readCached(CACHE_SUPPLIERS).filter((s) => s.event_booking_id !== eventBookingId)
    writeCached(CACHE_SUPPLIERS, [...filtered, ...(data || [])])
    return data || []
  } catch {
    return readCached(CACHE_SUPPLIERS).filter((s) => s.event_booking_id === eventBookingId)
  }
}
export const getEventSuppliers = (...args) => dedupePromise(`${MODULE_KEY}:getEventSuppliers`, () => _getEventSuppliers(...args))

export async function createSupplierEntry(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('create_supplier_entry', {
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function updateSupplierEntry(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('update_supplier_entry', {
      p_id: id,
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function updateSupplierStatus(id, status, actualAmount) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('update_supplier_status', {
      p_id: id,
      p_lodge_id: currentLodgeId,
      p_status: status,
      p_actual_amount: actualAmount
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ── Deposit Milestones ────────────────────────────────────────────────────

async function _getDepositMilestones(eventBookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId || !eventBookingId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_deposit_milestones', {
      p_event_booking_id: eventBookingId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    const filtered = readCached(CACHE_MILESTONES).filter((m) => m.event_booking_id !== eventBookingId)
    writeCached(CACHE_MILESTONES, [...filtered, ...(data || [])])
    return data || []
  } catch {
    return readCached(CACHE_MILESTONES).filter((m) => m.event_booking_id === eventBookingId)
  }
}
export const getDepositMilestones = (...args) => dedupePromise(`${MODULE_KEY}:getDepositMilestones`, () => _getDepositMilestones(...args))

export async function createDepositMilestone(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('create_deposit_milestone', {
      p_lodge_id: currentLodgeId,
      p_payload: data
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function markMilestonePaid(id, paidDate, method, reference) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('mark_milestone_paid', {
      p_id: id,
      p_lodge_id: currentLodgeId,
      p_paid_date: paidDate,
      p_method: method,
      p_reference: reference
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function waiveMilestone(id, reason) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('waive_milestone', {
      p_id: id,
      p_lodge_id: currentLodgeId,
      p_reason: reason
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ── Settlement ────────────────────────────────────────────────────────────

export async function settleEvent(eventBookingId, idempotencyKey, adjustmentAmount = 0, adjustmentType = null, adjustmentReason = null, notes = null) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  try {
    const { data: result, error } = await state.supabase.rpc('settle_event', {
      p_event_booking_id: eventBookingId,
      p_lodge_id: currentLodgeId,
      p_idempotency_key: idempotencyKey,
      p_adjustment_amount: adjustmentAmount,
      p_adjustment_type: adjustmentType,
      p_adjustment_reason: adjustmentReason,
      p_notes: notes
    })
    if (error) return { success: false, error: error.message }
    return result || { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ── Profitability ─────────────────────────────────────────────────────────

export async function getEventProfitability(eventBookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId || !eventBookingId) return { success: false, error: 'Invalid parameters' }
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' }
  try {
    const { data, error } = await state.supabase.rpc('get_event_profitability', {
      p_event_booking_id: eventBookingId,
      p_lodge_id: currentLodgeId
    })
    if (error) return { success: false, error: error.message }
    return data
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function getVenueProfitabilityReport(startDate, endDate) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { success: false, error: 'No lodge selected' }
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' }
  try {
    const { data, error } = await state.supabase.rpc('get_venue_profitability_report', {
      p_lodge_id: currentLodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data: data || [] }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
