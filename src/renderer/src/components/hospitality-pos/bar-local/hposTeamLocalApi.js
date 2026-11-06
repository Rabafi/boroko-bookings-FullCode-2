// @ts-check

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {any} bridge @param {{outletId?: string|null, staffId?: string|null}} scope */
export async function loadLocalHposTeam(bridge, scope = {}) {
  const outletId = typeof scope.outletId === 'string' ? scope.outletId : ''
  const staffId = typeof scope.staffId === 'string' ? scope.staffId : ''
  if (!bridge || typeof bridge.query !== 'function' || !outletId || !staffId) {
    throw new Error('Local staff and outlet scope is unavailable. Sign in again before loading the team board.')
  }
  const [staffResult, attendanceResult] = await Promise.all([
    bridge.query('staff.list', { include_suspended: false }),
    bridge.query('workforce.attendance.current', { outlet_id: outletId })
  ])
  const validEnvelope = (result) => isRecord(result) && result.complete === true
    && result.pagination?.has_more === false && isRecord(result.scope)
    && result.scope.outlet_id === outletId && result.scope.actor_staff_id === staffId
    && Array.isArray(result.data)
  if (!validEnvelope(staffResult) || !validEnvelope(attendanceResult)) {
    throw new Error('The local Bar service returned incomplete staff or attendance data. No hosted data was used.')
  }
  const staff = staffResult.data.map((row) => {
    if (!isRecord(row) || typeof row.staff_id !== 'string' || typeof row.display_name !== 'string'
      || !['owner', 'manager', 'cashier', 'bartender', 'waiter', 'kitchen', 'staff'].includes(row.role)
      || !['active', 'suspended'].includes(row.status)) throw new Error('The local service returned an invalid staff row.')
    return { id: row.staff_id, name: row.display_name, role: row.role, status: row.status, version: row.version }
  })
  const shifts = attendanceResult.data.map((row) => {
    if (!isRecord(row) || typeof row.attendance_id !== 'string' || typeof row.staff_id !== 'string'
      || typeof row.display_name !== 'string' || typeof row.clocked_in_at !== 'string' || row.status !== 'open') {
      throw new Error('The local service returned an invalid attendance row.')
    }
    return { id: row.attendance_id, staff_user_id: row.staff_id, staff_name: row.display_name,
      role: row.staff_role || 'staff', clock_in: row.clocked_in_at, status: row.status }
  })
  return { staff: staff.filter((row) => row.status === 'active'), shifts }
}
