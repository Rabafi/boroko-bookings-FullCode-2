import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness, sha256Json } from './harness.mjs'

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

async function product(h, sku, price) {
  const result = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku, name: sku, category: 'Test', price, tax_rate: '0', track_stock: false
  }))
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result.product_id
}

async function createReturn(h, saleId, lineId, quantity) {
  const payload = {
    sale_id: saleId,
    lines: [{ sale_line_id: lineId, quantity }],
    reason: 'Allocation hardening regression',
    disposition: 'restock'
  }
  const approvalHash = sha256Json(payload)
  const approvalId = await h.approve('pos.void', approvalHash, { targetType: 'sale', targetId: saleId })
  const result = await h.callWith(h.runtime, 'cmd_sale_return', h.envelope('sale.return', { ...payload, approval_id: approvalId }), {
    hash: sha256Json({ ...payload, approval_id: approvalId }), approvalHash
  })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.receipt
}

async function insertLegacyReturn(h, { saleId, lineId, quantity }) {
  const originalSale = (await h.migrator.query('SELECT * FROM bar_local.sales WHERE id = $1', [saleId])).rows[0]
  const originalLine = (await h.migrator.query('SELECT * FROM bar_local.sale_lines WHERE id = $1', [lineId])).rows[0]
  const originalTenders = (await h.migrator.query(
    'SELECT * FROM bar_local.sale_tenders WHERE sale_id = $1 AND amount > 0 ORDER BY id', [saleId]
  )).rows
  const receipt = (await h.migrator.query(
    `SELECT COALESCE(MAX(receipt_number), 0) + 1 AS next
       FROM bar_local.sales WHERE business_id = $1 AND receipt_series = $2`,
    [originalSale.business_id, originalSale.receipt_series]
  )).rows[0].next

  const returnQty = Number(quantity)
  const ratio = returnQty / Number(originalLine.quantity)
  const gross = round2(Number(originalLine.line_subtotal) * ratio)
  const discount = round2(Number(originalLine.line_discount) * ratio)
  const tax = round2(Number(originalLine.line_tax) * ratio)
  const net = round2(gross - discount)
  const returnTotal = round2(net + tax)
  const operationId = randomUUID()

  const returnSale = await h.migrator.query(
    `INSERT INTO bar_local.sales
       (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number, receipt_series,
        business_date, status, subtotal, discount, tax, tip, total, customer_id, note, original_sale_id, operation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'returned',$10,0,$11,0,$12,$13,$14,$15,$16)
     RETURNING id`,
    [originalSale.business_id, originalSale.outlet_id, originalSale.shift_id, originalSale.device_id,
     originalSale.actor_staff_id, originalSale.tab_id, receipt, originalSale.receipt_series,
     originalSale.business_date, -net, -tax, -returnTotal, originalSale.customer_id,
     'Historical pre-allocation return', saleId, operationId]
  )
  const returnSaleId = returnSale.rows[0].id
  await h.migrator.query(
    'UPDATE bar_local.authority_counter SET receipt_sequence = GREATEST(receipt_sequence, $1::bigint) WHERE singleton',
    [receipt]
  )

  await h.migrator.query(
    `INSERT INTO bar_local.sale_lines
       (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
        line_subtotal, line_discount, line_tax, line_total, notes, operation_id)
     VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Historical pre-allocation return',$12)`,
    [returnSaleId, originalLine.product_id, originalLine.name_snapshot, originalLine.sku_snapshot,
     -returnQty, originalLine.unit_price, originalLine.tax_rate,
     -gross, -discount, -tax, -(round2(gross - discount + tax)), operationId]
  )

  const tenderTotal = originalTenders.reduce((sum, tender) => sum + Number(tender.amount), 0)
  let remaining = returnTotal
  for (const tender of originalTenders) {
    let share = round2(returnTotal * Number(tender.amount) / tenderTotal)
    if (remaining - share < 0) share = remaining
    share = round2(share)
    remaining = round2(remaining - share)
    if (share <= 0) continue
    await h.migrator.query(
      `INSERT INTO bar_local.sale_tenders
         (sale_id, method, amount, tendered, change_amount, reference, provider_status, voucher_id, customer_id, operation_id)
       VALUES ($1,$2,$3,NULL,0,$4,$5,$6,$7,$8)`,
      [returnSaleId, tender.method, -share, `return:${saleId}`, tender.provider_status,
       tender.voucher_id, tender.customer_id, operationId]
    )
  }

  await h.migrator.query('UPDATE bar_local.sale_lines SET returned_quantity = returned_quantity + $2 WHERE id = $1', [lineId, returnQty])
  await h.migrator.query("UPDATE bar_local.sales SET status = 'returned' WHERE id = $1", [saleId])

  return { returnSaleId, returnTotal, operationId }
}

