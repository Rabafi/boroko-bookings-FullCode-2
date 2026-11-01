import test from 'node:test'
import assert from 'node:assert/strict'
import { barLocalOperatorError, barLocalReadinessMessage, canVoidRemainingBarSale, canReturnBarSaleLines, barReturnQuantityWithinRemaining, barSaleShiftIsClosed, canPostCloseCorrectBarSale, canPostCloseReturnBarSaleLines, barPostCloseCorrectionBlockedMessage } from '../../src/shared/barLocalOperatorMessages.js'

test('connection errors give local recovery guidance without leaking the endpoint or IPC wrapper', () => {
  const message = barLocalOperatorError(new Error("Error invoking remote method 'barLocal:query': Error: connect ECONNREFUSED 192.168.1.12:8787"))
  assert.match(message, /Bar server/)
  assert.match(message, /saved operation/)
  assert.doesNotMatch(message, /192\.168|ECONNREFUSED|remote method/)
  assert.doesNotMatch(message, /internet/i)
})
test('uncertain outcomes preserve the same-operation recovery instruction', () => {
  const message = barLocalOperatorError({ outcomeUnknown: true, message: 'fetch failed' })
  assert.match(message, /may already be saved/)
  assert.match(message, /same operation/)
  assert.match(message, /do not enter it again/)
})
test('business refusal guidance remains visible while internal SQL diagnostics go to manager recovery', () => {
  assert.equal(barLocalOperatorError(new Error("Error invoking remote method 'barLocal:command': Error: Not enough stock for Water.")), 'Not enough stock for Water.')
  assert.equal(barLocalOperatorError({ message: 'A different manager must approve this sale.' }), 'A different manager must approve this sale.')
  assert.match(barLocalOperatorError({ message: 'permission denied for table financial_ledger' }), /ask a manager/)
  assert.doesNotMatch(barLocalOperatorError({ message: 'permission denied for table financial_ledger' }), /financial_ledger/)
})
test('readiness wording never promises selling while the state is not ready', () => {
  assert.match(barLocalReadinessMessage('ready'), /Ready to sell/)
  for (const state of ['blocked', 'unavailable', 'stale', 'unknown', 'unexpected']) {
    assert.doesNotMatch(barLocalReadinessMessage(state), /Ready to sell/)
    assert.doesNotMatch(barLocalReadinessMessage(state), /Supabase|PostgreSQL|authenticated|authority_epoch/)
  }
})

test('remaining correction control handles partial returns and tips but excludes compensation receipts', () => {
  assert.equal(canVoidRemainingBarSale({ status: 'completed' }), true)
  assert.equal(canVoidRemainingBarSale({ status: 'returned', tip: '0.37', lines: [] }), true)
  assert.equal(canVoidRemainingBarSale({ status: 'returned', tip: '0', lines: [{ remaining_quantity: '1' }] }), true)
  assert.equal(canVoidRemainingBarSale({ status: 'returned', tip: '0', lines: [{ remaining_quantity: '0' }] }), false)
  assert.equal(canVoidRemainingBarSale({ status: 'returned', tip: '1', original_sale_id: 'original' }), false)
  assert.equal(canVoidRemainingBarSale({ status: 'voided', tip: '1' }), false)
  assert.equal(canVoidRemainingBarSale(null), false)
})

test('line returns require verified remaining quantities and compare all six decimals exactly', () => {
  assert.equal(canReturnBarSaleLines({ status: 'returned', lines: [{ remaining_quantity: '0.000001' }] }), true)
  assert.equal(canReturnBarSaleLines({ status: 'returned', lines: [{ quantity: '1' }] }), false)
  assert.equal(canReturnBarSaleLines({ status: 'returned', lines: [{ remaining_quantity: '0' }] }), false)
  assert.equal(canReturnBarSaleLines({ status: 'returned', original_sale_id: 'original', lines: [{ remaining_quantity: '1' }] }), false)
  assert.equal(barReturnQuantityWithinRemaining('999999999999.000002','999999999999.000001'), false)
  assert.equal(barReturnQuantityWithinRemaining('999999999999.000001','999999999999.000001'), true)
  assert.equal(barReturnQuantityWithinRemaining('0.000001','0.000001'), true)
  for (const value of ['0', '-1', '1.0000001', '1e3', 'NaN']) assert.equal(barReturnQuantityWithinRemaining(value,'10'), false)
})

test('post-close correction controls require a service-eligible closed original sale', () => {
  const closedOriginal = {
    status: 'completed', shift_status: 'closed', post_close_eligible: true,
    post_close_tip_remaining: '0', lines: [{ remaining_quantity: '1' }]
  }
  assert.equal(barSaleShiftIsClosed(closedOriginal), true)
  assert.equal(barSaleShiftIsClosed({ shift_status: 'open' }), false)
  assert.equal(canPostCloseCorrectBarSale(closedOriginal), true)
  assert.equal(canPostCloseReturnBarSaleLines(closedOriginal), true)
  assert.equal(canPostCloseCorrectBarSale({ ...closedOriginal, post_close_tip_remaining: '0.37', lines: [] }), true)
  assert.equal(canPostCloseReturnBarSaleLines({ ...closedOriginal, lines: [] }), false)
  assert.equal(canPostCloseCorrectBarSale({ ...closedOriginal, shift_status: 'open' }), false)
  assert.equal(canPostCloseCorrectBarSale({ ...closedOriginal, original_sale_id: 'original' }), false)
  assert.equal(canPostCloseCorrectBarSale({ ...closedOriginal, post_close_eligible: false }), false)
  assert.equal(canPostCloseCorrectBarSale({ ...closedOriginal, status: 'voided' }), false)
  assert.equal(canPostCloseCorrectBarSale({ ...closedOriginal, lines: [{ remaining_quantity: '0' }] }), false)
  assert.equal(canPostCloseCorrectBarSale(null), false)
  assert.match(barPostCloseCorrectionBlockedMessage({ ...closedOriginal, original_sale_id: 'original' }), /cannot be corrected again/)
  assert.match(barPostCloseCorrectionBlockedMessage({ ...closedOriginal, shift_status: 'open' }), /open drawer/)
  assert.match(barPostCloseCorrectionBlockedMessage({ ...closedOriginal, post_close_eligible: false, lines: [] }), /no remaining items/)
  assert.equal(barPostCloseCorrectionBlockedMessage(closedOriginal), '')
})
