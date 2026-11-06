import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalRestaurantStockApi } from '../../src/renderer/src/components/restaurant/barLocalRestaurantStockApi.js'

const scope = { business_id: '11111111-1111-4111-8111-111111111111', outlet_id: '22222222-2222-4222-8222-222222222222', actor_staff_id: '33333333-3333-4333-8333-333333333333', device_id: '44444444-4444-4444-8444-444444444444' }
const productId = '55555555-5555-4555-8555-555555555555'
const operationId = '66666666-6666-4666-8666-666666666666'
const supplierId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const orderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orderLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function makeBridge({ watermarkFor = () => 9, wrongOutlet = false, lowStock = false } = {}) {
  const calls = []
  const item = { id: productId, name: 'Bottled water', category: 'Beverages', unit: 'bottle', current_stock: '12.00', is_active: true, track_stock: true, reorder_level: '5.00', latest_unit_cost: '3.50', product_version: 2, stock_version: 4, updated_at: '4', outlet_id: scope.outlet_id }
  return {
    calls,
    async query(name, filters = {}) {
      calls.push([name, filters])
      let data = []
      if (name === 'stock.list') data = [{ product_id: productId, name: 'Bottled water', category: 'Beverages', unit: 'bottle', track_stock: true, active: true, quantity: lowStock ? '4.00' : '12.00', version: 4, product_version: 2, reorder_level: '5.00', unit_cost: '3.50' }]
      if (name === 'stock.lot_expiry') data = [
        { movement_id: '88888888-8888-4888-8888-888888888888', product_id: productId, name: 'Bottled water', lot_code: 'LOT-1', expires_on: '2026-11-12', received_quantity: '6.00', unit_cost: '3.50', reason: 'purchase.receive' },
        { movement_id: '99999999-9999-4999-8999-999999999999', product_id: productId, lot_code: 'LOT-FUTURE', expires_on: '2027-02-12', received_quantity: '9.00' }
      ]
      if (name === 'stock.history' && filters.counts_only) data = [{ id: `${operationId}:1`, operation_id: operationId, created_at: '2026-11-05T10:00:00.000Z', item_id: productId, item_name: 'Bottled water', actual_qty: '12.00' }]
      if (name === 'stock.history' && !filters.counts_only) data = [{ id: '77777777-7777-4777-8777-777777777777', item_id: productId, quantity: '2.00', movement_type: 'stock.receive', created_at: '2026-11-05T09:00:00.000Z', notes: 'Delivery' }]
      if (name === 'suppliers.list') data = [{ supplier_id: supplierId, name: 'Local Supplier', contact_name: 'A. Person', phone: '70000000', email: 'supplier@example.test', active: true, version: 3 }]
      if (name === 'purchase_orders.list') data = [{ purchase_order_id: orderId, po_number: 'PO-000001' }]
      if (name === 'purchase_order.get') data = { purchase_order_id: orderId, supplier: { supplier_id: supplierId, name: 'Local Supplier', email: 'supplier@example.test' }, status: 'ordered', ordered_on: '2026-11-05', total: '42.00', lines: [{ purchase_order_line_id: orderLineId, product_id: productId, name_snapshot: 'Bottled water', quantity_ordered: '12.00', quantity_received: '0', quantity_remaining: '12.00', unit_cost: '3.50', line_total: '42.00' }] }
      return { data, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, snapshot_watermark: watermarkFor(name, filters), scope: { ...scope, ...(wrongOutlet ? { outlet_id: '99999999-9999-4999-8999-999999999999' } : {}) } }
    },
    async readHposMenu(kind) { assert.equal(kind, 'stock'); return { rows: [item], complete: true, snapshot: `9|${scope.business_id}|${scope.outlet_id}` } },
    async getOpenIntents() { return [] },
    async command(request) { calls.push(['command', request]); return { outcome: 'committed_local', operation_id: request.operation_id, result: { product_id: productId } } },
    async requestApprovalForCommand() { throw new Error('Unexpected approval request') },
    async retryOperation() { throw new Error('Unexpected retry') }
  }
}

const createApi = bridge => createBarLocalRestaurantStockApi(bridge, { businessId: scope.business_id, outletId: scope.outlet_id, staffId: scope.actor_staff_id })

