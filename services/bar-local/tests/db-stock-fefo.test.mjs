import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness, sha256Json } from './harness.mjs'

test('stock lot balances allocate sales by FEFO, preserve receipt history and refuse expired lots', async (t) => {
  const h = await createHarness(t)
  await assert.rejects(h.runtime.query('SELECT * FROM bar_local.stock_lots'), (error) => error.code === '42501')
  await assert.rejects(h.runtime.query('SELECT * FROM bar_local.stock_lot_events'), (error) => error.code === '42501')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'FEFO-DRINK', name: 'FEFO Drink', price: '8.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))

  const dates = await h.migrator.query(`SELECT
    to_char(bar_local.current_business_date() + 10, 'YYYY-MM-DD') AS first_expiry,
    to_char(bar_local.current_business_date() + 20, 'YYYY-MM-DD') AS second_expiry,
    to_char(bar_local.current_business_date() - 1, 'YYYY-MM-DD') AS expired`)
  for (const [quantity, lot_code, expires_on] of [
    ['4', 'FEFO-FIRST', dates.rows[0].first_expiry],
    ['4', 'FEFO-SECOND', dates.rows[0].second_expiry]
  ]) {
    const receipt = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
      product_id: product.result.product_id, quantity, lot_code, expires_on
    }))
    assert.equal(receipt.ok, true, JSON.stringify(receipt.error))
  }

  const shift = await h.openShift()
  const saleEnvelope = h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: product.result.product_id, quantity: '5' }],
    tenders: [{ method: 'cash', amount: '40.00', tendered: '40.00' }]
  })
  const sale = await h.call('cmd_sale_commit', saleEnvelope)
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const replay = await h.call('cmd_sale_commit', saleEnvelope)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))

  const lots = await h.query('stock.lot_balances', {})
  assert.equal(lots.complete, true)
  assert.equal(lots.scope.outlet_id, h.outletId)
  const byCode = new Map(lots.data.filter((row) => row.product_id === product.result.product_id).map((row) => [row.lot_code, row]))
  assert.equal(byCode.get('FEFO-FIRST')?.remaining_quantity, '0.000000')
  assert.equal(byCode.get('FEFO-FIRST')?.allocated_quantity, '4.000000')
  assert.equal(byCode.get('FEFO-SECOND')?.remaining_quantity, '3.000000')
  assert.equal(byCode.get('FEFO-SECOND')?.allocated_quantity, '1.000000')
  assert.equal(lots.data.filter((row) => row.product_id === product.result.product_id).reduce((sum, row) => sum + Number(row.remaining_quantity), 0), 3)

  const originalLine = (await h.migrator.query('SELECT id FROM bar_local.sale_lines WHERE sale_id=$1 AND product_id=$2', [sale.result.sale_id, product.result.product_id])).rows[0]
  const returnPayload = { sale_id: sale.result.sale_id, lines: [{ sale_line_id: originalLine.id, quantity: '1' }], reason: 'Return to original lot', disposition: 'restock' }
  const returnHash = sha256Json(returnPayload)
  const returned = await h.call('cmd_sale_return', h.envelope('sale.return', {
    ...returnPayload, approval_id: await h.approve('pos.void', returnHash)
  }), { approvalHash: returnHash })
  assert.equal(returned.ok, true, JSON.stringify(returned.error))
  const restored = await h.migrator.query(`SELECT child.parent_lot_id,child.source_kind,child.remaining_quantity::text AS remaining,
      parent.lot_code,parent.expires_on
    FROM bar_local.stock_lots child JOIN bar_local.stock_lots parent ON parent.id=child.parent_lot_id
   WHERE child.origin_movement_id=(SELECT id FROM bar_local.stock_movements WHERE operation_id=$1 AND reason='sale.return.restock')`, [returned.receipt.operation_id])
  assert.equal(restored.rows.length, 1)
  assert.equal(restored.rows[0].source_kind, 'sale.return.restock')
  assert.equal(restored.rows[0].lot_code, 'FEFO-FIRST')
  assert.equal(restored.rows[0].remaining, '1.000000')

  const expiredProduct = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'EXPIRED-DRINK', name: 'Expired Drink', price: '5.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(expiredProduct.ok, true, JSON.stringify(expiredProduct.error))
  const expiredReceipt = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: expiredProduct.result.product_id, quantity: '2', lot_code: 'PAST-DATE', expires_on: dates.rows[0].expired
  }))
  assert.equal(expiredReceipt.ok, true, JSON.stringify(expiredReceipt.error))
  const blocked = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: expiredProduct.result.product_id, quantity: '1' }],
    tenders: [{ method: 'cash', amount: '5.00', tendered: '5.00' }]
  }))
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'INSUFFICIENT_LOT_STOCK')
  const stock = await h.query('stock.list', {})
  assert.equal(stock.data.find((row) => row.product_id === expiredProduct.result.product_id)?.quantity, '2.000000')
})

