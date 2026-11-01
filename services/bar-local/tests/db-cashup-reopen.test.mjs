import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

async function submitAndReview(h, outcome = 'approved') {
  const shiftId = await h.openShift('100.00')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'CASH-1', name: 'Cash Product', category: 'Test', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: product.result.product_id, quantity: '1' }],
    tenders: [{ method: 'cash', amount: '10.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))

  const close = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shiftId, counted_cash: '110.00' }))
  assert.equal(close.ok, true, JSON.stringify(close.error))
  const cashup = await h.call('cmd_cashup_submit', h.envelope('cashup.submit', {
    shift_id: shiftId, counted_cash: '110.00', counted_card: '0', notes: 'balanced', proof_refs: []
  }))
  assert.equal(cashup.ok, true, JSON.stringify(cashup.error))

  const reviewPayload = { cashup_id: cashup.result.cashup_id, decision: outcome, reason: `manager ${outcome}` }
  const reviewHash = sha256Json(reviewPayload)
  reviewPayload.approval_id = await h.approve('pos.cashup', reviewHash, {
    targetType: 'cashup', targetId: cashup.result.cashup_id, approverStaffId: h.ownerStaffId
  })
  const review = await h.call('cmd_cashup_review', h.envelope('cashup.review', reviewPayload), {
    approvalHash: reviewHash, tokenHash: h.managerTokenHash
  })
  assert.equal(review.ok, true, JSON.stringify(review.error))
  assert.equal(review.result.status, outcome)
  return { shiftId, cashupId: cashup.result.cashup_id }
}

function reopenPayload(cashupId, expectedStatus, countedCash) {
  return {
    cashup_id: cashupId,
    expected_status: expectedStatus,
    counted_cash: countedCash,
    counted_card: '0',
    notes: 'corrected count',
    proof_refs: ['recount-sheet'],
    reason: 'Recount found a variance'
  }
}

test('cash-up reopen creates a submitted revision and preserves the reviewed snapshot', async (t) => {
  const h = await createHarness(t)
  const { shiftId, cashupId } = await submitAndReview(h, 'approved')

  const reopen = reopenPayload(cashupId, 'approved', '108.00')
  const reopenHash = sha256Json(reopen)
  reopen.approval_id = await h.approve('pos.cashup', reopenHash, { targetType: 'cashup', targetId: cashupId })
  const reopenEnvelope = h.envelope('cashup.reopen', reopen)
  const reopened = await h.call('cmd_cashup_reopen', reopenEnvelope, { approvalHash: reopenHash })
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error))
  assert.equal(reopened.result.status, 'submitted')
  assert.equal(reopened.result.revision, 2)
  assert.equal(reopened.result.prior_revision, 1)
  assert.equal(reopened.result.prior_status, 'approved')
  assert.equal(Number(reopened.result.expected_cash), 110)
  assert.equal(Number(reopened.result.variance), -2)

  const current = await h.migrator.query('SELECT revision, status, counted_cash, reviewed_by, reopen_reason FROM bar_local.cashups WHERE id = $1', [cashupId])
  assert.equal(current.rows[0].revision, 2)
  assert.equal(current.rows[0].status, 'submitted')
  assert.equal(Number(current.rows[0].counted_cash), 108)
  assert.equal(current.rows[0].reviewed_by, null)
  assert.equal(current.rows[0].reopen_reason, 'Recount found a variance')

  const revisions = await h.migrator.query('SELECT revision, status, counted_cash, variance, snapshot FROM bar_local.cashup_revisions WHERE cashup_id = $1', [cashupId])
  assert.equal(revisions.rows.length, 1)
  assert.equal(revisions.rows[0].revision, 1)
  assert.equal(revisions.rows[0].status, 'approved')
  assert.equal(Number(revisions.rows[0].counted_cash), 110)
  assert.equal(Number(revisions.rows[0].variance), 0)
  assert.equal(revisions.rows[0].snapshot.status, 'approved')
  assert.equal(revisions.rows[0].snapshot.revision, 1)

  const replay = await h.call('cmd_cashup_reopen', reopenEnvelope, { approvalHash: reopenHash })
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)
  assert.equal(replay.receipt.operation_id, reopened.receipt.operation_id)

  const summary = await h.query('cashup.summary', { shift_id: shiftId })
  assert.equal(summary.data.cashup.status, 'submitted')
  assert.equal(Number(summary.data.cashup.counted_cash), 108)
  assert.equal(Number(summary.data.cashup.variance), -2)

  const reviewPayload = { cashup_id: cashupId, decision: 'approved', reason: 'recount accepted' }
  const reviewHash = sha256Json(reviewPayload)
  reviewPayload.approval_id = await h.approve('pos.cashup', reviewHash, {
    targetType: 'cashup', targetId: cashupId, approverStaffId: h.ownerStaffId
  })
  const review = await h.call('cmd_cashup_review', h.envelope('cashup.review', reviewPayload), {
    approvalHash: reviewHash, tokenHash: h.managerTokenHash
  })
  assert.equal(review.ok, true, JSON.stringify(review.error))
  assert.equal(review.result.status, 'approved')

  const conflictPayload = reopenPayload(cashupId, 'rejected', '108.00')
  const conflictHash = sha256Json(conflictPayload)
  conflictPayload.approval_id = await h.approve('pos.cashup', conflictHash, { targetType: 'cashup', targetId: cashupId })
  const conflict = await h.call('cmd_cashup_reopen', h.envelope('cashup.reopen', conflictPayload), { approvalHash: conflictHash })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.code, 'CASHUP_STATE_CONFLICT')

  const final = await h.migrator.query('SELECT revision, status, counted_cash FROM bar_local.cashups WHERE id = $1', [cashupId])
  assert.equal(final.rows[0].revision, 2)
  assert.equal(final.rows[0].status, 'approved')
  assert.equal(Number(final.rows[0].counted_cash), 108)
})

