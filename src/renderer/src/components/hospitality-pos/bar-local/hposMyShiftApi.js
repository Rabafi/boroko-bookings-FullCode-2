// @ts-check

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

/** @param {any} bridge @param {{outletId?: string|null, staffId?: string|null}} scope */
export function createLocalHposMyShiftApi(bridge, scope = {}) {
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function'
    || typeof bridge.getOpenIntents !== 'function' || typeof bridge.retryOperation !== 'function') {
    throw new TypeError('The local Bar shift bridge is incomplete.')
  }
  const outletId = typeof scope.outletId === 'string' ? scope.outletId : null
  const staffId = typeof scope.staffId === 'string' ? scope.staffId : null
  const readMine = async () => {
    if (!outletId || !staffId) throw new Error('Your local staff and outlet scope is unavailable. Refresh the Bar session.')
    const response = await bridge.query('cashup.mine', { outlet_id: outletId })
    if (!isRecord(response) || response.complete !== true || !isRecord(response.scope)
      || response.scope.outlet_id !== outletId || response.scope.actor_staff_id !== staffId) {
      throw new Error('The local service did not return a complete shift for your staff and outlet. No cloud data was used.')
    }
    if (!isRecord(response.data)) throw new Error('The local service returned no shift data. Refresh before taking payment.')
    const row = response.data.shift
    const submission = response.data.submission
    if (row === null || row === undefined) return { shift: null, submission: submission || null }
    if (!isRecord(row) || row.status !== 'open' || row.staff_id !== staffId || !nonEmpty(row.id)
      || !nonEmpty(row.opening_float) || !nonEmpty(row.opened_at) || !Number.isSafeInteger(row.version)) {
      throw new Error('The local service returned an incomplete open shift. Refresh before taking payment.')
    }
    return { shift: {
      id: row.id,
      outlet_id: outletId,
      cashier_id: staffId,
      status: 'open',
      opening_float: row.opening_float,
      opened_at: row.opened_at,
      business_date: row.business_date,
      version: row.version
    }, submission: submission || null }
  }
  const openShift = async ({ openingFloat, operationId }) => {
    if (!outletId || !staffId) throw new Error('Your local staff and outlet scope is unavailable. Refresh the Bar session.')
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(openingFloat ?? '')) || !nonEmpty(operationId)) {
      throw new Error('Enter a valid non-negative opening float and keep the saved operation ID.')
    }
    const open = await bridge.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('Saved local operations could not be checked. Restore the operation journal before starting a shift.')
    if (open.length) {
      const prior = open.length === 1 && open[0]?.command === 'shift.open' ? open[0] : null
      if (!prior || prior.operation_id !== operationId) throw new Error('Resolve the saved shift-start operation before starting another shift.')
      const recovered = await bridge.retryOperation(operationId)
      if (recovered?.outcome !== 'committed_local') throw Object.assign(new Error(recovered?.error?.message || 'The saved shift start is unresolved. Retry the same operation.'), { outcome: recovered?.outcome || 'unknown' })
      return (await readMine()).shift
    }
    const result = await bridge.command({ command: 'shift.open', operation_id: operationId, payload: { opening_float: String(openingFloat) } })
    if (result?.outcome !== 'committed_local') throw Object.assign(new Error(result?.error?.message || 'The local service did not confirm the shift start. Check saved operations before trying again.'), { outcome: result?.outcome || 'unknown' })
    return (await readMine()).shift
  }
  return { readMine, openShift }
}