async function tenderAllocations(h, saleId) {
  const result = await h.migrator.query(
    `SELECT a.amount::numeric AS allocated, t.amount::numeric AS capacity, t.id
       FROM bar_local.sale_return_tender_allocations a
       JOIN bar_local.sale_tenders t ON t.id = a.original_tender_id
      WHERE a.original_sale_id = $1
      ORDER BY t.id`,
    [saleId]
  )
  return result.rows
}

test('exact tender allocation cannot exceed the final tender capacity', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const item = await product(h, 'CAPACITY-RETURN', '0.01')
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: item, quantity: '20900' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [
      { method: 'cash', amount: '46.00' },
      { method: 'cash', amount: '42.00' },
      { method: 'cash', amount: '42.00' },
      { method: 'cash', amount: '35.00' },
      { method: 'cash', amount: '1.00' },
      { method: 'cash', amount: '43.00' }
    ]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  assert.equal(Number(sale.result.receipt.total), 209)

  const returned = await createReturn(h, sale.result.sale_id, sale.result.receipt.lines[0].sale_line_id, '20897')
  assert.equal(Number(returned.total), -208.97)

  const allocations = await tenderAllocations(h, sale.result.sale_id)
  assert.equal(allocations.length, 8)
  const allocatedTotal = round2(allocations.reduce((sum, row) => sum + Number(row.allocated), 0))
  assert.equal(allocatedTotal, 208.97)
  for (const row of allocations) {
    assert.ok(Number(row.allocated) > 0)
    assert.ok(Number(row.allocated) <= Number(row.capacity), `${row.allocated} exceeds ${row.capacity}`)
  }
  assert.equal(allocations.filter((row) => Number(row.allocated) === 0.01).length, 2)
  const fortyThree = allocations.filter((row) => Number(row.capacity) === 43)
  assert.ok(fortyThree.length > 0)
  const fortyThreeTotal = round2(fortyThree.reduce((sum, row) => sum + Number(row.allocated), 0))
  assert.ok(fortyThreeTotal <= 43, 'the final tender must never exceed its capacity')
})

test('multiple partial returns conserve every original tender capacity', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const item = await product(h, 'MULTI-RETURN', '10.00')
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: item, quantity: '10' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [
      { method: 'cash', amount: '60.00' },
      { method: 'card', amount: '40.00' }
    ]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id
  const lineId = sale.result.receipt.lines[0].sale_line_id

  const first = await createReturn(h, saleId, lineId, '2')
  const second = await createReturn(h, saleId, lineId, '3')
  const third = await createReturn(h, saleId, lineId, '5')
  assert.deepEqual([first.total, second.total, third.total].map(Number), [-20, -30, -50])

  const allocations = await tenderAllocations(h, saleId)
  const allocatedTotal = round2(allocations.reduce((sum, row) => sum + Number(row.allocated), 0))
  assert.equal(allocatedTotal, 100)
  assert.equal(round2(allocations.filter((row) => Number(row.capacity) === 60)
    .reduce((sum, row) => sum + Number(row.allocated), 0)), 60)
  assert.equal(round2(allocations.filter((row) => Number(row.capacity) === 40)
    .reduce((sum, row) => sum + Number(row.allocated), 0)), 40)
  for (const row of allocations) assert.ok(Number(row.allocated) <= Number(row.capacity))
})

test('historical pre-allocation partial returns are backfilled before further returns', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const item = await product(h, 'LEGACY-RETURN', '10.00')
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: item, quantity: '10' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [
      { method: 'cash', amount: '60.00' },
      { method: 'card', amount: '40.00' }
    ]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id
  const lineId = sale.result.receipt.lines[0].sale_line_id

  await insertLegacyReturn(h, { saleId, lineId, quantity: '3' })

  const beforeLine = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sale_return_line_allocations WHERE original_sale_id = $1', [saleId]
  )
  const beforeTender = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sale_return_tender_allocations WHERE original_sale_id = $1', [saleId]
  )
  assert.equal(beforeLine.rows[0].count, 0)
  assert.equal(beforeTender.rows[0].count, 0)

  const backfilled = (await h.migrator.query('SELECT bar_local.backfill_return_allocations() AS result')).rows[0].result
  assert.equal(backfilled.line_allocations_inserted, 1)
  assert.equal(backfilled.tender_allocations_inserted, 2)
  assert.equal(backfilled.blockers, 0)

  const lineAllocations = await h.migrator.query(
    `SELECT quantity::numeric AS quantity, gross_amount::numeric AS gross
       FROM bar_local.sale_return_line_allocations WHERE original_sale_id = $1`, [saleId]
  )
  assert.equal(lineAllocations.rows.length, 1)
  assert.equal(Number(lineAllocations.rows[0].quantity), 3)
  assert.equal(Number(lineAllocations.rows[0].gross), 30)

  const legacyTenders = await tenderAllocations(h, saleId)
  assert.equal(round2(legacyTenders.reduce((sum, row) => sum + Number(row.allocated), 0)), 30)
  assert.equal(round2(legacyTenders.filter((row) => Number(row.capacity) === 60)
    .reduce((sum, row) => sum + Number(row.allocated), 0)), 18)
  assert.equal(round2(legacyTenders.filter((row) => Number(row.capacity) === 40)
    .reduce((sum, row) => sum + Number(row.allocated), 0)), 12)

  const furtherReturn = await createReturn(h, saleId, lineId, '4')
  assert.equal(Number(furtherReturn.total), -40)

  const finalTenders = await tenderAllocations(h, saleId)
  assert.equal(round2(finalTenders.reduce((sum, row) => sum + Number(row.allocated), 0)), 70)
  assert.equal(round2(finalTenders.filter((row) => Number(row.capacity) === 60)
    .reduce((sum, row) => sum + Number(row.allocated), 0)), 42)
  assert.equal(round2(finalTenders.filter((row) => Number(row.capacity) === 40)
    .reduce((sum, row) => sum + Number(row.allocated), 0)), 28)

  const finalLine = await h.migrator.query(
    `SELECT sum(quantity)::numeric AS quantity, sum(gross_amount)::numeric AS gross
       FROM bar_local.sale_return_line_allocations WHERE original_sale_id = $1`, [saleId]
  )
  assert.equal(Number(finalLine.rows[0].quantity), 7)
  assert.equal(Number(finalLine.rows[0].gross), 70)
})

