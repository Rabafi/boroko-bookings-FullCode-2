import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

const ACCOUNTS = `INSERT INTO bar_local.accounting_accounts(code,name,type) VALUES
  ('1000','Cash','asset'),('2300','Tips payable','liability'),('4000','Sales revenue','revenue')`

async function setTimezone(h, zone) {
  await h.migrator.query(
    `UPDATE bar_local.settings SET value = to_jsonb($1::text), version = version + 1 WHERE key = 'timezone'`,
    [zone]
  )
}

async function saleRow(h, saleId) {
  return (await h.migrator.query(
    `SELECT status, subtotal::text, tax::text, tip::text, total::text,
            business_date::text AS business_date, receipt_number::text, receipt_series, shift_id
       FROM bar_local.sales WHERE id = $1`, [saleId]
  )).rows[0]
}

async function stockBalance(h, productId) {
  const row = (await h.migrator.query(
    `SELECT quantity::text FROM bar_local.stock_balances
      WHERE business_id = $1 AND outlet_id = $2 AND product_id = $3`,
    [h.businessId, h.outletId, productId]
  )).rows[0]
  return row ? Number(row.quantity) : 0
}

async function correctionCount(h, originalSaleId) {
  return Number((await h.migrator.query(
    'SELECT count(*)::integer AS n FROM bar_local.sale_post_close_corrections WHERE original_sale_id = $1',
    [originalSaleId]
  )).rows[0].n)
}

