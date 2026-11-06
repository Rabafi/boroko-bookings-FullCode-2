import { createLocalHposStockApi } from '../hospitality-pos/bar-local/nativeStockApi.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createReader(bridge, expectedScope) {
  const scope = {
    business_id: String(expectedScope?.businessId || ''),
    outlet_id: String(expectedScope?.outletId || ''),
    actor_staff_id: String(expectedScope?.staffId || '')
  }
  if (Object.values(scope).some(value => !UUID.test(value))) throw new Error('The local Stock Pro scope could not be verified. Sign in again before continuing.')

  return async (name, filters = {}) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rows = []
      const ids = new Set()
      const cursors = new Set()
      let cursor = null
      let watermark = null
      let changed = false
      for (let page = 0; page < 100; page += 1) {
        const result = await bridge.query(name, { ...filters, limit: 200, ...(cursor ? { cursor } : {}) })
        if (result?.complete !== true || !Array.isArray(result.data) || !Array.isArray(result.unavailable) || result.unavailable.length !== 0 ||
            !Number.isSafeInteger(result.snapshot_watermark) || result.snapshot_watermark < 0 ||
            result.scope?.business_id !== scope.business_id || result.scope?.outlet_id !== scope.outlet_id ||
            result.scope?.actor_staff_id !== scope.actor_staff_id || typeof result.pagination?.has_more !== 'boolean') {
          throw new Error('The local Stock Pro list is incomplete or has the wrong Bar/outlet scope. Refresh before relying on it.')
        }
        if (watermark !== null && watermark !== result.snapshot_watermark) { changed = true; break }
        watermark = result.snapshot_watermark
        for (const row of result.data) {
          const id = String(row?.id || row?.movement_id || row?.supplier_id || row?.purchase_order_id || row?.product_id || '')
          if (!row || typeof row !== 'object' || Array.isArray(row) || !id || ids.has(id)) throw new Error('The local Stock Pro list contains an invalid or duplicated row.')
          ids.add(id)
          rows.push(row)
        }
        if (!result.pagination.has_more) return { rows, watermark }
        cursor = result.pagination.next_cursor
        if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || result.data.length === 0) throw new Error('The local Stock Pro pagination is invalid. Refresh before relying on it.')
        cursors.add(cursor)
      }
      if (!changed) throw new Error('The local Stock Pro list exceeds its safe page limit.')
    }
    throw new Error('Stock changed while loading. Refresh the page before relying on inventory totals.')
  }
}

