import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

function commitEnvelope(h, shiftId, items, tender) {
  return h.envelope('sale.commit', {
    shift_id: shiftId,
    items,
    discount_amount: '0',
    tip_amount: '0',
    tenders: [tender]
  })
}

test('sales summary reconciles gross, returns, voids and tenders', async (t) => {
  const h = await createHarness(t)
  await h.seedShiftCatalogue()
  const date = await businessDate(h)

  const shift = await h.call('cmd_shift_open', h.envelope('shift.open', { opening_float: '100.00' }))
  assert.equal(shift.ok, true, JSON.stringify(shift.error))
  const shiftId = shift.result.shift_id

  const beer = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'BEER-330', name: 'Stout 330ml', category: 'Beer', price: '10.00', tax_rate: '0.14', track_stock: false
  }))
  assert.equal(beer.ok, true, JSON.stringify(beer.error))
  const food = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'FOOD-1', name: 'Bar snack', category: 'Food', price: '20.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(food.ok, true, JSON.stringify(food.error))

  const firstSale = await h.call('cmd_sale_commit', commitEnvelope(h, shiftId, [
    { product_id: beer.result.product_id, quantity: '2' }
  ], { method: 'cash', amount: '22.80', tendered: '25.00' }))
  assert.equal(firstSale.ok, true, JSON.stringify(firstSale.error))
  const firstSaleId = firstSale.result.sale_id

  const secondSale = await h.call('cmd_sale_commit', commitEnvelope(h, shiftId, [
    { product_id: food.result.product_id, quantity: '1' }
  ], { method: 'card', amount: '20.00', reference: 'CARD-1' }))
  assert.equal(secondSale.ok, true, JSON.stringify(secondSale.error))
  const secondSaleId = secondSale.result.sale_id

  const returnPayload = {
    sale_id: firstSaleId,
    lines: [{ sale_line_id: firstSale.result.receipt.lines[0].sale_line_id, quantity: '1' }],
    reason: 'Customer changed mind',
    disposition: 'restock'
  }
  const returnHash = sha256Json(returnPayload)
  const returnApproval = await h.approve('pos.void', returnHash, { targetType: 'sale', targetId: firstSaleId })
  const returnEnvelope = h.envelope('sale.return', { ...returnPayload, approval_id: returnApproval })
  const returned = await h.callWith(h.runtime, 'cmd_sale_return', returnEnvelope, { hash: returnHash, approvalHash: returnHash })
  assert.equal(returned.ok, true, JSON.stringify(returned.error))
  assert.equal(Number(returned.result.total), -11.4)

  const voidPayload = { sale_id: secondSaleId, reason: 'Wrong order' }
  const voidHash = sha256Json(voidPayload)
  const voidApproval = await h.approve('pos.void', voidHash, { targetType: 'sale', targetId: secondSaleId })
  const voidEnvelope = h.envelope('sale.void', { ...voidPayload, approval_id: voidApproval })
  const voided = await h.callWith(h.runtime, 'cmd_sale_void', voidEnvelope, { hash: voidHash, approvalHash: voidHash })
  assert.equal(voided.ok, true, JSON.stringify(voided.error))
  assert.equal(Number(voided.result.total), -20)

  const summary = await h.query('reports.sales_summary', { from: date, to: date, shift_id: shiftId })
  assert.equal(summary.complete, true)
  assert.equal(summary.pagination.has_more, false)
  assert.equal(summary.data.period.from, date)
  assert.equal(Number(summary.data.totals.gross_sales), 42.8)
  assert.equal(Number(summary.data.totals.returns), 11.4)
  assert.equal(Number(summary.data.totals.voids), 20)
  assert.equal(Number(summary.data.totals.net_sales), 11.4)
  assert.equal(Number(summary.data.totals.tax), 1.4)
  assert.equal(Number(summary.data.totals.tips), 0)
  assert.equal(Number(summary.data.totals.sale_count), 1)
  assert.equal(Number(summary.data.totals.average_sale), 11.4)

  const cash = summary.data.by_tender.find((row) => row.method === 'cash')
  const card = summary.data.by_tender.find((row) => row.method === 'card')
  assert.equal(Number(cash.amount), 11.4)
  assert.equal(Number(card.amount), 0)

  const beerRow = summary.data.by_product.find((row) => row.sku === 'BEER-330')
  const foodRow = summary.data.by_product.find((row) => row.sku === 'FOOD-1')
  assert.equal(Number(beerRow.quantity), 1)
  assert.equal(Number(beerRow.net_sales), 11.4)
  assert.equal(Number(foodRow.quantity), 0)
  assert.equal(Number(foodRow.net_sales), 0)

  const beerCategory = summary.data.by_category.find((row) => row.category === 'Beer')
  assert.equal(Number(beerCategory.net_sales), 11.4)
  assert.equal(Number(summary.data.by_day[0].net_sales), 11.4)
  assert.equal(summary.data.by_day[0].business_date, date)
})
