// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {any} bridge @param {{businessId:string, outletId:string, staffId:string}} scope */
export function createBarLocalWorkforceScheduleApi(bridge, scope) {
  const businessId = String(scope?.businessId || '')
  const outletId = String(scope?.outletId || '')
  const staffId = String(scope?.staffId || '')
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function'
    || [businessId, outletId, staffId].some((value) => !UUID.test(value))) {
    throw new Error('The Bar, outlet or signed-in staff session could not be verified.')
  }
  const storageKey = `bar-local:workforce-roster:${businessId}:${outletId}:${staffId}:pending`

  const readPending = (storage) => {
    try {
      const value = JSON.parse(storage?.getItem(storageKey) || 'null')
      if (value === null) return null
      if (!isRecord(value) || !UUID.test(String(value.operation_id || ''))
        || !['workforce.shift.schedule', 'workforce.shift.cancel'].includes(value.command)
        || !isRecord(value.payload) || !isRecord(value.base_payload)) throw new Error()
      return value
    } catch {
      throw new Error('The saved roster recovery record is unreadable. Stop and contact support before making another roster change.')
    }
  }
  const checkResult = (result) => {
    if (!isRecord(result) || !isRecord(result.scope) || result.scope.business_id !== businessId
      || result.scope.outlet_id !== outletId || result.scope.actor_staff_id !== staffId
      || result.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable)
      || result.unavailable.length || !Number.isSafeInteger(result.snapshot_watermark)
      || result.snapshot_watermark < 0 || typeof result.pagination?.has_more !== 'boolean') {
      throw new Error('The local roster snapshot is incomplete or belongs to a different Bar session. Refresh before relying on it.')
    }
  }
  const dispatch = async (storage, intent) => {
    const result = await bridge.command({ command: intent.command, operation_id: intent.operation_id, payload: intent.payload })
    if (result?.outcome === 'committed_local') { storage.removeItem(storageKey); return result }
    if (result?.outcome === 'refused') { storage.removeItem(storageKey); throw new Error(result.error?.message || 'The local Bar service refused this roster change.') }
    throw new Error('The roster result is uncertain. Retry the same saved operation before making another change.')
  }
  const send = async (storage, command, payload) => {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function') throw new Error('Durable roster recovery is unavailable. No change was sent.')
    const pending = readPending(storage)
    if (pending && (pending.command !== command || JSON.stringify(pending.base_payload) !== JSON.stringify(payload))) {
      throw new Error('A different roster change is unresolved. Retry that exact operation before continuing.')
    }
    const open = await bridge.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No roster change was sent.')
    if (pending) {
      const same = open.find((item) => item?.operation_id === pending.operation_id)
      if (open.some((item) => item?.operation_id !== pending.operation_id)) throw new Error('Resolve the other local operation before changing the roster.')
      if (same) {
        if (same.command !== command || typeof bridge.retryOperation !== 'function') throw new Error('The saved roster operation does not match the service journal.')
        const result = await bridge.retryOperation(pending.operation_id)
        if (result?.outcome === 'committed_local' || result?.outcome === 'refused') {
          storage.removeItem(storageKey)
          if (result.outcome === 'refused') throw new Error(result.error?.message || 'The local Bar service refused this roster change.')
          return result
        }
        throw new Error('The roster result is still unresolved. Retry this same operation.')
      }
      return dispatch(storage, pending)
    }
    if (open.length) throw new Error('Resolve the existing local operation before changing the roster.')
    const operation_id = globalThis.crypto?.randomUUID?.()
    if (!UUID.test(String(operation_id || ''))) throw new Error('A stable roster operation ID could not be created. No change was sent.')
    const intent = { command, operation_id, payload, base_payload: payload }
    try { storage.setItem(storageKey, JSON.stringify(intent)) }
    catch { throw new Error('The roster change could not be saved for safe retry. Nothing was sent.') }
    return dispatch(storage, intent)
  }

  return {
    pending(storage) { return readPending(storage) },
    async load(storage, from, to) {
      if (!DATE.test(from) || !DATE.test(to) || to < from) throw new Error('Choose a valid roster week.')
      const [staffResult, firstPage] = await Promise.all([
        bridge.query('staff.list', { include_suspended: false }),
        bridge.query('workforce.roster', { from, to, status: 'scheduled', limit: 200 })
      ])
      checkResult(staffResult); checkResult(firstPage)
      if (firstPage.pagination.has_more) throw new Error('The local roster week exceeds the safe result limit. Narrow the week and refresh.')
      const staff = staffResult.data.map((row) => {
        if (!isRecord(row) || !UUID.test(String(row.staff_id || '')) || typeof row.display_name !== 'string'
          || !['active', 'suspended'].includes(row.status)) throw new Error('The local service returned an invalid staff record.')
        return { id: row.staff_id, name: row.display_name, status: row.status, role: row.role }
      }).filter((row) => row.status === 'active')
      const rows = firstPage.data.map((row) => {
        if (!isRecord(row) || !UUID.test(String(row.shift_id || '')) || !UUID.test(String(row.staff_id || ''))
          || typeof row.display_name !== 'string' || !DATE.test(String(row.work_date || ''))
          || typeof row.starts_at !== 'string' || typeof row.ends_at !== 'string' || row.status !== 'scheduled'
          || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('The local roster contains an invalid or unsupported entry.')
        return { id: row.shift_id, staff_id: row.staff_id, staff_name: row.display_name, schedule_date: row.work_date,
          start_time: row.starts_at, end_time: row.ends_at, role_at_shift: row.role_label || '', notes: row.notes || '',
          status: row.status, version: row.version }
      })
      return { staff, rows, snapshot_watermark: firstPage.snapshot_watermark, pending: this.pending(storage) }
    },
    schedule(storage, input) {
      const payload = {
        staff_id: String(input?.staff_id || ''), work_date: String(input?.work_date || ''),
        starts_at: String(input?.starts_at || ''), ends_at: String(input?.ends_at || ''),
        break_minutes: 0, role_label: String(input?.role_label || '').trim(), notes: String(input?.notes || '').trim() || null
      }
      if (!UUID.test(payload.staff_id) || !DATE.test(payload.work_date) || !TIME.test(payload.starts_at)
        || !TIME.test(payload.ends_at) || payload.starts_at === payload.ends_at || !payload.role_label
        || payload.role_label.length > 80 || (payload.notes && payload.notes.length > 500)) {
        throw new Error('Enter an active staff member, date, valid start/end times, role and notes of at most 500 characters.')
      }
      return send(storage, 'workforce.shift.schedule', payload)
    },
    cancel(storage, row, reason) {
      const payload = { shift_id: String(row?.id || ''), expected_version: Number(row?.version), reason: String(reason || '').trim() }
      if (!UUID.test(payload.shift_id) || !Number.isSafeInteger(payload.expected_version) || payload.expected_version < 1
        || !payload.reason || payload.reason.length > 500) throw new Error('A current roster entry and a reason of 1–500 characters are required.')
      return send(storage, 'workforce.shift.cancel', payload)
    },
    retry(storage) {
      const pending = readPending(storage)
      if (!pending) throw new Error('There is no saved roster operation to retry.')
      return send(storage, pending.command, pending.base_payload)
    }
  }
}