test('selected-lot waste and inspected quarantine release are approved, versioned and outlet scoped', async (t) => {
  const h = await createHarness(t)
  const created = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'LOT-GUARD', name: 'Lot Guard Item', price: '4.00', tax_rate: '0', track_stock: true
  }))
  const productId = created.result.product_id
  for (const [quantity, lot_code] of [['3', 'WASTE-A'], ['4', 'WASTE-B']]) {
    assert.equal((await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: productId, quantity, lot_code }))).ok, true)
  }
  let lots = await h.query('stock.lot_balances', {})
  const lotA = lots.data.find((row) => row.product_id === productId && row.lot_code === 'WASTE-A')
  const lotB = lots.data.find((row) => row.product_id === productId && row.lot_code === 'WASTE-B')
  const wastePayload = { lot_id: lotA.lot_id, product_id: productId, expected_version: lotA.version, quantity: '1', reason: 'Damaged seal' }
  const wasteHash = sha256Json(wastePayload)
  const wasteEnvelope = h.envelope('stock.lot.waste', { ...wastePayload, approval_id: await h.approve('inventory.approve', wasteHash) })
  const waste = await h.call('cmd_stock_lot_waste', wasteEnvelope, { approvalHash: wasteHash })
  assert.equal(waste.ok, true, JSON.stringify(waste.error))
  assert.equal(Number(waste.result.remaining_quantity), 2)
  const wasteEvent = await h.migrator.query(`SELECT lot_id,event_kind,delta_quantity::text AS delta FROM bar_local.stock_lot_events WHERE stock_movement_id=(SELECT id FROM bar_local.stock_movements WHERE operation_id=$1)`, [waste.receipt.operation_id])
  assert.deepEqual(wasteEvent.rows[0], { lot_id: lotA.lot_id, event_kind: 'waste', delta: '-1.000000' })
  lots = await h.query('stock.lot_balances', {})
  assert.equal(lots.data.find((row) => row.lot_id === lotB.lot_id)?.remaining_quantity, '4.000000')

  await h.migrator.query('UPDATE bar_local.stock_balances SET quantity=quantity+1 WHERE business_id=$1 AND outlet_id=$2 AND product_id=$3', [h.businessId, h.outletId, productId])
  await h.migrator.query(`INSERT INTO bar_local.stock_movements(business_id,outlet_id,product_id,delta,reason,operation_id,business_date,reference)
    VALUES($1,$2,$3,1,'sale.return.restock',$4,bar_local.current_business_date(),'unlinked-return-for-inspection')`, [h.businessId, h.outletId, productId, randomUUID()])
  lots = await h.query('stock.lot_balances', {})
  const quarantine = lots.data.find((row) => row.product_id === productId && row.source_kind === 'sale_return_quarantine' && row.remaining_quantity === '1.000000')
  assert.ok(quarantine)
  const releasePayload = { lot_id: quarantine.lot_id, expected_version: quarantine.version, verified_lot_code: 'INSPECTED-A', verified_expires_on: null, no_expiry_confirmed: true, reason: 'Packaging and no-expiry label checked' }
  const releaseHash = sha256Json(releasePayload)
  const release = await h.call('cmd_stock_lot_release', h.envelope('stock.lot.release', {
    ...releasePayload, approval_id: await h.approve('inventory.approve', releaseHash)
  }), { approvalHash: releaseHash })
  assert.equal(release.ok, true, JSON.stringify(release.error))
  const released = (await h.query('stock.lot_balances', {})).data.find((row) => row.lot_id === quarantine.lot_id)
  assert.equal(released.sale_eligible, true)
  assert.equal(released.lot_code, 'INSPECTED-A')
  assert.equal(released.expiry_status, 'no_expiry')
})
