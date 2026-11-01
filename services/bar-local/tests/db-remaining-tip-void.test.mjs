import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

test('a fully item-returned sale refunds its remaining tip once without changing stock or old receipts', async t => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await h.migrator.query(`INSERT INTO bar_local.accounting_accounts(code,name,type) VALUES
    ('1000','Cash','asset'),('2300','Tips payable','liability'),('4000','Sales revenue','revenue')`)
  const shift = await h.openShift('0')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'TIP-ONLY', name: 'Tip item', price: '10.00', tax_rate: '0', track_stock: true
  }))
  const productId = product.result.product_id
  await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: productId, quantity: '2' }))
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: productId, quantity: '1' }], tip_amount: '0.37',
    tenders: [{ method: 'cash', amount: '10.37', tendered: '10.37' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const saleId = sale.result.sale_id
  const originalReceipt = (await h.migrator.query('SELECT receipt FROM bar_local.operations WHERE operation_id=$1', [sale.receipt.operation_id])).rows[0].receipt
  const line = (await h.query('sale.get', { sale_id: saleId })).data.lines[0]
  const lineId = line.sale_line_id ?? line.id
  assert.equal(line.remaining_quantity, '1.000000')
  const payload = { sale_id: saleId, lines: [{ sale_line_id: lineId, quantity: '0.25' }], reason: 'Return item', disposition: 'restock' }
  const hash = sha256Json(payload)
  const approval = await h.approve('pos.void', hash)
  const returned = await h.call('cmd_sale_return', h.envelope('sale.return', { ...payload, approval_id: approval }), { approvalHash: hash })
  assert.equal(returned.ok, true, JSON.stringify(returned.error))
  const returnedReceipt = (await h.migrator.query('SELECT receipt FROM bar_local.operations WHERE operation_id=$1', [returned.receipt.operation_id])).rows[0].receipt
  const remaining = (await h.query('sale.get', { sale_id: saleId })).data.lines[0]
  assert.equal(remaining.returned_quantity, '0.250000')
  assert.equal(remaining.remaining_quantity, '0.750000')
  const restPayload = { ...payload, lines: [{ sale_line_id: lineId, quantity: '0.75' }] }
  const restHash = sha256Json(restPayload), restApproval = await h.approve('pos.void', restHash)
  const rest = await h.call('cmd_sale_return', h.envelope('sale.return', { ...restPayload, approval_id: restApproval }), { approvalHash: restHash })
  assert.equal(rest.ok, true, JSON.stringify(rest.error))
  assert.equal((await h.query('sale.get', { sale_id: saleId })).data.lines[0].remaining_quantity, '0')
  const before = (await h.migrator.query('SELECT count(*)::integer AS n FROM bar_local.stock_movements')).rows[0].n
  const voidPayload = { sale_id: saleId, reason: 'Customer requested remaining tip refund' }
  const voidHash = sha256Json(voidPayload)
  const voidApproval = await h.approve('pos.void', voidHash)
  const envelope = h.envelope('sale.void', { ...voidPayload, approval_id: voidApproval })
  const refund = await h.call('cmd_sale_void', envelope, { approvalHash: voidHash })
  assert.equal(refund.ok, true, JSON.stringify(refund.error))
  assert.equal(refund.result.total, '-0.37')
  assert.equal(refund.result.tip, '-0.37')
  assert.equal(refund.result.lines.length, 0)
  const replay = await h.call('cmd_sale_void', envelope, { approvalHash: voidHash })
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.receipt, refund.receipt)
  await assert.rejects(h.call('cmd_sale_void', { ...envelope, payload: { ...envelope.payload, reason: 'Changed refund request' } }, { approvalHash: voidHash }),
    error => error.detail === 'IDEMPOTENCY_PAYLOAD_CONFLICT')
  assert.equal((await h.migrator.query('SELECT count(*)::integer AS n FROM bar_local.stock_movements')).rows[0].n, before)
  assert.equal(Number((await h.query('cashup.summary', { shift_id: shift })).data.expected_cash), 0)
  assert.equal(Number((await h.migrator.query('SELECT sum(amount) AS amount FROM bar_local.sale_tenders')).rows[0].amount), 0)
  assert.deepEqual((await h.migrator.query('SELECT receipt FROM bar_local.operations WHERE operation_id=$1', [sale.receipt.operation_id])).rows[0].receipt, originalReceipt)
  assert.deepEqual((await h.migrator.query('SELECT receipt FROM bar_local.operations WHERE operation_id=$1', [returned.receipt.operation_id])).rows[0].receipt, returnedReceipt)
  const drift = await h.migrator.query(`SELECT l.account_code FROM bar_local.journal_lines l
    JOIN bar_local.journal_entries e ON e.id=l.entry_id
    WHERE e.source_id=ANY($1::uuid[]) GROUP BY l.account_code HAVING sum(l.debit-l.credit)<>0`,
    [[saleId,returned.result.sale_id,rest.result.sale_id,refund.result.sale_id]])
  assert.deepEqual(drift.rows, [], 'items and tip must conserve every original GL account')
  const duplicateApproval = await h.approve('pos.void', voidHash)
  const duplicate = await h.call('cmd_sale_void', h.envelope('sale.void', { ...voidPayload, approval_id: duplicateApproval }), { approvalHash: voidHash })
  assert.equal(duplicate.ok, false)

  // The new empty-item branch must not bypass staff liabilities or closed drawers.
  const second = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shift, items: [{ product_id: productId, quantity: '1' }], tip_amount: '0.37',
    tenders: [{ method: 'cash', amount: '10.37', tendered: '10.37' }]
  }))
  assert.equal(second.ok, true, JSON.stringify(second.error))
  const secondLine = (await h.query('sale.get', { sale_id: second.result.sale_id })).data.lines[0].sale_line_id
  const secondPayload = { ...payload, sale_id: second.result.sale_id, lines: [{ sale_line_id: secondLine, quantity: '1' }] }
  const secondHash = sha256Json(secondPayload), secondApproval = await h.approve('pos.void', secondHash)
  const secondReturn = await h.call('cmd_sale_return', h.envelope('sale.return', { ...secondPayload, approval_id: secondApproval }), { approvalHash: secondHash })
  assert.equal(secondReturn.ok, true, JSON.stringify(secondReturn.error))
  const allocated = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: second.result.sale_id, staff_id: h.ownerStaffId, amount: '0.37'
  }))
  assert.equal(allocated.ok, true, JSON.stringify(allocated.error))
  const blockedPayload = { sale_id: second.result.sale_id, reason: 'Tip liability must remain' }, blockedHash = sha256Json(blockedPayload)
  const blockedApproval = await h.approve('pos.void', blockedHash)
  const blocked = await h.call('cmd_sale_void', h.envelope('sale.void', { ...blockedPayload, approval_id: blockedApproval }), { approvalHash: blockedHash })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'TIP_RECONCILIATION_REQUIRED')
  assert.equal((await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id=$1',[blockedApproval])).rows[0].consumed_at, null)
  assert.equal(Number((await h.query('cashup.summary',{shift_id:shift})).data.expected_cash), 0.37)
  const close = await h.call('cmd_shift_close', h.envelope('shift.close',{shift_id:shift,counted_cash:'0.37'}))
  assert.equal(close.ok,true,JSON.stringify(close.error))
  const closed = await h.call('cmd_sale_void', h.envelope('sale.void',{...blockedPayload,approval_id:blockedApproval}),{approvalHash:blockedHash})
  assert.equal(closed.ok,false)
  assert.equal(closed.error.code,'SHIFT_CLOSED')
})
