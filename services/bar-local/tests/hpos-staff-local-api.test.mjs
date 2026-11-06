import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalStaffApi } from '../../../src/renderer/src/components/hospitality-pos/bar-local/hposStaffLocalApi.js'

const scope = { businessId: '11111111-1111-4111-8111-111111111111', outletId: '22222222-2222-4222-8222-222222222222', staffId: '33333333-3333-4333-8333-333333333333' }
const scopedList = { data: [{ staff_id: '44444444-4444-4444-8444-444444444444', display_name: 'Sam', role: 'cashier', status: 'active', version: 1, capabilities: ['pos.view'] }],
  complete: true, pagination: { has_more: false, next_cursor: null }, scope: { business_id: '11111111-1111-4111-8111-111111111111', outlet_id: '22222222-2222-4222-8222-222222222222', actor_staff_id: '33333333-3333-4333-8333-333333333333' }, snapshot_watermark: 4 }
const memoryStorage = () => {
  const values = new Map()
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('local Staff adapter reads a complete list scoped to the current Bar', async () => {
  let called
  const api = createLocalStaffApi({ query: async (...args) => { called = args; return scopedList } }, scope)
  const rows = await api.list()
  assert.deepEqual(called, ['staff.list', { include_suspended: true }])
  assert.deepEqual(rows[0], { id: '44444444-4444-4444-8444-444444444444', name: 'Sam', email: '', role: 'cashier', status: 'active', created_at: undefined,
    capability_overrides: {}, allowed_outlet_ids: ['22222222-2222-4222-8222-222222222222'], version: 1, local_capabilities: ['pos.view'] })
})

test('local Staff adapter rejects incomplete and cross-Bar snapshots', async (t) => {
  for (const [name, mutate] of [['incomplete', (value) => { value.complete = false }], ['wrong outlet', (value) => { value.scope.outlet_id = 'outlet-2' }]]) {
    await t.test(name, async () => {
      const value = structuredClone(scopedList); mutate(value)
      const api = createLocalStaffApi({ query: async () => value }, scope)
      await assert.rejects(api.list(), /incomplete or belongs to another Bar session/)
    })
  }
})

test('local staff PIN stays out of browser storage and unresolved create retries the original operation ID', async () => {
  const storage = memoryStorage()
  const intents = []
  const api = createLocalStaffApi({
    async command(intent) { intents.push(intent); throw new Error('connection lost after submission') },
    async retryOperation(operationId) { assert.equal(operationId, intents[0].operation_id); return { outcome: 'committed_local' } }
  }, scope)
  await assert.rejects(api.create(storage, { display_name: 'Sam', role: 'cashier', pin: '1234' }), /connection lost/)
  const pending = api.pending(storage)
  assert.ok(pending?.operation_id)
  assert.deepEqual([...storage.values.values()].map(JSON.parse), [{ business_id: '11111111-1111-4111-8111-111111111111', staff_id: '33333333-3333-4333-8333-333333333333', operation_id: pending.operation_id }])
  assert.equal(JSON.stringify([...storage.values.values()]).includes('1234'), false)
  assert.deepEqual(intents[0], { command: 'staff.create', operation_id: pending.operation_id, payload: { display_name: 'Sam', role: 'cashier', pin: '1234' } })
  assert.deepEqual(await api.retry(storage), { outcome: 'committed_local' })
  assert.equal(api.pending(storage), null)
})

test('local staff creation validates role and PIN before submission', async (t) => {
  const api = createLocalStaffApi({ async command() { assert.fail('invalid staff data must not submit') } }, scope)
  for (const input of [
    { display_name: 'Sam', role: 'owner', pin: '1234' },
    { display_name: 'Sam', role: 'cashier', pin: '12' },
    { display_name: ' '.repeat(1), role: 'cashier', pin: '1234' }
  ]) await t.test(JSON.stringify(input), () => assert.rejects(api.create(memoryStorage(), input)))
})