async function approvalConsumed(h, approvalId) {
  return (await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id = $1', [approvalId])).rows[0].consumed_at
}

test('a post-close correction preserves the closed day and posts a current-date compensating return', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await h.migrator.query(ACCOUNTS)
  await setTimezone(h, 'Etc/GMT+12')
  const shift = await h.openShift('100.00')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'POST-CLOSE', name: 'Post-close item', price: '10.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id
  assert.equal((await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: productId, quantity: '5' }))).ok, true)
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: productId, quantity: '2' }],
    tenders: [{ method: 'cash', amount: '20.00', tendered: '20.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id
  const lineId = (await h.query('sale.get', { sale_id: saleId })).data.lines[0].sale_line_id
  const originalSale = await saleRow(h, saleId)
  const originalReceipt = (await h.migrator.query(
    'SELECT receipt FROM bar_local.operations WHERE operation_id = $1', [sale.receipt.operation_id]
  )).rows[0].receipt
  const close = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shift, counted_cash: '120.00' }))
  assert.equal(close.ok, true, JSON.stringify(close.error))

  const closedDetail = (await h.query('sale.get', { sale_id: saleId })).data
  assert.equal(closedDetail.shift_status, 'closed')
  assert.equal(closedDetail.post_close_eligible, true)
  assert.equal(closedDetail.lines[0].remaining_quantity, '2.000000')

  // Cross a real date boundary: the correction must post on the new business
  // date while the original sale keeps its closed business date.
  await setTimezone(h, 'Pacific/Kiritimati')
  const next = await h.openShift('100.00')
  const correctionPayload = {
    sale_id: saleId, kind: 'return',
    lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'Customer returned one sealed bottle after cash-up', disposition: 'restock'
  }
  const correctionHash = sha256Json(correctionPayload)
  const approval = await h.approve('pos.void', correctionHash)
  const env = h.envelope('sale.correct_after_close', { ...correctionPayload, approval_id: approval })
  const corrected = await h.call('cmd_sale_correct_after_close', env, { approvalHash: correctionHash })
  assert.equal(corrected.ok, true, JSON.stringify(corrected.error))
  assert.equal(corrected.result.post_close_correction.kind, 'return')
  assert.equal(corrected.result.post_close_correction.original_sale_id, saleId)
  assert.equal(Number(corrected.result.total), -10)

  const correctionSale = await saleRow(h, corrected.result.sale_id)
  assert.equal(correctionSale.status, 'returned')
  assert.equal(correctionSale.shift_id, next)
  assert.equal(correctionSale.total, '-10.00')
  assert.notEqual(correctionSale.business_date, originalSale.business_date)
  assert.equal(corrected.result.post_close_correction.business_date, correctionSale.business_date)
  assert.equal(corrected.result.post_close_correction.original_business_date, originalSale.business_date)
  assert.deepEqual(await saleRow(h, saleId), originalSale, 'the closed original sale must not be rewritten')
  assert.deepEqual((await h.migrator.query(
    'SELECT receipt FROM bar_local.operations WHERE operation_id = $1', [sale.receipt.operation_id]
  )).rows[0].receipt, originalReceipt, 'the closed receipt must remain immutable')

  const allocation = (await h.migrator.query(
    `SELECT quantity::text, post_close_operation_id,
            (SELECT sum(amount)::text FROM bar_local.sale_tenders WHERE sale_id = $2) AS refund_tender
       FROM bar_local.sale_return_line_allocations
      WHERE original_sale_line_id = $1`, [lineId, corrected.result.sale_id]
  )).rows[0]
  assert.equal(allocation.quantity, '1.000000')
  assert.equal(allocation.post_close_operation_id, env.operation_id)
  assert.equal(allocation.refund_tender, '-10.00')
  assert.equal(await stockBalance(h, productId), 4)

  const detail = (await h.query('sale.get', { sale_id: saleId })).data
  assert.equal(detail.lines[0].post_close_corrected_quantity, '1.000000')
  assert.equal(detail.lines[0].remaining_quantity, '1.000000')
  assert.equal(detail.post_close_corrections.length, 1)
  assert.equal(detail.post_close_corrections[0].correction_sale_id, corrected.result.sale_id)
  assert.equal(detail.post_close_corrections[0].kind, 'return')
  assert.equal(Number(detail.post_close_tip_remaining), 0)
  assert.equal(detail.post_close_eligible, true)

  const history = await h.query('reports.post_close_corrections', { original_sale_id: saleId })
  assert.equal(history.data.length, 1)
  assert.equal(history.data[0].kind, 'return')
  assert.equal(Number(history.data[0].total), -10)
  assert.equal(String(history.data[0].original_receipt_number), originalSale.receipt_number)
  assert.equal(String(history.data[0].correction_receipt_number), correctionSale.receipt_number)
  assert.equal(history.data[0].approved_by_name, 'Manager One')
  assert.equal(history.pagination.has_more, false)

  const summary = (await h.query('reports.sales_summary', {
    from: originalSale.business_date, to: correctionSale.business_date
  })).data
  assert.equal(Number(summary.totals.gross_sales), 20)
  assert.equal(Number(summary.totals.returns), 10)
  assert.equal(Number(summary.totals.net_sales), 10)
  assert.equal(summary.by_day.length, 2)
  const originalDay = summary.by_day.find((day) => day.business_date === originalSale.business_date)
  assert.equal(Number(originalDay.gross_sales), 20)
  assert.equal(Number(originalDay.returns), 0)
  assert.equal(Number(originalDay.net_sales), 20)
  const correctionDay = summary.by_day.find((day) => day.business_date === correctionSale.business_date)
  assert.equal(Number(correctionDay.returns), 10)
  assert.equal(Number(correctionDay.net_sales), -10)

  const replay = await h.call('cmd_sale_correct_after_close', env, { approvalHash: correctionHash })
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.receipt, corrected.receipt)
  assert.equal(await correctionCount(h, saleId), 1)
  assert.equal(await stockBalance(h, productId), 4)
  await assert.rejects(
    h.call('cmd_sale_correct_after_close', { ...env, payload: { ...env.payload, reason: 'Changed after commit' } }, { approvalHash: correctionHash }),
    (error) => error.detail === 'IDEMPOTENCY_PAYLOAD_CONFLICT'
  )

  const secondPayload = { ...correctionPayload, lines: [{ sale_line_id: lineId, quantity: '1' }], reason: 'Customer returned the second bottle' }
  const secondHash = sha256Json(secondPayload)
  const secondApproval = await h.approve('pos.void', secondHash)
  const second = await h.call('cmd_sale_correct_after_close',
    h.envelope('sale.correct_after_close', { ...secondPayload, approval_id: secondApproval }), { approvalHash: secondHash })
  assert.equal(second.ok, true, JSON.stringify(second.error))
  assert.equal(await stockBalance(h, productId), 5)
  const finalDetail = (await h.query('sale.get', { sale_id: saleId })).data
  assert.equal(Number(finalDetail.lines[0].remaining_quantity), 0)
  assert.equal(Number(finalDetail.post_close_tip_remaining), 0)
  assert.equal(finalDetail.post_close_eligible, false)

  const thirdPayload = { ...correctionPayload, reason: 'A third correction must not duplicate the refund' }
  const thirdHash = sha256Json(thirdPayload)
  const thirdApproval = await h.approve('pos.void', thirdHash)
  const third = await h.call('cmd_sale_correct_after_close',
    h.envelope('sale.correct_after_close', { ...thirdPayload, approval_id: thirdApproval }), { approvalHash: thirdHash })
  assert.equal(third.ok, false)
  assert.equal(third.error.code, 'RETURN_EXCEEDS_ORIGINAL')
  assert.equal(await approvalConsumed(h, thirdApproval), null)
  const emptyVoidPayload = { sale_id: saleId, kind: 'void', reason: 'Nothing remains to cancel' }
  const emptyVoidHash = sha256Json(emptyVoidPayload)
  const emptyVoidApproval = await h.approve('pos.void', emptyVoidHash)
  const emptyVoid = await h.call('cmd_sale_correct_after_close',
    h.envelope('sale.correct_after_close', { ...emptyVoidPayload, approval_id: emptyVoidApproval }), { approvalHash: emptyVoidHash })
  assert.equal(emptyVoid.ok, false)
  assert.equal(emptyVoid.error.code, 'SALE_ALREADY_VOIDED')

  const postings = await h.migrator.query(
    `SELECT source_type FROM bar_local.source_gl_postings
      WHERE source_id = ANY($1::uuid[]) ORDER BY source_type`,
    [[saleId, corrected.result.sale_id, second.result.sale_id]]
  )
  assert.deepEqual(postings.rows.map((row) => row.source_type), ['sale', 'sale.return', 'sale.return'])
  const unbalanced = await h.migrator.query(
    `SELECT e.id FROM bar_local.journal_entries e
       JOIN bar_local.journal_lines l ON l.entry_id = e.id
      WHERE e.source_id = ANY($1::uuid[])
      GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)`,
    [[saleId, corrected.result.sale_id, second.result.sale_id]]
  )
  assert.deepEqual(unbalanced.rows, [])
})

