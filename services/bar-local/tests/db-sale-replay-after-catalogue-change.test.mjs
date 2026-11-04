import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('a committed sale replays its original receipt and stock effect after its product price changes', async (t) => {
  const h = await createHarness(t)
  const created = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'REPLAY-PRICE-1', name: 'Replay price item', category: 'Drinks', price: '10.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(created.ok, true, JSON.stringify(created.error))
  const productId = created.result.product_id

  const received = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: productId, quantity: '2.000000', unit_cost: '3.0000', supplier_ref: 'REPLAY-PRICE-RECEIPT'
  }))
  assert.equal(received.ok, true, JSON.stringify(received.error))
  const shiftId = await h.openShift()
  const saleEnvelope = h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1.000000' }],
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  })
  const first = await h.call('cmd_sale_commit', saleEnvelope)
  assert.equal(first.ok, true, JSON.stringify(first.error))
  assert.equal(first.result.receipt.total, 10)

  const changed = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    product_id: productId, expected_version: 1, sku: 'REPLAY-PRICE-1', name: 'Replay price item',
    category: 'Drinks', price: '12.50', tax_rate: '0', track_stock: true, active: true
  }))
  assert.equal(changed.ok, true, JSON.stringify(changed.error))

  const replay = await h.call('cmd_sale_commit', saleEnvelope)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.receipt.total, 10)
  assert.equal(replay.result.receipt.receipt_number, first.result.receipt.receipt_number)

  const stock = await h.query('stock.list')
  assert.equal(stock.data.find((item) => item.product_id === productId).quantity, '1.000000')
  const sales = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.sales WHERE business_id = $1 AND shift_id = $2', [h.businessId, shiftId])
  assert.equal(sales.rows[0].count, 1)
})