test('original Stock Pro reads a consistent local stock, movement and count-history snapshot', async () => {
  const bridge = makeBridge()
  const api = createApi(bridge)
  const prime = await api.inventory.getItemsWithReadStatus()
  assert.equal(prime.complete, true)
  const snapshot = await api.inventory.getRestaurantStockSnapshot('2026-11-05')
  assert.equal(snapshot.complete, true)
  assert.equal(snapshot.items[0].name, 'Bottled water')
  assert.equal(snapshot.items[0].current_stock, '12.00')
  assert.equal(snapshot.lowStock.length, 0)
  assert.equal(snapshot.movements[0].item_name, 'Bottled water')
  assert.equal(snapshot.movements[0].quantity, '2.00')
  assert.deepEqual(snapshot.stocktakes.map(row => [row.id, row.status]), [[operationId, 'posted']])
  assert.equal(bridge.calls.filter(([name]) => name === 'stock.list').length, 1)
})

test('original Stock Pro refuses a wrong outlet and mixed snapshots', async () => {
  await assert.rejects(createApi(makeBridge({ wrongOutlet: true })).inventory.getRestaurantStockSnapshot('2026-11-05'), /scope/)
  const bridge = makeBridge({ watermarkFor: name => name === 'stock.list' ? 9 : 10 })
  const api = createApi(bridge)
  await api.inventory.getItemsWithReadStatus()
  await assert.rejects(api.inventory.getRestaurantStockSnapshot('2026-11-05'), /changed while reading/)
})

test('original Stock Pro item creation uses the local atomic catalogue command', async () => {
  const bridge = makeBridge()
  const api = createApi(bridge)
  const result = await api.inventory.createItem({ name: 'Glass water', category: 'Beverages', unit: 'bottle', current_stock: 6, reorder_level: 2, unit_cost: 3.5 })
  assert.equal(result.success, true)
  const command = bridge.calls.find(([name]) => name === 'command')?.[1]
  assert.equal(command.command, 'catalogue.stock_item.save')
  assert.equal(command.payload.opening_stock, '6')
  assert.equal(command.payload.unit_cost, '3.5')
})

test('original Lots & Expiry reads only scoped local receipt history and labels quantity semantics', async () => {
  const api = createApi(makeBridge())
  const snapshot = await api.inventory.getLotExpirySnapshot(14)
  assert.equal(snapshot.complete, true)
  assert.equal(snapshot.rows.length, 1)
  assert.equal(snapshot.rows[0].inventory_item_name, 'Bottled water')
  assert.equal(snapshot.rows[0].received_quantity, '6.00')
  assert.equal(Object.hasOwn(snapshot.rows[0], 'remaining_quantity'), false)
  await assert.rejects(api.inventory.getLotExpirySnapshot(21), /supported local expiry/)
})

test('original Purchasing Pro reads local suppliers and detailed orders at one watermark', async () => {
  const snapshot = await createApi(makeBridge()).inventory.getPurchasingSnapshot()
  assert.equal(snapshot.complete, true)
  assert.equal(snapshot.suppliers[0].name, 'Local Supplier')
  assert.equal(snapshot.suppliers[0].version, 3)
  assert.equal(snapshot.orders[0].status, 'approved')
  assert.equal(snapshot.orders[0].stock_location_name, 'This Bar outlet')
  assert.equal(snapshot.orders[0].items[0].quantity_remaining, '12.00')
  const bridge = makeBridge({ watermarkFor: name => name === 'purchase_order.get' ? 10 : 9 })
  await assert.rejects(createApi(bridge).inventory.getPurchasingSnapshot(), /changed or are incomplete/)
})

test('original Purchase Suggestions derives an outlet-scoped reorder quantity from local stock', async () => {
  const snapshot = await createApi(makeBridge({ lowStock: true })).inventory.getPurchaseSuggestionsSnapshot()
  assert.equal(snapshot.complete, true)
  assert.equal(snapshot.suggestions.length, 1)
  assert.equal(snapshot.suggestions[0].inventory_item_name, 'Bottled water')
  assert.equal(snapshot.suggestions[0].suggested_quantity, '1')
  assert.equal(snapshot.suggestions[0].supplier_id, null)
})
