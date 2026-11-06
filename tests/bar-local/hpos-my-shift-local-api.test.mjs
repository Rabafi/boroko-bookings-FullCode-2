import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposMyShiftApi } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposMyShiftApi.js'

const scope = { outletId: 'outlet-1', staffId: 'staff-1' }
const mine = (shift = null, submission = null) => ({
  data: { shift, submission }, complete: true,
  pagination: { has_more: false, next_cursor: null },
  scope: { outlet_id: 'outlet-1', actor_staff_id: 'staff-1' }
})
const openShift = { id: 'shift-1', staff_id: 'staff-1', status: 'open', version: 2,
  opening_float: '50.00', opened_at: '2026-11-05T10:00:00Z', business_date: '2026-11-05' }

test('My Shift reads only the own local shift and submitted cash-up from the local query', async () => {
  const queries = []
  const api = createLocalHposMyShiftApi({
    query: async (name, filters) => { queries.push([name, filters]); return mine(openShift, { status: 'submitted' }) },
    command: async () => assert.fail('refresh must not write'),
    getOpenIntents: async () => [], retryOperation: async () => assert.fail('refresh must not retry')
  }, scope)
  assert.deepEqual(await api.readMine(), {
    shift: { id: 'shift-1', outlet_id: 'outlet-1', cashier_id: 'staff-1', status: 'open',
      opening_float: '50.00', opened_at: '2026-11-05T10:00:00Z', business_date: '2026-11-05', version: 2 },
    submission: { status: 'submitted' }
  })
  assert.deepEqual(queries, [['cashup.mine', { outlet_id: 'outlet-1' }]])
})

test('My Shift refuses incomplete or foreign local scope instead of reading cloud shifts', async () => {
  const api = createLocalHposMyShiftApi({
    query: async () => ({ ...mine(openShift), scope: { outlet_id: 'outlet-2', actor_staff_id: 'staff-2' } }),
    command: async () => assert.fail('foreign scope must not open a shift'),
    getOpenIntents: async () => [], retryOperation: async () => assert.fail('must not retry')
  }, scope)
  await assert.rejects(api.readMine(), /complete shift for your staff and outlet/)
})

test('shift opening preserves a saved operation ID and blocks other unresolved local work', async () => {
  const calls = []
  const api = createLocalHposMyShiftApi({
    query: async () => mine(openShift),
    getOpenIntents: async () => [{ command: 'shift.open', operation_id: 'op-1' }],
    retryOperation: async (id) => { calls.push(['retry', id]); return { outcome: 'committed_local' } },
    command: async () => assert.fail('uncertain shift must reuse its original intent')
  }, scope)
  assert.equal((await api.openShift({ openingFloat: '0.00', operationId: 'op-1' })).id, 'shift-1')
  assert.deepEqual(calls, [['retry', 'op-1']])

  const blocked = createLocalHposMyShiftApi({
    query: async () => mine(), getOpenIntents: async () => [{ command: 'sale.commit', operation_id: 'sale-1' }],
    retryOperation: async () => assert.fail('do not retry a different operation'), command: async () => assert.fail('do not open')
  }, scope)
  await assert.rejects(blocked.openShift({ openingFloat: '12', operationId: 'op-2' }), /Resolve the saved shift-start operation/)
})

test('shift opening uses one local atomic command and refuses invalid amounts and unknown outcomes', async () => {
  const calls = []
  const api = createLocalHposMyShiftApi({
    query: async () => mine(openShift), getOpenIntents: async () => [], retryOperation: async () => assert.fail('no pending operation'),
    command: async (request) => { calls.push(request); return { outcome: 'committed_local' } }
  }, scope)
  await api.openShift({ openingFloat: '12.30', operationId: 'op-3' })
  assert.deepEqual(calls, [{ command: 'shift.open', operation_id: 'op-3', payload: { opening_float: '12.30' } }])

  await assert.rejects(api.openShift({ openingFloat: '-1', operationId: 'op-4' }), /valid non-negative opening float/)
  const unknown = createLocalHposMyShiftApi({
    query: async () => mine(), getOpenIntents: async () => [], retryOperation: async () => assert.fail('no intent'),
    command: async () => ({ outcome: 'outcome_unknown' })
  }, scope)
  await assert.rejects(unknown.openShift({ openingFloat: '1', operationId: 'op-5' }), (error) => error.outcome === 'outcome_unknown')
})