test('a rejected cash-up can be reopened for correction', async (t) => {
  const h = await createHarness(t)
  const { cashupId } = await submitAndReview(h, 'rejected')

  const reopen = reopenPayload(cashupId, 'rejected', '109.50')
  const reopenHash = sha256Json(reopen)
  reopen.approval_id = await h.approve('pos.cashup', reopenHash, { targetType: 'cashup', targetId: cashupId })
  const reopened = await h.call('cmd_cashup_reopen', h.envelope('cashup.reopen', reopen), { approvalHash: reopenHash })
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error))
  assert.equal(reopened.result.prior_status, 'rejected')
  assert.equal(reopened.result.revision, 2)
  assert.equal(Number(reopened.result.variance), -0.5)

  const reviewPayload = { cashup_id: cashupId, decision: 'approved', reason: 'correction accepted' }
  const reviewHash = sha256Json(reviewPayload)
  reviewPayload.approval_id = await h.approve('pos.cashup', reviewHash, {
    targetType: 'cashup', targetId: cashupId, approverStaffId: h.ownerStaffId
  })
  const review = await h.call('cmd_cashup_review', h.envelope('cashup.review', reviewPayload), {
    approvalHash: reviewHash, tokenHash: h.managerTokenHash
  })
  assert.equal(review.ok, true, JSON.stringify(review.error))
  assert.equal(review.result.status, 'approved')
})

test('cash-up reopen is refused until the submission has been reviewed', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift('0')
  const close = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shiftId, counted_cash: '0' }))
  assert.equal(close.ok, true, JSON.stringify(close.error))
  const cashup = await h.call('cmd_cashup_submit', h.envelope('cashup.submit', {
    shift_id: shiftId, counted_cash: '0', counted_card: '0', proof_refs: []
  }))
  assert.equal(cashup.ok, true, JSON.stringify(cashup.error))

  const payload = reopenPayload(cashup.result.cashup_id, 'approved', '0')
  const hash = sha256Json(payload)
  payload.approval_id = await h.approve('pos.cashup', hash, { targetType: 'cashup', targetId: cashup.result.cashup_id })
  const refused = await h.call('cmd_cashup_reopen', h.envelope('cashup.reopen', payload), { approvalHash: hash })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'CASHUP_NOT_REVIEWED')

  const stored = await h.migrator.query('SELECT revision, status FROM bar_local.cashups WHERE id = $1', [cashup.result.cashup_id])
  assert.equal(stored.rows[0].revision, 1)
  assert.equal(stored.rows[0].status, 'submitted')
})

test('cash-up reopen is blocked once the accounting period is closed', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES
       ('1000','Cash','asset'), ('4000','Sales revenue','revenue')`
  )
  const { shiftId, cashupId } = await submitAndReview(h, 'approved')
  const period = await h.migrator.query("SELECT to_char(business_date, 'YYYY-MM') AS period FROM bar_local.shifts WHERE id = $1", [shiftId])

  const closePayload = { period: period.rows[0].period }
  const closeHash = sha256Json(closePayload)
  closePayload.approval_id = await h.approve('accounting.approve', closeHash, {
    targetType: 'accounting_period', approverStaffId: h.managerStaffId
  })
  const closed = await h.call('cmd_period_close', h.envelope('accounting.period.close', closePayload), { approvalHash: closeHash })
  assert.equal(closed.ok, true, JSON.stringify(closed.error))

  const reopen = reopenPayload(cashupId, 'approved', '109.00')
  const reopenHash = sha256Json(reopen)
  reopen.approval_id = await h.approve('pos.cashup', reopenHash, { targetType: 'cashup', targetId: cashupId })
  const refused = await h.call('cmd_cashup_reopen', h.envelope('cashup.reopen', reopen), { approvalHash: reopenHash })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'PERIOD_LOCKED')

  const stored = await h.migrator.query('SELECT revision, status FROM bar_local.cashups WHERE id = $1', [cashupId])
  assert.equal(stored.rows[0].revision, 1)
  assert.equal(stored.rows[0].status, 'approved')
  const revisions = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.cashup_revisions WHERE cashup_id = $1', [cashupId])
  assert.equal(revisions.rows[0].count, 0)
})
