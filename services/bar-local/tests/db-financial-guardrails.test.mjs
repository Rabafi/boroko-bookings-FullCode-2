import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createHarness, sha256Json, sha256Text } from './harness.mjs'
import { verifyRestoredDatabase } from '../dist/operations/backup.js'

async function product(h, sku, price, { track = false } = {}) {
  const result = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku, name: sku, category: 'Test', price, tax_rate: '0', track_stock: track
  }))
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result.product_id
}

async function createReturn(h, saleId, lineId, quantity) {
  const payload = { sale_id: saleId, lines: [{ sale_line_id: lineId, quantity }], reason: 'Guardrail regression', disposition: 'restock' }
  const approvalHash = sha256Json(payload)
  const approvalId = await h.approve('pos.void', approvalHash, { targetType: 'sale', targetId: saleId })
  const result = await h.callWith(h.runtime, 'cmd_sale_return', h.envelope('sale.return', { ...payload, approval_id: approvalId }), {
    hash: sha256Json({ ...payload, approval_id: approvalId }), approvalHash
  })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.receipt
}

test('split-tender penny refunds allocate every cent and repeated partial returns conserve original value', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const penny = await product(h, 'PENNY-RETURN', '0.01')
  const splitSale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId, items: [{ product_id: penny, quantity: '3' }], discount_amount: '0', tip_amount: '0',
    tenders: [
      { method: 'cash', amount: '0.01', tendered: '0.01' },
      { method: 'card', amount: '0.01' },
      { method: 'bank_transfer', amount: '0.01' }
    ]
  }))
  assert.equal(splitSale.ok, true, JSON.stringify(splitSale.error))
  const splitLine = splitSale.result.receipt.lines[0].sale_line_id
  const pennyReturn = await createReturn(h, splitSale.result.sale_id, splitLine, '1')
  assert.equal(Number(pennyReturn.total), -0.01)
  assert.equal(Number(pennyReturn.tenders.reduce((sum, tender) => sum + Number(tender.amount), 0).toFixed(2)), -0.01)

  const discounted = await h.call('cmd_promotion_upsert', h.envelope('promotion.upsert', {
    name: 'ONE CENT', code: 'ONECENT', scope: 'all', discount_type: 'amount', amount: '0.01', minimum_subtotal: '0', active: true
  }))
  assert.equal(discounted.ok, true, JSON.stringify(discounted.error))
  const nickel = await product(h, 'NICKEL-RETURN', '0.05')
  const discountSale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId, items: [{ product_id: nickel, quantity: '3' }], discount_amount: '0', tip_amount: '0',
    promotion_code: 'ONECENT', tenders: [{ method: 'cash', amount: '0.14', tendered: '0.14' }]
  }))
  assert.equal(discountSale.ok, true, JSON.stringify(discountSale.error))
  const discountLine = discountSale.result.receipt.lines[0].sale_line_id
  const partials = []
  for (let index = 0; index < 3; index += 1) partials.push(await createReturn(h, discountSale.result.sale_id, discountLine, '1'))
  assert.equal(Number(partials.reduce((sum, receipt) => sum + Number(receipt.total), 0).toFixed(2)), -0.14)
  assert.equal(Number(partials.flatMap((receipt) => receipt.tenders).reduce((sum, tender) => sum + Number(tender.amount), 0).toFixed(2)), -0.14)
})