test('a post-close void refunds only the unallocated tip after all items were returned before cash-up', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await h.migrator.query(ACCOUNTS)
  await setTimezone(h, 'Etc/GMT+12')
  const shift = await h.openShift('0.00')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'TIP-AFTER-CLOSE', name: 'Tip item', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: productId, quantity: '1' }], tip_amount: '0.37',
    tenders: [{ method: 'cash', amount: '10.37', tendered: '10.37' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id
  const lineId = (await h.query('sale.get', { sale_id: saleId })).data.lines[0].sale_line_id
  const returnPayload = {
    sale_id: saleId, lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'Item returned before cash-up', disposition: 'restock'
  }
  const returnHash = sha256Json(returnPayload)
  const returnApproval = await h.approve('pos.void', returnHash)
  const returned = await h.call('cmd_sale_return',
    h.envelope('sale.return', { ...returnPayload, approval_id: returnApproval }), { approvalHash: returnHash })
  assert.equal(returned.ok, true, JSON.stringify(returned.error))
  assert.equal(Number(returned.result.total), -10)
  const beforeClose = (await h.query('sale.get', { sale_id: saleId })).data
  assert.equal(beforeClose.lines[0].remaining_quantity, '0')
  assert.equal(Number(beforeClose.post_close_tip_remaining), 0.37)

  const close = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shift, counted_cash: '0.37' }))
  assert.equal(close.ok, true, JSON.stringify(close.error))
  await setTimezone(h, 'Pacific/Kiritimati')
  // A positive float is required: the tip refund is allocated to the original
  // cash tender and a zero drawer would otherwise go negative.
  const next = await h.openShift('1.00')
  const voidPayload = { sale_id: saleId, kind: 'void', reason: 'Refund the unallocated tip after cash-up' }
  const voidHash = sha256Json(voidPayload)
  const voidApproval = await h.approve('pos.void', voidHash)
  const refund = await h.call('cmd_sale_correct_after_close',
    h.envelope('sale.correct_after_close', { ...voidPayload, approval_id: voidApproval }), { approvalHash: voidHash })
  assert.equal(refund.ok, true, JSON.stringify(refund.error))
  assert.equal(Number(refund.result.total), -0.37)
  assert.equal(Number(refund.result.tip), -0.37)
  assert.equal(refund.result.lines.length, 0)
  assert.equal(refund.result.post_close_correction.kind, 'void')

  const correctionSale = await saleRow(h, refund.result.sale_id)
  assert.equal(correctionSale.status, 'returned')
  assert.equal(correctionSale.shift_id, next)
  assert.equal(correctionSale.total, '-0.37')
  assert.equal(correctionSale.tip, '-0.37')
  const originalSale = await saleRow(h, saleId)
  assert.equal(originalSale.status, 'returned')
  assert.equal(originalSale.total, '10.37')
  assert.equal(originalSale.tip, '0.37')

  const detail = (await h.query('sale.get', { sale_id: saleId })).data
  assert.equal(Number(detail.post_close_tip_remaining), 0)
  assert.equal(detail.post_close_eligible, false)
  const history = await h.query('reports.post_close_corrections', { original_sale_id: saleId })
  assert.equal(history.data.length, 1)
  assert.equal(history.data[0].kind, 'void')
  assert.equal(Number(history.data[0].tip), -0.37)
  assert.equal(Number(history.data[0].total), -0.37)
  assert.deepEqual(history.data[0].lines, [])

  const summary = (await h.query('reports.sales_summary', {
    from: originalSale.business_date, to: correctionSale.business_date
  })).data
  assert.equal(Number(summary.totals.gross_sales), 10.37)
  assert.equal(Number(summary.totals.returns), 10.37)
  assert.equal(Number(summary.totals.net_sales), 0)
  const originalDay = summary.by_day.find((day) => day.business_date === originalSale.business_date)
  assert.equal(Number(originalDay.net_sales), 0.37)
  const correctionDay = summary.by_day.find((day) => day.business_date === correctionSale.business_date)
  assert.equal(Number(correctionDay.returns), 0.37)
  assert.equal(Number(correctionDay.net_sales), -0.37)

  const repeatPayload = { ...voidPayload, reason: 'The tip was already refunded' }
  const repeatHash = sha256Json(repeatPayload)
  const repeatApproval = await h.approve('pos.void', repeatHash)
  const repeat = await h.call('cmd_sale_correct_after_close',
    h.envelope('sale.correct_after_close', { ...repeatPayload, approval_id: repeatApproval }), { approvalHash: repeatHash })
  assert.equal(repeat.ok, false)
  assert.equal(repeat.error.code, 'SALE_ALREADY_VOIDED')
  assert.equal(await approvalConsumed(h, repeatApproval), null)
})

