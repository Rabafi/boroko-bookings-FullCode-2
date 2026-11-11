import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposVoucherApi } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposVoucherApi.js'

const scope = { businessId: 'biz-1', outletId: 'out-1', staffId: 'staff-1' }
const storage = () => {
  const values = new Map()
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values }
}
const listResult = (overrides = {}) => ({ complete: true, data: [], pagination: { has_more: false, next_cursor: null }, snapshot_watermark: 7,
  scope: { business_id: scope.businessId, outlet_id: scope.outletId, actor_staff_id: scope.staffId }, ...overrides })

test('voucher list requires complete exact business, outlet and actor scope', async () => {
  const bridge = { query: async () => listResult({ data: [{ voucher_id: '123e4567-e89b-42d3-a456-426614174000', code: 'A1', initial_amount: '25.00', balance: '20.00', status: 'active', version: 1 }] }) }
  assert.equal((await createLocalHposVoucherApi(bridge, scope).list()).length, 1)
  const wrongScope = createLocalHposVoucherApi({ query: async () => listResult({ scope: { ...listResult().scope, outlet_id: 'other-outlet' } }) }, scope)
  await assert.rejects(wrongScope.list(), /another Bar session/)
  const incomplete = createLocalHposVoucherApi({ query: async () => listResult({ complete: false }) }, scope)
  await assert.rejects(incomplete.list(), /incomplete/)
})

test('voucher issue uses manager approval, saves the stable intent and retries the same unknown operation', async () => {
  const local = storage()
  let savedOperation
  let committed = false
  let approvalCount = 0
  let commandCount = 0
  const bridge = {
    query: async () => listResult(),
    getOpenIntents: async () => savedOperation && !committed ? [{ operation_id: savedOperation.operation_id, command: 'voucher.issue' }] : [],
    requestApprovalForCommand: async (request) => { approvalCount += 1; assert.equal(request.pin, '123456'); savedOperation = { operation_id: request.operation_id }; return { approval_id: '123e4567-e89b-42d3-a456-426614174001' } },
    command: async (request) => { commandCount += 1; savedOperation = { operation_id: request.operation_id, payload: request.payload }; return { outcome: 'unknown', operation_id: request.operation_id } },
    retryOperation: async (operationId) => { assert.equal(operationId, savedOperation.operation_id); committed = true; return { outcome: 'committed_local', result: { voucher_id: '123e4567-e89b-42d3-a456-426614174000' } } }
  }
  const api = createLocalHposVoucherApi(bridge, scope)
  const input = { code: 'A1-TEST', amount: '25.00', expires_on: '2027-01-31', pin: '123456' }
  await assert.rejects(api.issue(local, input), /result is unresolved/)
  const pending = api.pending(local)
  assert.equal(pending.command, 'voucher.issue')
  assert.equal(pending.payload.approval_id, '123e4567-e89b-42d3-a456-426614174001')
  assert.equal(approvalCount, 1)
  assert.equal(commandCount, 1)
  await assert.rejects(api.issue(local, { ...input, amount: '26.00' }), /different voucher operation is unresolved/)
  assert.equal((await api.issue(local, input)).outcome, 'committed_local')
  assert.equal(api.pending(local), null)
  assert.equal(approvalCount, 1)
  assert.equal(commandCount, 1)
})

test('voucher issue refuses an existing unrelated local intent and invalid input before approval', async () => {
  const bridge = { getOpenIntents: async () => [{ operation_id: 'existing' }], requestApprovalForCommand: async () => { throw new Error('must not approve') } }
  const api = createLocalHposVoucherApi(bridge, scope)
  await assert.rejects(api.issue(storage(), { code: 'A1', amount: '1.00', pin: '1234' }), /Resolve the existing local operation/)
  const clean = createLocalHposVoucherApi({ getOpenIntents: async () => [], requestApprovalForCommand: async () => { throw new Error('must not approve') } }, scope)
  await assert.rejects(clean.issue(storage(), { code: 'A1', amount: '-1', pin: '1234' }), /greater than zero/)
})
