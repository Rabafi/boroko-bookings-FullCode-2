import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('drawer movements and float adjustments are shift-scoped, audited, and idempotent', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift('25.00')
  const envelope = h.envelope('drawer.movement', {
    shift_id: shiftId,
    type: 'paid_out',
    amount: '7.25',
    reason: 'Change float replenishment'
  })

  const first = await h.call('cmd_drawer_movement', envelope)
  assert.equal(first.ok, true, JSON.stringify(first.error))
  assert.equal(first.result.type, 'paid_out')
  assert.equal(Number(first.result.amount), 7.25)

  const replay = await h.call('cmd_drawer_movement', envelope)
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  assert.equal(replay.receipt.operation_id, first.receipt.operation_id)

  const ledger = await h.migrator.query(
    `SELECT count(*)::integer AS count, sum(amount)::numeric(12,2)::text AS amount
       FROM bar_local.cash_movements WHERE operation_id = $1 AND shift_id = $2`,
    [envelope.operation_id, shiftId]
  )
  assert.equal(ledger.rows[0].count, 1)
  assert.equal(ledger.rows[0].amount, '7.25')

  const floatEnvelope = h.envelope('drawer.movement', {
    shift_id: shiftId,
    type: 'float',
    amount: '5.00',
    reason: 'Till float top-up'
  })
  const float = await h.call('cmd_drawer_movement', floatEnvelope)
  assert.equal(float.ok, true, JSON.stringify(float.error))
  const floatReplay = await h.call('cmd_drawer_movement', floatEnvelope)
  assert.equal(floatReplay.replayed, true)
  const floatLedger = await h.migrator.query(
    'SELECT count(*)::integer AS count FROM bar_local.cash_movements WHERE operation_id = $1',
    [floatEnvelope.operation_id]
  )
  assert.equal(floatLedger.rows[0].count, 1)
  const expected = await h.migrator.query('SELECT bar_local.expected_shift_cash($1)::text AS amount', [shiftId])
  assert.equal(expected.rows[0].amount, '22.75')

  const countEnvelope = h.envelope('drawer.movement', {
    shift_id: shiftId,
    type: 'count',
    amount: '20.00',
    reason: 'Mid-shift till count'
  })
  const count = await h.call('cmd_drawer_movement', countEnvelope)
  assert.equal(count.ok, true, JSON.stringify(count.error))
  assert.equal(Number(count.result.counted_cash), 20)
  assert.equal(Number(count.result.expected_cash), 22.75)
  assert.equal(Number(count.result.variance), -2.75)
  const countReplay = await h.call('cmd_drawer_movement', countEnvelope)
  assert.equal(countReplay.replayed, true)
  assert.deepEqual(countReplay.result, count.result)
  const countLedger = await h.migrator.query(
    `SELECT count(*)::integer AS count, min(type) AS type, min(amount)::numeric(12,2)::text AS amount
       FROM bar_local.cash_movements WHERE operation_id = $1 AND shift_id = $2`,
    [countEnvelope.operation_id, shiftId]
  )
  assert.deepEqual(countLedger.rows[0], { count: 1, type: 'count', amount: '20.00' })
  const expectedAfterCount = await h.migrator.query('SELECT bar_local.expected_shift_cash($1)::text AS amount', [shiftId])
  assert.equal(expectedAfterCount.rows[0].amount, '22.75', 'physical counts must not alter expected drawer cash')

  const invalidMovement = h.envelope('drawer.movement', {
    shift_id: shiftId,
    type: 'paid_in',
    amount: '0.00',
    reason: 'Invalid zero cash movement'
  })
  const invalid = await h.call('cmd_drawer_movement', invalidMovement)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.outcome, 'refused')
  const invalidLedger = await h.migrator.query(
    'SELECT count(*)::integer AS count FROM bar_local.cash_movements WHERE operation_id = $1',
    [invalidMovement.operation_id]
  )
  assert.equal(invalidLedger.rows[0].count, 0, 'invalid direct command calls must not create cash movements')

  // Exercise the database entry point directly, bypassing shared API validation.
  const forgedPayout = h.envelope('drawer.movement', {
    shift_id: shiftId, type: 'tip_payout', amount: '1.00', reason: 'Bypass workforce approval'
  })
  const forgedResult = await h.call('cmd_drawer_movement', forgedPayout)
  assert.equal(forgedResult.ok, false)
  assert.equal(forgedResult.error.code, 'DRAWER_MOVEMENT_INVALID')
  const forgedRows = await h.migrator.query(
    'SELECT count(*)::integer AS count FROM bar_local.cash_movements WHERE operation_id = $1',
    [forgedPayout.operation_id]
  )
  assert.equal(forgedRows.rows[0].count, 0)
  const forgedReplay = await h.call('cmd_drawer_movement', forgedPayout)
  assert.equal(forgedReplay.replayed, true)
  assert.equal(forgedReplay.error.code, 'DRAWER_MOVEMENT_INVALID')

  const audit = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.audit_log
      WHERE operation_id = $1 AND action = 'drawer.movement'`,
    [envelope.operation_id]
  )
  assert.equal(audit.rows[0].count, 1)
})
