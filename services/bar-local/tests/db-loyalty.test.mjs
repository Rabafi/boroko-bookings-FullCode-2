import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

function assertOk(result, label) {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`)
  return result.result
}

async function createCustomer(h, name) {
  const created = await h.call('cmd_customer_create', h.envelope('customer.create', { name }))
  return assertOk(created, 'customer.create').customer_id
}

test('loyalty ledger keeps append-only points, exact rounding, approvals and replay', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()

  const programEnvelope = h.envelope('loyalty.program.upsert', {
    name: 'Bar loyalty',
    earn_rate: '1.25',
    redeem_value: '0.10',
    min_redeem_points: 5,
    active: true
  })
  const program = assertOk(await h.call('cmd_loyalty_program_upsert', programEnvelope), 'loyalty.program.upsert')
  assert.equal(Number(program.earn_rate), 1.25)
  assert.equal(Number(program.redeem_value), 0.1)
  assert.equal(program.min_redeem_points, 5)
  assert.equal(program.version, 1)

  const customerId = await createCustomer(h, 'Loyalty Guest')

  const enrolEnvelope = h.envelope('loyalty.account.enrol', { customer_id: customerId })
  const enrolled = assertOk(await h.call('cmd_loyalty_account_enrol', enrolEnvelope), 'loyalty.account.enrol')
  assert.equal(enrolled.customer_id, customerId)
  assert.equal(enrolled.status, 'active')
  assert.equal(enrolled.points_balance, 0)
  assert.equal(enrolled.version, 1)
  const accountId = enrolled.account_id

  const balanceAfterEnroll = await h.query('loyalty.account.get', { customer_id: customerId })
  assert.equal(balanceAfterEnroll.complete, true)
  assert.equal(balanceAfterEnroll.scope.business_id, h.businessId)
  assert.equal(balanceAfterEnroll.scope.outlet_id, h.outletId)
  assert.equal(balanceAfterEnroll.data.account_id, accountId)
  assert.equal(balanceAfterEnroll.data.points_balance, 0)
  await assert.rejects(
    () => h.query('loyalty.account.get', { customer_id: customerId, business_id: h.businessId }),
    /loyalty\.account\.get requires only a customer_id|VALIDATION_FAILED/i
  )

  const duplicateEnrol = await h.call('cmd_loyalty_account_enrol', h.envelope('loyalty.account.enrol', { customer_id: customerId }))
  assert.equal(duplicateEnrol.ok, false)
  assert.equal(duplicateEnrol.error.code, 'LOYALTY_ACCOUNT_EXISTS')

  const product = assertOk(await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'LOY-1', name: 'Loyalty test item', category: 'Test', price: '10.35', tax_rate: '0', track_stock: false
  })), 'catalogue.upsert')

  const sale = assertOk(await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    customer_id: customerId,
    items: [{ product_id: product.product_id, quantity: '1' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.35', tendered: '10.35' }]
  })), 'sale.commit')

  const earnEnvelope = h.envelope('loyalty.points.earn', {
    sale_id: sale.sale_id,
    customer_id: customerId
  })
  const earned = assertOk(await h.call('cmd_loyalty_points_earn', earnEnvelope), 'loyalty.points.earn')
  assert.equal(earned.points_delta, 12)
  assert.equal(earned.points_balance, 12)
  assert.equal(Number(earned.earn_rate), 1.25)
  assert.equal(earned.sale_id, sale.sale_id)
  assert.equal((await h.query('loyalty.account.get', { customer_id: customerId })).data.points_balance, 12)

  const earnReplay = await h.call('cmd_loyalty_points_earn', earnEnvelope)
  assert.equal(earnReplay.ok, true)
  assert.equal(earnReplay.replayed, true)
  assert.equal(earnReplay.result.transaction_id, earned.transaction_id)
  assert.equal(earnReplay.result.points_balance, 12)

  const duplicateEarn = await h.call('cmd_loyalty_points_earn', h.envelope('loyalty.points.earn', {
    sale_id: sale.sale_id,
    customer_id: customerId
  }))
  assert.equal(duplicateEarn.ok, false)
  assert.equal(duplicateEarn.error.code, 'DUPLICATE_LOYALTY_EARN')

  const redeemed = assertOk(await h.call('cmd_loyalty_points_redeem', h.envelope('loyalty.points.redeem', {
    customer_id: customerId,
    points: 5,
    reference: 'REWARD-1'
  })), 'loyalty.points.redeem')
  assert.equal(redeemed.points_delta, -5)
  assert.equal((await h.query('loyalty.account.get', { customer_id: customerId })).data.points_balance, 7)
  assert.equal(redeemed.points_balance, 7)
  assert.equal(Number(redeemed.redemption_value), 0.5)
  assert.equal(redeemed.reference, 'REWARD-1')

  const insufficient = await h.call('cmd_loyalty_points_redeem', h.envelope('loyalty.points.redeem', {
    customer_id: customerId,
    points: 100,
    reference: 'REWARD-2'
  }))
  assert.equal(insufficient.ok, false)
  assert.equal(insufficient.error.code, 'INSUFFICIENT_LOYALTY_POINTS')

  const negative = await h.call('cmd_loyalty_points_redeem', h.envelope('loyalty.points.redeem', {
    customer_id: customerId,
    points: -1,
    reference: 'REWARD-3'
  }))
  assert.equal(negative.ok, false)
  assert.equal(negative.error.code, 'VALIDATION_FAILED')

  const missingReference = await h.call('cmd_loyalty_points_redeem', h.envelope('loyalty.points.redeem', {
    customer_id: customerId,
    points: 1
  }))
  assert.equal(missingReference.ok, false)
  assert.equal(missingReference.error.code, 'VALIDATION_FAILED')

  const adjustmentPayload = { customer_id: customerId, points: 3, reason: 'Service recovery' }
  const adjustmentHash = sha256Json(adjustmentPayload)

  const selfApproval = await h.approve('accounting.approve', adjustmentHash, {
    approverStaffId: h.managerStaffId,
    targetType: 'loyalty_account',
    targetId: accountId
  })
  const makerChecker = await h.callWith(h.runtime, 'cmd_loyalty_points_adjust', h.envelope('loyalty.points.adjust', {
    ...adjustmentPayload,
    approval_id: selfApproval
  }), { tokenHash: h.managerTokenHash, approvalHash: adjustmentHash })
  assert.equal(makerChecker.ok, false)
  assert.equal(makerChecker.error.code, 'MAKER_CHECKER_VIOLATION')

  const ownerApproval = await h.approve('accounting.approve', adjustmentHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'loyalty_account',
    targetId: accountId
  })
  const adjusted = assertOk(await h.callWith(h.runtime, 'cmd_loyalty_points_adjust', h.envelope('loyalty.points.adjust', {
    ...adjustmentPayload,
    approval_id: ownerApproval
  }), { tokenHash: h.managerTokenHash, approvalHash: adjustmentHash }), 'loyalty.points.adjust')
  assert.equal(adjusted.points_delta, 3)
  assert.equal(adjusted.points_balance, 10)
  assert.equal(adjusted.reason, 'Service recovery')

  const overdrawPayload = { customer_id: customerId, points: -11, reason: 'Overdraw attempt' }
  const overdrawHash = sha256Json(overdrawPayload)
  const overdrawApproval = await h.approve('accounting.approve', overdrawHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'loyalty_account',
    targetId: accountId
  })
  const overdraw = await h.callWith(h.runtime, 'cmd_loyalty_points_adjust', h.envelope('loyalty.points.adjust', {
    ...overdrawPayload,
    approval_id: overdrawApproval
  }), { tokenHash: h.managerTokenHash, approvalHash: overdrawHash })
  assert.equal(overdraw.ok, false)
  assert.equal(overdraw.error.code, 'INSUFFICIENT_LOYALTY_POINTS')

  const ledger = await h.migrator.query(
    `SELECT type, points_delta, sale_id, operation_id, reference
       FROM bar_local.loyalty_ledger ORDER BY created_at, id`
  )
  assert.deepEqual(ledger.rows.map((row) => row.type).sort(), ['adjust', 'earn', 'redeem'])
  assert.equal(ledger.rows.reduce((sum, row) => sum + Number(row.points_delta), 0), 10)
  assert.equal(ledger.rows.find((row) => row.type === 'earn').sale_id, sale.sale_id)
  assert.equal(new Set(ledger.rows.map((row) => row.operation_id)).size, 3)

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'loyalty.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'loyalty.program.upserted',
    'loyalty.account.enrolled',
    'loyalty.points.earned',
    'loyalty.points.redeemed',
    'loyalty.points.adjusted'
  ])

  const outbox = await h.migrator.query(
    `SELECT event_type FROM bar_local.outbox WHERE event_type LIKE 'loyalty.%' ORDER BY commit_sequence, event_index`
  )
  assert.deepEqual(outbox.rows.map((row) => row.event_type), [
    'loyalty.program.upserted',
    'loyalty.account.enrolled',
    'loyalty.points.earned',
    'loyalty.points.redeemed',
    'loyalty.points.adjusted'
  ])

  await assert.rejects(
    () => h.migrator.query('UPDATE bar_local.loyalty_ledger SET points_delta = points_delta + 1'),
    /append-only/i
  )
  await assert.rejects(
    () => h.migrator.query('DELETE FROM bar_local.loyalty_ledger'),
    /append-only/i
  )
  await assert.rejects(
    () => h.runtime.query('SELECT 1 FROM bar_local.loyalty_ledger'),
    /permission denied/i
  )
})
