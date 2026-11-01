import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES, COMMANDS } from '@tsa-bonno/bar-contracts'

test('cash-up reopen requires cash-up approval and a reviewed state', () => {
  assert.equal(COMMANDS['cashup.reopen'].version, 1)
  assert.equal(COMMANDS['cashup.reopen'].capability, CAPABILITIES.POS_CASHUP)
  assert.equal(COMMANDS['cashup.reopen'].approval, CAPABILITIES.POS_CASHUP)

  const payload = {
    cashup_id: randomUUID(),
    expected_status: 'approved',
    counted_cash: '108.00',
    counted_card: '0',
    notes: ' recount ',
    proof_refs: [' sheet-1 '],
    reason: ' recount variance '
  }
  const valid = COMMANDS['cashup.reopen'].validate(payload)
  assert.equal(valid.expected_status, 'approved')
  assert.equal(valid.counted_cash, '108.00')
  assert.equal(valid.counted_card, '0')
  assert.equal(valid.notes, 'recount')
  assert.deepEqual(valid.proof_refs, ['sheet-1'])
  assert.equal(valid.reason, 'recount variance')
  assert.equal(valid.approval_id, null)

  assert.throws(() => COMMANDS['cashup.reopen'].validate({ ...payload, reason: undefined }), /reason/)
  assert.throws(() => COMMANDS['cashup.reopen'].validate({ ...payload, expected_status: 'submitted' }), /expected_status/)
  assert.throws(() => COMMANDS['cashup.reopen'].validate({ ...payload, counted_cash: '-1.00' }), /counted_cash/)
  assert.throws(() => COMMANDS['cashup.reopen'].validate({ ...payload, proof_refs: [''] }), /proof_refs/)
})