test('recipe restock reverses only original ingredient depletion', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const dish = await product(h, 'RECIPE-RETURN-DISH', '10.00')
  const ingredient = await product(h, 'RECIPE-RETURN-INGREDIENT', '1.00', { track: true })
  const receiving = await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: ingredient, quantity: '10', unit_cost: '1' }))
  assert.equal(receiving.ok, true, JSON.stringify(receiving.error))
  const recipe = await h.call('cmd_catalogue_recipe_set', h.envelope('catalogue.recipe.set', {
    product_id: dish, expected_version: 0, lines: [{ ingredient_product_id: ingredient, quantity: '2', unit_cost: '1' }]
  }))
  assert.equal(recipe.ok, true, JSON.stringify(recipe.error))
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId, items: [{ product_id: dish, quantity: '1' }], discount_amount: '0', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const afterSale = await h.migrator.query('SELECT quantity FROM bar_local.stock_balances WHERE business_id=$1 AND outlet_id=$2 AND product_id=$3', [h.businessId, h.outletId, ingredient])
  assert.equal(Number(afterSale.rows[0].quantity), 8)
  await createReturn(h, sale.result.sale_id, sale.result.receipt.lines[0].sale_line_id, '1')
  const afterReturn = await h.migrator.query(
    `SELECT sb.quantity,
            (SELECT count(*)::int FROM bar_local.stock_movements sm WHERE sm.product_id=$3 AND sm.reason='sale.return.restock') AS reversals
       FROM bar_local.stock_balances sb WHERE sb.business_id=$1 AND sb.outlet_id=$2 AND sb.product_id=$3`,
    [h.businessId, h.outletId, ingredient]
  )
  assert.equal(Number(afterReturn.rows[0].quantity), 10)
  assert.equal(afterReturn.rows[0].reversals, 1)
  const finishedStock = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.stock_movements WHERE product_id=$1 AND reason IN (\'sale.depletion\',\'sale.return.restock\')', [dish])
  assert.equal(finishedStock.rows[0].count, 0)
})

test('restore verification rejects a sale whose tender total no longer matches', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const itemId = await product(h, 'RESTORE-TENDER-MISMATCH', '10.00')
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId, items: [{ product_id: itemId, quantity: '1' }], discount_amount: '0', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  await h.migrator.query('UPDATE bar_local.sale_tenders SET amount = amount + 0.01 WHERE sale_id = $1', [sale.result.sale_id])

  const report = await verifyRestoredDatabase(h.migrator, {
    migrationsDir: join(import.meta.dirname, '..', 'db', 'migrations'),
    database: 'bar_local_test',
    runtimeRole: 'bar_local_runtime',
    expectedMigrationOwner: 'bar_local_migrator'
  })
  assert.equal(report.ok, false)
  assert.ok(report.failures.includes('sale_tender_total_matches'), JSON.stringify(report.failures))
  assert.equal(report.checks.find((check) => check.name === 'sale_tender_total_matches')?.status, 'fail')

  await h.migrator.query('UPDATE bar_local.sale_tenders SET amount = amount - 0.01 WHERE sale_id = $1', [sale.result.sale_id])
  await h.migrator.query(`UPDATE bar_local.authority SET entitlement_features = ARRAY['bar_accounting_workforce'] WHERE singleton`)
  await h.migrator.query(
    `DELETE FROM bar_local.journal_lines WHERE entry_id IN (
       SELECT id FROM bar_local.journal_entries WHERE source_type = 'sale' AND source_id = $1
     )`,
    [sale.result.sale_id]
  )
  await h.migrator.query(`DELETE FROM bar_local.journal_entries WHERE source_type = 'sale' AND source_id = $1`, [sale.result.sale_id])
  const coverageReport = await verifyRestoredDatabase(h.migrator, {
    migrationsDir: join(import.meta.dirname, '..', 'db', 'migrations'),
    database: 'bar_local_test',
    runtimeRole: 'bar_local_runtime',
    expectedMigrationOwner: 'bar_local_migrator'
  })
  assert.equal(coverageReport.ok, false)
  assert.ok(coverageReport.failures.includes('source_to_gl_coverage'), JSON.stringify(coverageReport.failures))
  assert.equal(coverageReport.checks.find((check) => check.name === 'source_to_gl_coverage')?.status, 'fail')
})

test('cashier cannot apply a manual discount through the authoritative sale command', async (t) => {
  const h = await createHarness(t)
  const itemId = await product(h, 'DISCOUNT-GUARD', '10.00')
  const staffId = await h.insertStaff('Discount Restricted Cashier', 'cashier', ['pos.view', 'pos.manage'])
  const tokenHash = sha256Text(`discount-restricted-${randomUUID()}`)
  await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [staffId, h.deviceId, h.outletId, tokenHash])
  const shift = await h.callWith(h.runtime, 'cmd_shift_open', h.envelope('shift.open', { opening_float: '0' }), { tokenHash })
  assert.equal(shift.ok, true, JSON.stringify(shift.error))
  const result = await h.callWith(h.runtime, 'cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift.result.shift_id, items: [{ product_id: itemId, quantity: '1' }], discount_amount: '9.00', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '1.00', tendered: '1.00' }]
  }), { tokenHash })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'CAPABILITY_DENIED')
})
