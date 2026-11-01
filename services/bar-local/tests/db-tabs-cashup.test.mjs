import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json, sha256Text } from './harness.mjs'

test('tabs enforce ownership checks and cash-up stays maker-checker safe', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()

  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'GIN-750', name: 'Gin 750ml', category: 'Spirits', price: '10.00', tax_rate: '0.14', track_stock: true
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id
  const receive = await h.call('cmd_stock_receive', h.envelope('stock.receive', { product_id: productId, quantity: '10' }))
  assert.equal(receive.ok, true, JSON.stringify(receive.error))

  const cashierStaffId = await h.insertStaff('Cashier One', 'cashier', ['pos.view', 'pos.manage', 'pos.cashup'])
  const cashierTokenHash = sha256Text(`cashier-token-${cashierStaffId}`)
  await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [
    cashierStaffId, h.deviceId, h.outletId, cashierTokenHash
  ])
  const managerShift = await h.call('cmd_shift_open', h.envelope('shift.open', { opening_float: '0' }), { tokenHash: h.managerTokenHash })
  assert.equal(managerShift.ok, true, JSON.stringify(managerShift.error))

  const tab = await h.call('cmd_tab_open', h.envelope('tab.open', { table_label: 'Table 4' }))
  assert.equal(tab.ok, true, JSON.stringify(tab.error))
  const tabId = tab.result.tab_id

  const addOwner = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: tabId, expected_version: 1, items: [{ product_id: productId, quantity: '2' }]
  }))
  assert.equal(addOwner.ok, true, JSON.stringify(addOwner.error))
  assert.equal(addOwner.result.version, 2)

  const deniedAdd = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: tabId, expected_version: 2, items: [{ product_id: productId, quantity: '1' }]
  }), { tokenHash: cashierTokenHash })
  assert.equal(deniedAdd.ok, false)
  assert.equal(deniedAdd.error.code, 'TAB_NOT_OWNED')

  const menuAfterDenied = await h.query('menu.list', {})
  assert.equal(Number(menuAfterDenied.data.find((row) => row.product_id === productId).stock_quantity), 8)

  const addManager = await h.call('cmd_tab_add', h.envelope('tab.add', {
    tab_id: tabId, expected_version: 2, items: [{ product_id: productId, quantity: '1' }]
  }), { tokenHash: h.managerTokenHash })
  assert.equal(addManager.ok, true, JSON.stringify(addManager.error))
  assert.equal(addManager.result.version, 3)

  const settle = await h.call('cmd_tab_settle', h.envelope('tab.settle', {
    tab_id: tabId,
    expected_version: 3,
    discount_amount: '0',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '34.20', tendered: '40.00' }]
  }))
  assert.equal(settle.ok, true, JSON.stringify(settle.error))
  assert.equal(Number(settle.receipt.total), 34.2)
  assert.equal(Number(settle.receipt.change), 5.8)

  const duplicateSettle = await h.call('cmd_tab_settle', h.envelope('tab.settle', {
    tab_id: tabId,
    expected_version: 4,
    tenders: [{ method: 'cash', amount: '34.20' }]
  }))
  assert.equal(duplicateSettle.ok, false)
  assert.equal(duplicateSettle.error.code, 'DUPLICATE_SETTLEMENT')

  const close = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shiftId, counted_cash: '134.20' }))
  assert.equal(close.ok, true, JSON.stringify(close.error))
  assert.equal(Number(close.result.expected_cash), 134.2)
  assert.equal(Number(close.result.variance), 0)

  const cashup = await h.call('cmd_cashup_submit', h.envelope('cashup.submit', {
    shift_id: shiftId, counted_cash: '134.20', counted_card: '0', notes: 'balanced', proof_refs: []
  }))
  assert.equal(cashup.ok, true, JSON.stringify(cashup.error))
  assert.equal(Number(cashup.result.variance), 0)

  const reviewEnvelope = h.envelope('cashup.review', {
    cashup_id: cashup.result.cashup_id, decision: 'approved', reason: 'counted'
  })
  const reviewHash = sha256Json(reviewEnvelope.payload)
  reviewEnvelope.payload.approval_id = await h.approve('pos.cashup', reviewHash, {
    targetType: 'cashup', targetId: cashup.result.cashup_id, approverStaffId: h.ownerStaffId
  })
  const review = await h.call('cmd_cashup_review', reviewEnvelope, { approvalHash: reviewHash, tokenHash: h.managerTokenHash })
  assert.equal(review.ok, true, JSON.stringify(review.error))
  assert.equal(review.result.status, 'approved')

  const stored = await h.migrator.query('SELECT status, variance FROM bar_local.cashups WHERE id = $1', [cashup.result.cashup_id])
  assert.equal(stored.rows[0].status, 'approved')
  assert.equal(Number(stored.rows[0].variance), 0)
})
