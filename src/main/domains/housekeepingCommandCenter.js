import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

// ── Housekeeping Assignments ─────────────────────────────────────────────────
const ASSIGNMENT_CACHE = 'housekeeping-assignments'

async function _getAllAssignments() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_housekeeping_dashboard', { p_lodge_id: currentLodgeId, p_date: new Date().toISOString().slice(0, 10) })
    if (error) throw error
    const rows = data?.assignments || []
    writeCache(ASSIGNMENT_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(ASSIGNMENT_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllAssignments = (...args) => dedupePromise('getAllAssignments', () => _getAllAssignments(...args))

export async function createAssignment(roomId, assignedTo, date, shift, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_housekeeping_assignment', {
    p_lodge_id: currentLodgeId,
    p_room_id: roomId,
    p_assigned_to: assignedTo,
    p_assignment_date: date,
    p_shift: shift
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not create assignment')
  return data
}

export async function updateAssignmentStatus(id, status, notes, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('update_housekeeping_assignment_status', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_status: status,
    p_notes: notes || null
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not update assignment')
  return data
}

// ── Housekeeping Inspections ─────────────────────────────────────────────────
const INSPECTION_CACHE = 'housekeeping-inspections'

async function _getAllInspections() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_housekeeping_dashboard', { p_lodge_id: currentLodgeId, p_date: new Date().toISOString().slice(0, 10) })
    if (error) throw error
    const rows = data?.inspections || []
    writeCache(INSPECTION_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(INSPECTION_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllInspections = (...args) => dedupePromise('getAllInspections', () => _getAllInspections(...args))

export async function createInspection(roomId, inspectedBy, checklistResults, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_housekeeping_inspection', {
    p_lodge_id: currentLodgeId,
    p_room_id: roomId,
    p_inspected_by: inspectedBy,
    p_checklist_results: checklistResults
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not create inspection')
  return data
}

// ── Turnaround Tracking ──────────────────────────────────────────────────────
export async function startTurnaround(bookingId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('start_turnaround', {
    p_booking_id: bookingId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not start turnaround')
  return data
}

export async function completeTurnaround(turnaroundId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('complete_turnaround', {
    p_turnaround_id: turnaroundId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not complete turnaround')
  return data
}

export async function getTurnaroundTimes(startDate, endDate, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_turnaround_times', {
    p_lodge_id: currentLodgeId,
    p_start_date: startDate,
    p_end_date: endDate
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export async function getHousekeepingDashboard(date, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return null
  const { data, error } = await state.supabase.rpc('get_housekeeping_dashboard', {
    p_lodge_id: currentLodgeId,
    p_date: date || new Date().toISOString().slice(0, 10)
  })
  if (error) throw error
  return data
}

export async function getProductivity(startDate, endDate, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_housekeeping_productivity', {
    p_lodge_id: currentLodgeId,
    p_start_date: startDate,
    p_end_date: endDate
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// ── Checklist Items ──────────────────────────────────────────────────────────
const CHECKLIST_CACHE = 'housekeeping-checklist'

async function _getChecklistItems() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_housekeeping_checklist_items', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(CHECKLIST_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(CHECKLIST_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getChecklistItems = (...args) => dedupePromise('getChecklistItems', () => _getChecklistItems(...args))

export async function createChecklistItem(data, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_housekeeping_checklist_item', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updateChecklistItem(id, data, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_housekeeping_checklist_item', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteChecklistItem(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_housekeeping_checklist_item', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}
