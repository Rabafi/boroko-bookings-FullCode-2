import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) {
    const err = new Error('Staff operations require an internet connection')
    err.onlineOnly = true
    throw err
  }
}

const DEPARTMENTS_CACHE = 'staff-ops-departments'
const TEMPLATES_CACHE = 'staff-ops-templates'
const CATEGORIES_CACHE = 'staff-ops-categories'
const TASKS_CACHE = 'staff-ops-tasks'
const CHECKLISTS_CACHE = 'staff-ops-checklists'
const TRAINING_RECORDS_CACHE = 'staff-ops-training-records'
const HANDOVERS_CACHE = 'staff-ops-handovers'
const PRODUCTIVITY_CACHE = 'staff-ops-productivity'
const CONFLICTS_CACHE = 'staff-ops-conflicts'

// ── Departments ───────────────────────────────────────────────────────────────
async function _getStaffDepartments() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_staff_departments', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(DEPARTMENTS_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(DEPARTMENTS_CACHE) || []
  }
}
export const getStaffDepartments = (...args) => dedupePromise('getStaffDepartments', () => _getStaffDepartments(...args))

export async function createStaffDepartment(name, description, color) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_staff_department', {
    p_lodge_id: currentLodgeId,
    p_name: name,
    p_description: description || null,
    p_color: color || null
  })
  if (error) throw error
  return data
}

export async function updateStaffDepartment(id, payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('update_staff_department', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_name: payload.name || null,
    p_description: payload.description !== undefined ? payload.description : null,
    p_color: payload.color !== undefined ? payload.color : null,
    p_is_active: payload.is_active !== undefined ? payload.is_active : null
  })
  if (error) throw error
  return data
}

export async function deleteStaffDepartment(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_staff_department', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

// ── Shift Templates ───────────────────────────────────────────────────────────
async function _getShiftTemplates(departmentId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_shift_templates', {
      p_lodge_id: currentLodgeId,
      p_department_id: departmentId || null
    })
    if (error) throw error
    writeCache(TEMPLATES_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(TEMPLATES_CACHE) || []
  }
}
export const getShiftTemplates = (...args) => dedupePromise('getShiftTemplates', () => _getShiftTemplates(...args))

export async function createShiftTemplate(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_shift_template', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function updateShiftTemplate(id, payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('update_shift_template', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function deleteShiftTemplate(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_shift_template', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

// ── Task Categories ───────────────────────────────────────────────────────────
async function _getTaskCategories() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_task_categories', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(CATEGORIES_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(CATEGORIES_CACHE) || []
  }
}
export const getTaskCategories = (...args) => dedupePromise('getTaskCategories', () => _getTaskCategories(...args))

export async function createTaskCategory(name, color) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_task_category', {
    p_lodge_id: currentLodgeId,
    p_name: name,
    p_color: color || null
  })
  if (error) throw error
  return data
}

// ── Task Assignments ──────────────────────────────────────────────────────────
async function _getTaskAssignments(staffId, status, date) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_task_assignments', {
      p_lodge_id: currentLodgeId,
      p_staff_id: staffId || null,
      p_status: status || null,
      p_date: date || null
    })
    if (error) throw error
    writeCache(TASKS_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(TASKS_CACHE) || []
  }
}
export const getTaskAssignments = (...args) => dedupePromise('getTaskAssignments', () => _getTaskAssignments(...args))

export async function createTaskAssignment(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_task_assignment', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function updateTaskAssignment(id, payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('update_task_assignment', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function completeTaskAssignment(id, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('complete_task_assignment', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

// ── Training ──────────────────────────────────────────────────────────────────
async function _getTrainingChecklists(departmentId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_training_checklists', {
      p_lodge_id: currentLodgeId,
      p_department_id: departmentId || null
    })
    if (error) throw error
    writeCache(CHECKLISTS_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(CHECKLISTS_CACHE) || []
  }
}
export const getTrainingChecklists = (...args) => dedupePromise('getTrainingChecklists', () => _getTrainingChecklists(...args))

export async function createTrainingChecklist(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_training_checklist', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function recordTrainingCompletion(staffId, checklistId, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('record_training_completion', {
    p_lodge_id: currentLodgeId,
    p_staff_id: staffId,
    p_checklist_id: checklistId,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

async function _getTrainingRecords(staffId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_training_records', {
      p_lodge_id: currentLodgeId,
      p_staff_id: staffId || null
    })
    if (error) throw error
    writeCache(TRAINING_RECORDS_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(TRAINING_RECORDS_CACHE) || []
  }
}
export const getTrainingRecords = (...args) => dedupePromise('getTrainingRecords', () => _getTrainingRecords(...args))

// ── Handover ──────────────────────────────────────────────────────────────────
export async function createShiftHandover(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_shift_handover', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

async function _getShiftHandovers(date) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_shift_handovers', {
      p_lodge_id: currentLodgeId,
      p_date: date || null
    })
    if (error) throw error
    writeCache(HANDOVERS_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(HANDOVERS_CACHE) || []
  }
}
export const getShiftHandovers = (...args) => dedupePromise('getShiftHandovers', () => _getShiftHandovers(...args))

// ── Dashboard & Schedule ──────────────────────────────────────────────────────
async function _getStaffProductivityDashboard(startDate, endDate) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { metrics: [], summary: {} }
  try {
    const { data, error } = await state.supabase.rpc('get_staff_productivity_dashboard', {
      p_lodge_id: currentLodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    })
    if (error) throw error
    writeCache(PRODUCTIVITY_CACHE, data || { metrics: [], summary: {} })
    return data || { metrics: [], summary: {} }
  } catch (e) {
    return readCache(PRODUCTIVITY_CACHE) || { metrics: [], summary: {} }
  }
}
export const getStaffProductivityDashboard = (...args) => dedupePromise('getStaffProductivityDashboard', () => _getStaffProductivityDashboard(...args))

export async function publishWeeklySchedule(weekStart) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('publish_weekly_schedule', {
    p_lodge_id: currentLodgeId,
    p_week_start: weekStart
  })
  if (error) throw error
  return data
}

async function _getScheduleConflicts(weekStart) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { has_conflicts: false, conflicts: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_schedule_conflicts', {
      p_lodge_id: currentLodgeId,
      p_week_start: weekStart
    })
    if (error) throw error
    writeCache(CONFLICTS_CACHE, data || { has_conflicts: false, conflicts: [] })
    return data || { has_conflicts: false, conflicts: [] }
  } catch (e) {
    return readCache(CONFLICTS_CACHE) || { has_conflicts: false, conflicts: [] }
  }
}
export const getScheduleConflicts = (...args) => dedupePromise('getScheduleConflicts', () => _getScheduleConflicts(...args))
