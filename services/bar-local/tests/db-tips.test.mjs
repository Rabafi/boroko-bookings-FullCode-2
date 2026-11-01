import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

async function openShiftFor(h, tokenHash, openingFloat = '0') {
  const result = await h.call('cmd_shift_open', h.envelope('shift.open', { opening_float: openingFloat }), { tokenHash })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result.shift_id
}

function saleEnvelope(h, shiftId, productId, tipAmount, total) {
  return h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: '0',
    tip_amount: tipAmount,
    tenders: [{ method: 'cash', amount: total, tendered: total }]
  })
}

test('tips allocate against completed sales and payout reversals restore staff balances', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await h.seedShiftCatalogue()
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES
       ('1000','Cash','asset'), ('2300','Tips payable','liability'), ('4000','Sales revenue','revenue')`
  )
  const ownerShiftId = await h.openShift('100.00')
  const managerShiftId = await openShiftFor(h, h.managerTokenHash, '100.00')

  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'TIP-TEST', name: 'Tip test item', category: 'Test', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))

  const sale = await h.call('cmd_sale_commit', saleEnvelope(h, ownerShiftId, product.result.product_id, '5.00', '15.00'))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  assert.equal(Number(sale.result.receipt.tip), 5)

  const noTipSale = await h.call('cmd_sale_commit', saleEnvelope(h, ownerShiftId, product.result.product_id, '0', '10.00'))
  assert.equal(noTipSale.ok, true, JSON.stringify(noTipSale.error))
  const noTipAllocation = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: noTipSale.result.sale_id,
    staff_id: h.ownerStaffId,
    amount: '1.00'
  }))
  assert.equal(noTipAllocation.ok, false)
  assert.equal(noTipAllocation.error.code, 'TIP_NOT_AVAILABLE')

  const ownerAllocationEnvelope = h.envelope('workforce.tip.allocate', {
    sale_id: sale.result.sale_id,
    staff_id: h.ownerStaffId,
    amount: '3.00',
    points: '1.5'
  })
  const ownerAllocation = await h.call('cmd_workforce_tip_allocate', ownerAllocationEnvelope)
  assert.equal(ownerAllocation.ok, true, JSON.stringify(ownerAllocation.error))
  assert.equal(Number(ownerAllocation.result.amount), 3)
  assert.equal(Number(ownerAllocation.result.allocated_total), 3)
  assert.equal(Number(ownerAllocation.result.remaining_tip), 2)
  assert.ok(ownerAllocation.result.allocation_id)

  const allocationReplay = await h.call('cmd_workforce_tip_allocate', ownerAllocationEnvelope)
  assert.equal(allocationReplay.ok, true)
  assert.equal(allocationReplay.replayed, true)
  assert.equal(allocationReplay.result.allocation_id, ownerAllocation.result.allocation_id)

  const duplicateAllocation = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: sale.result.sale_id,
    staff_id: h.ownerStaffId,
    amount: '1.00'
  }))
  assert.equal(duplicateAllocation.ok, false)
  assert.equal(duplicateAllocation.error.code, 'TIP_ALLOCATION_DUPLICATE')

  const managerAllocation = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: sale.result.sale_id,
    staff_id: h.managerStaffId,
    amount: '2.00'
  }))
  assert.equal(managerAllocation.ok, true, JSON.stringify(managerAllocation.error))
  assert.equal(Number(managerAllocation.result.allocated_total), 5)
  assert.equal(Number(managerAllocation.result.remaining_tip), 0)

  const cashierId = await h.insertStaff('Tip Cashier', 'cashier', ['pos.view', 'pos.manage', 'pos.cashup'])
  const overAllocation = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: sale.result.sale_id,
    staff_id: cashierId,
    amount: '0.01'
  }))
  assert.equal(overAllocation.ok, false)
  assert.equal(overAllocation.error.code, 'TIP_ALLOCATION_EXCEEDS_SALE_TIP')

  await h.migrator.query(`UPDATE bar_local.staff SET status = 'suspended' WHERE id = $1`, [cashierId])
  const suspendedAllocation = await h.call('cmd_workforce_tip_allocate', h.envelope('workforce.tip.allocate', {
    sale_id: sale.result.sale_id,
    staff_id: cashierId,
    amount: '0.01'
  }))
  assert.equal(suspendedAllocation.ok, false)
  assert.equal(suspendedAllocation.error.code, 'STAFF_INACTIVE')

  const payoutPayload = {
    staff_id: h.ownerStaffId,
    shift_id: ownerShiftId,
    amount: '2.50',
    reason: 'Evening tip share'
  }
  const missingApproval = await h.call('cmd_workforce_tip_payout', h.envelope('workforce.tip.payout', payoutPayload), {
    tokenHash: h.managerTokenHash
  })
  assert.equal(missingApproval.ok, false)
  assert.equal(missingApproval.error.code, 'APPROVAL_REQUIRED')

  const selfHash = sha256Json(payoutPayload)
  const selfPayload = { ...payoutPayload, approval_id: await h.approve('pos.cashup', selfHash, { targetType: 'tip_payout' }) }
  const selfApproved = await h.call('cmd_workforce_tip_payout', h.envelope('workforce.tip.payout', selfPayload), {
    tokenHash: h.managerTokenHash,
    approvalHash: selfHash
  })
  assert.equal(selfApproved.ok, false)
  assert.equal(selfApproved.error.code, 'MAKER_CHECKER_VIOLATION')

  const overpaymentPayload = { ...payoutPayload, amount: '6.00' }
  const overpaymentHash = sha256Json(overpaymentPayload)
  overpaymentPayload.approval_id = await h.approve('pos.cashup', overpaymentHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'tip_payout'
  })
  const overpayment = await h.call('cmd_workforce_tip_payout', h.envelope('workforce.tip.payout', overpaymentPayload), {
    tokenHash: h.managerTokenHash,
    approvalHash: overpaymentHash
  })
  assert.equal(overpayment.ok, false)
  assert.equal(overpayment.error.code, 'TIP_BALANCE_INSUFFICIENT')

  const wrongShiftPayload = {
    staff_id: h.managerStaffId,
    shift_id: ownerShiftId,
    amount: '1.00',
    reason: 'Mismatched drawer'
  }
  const wrongShiftHash = sha256Json(wrongShiftPayload)
  wrongShiftPayload.approval_id = await h.approve('pos.cashup', wrongShiftHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'tip_payout'
  })
  const wrongShift = await h.call('cmd_workforce_tip_payout', h.envelope('workforce.tip.payout', wrongShiftPayload), {
    tokenHash: h.managerTokenHash,
    approvalHash: wrongShiftHash
  })
  assert.equal(wrongShift.ok, false)
  assert.equal(wrongShift.error.code, 'SHIFT_SCOPE_MISMATCH')

  const payoutHash = sha256Json(payoutPayload)
  const payoutEnvelope = h.envelope('workforce.tip.payout', {
    ...payoutPayload,
    approval_id: await h.approve('pos.cashup', payoutHash, {
      approverStaffId: h.ownerStaffId,
      targetType: 'tip_payout'
    })
  })
  const payout = await h.call('cmd_workforce_tip_payout', payoutEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: payoutHash
  })
  assert.equal(payout.ok, true, JSON.stringify(payout.error))
  assert.equal(payout.result.status, 'paid')
  assert.equal(Number(payout.result.amount), 2.5)
  assert.equal(Number(payout.result.balance_before), 3)
  assert.equal(Number(payout.result.balance_after), 0.5)
  assert.ok(payout.result.cash_movement_id)
  const payoutRead=await h.query('workforce.tip_payouts')
  assert.equal(payoutRead.complete,true)
  assert.equal(payoutRead.data[0].id,payout.result.payout_id)
  assert.equal(payoutRead.data[0].amount,'2.50')
  assert.equal(payoutRead.data[0].status,'paid')
  await assert.rejects(h.runtime.query('SELECT bar_local.query_tip_payouts($1,$2,$3,$4,$5)',[h.ownerTokenHash,h.deviceId,h.authorityId,1,{}]),error=>error.code==='42501')

  const payoutReplay = await h.call('cmd_workforce_tip_payout', payoutEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: payoutHash
  })
  assert.equal(payoutReplay.replayed, true)
  assert.equal(payoutReplay.result.payout_id, payout.result.payout_id)

  const paidMovement = await h.migrator.query(
    'SELECT type, amount, shift_id FROM bar_local.cash_movements WHERE id = $1',
    [payout.result.cash_movement_id]
  )
  assert.equal(paidMovement.rows[0].type, 'paid_out')
  assert.equal(Number(paidMovement.rows[0].amount), 2.5)
  assert.equal(paidMovement.rows[0].shift_id, ownerShiftId)

  const residualOverpaymentPayload = { ...payoutPayload, amount: '0.51' }
  const residualHash = sha256Json(residualOverpaymentPayload)
  residualOverpaymentPayload.approval_id = await h.approve('pos.cashup', residualHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'tip_payout'
  })
  const residualOverpayment = await h.call('cmd_workforce_tip_payout', h.envelope('workforce.tip.payout', residualOverpaymentPayload), {
    tokenHash: h.managerTokenHash,
    approvalHash: residualHash
  })
  assert.equal(residualOverpayment.ok, false)
  assert.equal(residualOverpayment.error.code, 'TIP_BALANCE_INSUFFICIENT')

  const reversePayload = { payout_id: payout.result.payout_id, reason: 'Paid to the wrong operator' }
  const reverseHash = sha256Json(reversePayload)
  reversePayload.approval_id = await h.approve('pos.cashup', reverseHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'tip_payout',
    targetId: payout.result.payout_id
  })
  const reverseEnvelope = h.envelope('workforce.tip.payout.reverse', reversePayload)
  const reversed = await h.call('cmd_workforce_tip_payout_reverse', reverseEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: reverseHash
  })
  assert.equal(reversed.ok, true, JSON.stringify(reversed.error))
  assert.equal(reversed.result.status, 'reversed')
  assert.equal(Number(reversed.result.amount), 2.5)
  assert.equal(Number(reversed.result.balance_after), 3)
  assert.ok(reversed.result.cash_movement_id)
  assert.equal((await h.query('workforce.tip_payouts')).data.find(row=>row.id===payout.result.payout_id).status,'reversed')

  const reversalMovement = await h.migrator.query(
    'SELECT type, amount, shift_id FROM bar_local.cash_movements WHERE id = $1',
    [reversed.result.cash_movement_id]
  )
  assert.equal(reversalMovement.rows[0].type, 'paid_in')
  assert.equal(Number(reversalMovement.rows[0].amount), 2.5)
  assert.equal(reversalMovement.rows[0].shift_id, ownerShiftId)

  const reversalRows = await h.migrator.query(
    'SELECT count(*)::integer AS count FROM bar_local.tip_payout_reversals WHERE payout_id = $1',
    [payout.result.payout_id]
  )
  assert.equal(reversalRows.rows[0].count, 1)

  const secondReversePayload = { payout_id: payout.result.payout_id, reason: 'Duplicate reversal attempt' }
  const secondReverseHash = sha256Json(secondReversePayload)
  secondReversePayload.approval_id = await h.approve('pos.cashup', secondReverseHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'tip_payout',
    targetId: payout.result.payout_id
  })
  const secondReverse = await h.call('cmd_workforce_tip_payout_reverse', h.envelope('workforce.tip.payout.reverse', secondReversePayload), {
    tokenHash: h.managerTokenHash,
    approvalHash: secondReverseHash
  })
  assert.equal(secondReverse.ok, false)
  assert.equal(secondReverse.error.code, 'TIP_PAYOUT_ALREADY_REVERSED')

  const managerPayoutPayload = {
    staff_id: h.managerStaffId,
    shift_id: managerShiftId,
    amount: '2.00',
    reason: 'Manager tip share'
  }
  const managerPayoutHash = sha256Json(managerPayoutPayload)
  managerPayoutPayload.approval_id = await h.approve('pos.cashup', managerPayoutHash, { targetType: 'tip_payout' })
  const managerPayoutEnvelope = h.envelope('workforce.tip.payout', managerPayoutPayload)
  const managerPayout = await h.call('cmd_workforce_tip_payout', managerPayoutEnvelope, {
    tokenHash: h.ownerTokenHash,
    approvalHash: managerPayoutHash
  })
  assert.equal(managerPayout.ok, true, JSON.stringify(managerPayout.error))
  assert.equal(Number(managerPayout.result.balance_after), 0)

  const closeManager = await h.call('cmd_shift_close', h.envelope('shift.close', {
    shift_id: managerShiftId, counted_cash: '98.00'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(closeManager.ok, true, JSON.stringify(closeManager.error))
  const cashup = await h.call('cmd_cashup_submit', h.envelope('cashup.submit', {
    shift_id: managerShiftId, counted_cash: '98.00', counted_card: '0', proof_refs: []
  }), { tokenHash: h.managerTokenHash })
  assert.equal(cashup.ok, true, JSON.stringify(cashup.error))
  const before = await h.migrator.query(
    `SELECT (SELECT to_jsonb(c) FROM bar_local.cashups c WHERE c.id = $1) AS cashup,
            (SELECT to_jsonb(p) FROM bar_local.tip_payouts p WHERE p.id = $2) AS payout,
            (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM bar_local.cash_movements m WHERE m.shift_id = $3) AS movements,
            (SELECT count(*)::int FROM bar_local.tip_payout_reversals WHERE payout_id = $2) AS reversals`,
    [cashup.result.cashup_id, managerPayout.result.payout_id, managerShiftId]
  )
  const closedPayload = { payout_id: managerPayout.result.payout_id, reason: 'Closed drawer correction' }
  const closedHash = sha256Json(closedPayload)
  closedPayload.approval_id = await h.approve('pos.cashup', closedHash, {
    targetType: 'tip_payout', targetId: managerPayout.result.payout_id
  })
  const closedEnvelope = h.envelope('workforce.tip.payout.reverse', closedPayload)
  const closedReversal = await h.call('cmd_workforce_tip_payout_reverse', closedEnvelope, { approvalHash: closedHash })
  assert.equal(closedReversal.ok, false)
  assert.equal(closedReversal.error.code, 'SHIFT_CLOSED')
  const after = await h.migrator.query(
    `SELECT (SELECT to_jsonb(c) FROM bar_local.cashups c WHERE c.id = $1) AS cashup,
            (SELECT to_jsonb(p) FROM bar_local.tip_payouts p WHERE p.id = $2) AS payout,
            (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM bar_local.cash_movements m WHERE m.shift_id = $3) AS movements,
            (SELECT count(*)::int FROM bar_local.tip_payout_reversals WHERE payout_id = $2) AS reversals`,
    [cashup.result.cashup_id, managerPayout.result.payout_id, managerShiftId]
  )
  assert.deepEqual(after.rows[0], before.rows[0])
  const closedReplay = await h.call('cmd_workforce_tip_payout_reverse', closedEnvelope, { approvalHash: closedHash })
  assert.equal(closedReplay.replayed, true)
  assert.equal(closedReplay.error.code, 'SHIFT_CLOSED')
  const recoveryOpen = await h.call('cmd_shift_open', h.envelope('shift.open', { opening_float: '0.00' }), {
    tokenHash: h.managerTokenHash
  })
  assert.equal(recoveryOpen.ok, true, JSON.stringify(recoveryOpen.error))
  const recoveryPayload = {
    payout_id: managerPayout.result.payout_id,
    recovery_shift_id: recoveryOpen.result.shift_id,
    reason: 'Manager-approved correction after original cash-up'
  }
  const recoveryHash = sha256Json(recoveryPayload)
  recoveryPayload.approval_id = await h.approve('pos.cashup', recoveryHash, {
    targetType: 'tip_payout', targetId: managerPayout.result.payout_id
  })
  const recoveryEnvelope = h.envelope('workforce.tip.payout.reverse', recoveryPayload)
  const recovered = await h.call('cmd_workforce_tip_payout_reverse', recoveryEnvelope, { approvalHash: recoveryHash })
  assert.equal(recovered.ok, true, JSON.stringify(recovered.error))
  assert.equal(recovered.result.original_shift_id, managerShiftId)
  assert.equal(recovered.result.recovery_shift_id, recoveryOpen.result.shift_id)
  const recoveryMovement = await h.migrator.query(
    'SELECT shift_id, type, amount FROM bar_local.cash_movements WHERE id = $1',
    [recovered.result.cash_movement_id]
  )
  assert.deepEqual(recoveryMovement.rows[0], { shift_id: recoveryOpen.result.shift_id, type: 'paid_in', amount: '2.00' })
  const closeRecovery = await h.call('cmd_shift_close', h.envelope('shift.close', {
    shift_id: recoveryOpen.result.shift_id, counted_cash: '2.00'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(closeRecovery.ok, true, JSON.stringify(closeRecovery.error))
  const committedPayoutReplay = await h.call('cmd_workforce_tip_payout', managerPayoutEnvelope, { approvalHash: managerPayoutHash })
  assert.equal(committedPayoutReplay.replayed, true)
  assert.deepEqual(committedPayoutReplay.receipt, managerPayout.receipt)
  const closeOwner = await h.call('cmd_shift_close', h.envelope('shift.close', {
    shift_id: ownerShiftId, counted_cash: '125.00'
  }))
  assert.equal(closeOwner.ok, true, JSON.stringify(closeOwner.error))
  const committedReversalReplay = await h.call('cmd_workforce_tip_payout_reverse', reverseEnvelope, {
    tokenHash: h.managerTokenHash, approvalHash: reverseHash
  })
  assert.equal(committedReversalReplay.replayed, true)
  assert.deepEqual(committedReversalReplay.receipt, reversed.receipt)

  const balances = await h.migrator.query(
    `SELECT id AS staff_id, bar_local.staff_tip_balance($1, $2, id) AS balance
       FROM bar_local.staff WHERE id = ANY($3::uuid[]) ORDER BY id`,
    [h.businessId, h.outletId, [h.ownerStaffId, h.managerStaffId]]
  )
  const ownerBalance = balances.rows.find((row) => row.staff_id === h.ownerStaffId)
  const managerBalance = balances.rows.find((row) => row.staff_id === h.managerStaffId)
  assert.equal(Number(ownerBalance.balance), 3)
  assert.equal(Number(managerBalance.balance), 2)

  const payoutStatus = await h.migrator.query('SELECT status FROM bar_local.tip_payouts WHERE id = $1', [payout.result.payout_id])
  assert.equal(payoutStatus.rows[0].status, 'reversed')

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'workforce.tip.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'workforce.tip.allocated',
    'workforce.tip.allocated',
    'workforce.tip.paid_out',
    'workforce.tip.payout_reversed',
    'workforce.tip.paid_out',
    'workforce.tip.payout_reversed'
  ])

  const outbox = await h.migrator.query(
    `SELECT event_type FROM bar_local.outbox WHERE event_type LIKE 'workforce.tip.%' ORDER BY commit_sequence, event_index`
  )
  assert.deepEqual(outbox.rows.map((row) => row.event_type), [
    'workforce.tip.allocated',
    'workforce.tip.allocated',
    'workforce.tip.paid_out',
    'workforce.tip.payout_reversed',
    'workforce.tip.paid_out',
    'workforce.tip.payout_reversed'
  ])

  await assert.rejects(
    h.runtime.query('SELECT count(*) FROM bar_local.tip_allocations'),
    (error) => /permission denied/i.test(String(error.message))
  )
})
