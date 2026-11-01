import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

async function createProduct(h, sku, name, taxRate = '0.14') {
  const env = h.envelope('catalogue.upsert', {
    sku,
    name,
    category: 'Stock',
    price: '10.00',
    tax_rate: taxRate,
    track_stock: true
  })
  const result = await h.call('cmd_catalogue_upsert', env)
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result
}

async function createSupplier(h, name) {
  const env = h.envelope('supplier.upsert', { name, contact_name: 'Buyer', phone: '+26770000001' })
  const result = await h.call('cmd_supplier_upsert', env)
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result
}

async function createPurchaseOrder(h, supplierId, lines, operationId = undefined) {
  const env = h.envelope('purchase_order.create', {
    supplier_id: supplierId,
    notes: 'Weekly order',
    lines
  }, operationId)
  const hash = sha256Json(env.payload)
  env.payload.approval_id = await h.approve('inventory.approve', hash, { targetType: 'purchase_order' })
  const result = await h.call('cmd_purchase_order_create', env, { approvalHash: hash })
  return { env, result }
}

test('purchasing supports suppliers, approved orders, partial receipts and guarded completion', async (t) => {
  const h = await createHarness(t)
  const productA = await createProduct(h, 'PUR-A', 'Purchase Product A')
  const productB = await createProduct(h, 'PUR-B', 'Purchase Product B', '0')

  const supplier = await createSupplier(h, 'Acme Distributors')
  const duplicate = await h.call('cmd_supplier_upsert', h.envelope('supplier.upsert', { name: 'acme distributors' }))
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'DUPLICATE_RECORD')

  const supplierUpdate = h.envelope('supplier.upsert', {
    supplier_id: supplier.supplier_id,
    expected_version: supplier.version,
    name: 'Acme Distributors Ltd',
    contact_name: 'Updated Buyer'
  })
  const updated = await h.call('cmd_supplier_upsert', supplierUpdate)
  assert.equal(updated.ok, true, JSON.stringify(updated.error))
  assert.equal(updated.result.version, 2)

  const staleUpdate = h.envelope('supplier.upsert', {
    supplier_id: supplier.supplier_id,
    expected_version: 1,
    name: 'Stale Name'
  })
  const stale = await h.call('cmd_supplier_upsert', staleUpdate)
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'SUPPLIER_VERSION_CONFLICT')

  const { env: orderEnv, result: order } = await createPurchaseOrder(h, supplier.supplier_id, [
    { product_id: productA.product_id, quantity: '10', unit_cost: '4.5000' },
    { product_id: productB.product_id, quantity: '3', unit_cost: '2.0000' }
  ])
  assert.equal(order.ok, true, JSON.stringify(order.error))
  assert.match(order.result.po_number, /^PO-\d{6}$/)
  assert.equal(order.result.status, 'ordered')
  assert.equal(order.result.line_count, 2)

  const replay = await h.call('cmd_purchase_order_create', orderEnv, { approvalHash: sha256Json({ ...orderEnv.payload, approval_id: undefined }) })
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.purchase_order_id, order.result.purchase_order_id)

  const list = await h.query('purchase_orders.list', { status: 'ordered' })
  assert.equal(list.data.length, 1)
  assert.equal(list.data[0].purchase_order_id, order.result.purchase_order_id)

  const detail = await h.query('purchase_order.get', { purchase_order_id: order.result.purchase_order_id })
  assert.equal(detail.data.lines.length, 2)
  assert.equal(Number(detail.data.total), 57.30)
  const lineA = detail.data.lines.find((line) => line.product_id === productA.product_id)
  const lineB = detail.data.lines.find((line) => line.product_id === productB.product_id)

  const overReceipt = await h.call('cmd_purchase_order_receive', h.envelope('purchase_order.receive', {
    purchase_order_id: order.result.purchase_order_id,
    expected_version: order.result.version,
    lines: [{ purchase_order_line_id: lineA.purchase_order_line_id, quantity: '11' }]
  }))
  assert.equal(overReceipt.ok, false)
  assert.equal(overReceipt.error.code, 'PURCHASE_OVER_RECEIPT')

  const partialEnvelope = h.envelope('purchase_order.receive', {
    purchase_order_id: order.result.purchase_order_id,
    expected_version: order.result.version,
    supplier_reference: 'INV-100',
    lines: [
      { purchase_order_line_id: lineA.purchase_order_line_id, quantity: '4', lot_code: 'LOT-A', expires_on: '2027-01-31' },
      { purchase_order_line_id: lineB.purchase_order_line_id, quantity: '3' }
    ]
  })
  const partial = await h.call('cmd_purchase_order_receive', partialEnvelope)
  assert.equal(partial.ok, true, JSON.stringify(partial.error))
  assert.equal(partial.result.status, 'partially_received')
  assert.equal(partial.result.line_count, 2)
  assert.equal(Number(partial.result.total), 26.52)

  const stock = await h.query('stock.list', {})
  const stockA = stock.data.find((row) => row.product_id === productA.product_id)
  const stockB = stock.data.find((row) => row.product_id === productB.product_id)
  assert.equal(Number(stockA.quantity), 4)
  assert.equal(Number(stockB.quantity), 3)

  const lots = await h.migrator.query(
    `SELECT product_id, delta, unit_cost, lot_code, expires_on, reference
       FROM bar_local.stock_movements WHERE reason = 'purchase.receive' ORDER BY product_id`
  )
  assert.equal(lots.rows.length, 2)
  assert.equal(lots.rows.find((row) => row.product_id === productA.product_id).lot_code, 'LOT-A')
  assert.equal(lots.rows.find((row) => row.product_id === productA.product_id).reference, 'INV-100')

  const staleReceipt = await h.call('cmd_purchase_order_receive', h.envelope('purchase_order.receive', {
    purchase_order_id: order.result.purchase_order_id,
    expected_version: order.result.version,
    lines: [{ purchase_order_line_id: lineA.purchase_order_line_id, quantity: '1' }]
  }))
  assert.equal(staleReceipt.ok, false)
  assert.equal(staleReceipt.error.code, 'PURCHASE_ORDER_VERSION_CONFLICT')

  const finishEnvelope = h.envelope('purchase_order.receive', {
    purchase_order_id: order.result.purchase_order_id,
    expected_version: partial.result.version,
    lines: [{ purchase_order_line_id: lineA.purchase_order_line_id, quantity: '6', lot_code: 'LOT-B' }]
  })
  const finished = await h.call('cmd_purchase_order_receive', finishEnvelope)
  assert.equal(finished.ok, true, JSON.stringify(finished.error))
  assert.equal(finished.result.status, 'received')

  const receivedDetail = await h.query('purchase_order.get', { purchase_order_id: order.result.purchase_order_id })
  assert.equal(receivedDetail.data.status, 'received')
  assert.equal(receivedDetail.data.receipts.length, 2)
  assert.equal(Number(receivedDetail.data.lines.find((line) => line.product_id === productA.product_id).quantity_received), 10)

  const cancelReceived = h.envelope('purchase_order.cancel', {
    purchase_order_id: order.result.purchase_order_id,
    expected_version: finished.result.version,
    reason: 'Should not be cancellable'
  })
  const cancelHash = sha256Json(cancelReceived.payload)
  cancelReceived.payload.approval_id = await h.approve('inventory.approve', cancelHash, { targetType: 'purchase_order' })
  const cancelRefused = await h.call('cmd_purchase_order_cancel', cancelReceived, { approvalHash: cancelHash })
  assert.equal(cancelRefused.ok, false)
  assert.equal(cancelRefused.error.code, 'PURCHASE_ORDER_STATE_CONFLICT')

  const second = await createPurchaseOrder(h, supplier.supplier_id, [
    { product_id: productA.product_id, quantity: '2', unit_cost: '5.0000' }
  ])
  assert.equal(second.result.ok, true, JSON.stringify(second.result.error))
  const cancelEnvelope = h.envelope('purchase_order.cancel', {
    purchase_order_id: second.result.result.purchase_order_id,
    expected_version: second.result.result.version,
    reason: 'Supplier cancelled delivery'
  })
  const secondHash = sha256Json(cancelEnvelope.payload)
  cancelEnvelope.payload.approval_id = await h.approve('inventory.approve', secondHash, { targetType: 'purchase_order' })
  const cancelled = await h.call('cmd_purchase_order_cancel', cancelEnvelope, { approvalHash: secondHash })
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled.error))
  assert.equal(cancelled.result.status, 'cancelled')

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log
      WHERE action IN ('supplier.created','supplier.updated','purchase_order.created','purchase_order.received','purchase_order.cancelled')
      ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'supplier.created', 'supplier.updated', 'purchase_order.created', 'purchase_order.received',
    'purchase_order.received', 'purchase_order.created', 'purchase_order.cancelled'
  ])
})
