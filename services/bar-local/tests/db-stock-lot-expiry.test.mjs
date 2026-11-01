import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('lot expiry report is outlet scoped and labels receipt quantity without claiming remaining stock', async (t) => {
  const h = await createHarness(t)
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'LOT-DRINK', name: 'Lot Drink', price: '8.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const date = await h.migrator.query("SELECT to_char(bar_local.current_business_date() + 20, 'YYYY-MM-DD') AS expiry")
  const receipt = h.envelope('stock.receive', {
    product_id: product.result.product_id, quantity: '12', lot_code: 'BATCH-20', expires_on: date.rows[0].expiry,
    supplier_ref: 'DELIVERY-LOT-20'
  })
  const received = await h.call('cmd_stock_receive', receipt)
  assert.equal(received.ok, true, JSON.stringify(received.error))

  const report = await h.query('stock.lot_expiry', {})
  assert.equal(report.complete, true)
  assert.equal(report.scope.outlet_id, h.outletId)
  assert.equal(report.quantity_semantics, 'received_quantity_only; remaining on-hand by lot is not tracked')
  assert.equal(report.data.length, 1)
  assert.equal(report.data[0].lot_code, 'BATCH-20')
  assert.equal(report.data[0].received_quantity, '12.000000')
  assert.equal(report.data[0].expiry_status, 'expiring_soon')

  const saleShift = await h.openShift()
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: saleShift, items: [{ product_id: product.result.product_id, quantity: '2' }],
    tenders: [{ method: 'cash', amount: '16.00', tendered: '16.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const afterSale = await h.query('stock.lot_expiry', {})
  assert.equal(afterSale.data[0].received_quantity, '12.000000', 'receipt history must not imply lot allocation or current quantity')
})
