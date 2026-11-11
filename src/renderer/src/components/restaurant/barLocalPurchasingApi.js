// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PREFIX = 'restaurant:bar-local:purchasing:'
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {any} bridge @param {{businessId:string, outletId:string, staffId:string}} scope */
export function createBarLocalPurchasingApi(bridge, scope) {
  const { businessId, outletId, staffId } = scope || {}
  if (!bridge || !businessId || !outletId || !staffId) throw new Error('The signed-in Bar, outlet, or operator scope is unavailable.')
  const key = `${PREFIX}${businessId}:${outletId}:${staffId}:pending`
  const readPending = (storage) => {
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null')
      if (value === null) return null
      if (!isRecord(value) || !UUID.test(String(value.operation_id || '')) || typeof value.command !== 'string' || !isRecord(value.payload)) {
        throw new Error('The saved purchasing recovery record is invalid.')
      }
      return value
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Saved purchasing recovery data could not be read. Stop and contact support before continuing.')
      throw error
    }
  }
  const confirmed = (storage, result) => {
    if (result?.outcome === 'committed_local') { storage.removeItem(key); return result }
    if (result?.outcome === 'refused') { storage.removeItem(key); throw new Error(result.error?.message || 'The local Bar service refused this purchasing change.') }
    throw new Error('The purchasing result is uncertain. Retry the exact saved operation before starting another change.')
  }
  const dispatch = async (storage, intent) => {
    try {
      return confirmed(storage, await bridge.command({ command: intent.command, operation_id: intent.operation_id, payload: intent.payload }))
    } catch (error) {
      if (readPending(storage)) throw new Error('The purchasing result is uncertain. Retry the exact saved operation before starting another change.')
      throw error
    }
  }
  const ensureNoOtherOpenIntent = async (operationId = '') => {
    const open = await bridge.getOpenIntents()
    if (!Array.isArray(open)) throw new Error('The local operation journal could not be checked. No purchasing change was sent.')
    if (open.some((row) => row?.operation_id !== operationId)) throw new Error('Resolve the existing local operation before changing purchasing records.')
    return open
  }
  const send = async (storage, command, payload, options = {}) => {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      throw new Error('Durable purchasing recovery storage is unavailable. No change was sent.')
    }
    const current = readPending(storage)
    if (current) {
      if (current.command !== command || JSON.stringify(current.base_payload) !== JSON.stringify(payload)) {
        throw new Error('A different purchasing operation is unresolved. Retry it before making another change.')
      }
      const open = await ensureNoOtherOpenIntent(current.operation_id)
      if (open.some((row) => row?.operation_id === current.operation_id)) {
        if (typeof bridge.retryOperation !== 'function') throw new Error('Local purchasing retry is unavailable. Keep the saved operation pending and contact support.')
        try { return confirmed(storage, await bridge.retryOperation(current.operation_id)) }
        catch { throw new Error('The purchasing result is uncertain. Retry the exact saved operation before starting another change.') }
      }
      return dispatch(storage, current)
    }
    await ensureNoOtherOpenIntent()
    const operation_id = globalThis.crypto?.randomUUID?.()
    if (!UUID.test(String(operation_id || ''))) throw new Error('A stable purchasing operation ID could not be created. No change was sent.')
    let savedPayload = payload
    if (options.requiresManagerApproval) {
      if (!/^\d{4,12}$/.test(String(options.pin || ''))) throw new Error('A manager PIN of 4–12 digits is required to approve this purchase order.')
      if (typeof bridge.requestApprovalForCommand !== 'function') throw new Error('Local manager approval is unavailable. No purchase order was created.')
      const approval = await bridge.requestApprovalForCommand({ command, payload, pin: options.pin, operation_id })
      if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. No purchase order was created.')
      savedPayload = { ...payload, approval_id: approval.approval_id }
    }
    const intent = { command, operation_id, payload: savedPayload, base_payload: payload }
    storage.setItem(key, JSON.stringify(intent))
    return dispatch(storage, intent)
  }

  return {
    pending(storage) { return readPending(storage) },
    retry(storage) {
      const intent = readPending(storage)
      if (!intent) throw new Error('There is no saved purchasing operation to retry.')
      return send(storage, intent.command, intent.base_payload || intent.payload, {})
    },
    saveSupplier(storage, supplier, pin = '') {
      const payload = {
        ...(supplier.id ? { supplier_id: supplier.id, expected_version: supplier.version } : {}),
        name: String(supplier.name || '').trim(), contact_name: String(supplier.contact_person || '').trim(),
        phone: String(supplier.phone || '').trim(), email: String(supplier.email || '').trim(),
        address: String(supplier.address || '').trim(), active: true
      }
      if (!payload.name || (supplier.id && !Number.isSafeInteger(supplier.version))) throw new Error('Enter a supplier name and refresh before editing a changed supplier.')
      return send(storage, 'supplier.upsert', payload)
    },
    createPurchaseOrder(storage, order, managerPin) {
      const lines = Array.isArray(order?.items) ? order.items.map((item) => ({
        product_id: String(item.inventory_item_id || ''), quantity: String(item.quantity || ''), unit_cost: String(item.unit_cost || ''),
        ...(item.tax_rate == null ? {} : { tax_rate: String(item.tax_rate) })
      })) : []
      const payload = {
        supplier_id: String(order?.supplier_id || ''),
        expected_supplier_version: Number(order?.supplier_version),
        expected_on: order?.expected_delivery || null, notes: String(order?.notes || '').trim() || null, lines
      }
      if (!UUID.test(payload.supplier_id) || !Number.isSafeInteger(payload.expected_supplier_version) || payload.expected_supplier_version < 1 ||
          !lines.length || lines.some((line) => !UUID.test(line.product_id) || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(line.quantity) || Number(line.quantity) <= 0 ||
            !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(line.unit_cost) || Number(line.unit_cost) < 0)) {
        throw new Error('Choose an active supplier and enter valid positive quantities and non-negative unit costs for every stock item.')
      }
      return send(storage, 'purchase_order.create', payload, { requiresManagerApproval: true, pin: managerPin })
    },
    receivePurchaseOrder(storage, order, receipt) {
      const lines = Array.isArray(receipt?.lines) ? receipt.lines.filter((line) => Number(line.quantity) > 0).map((line) => ({
        purchase_order_line_id: String(line.id || ''), quantity: String(line.quantity),
        lot_code: String(line.lot_code || '').trim() || null, expires_on: String(line.expires_on || '').trim() || null
      })) : []
      const payload = {
        purchase_order_id: String(order?.id || ''), expected_version: Number(order?.version),
        supplier_reference: String(receipt?.supplier_reference || '').trim() || null,
        lines
      }
      if (!UUID.test(payload.purchase_order_id) || !Number.isSafeInteger(payload.expected_version) || payload.expected_version < 1 || !lines.length ||
          lines.some((line) => !UUID.test(line.purchase_order_line_id) || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(line.quantity) || Number(line.quantity) <= 0)) {
        throw new Error('Enter a positive quantity for at least one outstanding purchase-order line.')
      }
      return send(storage, 'purchase_order.receive', payload)
    }
  }
}
