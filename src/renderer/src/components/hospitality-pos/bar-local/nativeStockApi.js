// @ts-check
import { loadCompleteBarList } from '../../../../../shared/barLocalPagination.js'

/** Compatibility for the original Stock screen. Only the fixed local bridge
 * is supplied here; no cloud API is reachable through this object.
 * @param {any} bridge @param {{canManageMenu?: boolean, onMutation?: ()=>Promise<void>}} [options]
 */
export function createLocalHposStockApi(bridge, options = {}) {
  let stock = []
  const list = (name, filters = {}) => loadCompleteBarList((query, page) => bridge.query(query, page), name, filters)
  const confirmed = (result) => {
    if (result?.outcome === 'committed_local') return { success: true, ...result.result, outcome: result.outcome }
    return { success: false, outcome: result?.outcome, operation_id: result?.operation_id,
      error: result?.outcome === 'unknown'
        ? 'The local outcome is unknown. Retry the saved operation below before starting another stock change.'
        : result?.error?.message || 'The local Bar service refused this stock change.' }
  }
  const command = async (name, payload, operationId = crypto.randomUUID(), pin = '') => {
    try {
      if (pin) {
        const approval = await bridge.requestApprovalForCommand({ command: name, payload, pin, operation_id: operationId })
        if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. Nothing was submitted.')
        payload = { ...payload, approval_id: approval.approval_id }
      }
      return confirmed(await bridge.command({ command: name, payload, operation_id: operationId }))
    } finally { await options.onMutation?.() }
  }
  const batch = (mode, request) => command('stock.batch.record', {
    mode, notes: request.notes || null,
    lines: request.lines.map((line) => ({ product_id: line.item_id,
      quantity: String(mode === 'count' ? line.actual_qty : line.quantity),
      expected_stock_version: mode === 'count' ? Number(line.expected_updated_at) : null,
      reason: [line.reason_code, line.reason, request.notes].filter(Boolean).join(' · ') || 'Stock delivery' }))
  }, request.operation_id)
  return {
    outlets: { getAll: async () => (await bridge.readHposMenu('outlets')).rows },
    pos: {
      getMenuItems: async () => (await bridge.readHposMenu('menu')).rows,
      getModifierGroups: async () => options.canManageMenu ? (await bridge.readHposMenu('modifiers')).groups : []
    },
    inventory: {
      getItemsWithReadStatus: async () => {
        const result = await bridge.readHposMenu('stock')
        if (result?.complete !== true || !Array.isArray(result.rows)) throw new Error('The local stock read is incomplete. Refresh before posting.')
        stock = result.rows
        return { items: stock, source: 'bar_local', complete: true }
      },
      getBarStockAging: async (outletId) => (await list('stock.aging', outletId ? { outlet_id: outletId } : {})).map((row) => ({ ...row,
        age_bucket: row.days_since_receipt == null ? 'No receipt history' : Number(row.days_since_receipt) >= 90 ? 'Critical — 90+ days' : Number(row.days_since_receipt) >= 30 ? '30+ days since receipt' : 'Recent receipt' })),
      getMovementsWithReadStatus: async (request) => ({
        rows: (await list('stock.history', { product_id: request.item_id })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
        source: 'bar_local', complete: true
      }),
      getBarStockCountHistory: async (outletId, limit = 200) => ({
        rows: (await list('stock.history', { counts_only: true, ...(outletId ? { outlet_id: outletId } : {}) }))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit),
        source: 'bar_local', complete: true
      }),
      updateItem: async (productId, request) => {
        const original = stock.find((row) => row.id === productId)
        if (!original) throw new Error('Refresh Stock before editing this item.')
        return command('catalogue.stock_item.save', {
          product_id: productId, expected_version: original.product_version, outlet_id: request.outlet_id || null,
          name: request.name, category: request.category, unit: request.unit,
          barcode: Object.hasOwn(request, 'barcode') ? request.barcode : original.barcode,
          reorder_level: String(request.reorder_level ?? 0), unit_cost: request.unit_cost == null ? null : String(request.unit_cost), opening_stock: '0'
        })
      },
      createItem: (request) => command('catalogue.stock_item.save', {
        name: request.name, category: request.category, unit: request.unit, barcode: request.barcode || null,
        outlet_id: request.outlet_id || null, reorder_level: String(request.reorder_level ?? 0),
        unit_cost: request.unit_cost == null ? null : String(request.unit_cost), opening_stock: String(request.current_stock ?? 0)
      }),
      postBarPhysicalCount: (request) => batch('count', request),
      postBarSimpleDelivery: (request) => batch('receive', request),
      adjustStock: (productId, delta, reason, _unused, operationId, pin = '') => {
        if (delta < 0) {
          if (!/^\d{4,12}$/.test(pin)) throw new Error('A different authorised manager must enter a 4–12 digit PIN to approve waste.')
          return command('stock.waste', { product_id: productId, quantity: String(-delta), reason }, operationId, pin)
        }
        return command('stock.batch.record', { mode: 'receive', notes: null,
          lines: [{ product_id: productId, quantity: String(delta), expected_stock_version: null, reason }] }, operationId)
      },
      findByBarcode: async (barcode, outletId) => {
        const result = await bridge.readHposMenu('stock')
        if (result?.complete !== true) throw new Error('Refresh Stock before scanning a delivery.')
        return result.rows.find((row) => row.is_active !== false && (!outletId || row.outlet_id === outletId)
          && String(row.barcode || '').toLowerCase() === String(barcode).trim().toLowerCase()) || null
      }
    }
  }
}