test('post-close corrections refuse open drawers, missing drawers, shortages and corrections of corrections without partial writes', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await h.migrator.query(ACCOUNTS)
  const shift = await h.openShift('0.00')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'REFUSAL-ITEM', name: 'Refusal item', price: '10.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id
  assert.equal((await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: productId, quantity: '5' }))).ok, true)
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: productId, quantity: '1' }],
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id
  const lineId = (await h.query('sale.get', { sale_id: saleId })).data.lines[0].sale_line_id
  const originalSale = await saleRow(h, saleId)

  const callCorrection = async (payload) => {
    const hash = sha256Json(payload)
    const approval = await h.approve('pos.void', hash)
    const envelope = h.envelope('sale.correct_after_close', { ...payload, approval_id: approval })
    return { approval, result: await h.call('cmd_sale_correct_after_close', envelope, { approvalHash: hash }) }
  }

  const stillOpen = await callCorrection({
    sale_id: saleId, kind: 'return', lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'Cannot correct an open drawer', disposition: 'restock'
  })
  assert.equal(stillOpen.result.ok, false)
  assert.equal(stillOpen.result.error.code, 'SALE_STILL_OPEN')
  assert.equal(await approvalConsumed(h, stillOpen.approval), null)
  assert.equal(await correctionCount(h, saleId), 0)
  assert.equal(await stockBalance(h, productId), 4)

  const close = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shift, counted_cash: '10.00' }))
  assert.equal(close.ok, true, JSON.stringify(close.error))
  const missingDrawer = await callCorrection({
    sale_id: saleId, kind: 'return', lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'A correction needs an open drawer', disposition: 'restock'
  })
  assert.equal(missingDrawer.result.ok, false)
  assert.equal(missingDrawer.result.error.code, 'SHIFT_REQUIRED')
  assert.equal(await approvalConsumed(h, missingDrawer.approval), null)

  const next = await h.openShift('0.00')
  const shortage = await callCorrection({
    sale_id: saleId, kind: 'return', lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'The drawer cannot fund this refund yet', disposition: 'restock'
  })
  assert.equal(shortage.result.ok, false)
  assert.equal(shortage.result.error.code, 'DRAWER_AMOUNT_INVALID')
  assert.equal(await approvalConsumed(h, shortage.approval), null)
  assert.equal(await correctionCount(h, saleId), 0)
  assert.equal(await stockBalance(h, productId), 4)
  assert.deepEqual(await saleRow(h, saleId), originalSale, 'a refused correction must not alter the original sale')
  assert.equal((await h.migrator.query(
    'SELECT count(*)::integer AS n FROM bar_local.sales WHERE original_sale_id = $1', [saleId]
  )).rows[0].n, 0)

  assert.equal((await h.call('cmd_drawer_movement', h.envelope('drawer.movement', {
    shift_id: next, type: 'paid_in', amount: '10.00', reason: 'Float for the authorised refund'
  }))).ok, true)
  const recovered = await callCorrection({
    sale_id: saleId, kind: 'return', lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'Manager replenished the drawer and re-authorised the refund', disposition: 'restock'
  })
  assert.equal(recovered.result.ok, true, JSON.stringify(recovered.result.error))
  assert.equal(Number(recovered.result.result.total), -10)
  assert.equal(await stockBalance(h, productId), 5)

  const correctionOfCorrection = await callCorrection({
    sale_id: recovered.result.result.sale_id, kind: 'return',
    lines: [{ sale_line_id: lineId, quantity: '1' }],
    reason: 'A correction receipt is immutable', disposition: 'restock'
  })
  assert.equal(correctionOfCorrection.result.ok, false)
  assert.equal(correctionOfCorrection.result.error.code, 'POST_CLOSE_ORIGINAL_REQUIRED')
  assert.equal(await approvalConsumed(h, correctionOfCorrection.approval), null)

  const tipped = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: next, items: [{ product_id: productId, quantity: '1' }], tip_amount: '0.37',
    tenders: [{ method: 'cash', amount: '10.37', tendered: '10.37' }]
  }))
  assert.equal(tipped.ok, true, JSON.stringify(tipped.error))
  const allocated = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: tipped.result.sale_id, staff_id: h.ownerStaffId, amount: '0.37'
  }))
  assert.equal(allocated.ok, true, JSON.stringify(allocated.error))
  const tippedClose = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: next, counted_cash: '10.37' }))
  assert.equal(tippedClose.ok, true, JSON.stringify(tippedClose.error))
  await h.openShift('100.00')
  const tipBlocked = await callCorrection({
    sale_id: tipped.result.sale_id, kind: 'void',
    reason: 'The allocated tip must be reconciled first'
  })
  assert.equal(tipBlocked.result.ok, false)
  assert.equal(tipBlocked.result.error.code, 'TIP_RECONCILIATION_REQUIRED')
  assert.equal(await approvalConsumed(h, tipBlocked.approval), null)
  assert.equal(await correctionCount(h, tipped.result.sale_id), 0)
  assert.equal((await h.migrator.query(
    'SELECT status FROM bar_local.sales WHERE id = $1', [tipped.result.sale_id]
  )).rows[0].status, 'completed')
})
