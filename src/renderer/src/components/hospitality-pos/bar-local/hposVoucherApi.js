// @ts-check
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const PREFIX = 'hpos:bar-local:voucher.issue:'

/** @param {any} bridge @param {{businessId:string, outletId:string, staffId:string}} scope */
export function createLocalHposVoucherApi(bridge, scope) {
  const { businessId, outletId, staffId } = scope || {}
  if (!bridge || !businessId || !outletId || !staffId) throw new Error('The signed-in local Bar, outlet, or operator scope is unavailable.')
  const pendingKey = `${PREFIX}${businessId}:${outletId}:${staffId}`
  const readPending = (storage) => {
    try {
      const value = JSON.parse(storage?.getItem(pendingKey) || 'null')
      if (!record(value) || value.command !== 'voucher.issue' || !UUID.test(String(value.operation_id || '')) || !record(value.payload)) return null
      return value
    } catch { throw new Error('Saved voucher recovery data cannot be read. Stop and contact support before issuing another voucher.') }
  }
  const settle = (storage, result) => {
    if (result?.outcome === 'committed_local') { storage?.removeItem(pendingKey); return result }
    if (result?.outcome === 'refused') {
      storage?.removeItem(pendingKey)
      throw new Error(result.error?.message || 'The local Bar authority refused the voucher. No voucher was issued.')
    }
    throw new Error('The voucher result is unresolved. Retry the saved operation before starting another voucher.')
  }
  const list = async () => {
    const rows = []
    const cursors = new Set()
    let cursor = null
    let watermark = null
    for (let page = 0; page < 1000; page += 1) {
      const filters = { limit: 200, ...(cursor ? { cursor } : {}) }
      const result = await bridge.query('vouchers.list', filters)
      const scopeMatches = record(result?.scope) && result.scope.business_id === businessId && result.scope.outlet_id === outletId && result.scope.actor_staff_id === staffId
      if (result?.complete !== true || !scopeMatches || !Number.isSafeInteger(result.snapshot_watermark) || !Array.isArray(result.data)) {
        throw new Error('The local voucher list is incomplete or belongs to another Bar session. No hosted voucher data was used.')
      }
      if (watermark !== null && result.snapshot_watermark !== watermark) throw new Error('Vouchers changed while the complete list was loading. Refresh before issuing or reconciling a voucher.')
      watermark = result.snapshot_watermark
      for (const row of result.data) {
        if (!record(row) || !UUID.test(String(row.voucher_id || '')) || typeof row.code !== 'string' || !Number.isSafeInteger(row.version) || row.version < 1
          || !['active', 'redeemed', 'expired', 'voided'].includes(row.status)
          || !Number.isFinite(Number(row.initial_amount)) || Number(row.initial_amount) <= 0
          || !Number.isFinite(Number(row.balance)) || Number(row.balance) < 0) {
          throw new Error('The local voucher list contains an invalid record. Refresh it before continuing.')
        }
        rows.push(row)
      }
      if (result.pagination?.has_more === false) return rows
      const next = result.pagination?.next_cursor
      if (typeof next !== 'string' || !next || cursors.has(next) || result.data.length === 0) throw new Error('The local voucher list could not finish loading. No partial list was accepted.')
      cursors.add(next)
      cursor = next
    }
    throw new Error('The local voucher list exceeds the safe loading limit. Use a scoped export.')
  }
  return {
    list,
    pending: (storage) => readPending(storage),
    async issue(storage, input) {
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
        throw new Error('Durable local recovery storage is unavailable. No voucher was issued.')
      }
      let intent = readPending(storage)
      if (intent) {
        if (intent.payload.amount !== input?.amount || intent.payload.code !== input?.code || intent.payload.expires_on !== (input?.expires_on || null)) {
          throw new Error('A different voucher operation is unresolved. Retry that saved operation before entering another voucher.')
        }
        const open = await bridge.getOpenIntents()
        if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No voucher was submitted.')
        if (open.some((row) => row?.operation_id === intent.operation_id)) {
          if (typeof bridge.retryOperation !== 'function') throw new Error('Local retry is unavailable. Keep this operation pending and contact support.')
          return settle(storage, await bridge.retryOperation(intent.operation_id))
        }
        if (!intent.payload.approval_id) {
          const pin = String(input?.pin ?? '')
          if (!/^\d{4,12}$/.test(pin)) throw new Error('The saved voucher is awaiting manager approval. Enter the approving manager PIN to continue.')
          const approval = await bridge.requestApprovalForCommand({ command: intent.command, operation_id: intent.operation_id, payload: intent.payload, pin })
          if (!UUID.test(String(approval?.approval_id || ''))) throw new Error('Manager approval was not confirmed. The saved operation remains available for safe retry.')
          intent = { ...intent, payload: { ...intent.payload, approval_id: approval.approval_id } }
          storage.setItem(pendingKey, JSON.stringify(intent))
        }
      } else {
        const existing = await bridge.getOpenIntents()
        if (!Array.isArray(existing) || existing.length) throw new Error('Resolve the existing local operation before issuing a voucher. No new voucher was submitted.')
        const amount = String(input?.amount ?? '').trim()
        const code = String(input?.code ?? '').trim().toUpperCase()
        const expiry = input?.expires_on ? String(input.expires_on) : null
        if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error('Enter a voucher value greater than zero, with no more than two decimal places.')
        if (!/^[A-Z0-9_-]{1,60}$/.test(code)) throw new Error('Enter a voucher code using 1–60 letters, numbers, underscores, or hyphens.')
        if (expiry !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Error('Choose a valid voucher expiry date.')
        const pin = String(input?.pin ?? '')
        if (!/^\d{4,12}$/.test(pin)) throw new Error('Enter the approving manager PIN (4–12 digits).')
        const operation_id = globalThis.crypto?.randomUUID?.()
        if (!UUID.test(String(operation_id || ''))) throw new Error('A stable operation ID could not be created. No voucher was submitted.')
        intent = { command: 'voucher.issue', operation_id, payload: { amount, code, expires_on: expiry } }
        storage.setItem(pendingKey, JSON.stringify(intent))
        const approval = await bridge.requestApprovalForCommand({ command: intent.command, operation_id, payload: intent.payload, pin })
        if (!UUID.test(String(approval?.approval_id || ''))) throw new Error('Manager approval was not confirmed. The saved operation remains available for safe retry.')
        intent = { ...intent, payload: { ...intent.payload, approval_id: approval.approval_id } }
        storage.setItem(pendingKey, JSON.stringify(intent))
      }
      return settle(storage, await bridge.command({ command: intent.command, operation_id: intent.operation_id, payload: intent.payload }))
    }
  }
}
