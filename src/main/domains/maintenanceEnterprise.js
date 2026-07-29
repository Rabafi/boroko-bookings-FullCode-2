import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

// ── Preventive Schedules ─────────────────────────────────────────────────────
const PREVENTIVE_CACHE = 'preventive-schedules'

async function _getAllPreventiveSchedules() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_preventive_schedules', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(PREVENTIVE_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(PREVENTIVE_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    if (!state.isOnline) return []
    throw new Error(e?.message || 'Could not load preventive schedules')
  }
}

export const getAllPreventiveSchedules = (...args) => dedupePromise('getAllPreventiveSchedules', () => _getAllPreventiveSchedules(...args))

export async function createPreventiveSchedule(data, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_preventive_schedule', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  if (!result?.success) throw new Error(result?.error || 'Could not create preventive schedule')
  return result
}

export async function updatePreventiveSchedule(id, data, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_preventive_schedule', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deletePreventiveSchedule(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_preventive_schedule', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

export async function getDuePreventiveMaintenance(date, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_due_preventive_maintenance', {
    p_lodge_id: currentLodgeId,
    p_date: date || new Date().toISOString().slice(0, 10)
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function completePreventiveMaintenance(id, completedBy, notes, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('complete_preventive_maintenance', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_completed_by: completedBy,
    p_notes: notes || null
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not complete preventive maintenance')
  return data
}

// ── Room OOO/OOS ────────────────────────────────────────────────────────────
// Availability mutations are ONLINE-ONLY (docs/OFFLINE_MATRIX.md) — never queue silently.
function requireOnlineAvailability(operation) {
  if (state.isOnline === false) {
    const err = new Error(
      `${operation} requires an internet connection. Room OOO/OOS availability changes cannot be queued offline.`
    )
    err.onlineOnly = true
    throw err
  }
}

export async function setRoomOutOfOrder(roomId, startDate, reason, endDate, ticketId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineAvailability('Set room out of order')
  const { data, error } = await state.supabase.rpc('set_room_out_of_order', {
    p_room_id: roomId,
    p_lodge_id: currentLodgeId,
    p_start_date: startDate,
    p_reason: reason,
    p_end_date: endDate || null,
    p_ticket_id: ticketId || null
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not set room out of order')
  return data
}

export async function setRoomOutOfService(roomId, startDate, reason, endDate, ticketId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineAvailability('Set room out of service')
  const { data, error } = await state.supabase.rpc('set_room_out_of_service', {
    p_room_id: roomId,
    p_lodge_id: currentLodgeId,
    p_start_date: startDate,
    p_reason: reason,
    p_end_date: endDate || null,
    p_ticket_id: ticketId || null
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not set room out of service')
  return data
}

export async function returnRoomToService(downtimeId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineAvailability('Return room to service')
  const { data, error } = await state.supabase.rpc('return_room_to_service', {
    p_downtime_id: downtimeId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Could not return room to service')
  return data
}

export async function getRoomDowntimeHistory(roomId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_room_downtime_history', {
    p_room_id: roomId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function getMaintenanceDashboard(lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return null
  const { data, error } = await state.supabase.rpc('get_maintenance_dashboard', { p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

export async function getDowntimeReport(startDate, endDate, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return null
  const { data, error } = await state.supabase.rpc('get_downtime_report', {
    p_lodge_id: currentLodgeId,
    p_start_date: startDate,
    p_end_date: endDate
  })
  if (error) throw error
  return data
}
