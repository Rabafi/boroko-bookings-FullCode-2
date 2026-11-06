// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

/** Raw IPC fields consumed by the department update; property values are forwarded without validation. */
/** @typedef {{name?: unknown, description?: unknown, color?: unknown, is_active?: unknown}} StaffDepartmentUpdateExpectedData */
/** @typedef {Error & {onlineOnly?: boolean}} StaffOperationsOnlineError */

/* initDatabase installs this client before the normal connectivity probe. The
 * RPC-site assertions below only express that existing boot invariant; they
 * add no runtime guard, so direct failures/catch fallbacks stay unchanged. */
function requireOnline() {
  if (!state.isOnline) {
    const err = /** @type {StaffOperationsOnlineError} */ (new Error('Staff operations require an internet connection'))
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
/** @param {...unknown} _args */
async function _getStaffDepartments(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_staff_departments', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(DEPARTMENTS_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(DEPARTMENTS_CACHE) || []
  }
}
/** @param {...unknown} args */
export const getStaffDepartments = (...args) => dedupePromise('getStaffDepartments', () => _getStaffDepartments(...args))

/** @param {unknown} name @param {unknown} description @param {unknown} color */
export async function createStaffDepartment(name, description, color) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_staff_department', {
    p_lodge_id: currentLodgeId,
    p_name: name,
    p_description: description || null,
    p_color: color || null
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {StaffDepartmentUpdateExpectedData} payload */
export async function updateStaffDepartment(id, payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_staff_department', {
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

/** @param {unknown} id */
export async function deleteStaffDepartment(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('delete_staff_department', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

// ── Shift Templates ───────────────────────────────────────────────────────────
/** @param {unknown} departmentId @param {...unknown} _extraArgs */
async function _getShiftTemplates(departmentId, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_shift_templates', {
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
/** @type {(...args: Parameters<typeof _getShiftTemplates>) => ReturnType<typeof _getShiftTemplates>} */
export const getShiftTemplates = (...args) => dedupePromise('getShiftTemplates', () => _getShiftTemplates(...args))

/** @param {unknown} payload Raw IPC payload is forwarded without validation. */
export async function createShiftTemplate(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_shift_template', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload Raw IPC payload is forwarded without validation. */
export async function updateShiftTemplate(id, payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_shift_template', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} id */
export async function deleteShiftTemplate(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('delete_shift_template', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

// ── Task Categories ───────────────────────────────────────────────────────────
/** @param {...unknown} _args */
async function _getTaskCategories(..._args) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_task_categories', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(CATEGORIES_CACHE, data || [])
    return data || []
  } catch (e) {
    return readCache(CATEGORIES_CACHE) || []
  }
}
/** @param {...unknown} args */
export const getTaskCategories = (...args) => dedupePromise('getTaskCategories', () => _getTaskCategories(...args))

/** @param {unknown} name @param {unknown} color */
export async function createTaskCategory(name, color) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_task_category', {
    p_lodge_id: currentLodgeId,
    p_name: name,
    p_color: color || null
  })
  if (error) throw error
  return data
}

// ── Task Assignments ──────────────────────────────────────────────────────────
/** @param {unknown} staffId @param {unknown} status @param {unknown} date @param {...unknown} _extraArgs */
async function _getTaskAssignments(staffId, status, date, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_task_assignments', {
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
/** @type {(...args: Parameters<typeof _getTaskAssignments>) => ReturnType<typeof _getTaskAssignments>} */
export const getTaskAssignments = (...args) => dedupePromise('getTaskAssignments', () => _getTaskAssignments(...args))

/** @param {unknown} payload Raw IPC payload is forwarded without validation. */
export async function createTaskAssignment(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_task_assignment', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload Raw IPC payload is forwarded without validation. */
export async function updateTaskAssignment(id, payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_task_assignment', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} notes */
export async function completeTaskAssignment(id, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('complete_task_assignment', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

// ── Training ──────────────────────────────────────────────────────────────────
/** @param {unknown} departmentId @param {...unknown} _extraArgs */
async function _getTrainingChecklists(departmentId, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_training_checklists', {
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
/** @type {(...args: Parameters<typeof _getTrainingChecklists>) => ReturnType<typeof _getTrainingChecklists>} */
export const getTrainingChecklists = (...args) => dedupePromise('getTrainingChecklists', () => _getTrainingChecklists(...args))

/** @param {unknown} payload Raw IPC payload is forwarded without validation. */
export async function createTrainingChecklist(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_training_checklist', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} staffId @param {unknown} checklistId @param {unknown} notes */
export async function recordTrainingCompletion(staffId, checklistId, notes) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('record_training_completion', {
    p_lodge_id: currentLodgeId,
    p_staff_id: staffId,
    p_checklist_id: checklistId,
    p_notes: notes || null
  })
  if (error) throw error
  return data
}

/** @param {unknown} staffId @param {...unknown} _extraArgs */
async function _getTrainingRecords(staffId, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_training_records', {
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
/** @type {(...args: Parameters<typeof _getTrainingRecords>) => ReturnType<typeof _getTrainingRecords>} */
export const getTrainingRecords = (...args) => dedupePromise('getTrainingRecords', () => _getTrainingRecords(...args))

// ── Handover ──────────────────────────────────────────────────────────────────
/** @param {unknown} payload Raw IPC payload is forwarded without validation. */
export async function createShiftHandover(payload) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_shift_handover', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} date @param {...unknown} _extraArgs */
async function _getShiftHandovers(date, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_shift_handovers', {
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
/** @type {(...args: Parameters<typeof _getShiftHandovers>) => ReturnType<typeof _getShiftHandovers>} */
export const getShiftHandovers = (...args) => dedupePromise('getShiftHandovers', () => _getShiftHandovers(...args))

// ── Dashboard & Schedule ──────────────────────────────────────────────────────
/** @param {unknown} startDate @param {unknown} endDate @param {...unknown} _extraArgs */
async function _getStaffProductivityDashboard(startDate, endDate, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { metrics: [], summary: {} }
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_staff_productivity_dashboard', {
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
/** @type {(...args: Parameters<typeof _getStaffProductivityDashboard>) => ReturnType<typeof _getStaffProductivityDashboard>} */
export const getStaffProductivityDashboard = (...args) => dedupePromise('getStaffProductivityDashboard', () => _getStaffProductivityDashboard(...args))

/** @param {unknown} weekStart */
export async function publishWeeklySchedule(weekStart) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('publish_weekly_schedule', {
    p_lodge_id: currentLodgeId,
    p_week_start: weekStart
  })
  if (error) throw error
  return data
}

/** @param {unknown} weekStart @param {...unknown} _extraArgs */
async function _getScheduleConflicts(weekStart, ..._extraArgs) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { has_conflicts: false, conflicts: [] }
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_schedule_conflicts', {
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
/** @type {(...args: Parameters<typeof _getScheduleConflicts>) => ReturnType<typeof _getScheduleConflicts>} */
export const getScheduleConflicts = (...args) => dedupePromise('getScheduleConflicts', () => _getScheduleConflicts(...args))
