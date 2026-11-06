import test from 'node:test'
import assert from 'node:assert/strict'
import { readPendingExpenseIntent, readPendingExpenseVoidIntent, submitLocalExpense, submitLocalExpenseVoid } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposExpenseApi.js'

function storageFixture() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

test('local expense submission persists the exact operation before dispatch and clears only an authoritative result', async () => {
  const storage = storageFixture()
  const payload = { expense_date: '2026-11-05', amount: '25.00', description: 'Ice', expense_account_code: '5000', payment_account_code: '1000' }
  let dispatched
  const result = await submitLocalExpense({ storage, payload, operationId: '11111111-1111-4111-8111-111111111111', command: async (intent) => {
    dispatched = intent
    assert.deepEqual(readPendingExpenseIntent(storage), intent)
    return { outcome: 'committed_local', receipt: { expense_id: 'expense-1' } }
  } })
  assert.equal(result.outcome, 'committed_local')
  assert.equal(dispatched.operation_id, '11111111-1111-4111-8111-111111111111')
  assert.deepEqual(dispatched.payload, payload)
  assert.equal(readPendingExpenseIntent(storage), null)
})

test('an uncertain local expense retries the saved payload and operation ID, ignoring edited values', async () => {
  const storage = storageFixture()
  const original = { amount: '25.00', description: 'Ice' }
  await assert.rejects(submitLocalExpense({ storage, payload: original, operationId: '22222222-2222-4222-8222-222222222222', command: async () => { throw new Error('pipe lost') } }), /pipe lost/)
  const saved = readPendingExpenseIntent(storage)
  assert.deepEqual(saved.payload, original)
  let retried
  await submitLocalExpense({ storage, payload: { amount: '99.00', description: 'changed' }, command: async (intent) => {
    retried = intent
    return { outcome: 'committed_local' }
  } })
  assert.equal(retried.operation_id, saved.operation_id)
  assert.deepEqual(retried.payload, original)
  assert.equal(readPendingExpenseIntent(storage), null)
})

test('authoritative expense refusal clears the saved intent and reports no posting', async () => {
  const storage = storageFixture()
  await assert.rejects(submitLocalExpense({ storage, payload: { amount: '25.00' }, operationId: '33333333-3333-4333-8333-333333333333', command: async () => ({ outcome: 'refused', error: { message: 'Period locked' } }) }), /Period locked/)
  assert.equal(readPendingExpenseIntent(storage), null)
})

test('expense reversal binds a different manager approval to the saved operation and persists its approval before command', async () => {
  const storage = storageFixture()
  const payload = { expense_id: '44444444-4444-4444-8444-444444444444', expected_version: 1, reason: 'Duplicate receipt' }
  let approvalRequest
  let commandRequest
  await submitLocalExpenseVoid({ storage, payload, pin: '1234',
    requestApproval: async (request) => { approvalRequest = request; return { approval_id: '55555555-5555-4555-8555-555555555555' } },
    command: async (intent) => { commandRequest = intent; assert.deepEqual(readPendingExpenseVoidIntent(storage), intent); return { outcome: 'committed_local' } } })
  assert.equal(approvalRequest.command, 'expense.void')
  assert.deepEqual(approvalRequest.payload, payload)
  assert.equal(approvalRequest.operation_id, commandRequest.operation_id)
  assert.equal(commandRequest.payload.approval_id, '55555555-5555-4555-8555-555555555555')
  assert.equal(readPendingExpenseVoidIntent(storage), null)
})

test('uncertain expense reversal retries its saved approval and command without another PIN request', async () => {
  const storage = storageFixture()
  const payload = { expense_id: '66666666-6666-4666-8666-666666666666', expected_version: 2, reason: 'Duplicate entry' }
  await assert.rejects(submitLocalExpenseVoid({ storage, payload, pin: '1234', requestApproval: async () => ({ approval_id: '77777777-7777-4777-8777-777777777777' }), command: async () => { throw new Error('pipe lost') } }), /pipe lost/)
  const saved = readPendingExpenseVoidIntent(storage)
  let approvalCalls = 0
  let retried
  await submitLocalExpenseVoid({ storage, requestApproval: async () => { approvalCalls++; throw new Error('must reuse existing approval') }, command: async (intent) => { retried = intent; return { outcome: 'committed_local' } } })
  assert.equal(approvalCalls, 0)
  assert.equal(retried.operation_id, saved.operation_id)
  assert.deepEqual(retried.payload, saved.payload)
  assert.equal(readPendingExpenseVoidIntent(storage), null)
})