export function createBarLocalRestaurantStockApi(bridge, expectedScope, options = {}) {
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.readHposMenu !== 'function' || typeof bridge.command !== 'function') {
    throw new Error('The local Stock Pro service is unavailable. Restart the Bar app after updating it.')
  }
  const expected = {
    business_id: String(expectedScope?.businessId || ''),
    outlet_id: String(expectedScope?.outletId || ''),
    actor_staff_id: String(expectedScope?.staffId || '')
  }
  const read = createReader(bridge, expectedScope)
  const stockCommands = createLocalHposStockApi(bridge, options)

  return {
    inventory: {
      ...stockCommands.inventory,
      async getRestaurantStockSnapshot(movementDate) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const [stock, movements, counts] = await Promise.all([
            read('stock.list'), read('stock.history'), read('stock.history', { counts_only: true })
          ])
          if (stock.watermark !== movements.watermark || stock.watermark !== counts.watermark) continue
          const items = stock.rows.filter(row => row.track_stock === true).map(row => ({
            id: String(row.product_id), name: String(row.name || ''), category: row.category || null,
            unit: row.unit || 'each', current_stock: row.quantity ?? 0, reorder_level: row.reorder_level ?? 0,
            latest_unit_cost: row.unit_cost ?? 0, unit_cost: row.unit_cost ?? 0,
            is_active: row.active === true, product_version: row.product_version, stock_version: row.version
          }))
          const byId = new Map(items.map(item => [item.id, item]))
          const movementRows = movements.rows.filter(row => String(row.created_at || '').slice(0, 10) === movementDate).map(row => ({
            id: String(row.id), created_at: row.created_at, item_name: byId.get(String(row.item_id || row.product_id))?.name || 'Inventory item',
            movement_type: row.movement_type || 'stock movement', quantity: row.quantity ?? row.delta ?? '0', notes: row.notes || null
          }))
          const countGroups = new Map()
          for (const row of counts.rows) {
            const operationId = String(row.operation_id || '')
            if (!UUID.test(operationId)) throw new Error('The local stock count history has an invalid operation identity.')
            const group = countGroups.get(operationId) || { id: operationId, title: `Physical count · ${String(row.created_at || '').slice(0, 10)}`, status: 'posted', created_at: row.created_at }
            countGroups.set(operationId, group)
          }
          const lowStock = items.filter(item => Number(item.reorder_level) > 0 && Number(item.current_stock) <= Number(item.reorder_level))
          return { items, lowStock, movements: movementRows, stocktakes: [...countGroups.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), complete: true, snapshot_watermark: stock.watermark }
        }
        throw new Error('Stock changed while reading its movements. Refresh before relying on the displayed list.')
      },
      async getLotExpirySnapshot(horizonDays) {
        const horizon = Number(horizonDays)
        if (![7, 14, 30, 60].includes(horizon)) throw new Error('Choose a supported local expiry horizon.')
        const [stock, lots] = await Promise.all([read('stock.list'), read('stock.lot_expiry')])
        if (stock.watermark !== lots.watermark) throw new Error('Stock changed while loading lot expiry history. Refresh before relying on it.')
        const now = new Date()
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const until = new Date(`${today}T00:00:00.000Z`)
        until.setUTCDate(until.getUTCDate() + horizon)
        const endDate = until.toISOString().slice(0, 10)
        const names = new Map(stock.rows.map(row => [String(row.product_id), String(row.name || 'Inventory item')]))
        const rows = lots.rows.filter(row => typeof row.expires_on === 'string' && row.expires_on <= endDate).map(row => ({
          id: String(row.movement_id), inventory_item_id: String(row.product_id),
          inventory_item_name: names.get(String(row.product_id)) || String(row.name || 'Inventory item'),
          lot_code: row.lot_code || null, expires_on: row.expires_on,
          received_quantity: row.received_quantity ?? '0', unit_cost: row.unit_cost ?? null,
          supplier_reference: row.supplier_reference || null, received_at: row.received_at || null,
          reason: row.reason || null
        }))
        return { rows, business_date: today, complete: true, snapshot_watermark: stock.watermark }
      },
      async getPurchasingSnapshot() {
        const [supplierResult, orderResult, stockResult] = await Promise.all([
          read('suppliers.list'), read('purchase_orders.list'), read('stock.list')
        ])
        if (new Set([supplierResult.watermark, orderResult.watermark, stockResult.watermark]).size !== 1) {
          throw new Error('Local purchasing records changed while loading. Refresh before relying on them.')
        }
        const details = await Promise.all(orderResult.rows.map(async (row) => {
          const orderId = String(row.purchase_order_id || '')
          if (!UUID.test(orderId)) throw new Error('The local purchase order list contains an invalid order identity.')
          const detail = await bridge.query('purchase_order.get', { purchase_order_id: orderId })
          if (detail?.complete !== true || detail.unavailable?.length || !detail.data || Array.isArray(detail.data) ||
              detail.snapshot_watermark !== orderResult.watermark || detail.scope?.business_id !== expected.business_id ||
              detail.scope?.outlet_id !== expected.outlet_id || detail.scope?.actor_staff_id !== expected.actor_staff_id ||
              String(detail.data.purchase_order_id || '') !== orderId) {
            throw new Error('Purchasing records changed or are incomplete while loading order details. Refresh before relying on them.')
          }
          return detail.data
        }))
        const supplierRows = supplierResult.rows.map(row => {
          const id = String(row.supplier_id || '')
          if (!UUID.test(id) || typeof row.name !== 'string' || !row.name.trim() || !Number.isSafeInteger(row.version) ||
              row.version < 1 || typeof row.active !== 'boolean') throw new Error('The local supplier list contains incomplete supplier data.')
          return {
            id, name: row.name, contact_person: row.contact_name || null,
            phone: row.phone || null, email: row.email || null, address: row.address || null,
            payment_terms: null, version: row.version, is_active: row.active
          }
        })
        const suppliers = new Map(supplierRows.map(row => [row.id, row]))
        const orders = details.map(detail => {
          const supplierId = String(detail.supplier?.supplier_id || '')
          if (!UUID.test(supplierId) || !['ordered', 'partially_received', 'received', 'cancelled'].includes(detail.status) || !Array.isArray(detail.lines)) {
            throw new Error('A local purchase order has incomplete supplier, state or line details.')
          }
          const supplier = suppliers.get(supplierId)
          const status = detail.status === 'ordered' ? 'approved' : detail.status
          return {
            id: String(detail.purchase_order_id), supplier_id: supplierId, stock_location_id: expected.outlet_id,
            stock_location_name: 'This Bar outlet', status, order_date: detail.ordered_on,
            expected_delivery: detail.expected_on || null, notes: detail.notes || null, total: detail.total,
            created_at: detail.created_at || null, updated_at: detail.updated_at || null,
            supplier_name: supplier?.name || detail.supplier?.name || 'Supplier',
            supplier: supplier ? { name: supplier.name, contact_person: supplier.contact_person, phone: supplier.phone, email: supplier.email } : null,
            items: detail.lines.map(line => {
              if (!UUID.test(String(line.purchase_order_line_id || '')) || !UUID.test(String(line.product_id || '')) ||
                  !Number.isFinite(Number(line.quantity_ordered)) || Number(line.quantity_ordered) <= 0 ||
                  !Number.isFinite(Number(line.quantity_received)) || !Number.isFinite(Number(line.quantity_remaining)) ||
                  !Number.isFinite(Number(line.unit_cost)) || !Number.isFinite(Number(line.line_total))) {
                throw new Error('A local purchase-order line contains incomplete quantity or cost data.')
              }
              return {
                id: String(line.purchase_order_line_id), inventory_item_id: String(line.product_id),
                description: String(line.name_snapshot || 'Inventory item'), quantity: line.quantity_ordered,
                quantity_received: line.quantity_received, quantity_remaining: line.quantity_remaining,
                unit_cost: line.unit_cost, total: line.line_total, unit: 'unit'
              }
            })
          }
        })
        const inventoryItems = stockResult.rows.filter(row => row.track_stock === true && row.active === true).map(row => ({
          id: String(row.product_id), name: String(row.name || ''), unit: row.unit || 'unit',
          latest_unit_cost: row.unit_cost ?? null, unit_cost: row.unit_cost ?? null
        }))
        return { suppliers: supplierRows, orders, inventoryItems, complete: true, snapshot_watermark: orderResult.watermark }
      },
      async getPurchaseSuggestionsSnapshot() {
        const result = await read('stock.list')
        const suggestions = result.rows.filter(row => row.track_stock === true && row.active === true &&
          Number.isFinite(Number(row.quantity)) && Number.isFinite(Number(row.reorder_level)) &&
          Number(row.reorder_level) > 0 && Number(row.quantity) <= Number(row.reorder_level)).map(row => ({
          inventory_item_id: String(row.product_id), inventory_item_name: String(row.name || 'Inventory item'),
          current_stock: row.quantity, reorder_level: row.reorder_level,
          suggested_quantity: String(Math.max(0, Number(row.reorder_level) - Number(row.quantity))),
          last_unit_cost: row.unit_cost ?? null, supplier_id: null, supplier_name: null
        }))
        return { suggestions, complete: true, snapshot_watermark: result.watermark }
      }
    }
  }
}
