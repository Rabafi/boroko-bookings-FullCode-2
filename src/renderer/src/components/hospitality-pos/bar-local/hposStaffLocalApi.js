// @ts-check

const PENDING_KEY_PREFIX = 'hpos:bar-local:staff.create:'
const ROLES = new Set(['manager', 'cashier'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {any} bridge @param {{businessId?:string, outletId?:string, staffId?:string}} scope */
export function createLocalStaffApi(bridge, scope = {}) {
  const businessId = typeof scope.businessId === 'string' ? scope.businessId : ''
  const outletId = typeof scope.outletId === 'string' ? scope.outletId : ''
  const staffId = typeof scope.staffId === 'string' ? scope.staffId : ''
  if (!bridge || !businessId || !outletId || !staffId) throw new Error('Local business, outlet, or staff scope is unavailable. Sign in again before managing staff.')
  const pendingKey = `${PENDING_KEY_PREFIX}${businessId}:${staffId}`
  const readPending = (storage) => {
    try {
      const value = JSON.parse(storage?.getItem(pendingKey) || 'null')
      return record(value) && value.business_id === businessId && value.staff_id === staffId && UUID.test(String(value.operation_id))
        ? { business_id: businessId, staff_id: staffId, operation_id: String(value.operation_id) }
        : null
    } catch { return null }
  }
  const settle = (storage, result) => {
    if (result?.outcome === 'committed_local') { storage?.removeItem(pendingKey); return result }
    if (result?.outcome === 'refused') {
      storage?.removeItem(pendingKey)
      throw new Error(result.error?.message || 'The local Bar authority refused the staff change. No account was created.')
    }
    throw new Error('The staff operation is unresolved. Retry the saved operation; do not create the account again.')
  }
  return {
    async list() {
      const result = await bridge.query('staff.list', { include_suspended: true })
      if (!record(result) || result.complete !== true || result.pagination?.has_more !== false || !Number.isSafeInteger(result.snapshot_watermark)
        || !record(result.scope) || result.scope.business_id !== businessId || result.scope.outlet_id !== outletId
        || result.scope.actor_staff_id !== staffId || !Array.isArray(result.data)) {
        throw new Error('The local staff list is incomplete or belongs to another Bar session. No hosted staff data was used.')
      }
      return result.data.map((row) => {
        if (!record(row) || !UUID.test(String(row.staff_id || '')) || typeof row.display_name !== 'string'
          || !ROLES.has(row.role) && !['owner', 'stock', 'finance'].includes(row.role)
          || !['active', 'suspended'].includes(row.status) || !Number.isSafeInteger(row.version) || row.version < 1
          || !Array.isArray(row.capabilities)) throw new Error('The local service returned an invalid staff identity.')
        return { id: row.staff_id, name: row.display_name, email: '', role: row.role, status: row.status,
          created_at: row.created_at, capability_overrides: {}, allowed_outlet_ids: [outletId], version: row.version,
          local_capabilities: row.capabilities }
      })
    },
    pending(storage) { return readPending(storage) },
    async create(storage, input) {
      if (readPending(storage)) throw new Error('Resolve the saved staff operation before creating another local account.')
      const name = typeof input?.display_name === 'string' ? input.display_name.trim() : ''
      const role = typeof input?.role === 'string' ? input.role : ''
      const pin = typeof input?.pin === 'string' ? input.pin : ''
      if (!name || name.length > 120) throw new Error('Enter a staff name of 1–120 characters.')
      if (!ROLES.has(role)) throw new Error('Choose Manager or Cashier for this local Bar account.')
      if (!/^\d{4,12}$/.test(pin)) throw new Error('Set a private staff PIN between 4 and 12 digits.')
      const operation_id = globalThis.crypto?.randomUUID?.()
      if (!UUID.test(String(operation_id || ''))) throw new Error('A stable operation ID could not be created. No staff account was submitted.')
      const pending = { business_id: businessId, staff_id: staffId, operation_id }
      storage?.setItem(pendingKey, JSON.stringify(pending))
      return settle(storage, await bridge.command({ command: 'staff.create', operation_id, payload: { display_name: name, role, pin } }))
    },
    async retry(storage) {
      const pending = readPending(storage)
      if (!pending) throw new Error('There is no saved local staff operation to retry.')
      if (typeof bridge.retryOperation !== 'function') throw new Error('The local operation journal cannot retry this staff change. Keep the saved ID and ask an administrator for recovery.')
      return settle(storage, await bridge.retryOperation(pending.operation_id))
    }
  }
}
