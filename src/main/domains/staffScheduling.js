import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) {
    const err = new Error('Staff scheduling requires an internet connection')
    err.onlineOnly = true
    throw err
  }
}

const SCHEDULE_CACHE = 'staff-schedules'
const ATTENDANCE_CACHE = 'staff-attendance'
const LEAVE_CACHE = 'staff-leave'

// ── Schedule ─────────────────────────────────────────────────────────────────
async function _getStaffSchedule(date) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_staff_schedule', {
      p_lodge_id: currentLodgeId,
      p_date: date || new Date().toISOString().slice(0, 10)
    })
    if (error) throw error
    writeCache(SCHEDULE_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(SCHEDULE_CACHE) || []
  }
}
export const getStaffSchedule = (...args) => dedupePromise('getStaffSchedule', () => _getStaffSchedule(...args))

async function _getStaffScheduleRange(startDate, endDate) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_staff_schedule_range', {
      p_lodge_id: currentLodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    })
    if (error) throw error
    writeCache(SCHEDULE_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(SCHEDULE_CACHE) || []
  }
}
export const getStaffScheduleRange = (...args) => dedupePromise('getStaffScheduleRange', () => _getStaffScheduleRange(...args))

export async function upsertStaffSchedule(staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('upsert_staff_schedule', {
    p_lodge_id: currentLodgeId,
    p_staff_id: staffId,
    p_schedule_date: scheduleDate,
    p_shift_label: shiftLabel,
    p_start_time: startTime || null,
    p_end_time: endTime || null,
    p_role_at_shift: roleAtShift || null,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

export async function deleteStaffScheduleEntry(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_staff_schedule_entry', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

// ── Attendance ───────────────────────────────────────────────────────────────
async function _getStaffAttendanceToday() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_staff_attendance_today', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(ATTENDANCE_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(ATTENDANCE_CACHE) || []
  }
}
export const getStaffAttendanceToday = (...args) => dedupePromise('getStaffAttendanceToday', () => _getStaffAttendanceToday(...args))

async function _getStaffAttendanceRange(startDate, endDate, staffId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_staff_attendance_range', {
      p_lodge_id: currentLodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_staff_id: staffId || null
    })
    if (error) throw error
    return data || []
  } catch (e) {
    return []
  }
}
export const getStaffAttendanceRange = (...args) => dedupePromise('getStaffAttendanceRange', () => _getStaffAttendanceRange(...args))

async function _getStaffAttendanceDashboard() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_staff_attendance_dashboard', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    return data
  } catch (e) {
    return null
  }
}
export const getStaffAttendanceDashboard = (...args) => dedupePromise('getStaffAttendanceDashboard', () => _getStaffAttendanceDashboard(...args))

export async function clockInStaffHotel(staffId, shiftLabel, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('clock_in_staff_hotel', {
    p_lodge_id: currentLodgeId,
    p_staff_id: staffId,
    p_shift_label: shiftLabel || null,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

export async function clockOutStaffHotel(attendanceId, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('clock_out_staff_hotel', {
    p_attendance_id: attendanceId,
    p_lodge_id: currentLodgeId,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

// ── Leave ────────────────────────────────────────────────────────────────────
async function _getStaffLeaveRequests(status, staffId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_staff_leave_requests', {
      p_lodge_id: currentLodgeId,
      p_status: status || null,
      p_staff_id: staffId || null
    })
    if (error) throw error
    writeCache(LEAVE_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(LEAVE_CACHE) || []
  }
}
export const getStaffLeaveRequests = (...args) => dedupePromise('getStaffLeaveRequests', () => _getStaffLeaveRequests(...args))

export async function requestStaffLeave(staffId, leaveType, startDate, endDate, reason) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('request_staff_leave', {
    p_lodge_id: currentLodgeId,
    p_staff_id: staffId,
    p_leave_type: leaveType,
    p_start_date: startDate,
    p_end_date: endDate,
    p_reason: reason || null
  })
  if (error) throw error
  return data
}

export async function approveStaffLeave(id, status, rejectionReason) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('approve_staff_leave', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_status: status,
    p_rejection_reason: rejectionReason || null
  })
  if (error) throw error
  return data
}