test('runtime cannot read or write return allocation tables directly', async (t) => {
  const h = await createHarness(t)

  for (const table of ['sale_return_line_allocations', 'sale_return_tender_allocations']) {
    const privileges = await h.migrator.query(
      `SELECT has_table_privilege('bar_local_runtime', $1, 'SELECT') AS can_select,
              has_table_privilege('bar_local_runtime', $1, 'INSERT') AS can_insert`,
      [`bar_local.${table}`]
    )
    assert.equal(privileges.rows[0].can_select, false)
    assert.equal(privileges.rows[0].can_insert, false)
    await assert.rejects(
      () => h.runtime.query(`SELECT * FROM bar_local.${table} LIMIT 1`),
      (error) => error.code === '42501'
    )
    await assert.rejects(
      () => h.runtime.query(`INSERT INTO bar_local.${table} (id) VALUES (gen_random_uuid())`),
      (error) => error.code === '42501'
    )
  }

  const reconciliation = await h.migrator.query(
    `SELECT has_table_privilege('bar_local_runtime', 'bar_local.return_allocation_reconciliation', 'SELECT') AS can_select`
  )
  assert.equal(reconciliation.rows[0].can_select, false)
})

test('allocation lineage guards reject mismatched sale and tender rows', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()
  const item = await product(h, 'LINEAGE-RETURN', '10.00')

  const saleA = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: item, quantity: '1' }],
    discount_amount: '0', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00' }]
  }))
  assert.equal(saleA.ok, true, JSON.stringify(saleA.error))
  const saleAId = saleA.result.sale_id
  const lineAId = saleA.result.receipt.lines[0].sale_line_id

  const saleB = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: item, quantity: '1' }],
    discount_amount: '0', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00' }]
  }))
  assert.equal(saleB.ok, true, JSON.stringify(saleB.error))
  const saleBId = saleB.result.sale_id

  const saleC = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: item, quantity: '1' }],
    discount_amount: '0', tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00' }]
  }))
  assert.equal(saleC.ok, true, JSON.stringify(saleC.error))
  const saleCId = saleC.result.sale_id

  const returnA = await createReturn(h, saleAId, lineAId, '1')
  const returnC = await createReturn(h, saleCId, saleC.result.receipt.lines[0].sale_line_id, '1')

  const tenderAId = (await h.migrator.query(
    'SELECT id FROM bar_local.sale_tenders WHERE sale_id = $1 AND amount > 0', [saleAId]
  )).rows[0].id

  const lineageError = (error) => error.code === 'BL001' && error.detail === 'RETURN_ALLOCATION_LINEAGE_INVALID'

  await assert.rejects(
    () => h.migrator.query(
      'UPDATE bar_local.sale_return_line_allocations SET original_sale_id = $1 WHERE original_sale_line_id = $2',
      [saleBId, lineAId]
    ),
    lineageError
  )
  await assert.rejects(
    () => h.migrator.query(
      'UPDATE bar_local.sale_return_line_allocations SET return_sale_id = $1 WHERE original_sale_line_id = $2',
      [returnC.sale_id, lineAId]
    ),
    lineageError
  )
  await assert.rejects(
    () => h.migrator.query(
      'UPDATE bar_local.sale_return_tender_allocations SET original_sale_id = $1 WHERE original_tender_id = $2',
      [saleBId, tenderAId]
    ),
    lineageError
  )
  await assert.rejects(
    () => h.migrator.query(
      'UPDATE bar_local.sale_return_tender_allocations SET return_sale_id = $1 WHERE original_tender_id = $2',
      [returnC.sale_id, tenderAId]
    ),
    lineageError
  )
  assert.ok(returnA.sale_id)
})
