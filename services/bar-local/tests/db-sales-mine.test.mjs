import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256Text, createHarness } from './harness.mjs'

async function commitSale(h, tokenHash, productId, shiftId) {
  const result = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId, items: [{ product_id: productId, quantity: '1' }], discount_amount: '0', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  }), { tokenHash })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result.sale_id
}

test('sales.mine paginates exact actor receipts and never returns another staff member sales', async (t) => {
  const h = await createHarness(t)
  const ownerShift = await h.openShift()
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'MINE-WATER', name: 'Water', category: 'Drinks', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const cashierId = await h.insertStaff('My Sales Cashier', 'cashier', ['pos.view', 'pos.manage'])
  const cashierToken = sha256Text('my-sales-cashier-session')
  await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [cashierId, h.deviceId, h.outletId, cashierToken])
  const cashierShift = await h.call('cmd_shift_open', h.envelope('shift.open', { opening_float: '0.00' }), { tokenHash: cashierToken })
  assert.equal(cashierShift.ok, true, JSON.stringify(cashierShift.error))
  await commitSale(h, cashierToken, product.result.product_id, cashierShift.result.shift_id)
  await commitSale(h, cashierToken, product.result.product_id, cashierShift.result.shift_id)
  await commitSale(h, h.ownerTokenHash, product.result.product_id, ownerShift)

  const first = await h.query('sales.mine', { limit: 1 }, { tokenHash: cashierToken })
  assert.equal(first.complete, true)
  assert.equal(first.data.length, 1)
  assert.equal(first.pagination.has_more, true)
  assert.match(first.pagination.next_cursor, /^\d{4}-\d{2}-\d{2}\|\d+$/)
  assert.equal(first.data[0].actor_staff_id, cashierId)
  assert.equal(first.data[0].payment_breakdown.reduce((sum, row) => sum + Number(row.amount), 0), Number(first.data[0].total))
  assert.equal(first.data[0].pos_order_items[0].item_name, 'Water')
  const second = await h.query('sales.mine', { limit: 1, cursor: first.pagination.next_cursor }, { tokenHash: cashierToken })
  assert.equal(second.data.length, 1)
  assert.equal(second.pagination.has_more, false)
  assert.ok([...first.data, ...second.data].every((row) => row.actor_staff_id === cashierId))
  const ownerRows = await h.query('sales.mine', {}, { tokenHash: h.ownerTokenHash })
  assert.equal(ownerRows.data.length, 1)
  assert.equal(ownerRows.data[0].actor_staff_id, h.ownerStaffId)
})

test('sales.mine enforces date range and POS-view capability at the service query contract', async (t) => {
  const h = await createHarness(t)
  await assert.rejects(h.query('sales.mine', { from: '2099-12-31', to: '2099-01-01' }), /before its start date|on or after/i)
  const noViewStaff = await h.insertStaff('No View', 'cashier', ['pos.manage'])
  const noViewToken = sha256Text('my-sales-no-view-session')
  await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [noViewStaff, h.deviceId, h.outletId, noViewToken])
  await assert.rejects(h.query('sales.mine', {}, { tokenHash: noViewToken }), /not authorised|capability/i)
})
