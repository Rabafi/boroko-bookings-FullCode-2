import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposControlApi } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposControlApi.js'

function fixture() {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  const seen = { queries: [], commands: [], retries: [] }
  const bridge = {
    query: async (name, filters) => { seen.queries.push([name, filters]); return { data: [{ id: 'row-1' }], complete: true, scope: { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'staff-1', device_id: 'device-1' }, snapshot_watermark: 8, pagination: { has_more: false, next_cursor: null } } },
    command: async (request) => { seen.commands.push(request); return { ok: false, outcome: 'unknown', operation_id: request.operation_id } },
    retryOperation: async (id) => { seen.retries.push(id); return { ok: true, outcome: 'committed_local', result: { checklist_id: 'check-1' } } }
  }
  return { values, storage, seen, bridge, api: createLocalHposControlApi({ bridge, storage, businessId: 'business-1', outletId: 'outlet-1', randomUUID: () => 'operation-1' }) }
}

test('original Bar Control local lists require a complete scoped service snapshot', async () => {
  const f = fixture()
  assert.deepEqual(await f.api.listChecklists({ status: 'open' }), [{ id: 'row-1' }])
  assert.equal(f.seen.queries[0][0], 'control.checklists.list')
  assert.equal(f.seen.queries[0][1].status, 'open')
  f.bridge.query = async () => ({ data: [], complete: false })
  await assert.rejects(f.api.listIncidents(), /incomplete or cannot be verified/)
})

test('ambiguous Bar Control command retries its original journal ID and payload', async () => {
  const f = fixture()
  await assert.rejects(f.api.startChecklist('bar.opening'), /Retry the saved Control operation/)
  assert.equal(f.api.hasPending('checklist:start:bar.opening'), true)
  assert.deepEqual(f.seen.commands, [{ command: 'control.checklist.start', operation_id: 'operation-1', payload: { template_key: 'bar.opening' } }])
  const result = await f.api.startChecklist('bar.opening')
  assert.deepEqual(result, { checklist_id: 'check-1' })
  assert.deepEqual(f.seen.retries, ['operation-1'])
  assert.equal(f.seen.commands.length, 1)
  assert.equal(f.api.hasPending('checklist:start:bar.opening'), false)
})

test('Control mutations send versioned local contracts and clear confirmed operation IDs', async () => {
  const f = fixture()
  f.bridge.command = async (request) => { f.seen.commands.push(request); return { ok: true, outcome: 'committed_local', result: { id: 'saved-1' } } }
  await f.api.setChecklistItem({ checklist_id: 'check-1', item_id: 'item-1', expected_version: 4 })
  await f.api.logIncident({ category: 'safety', severity: 'high', description: 'Glass broken', immediate_action: '' })
  await f.api.resolveIncident({ incident_id: 'incident-1', expected_version: 2, resolution: 'Area cleared' })
  assert.deepEqual(f.seen.commands.map(({ command, payload }) => [command, payload]), [
    ['control.checklist.item.set', { checklist_id: 'check-1', item_id: 'item-1', completed: true, expected_version: 4, note: null }],
    ['control.incident.log', { category: 'safety', severity: 'high', description: 'Glass broken', immediate_action: '' }],
    ['control.incident.resolve', { incident_id: 'incident-1', expected_version: 2, resolution: 'Area cleared' }]
  ])
  assert.equal(f.values.size, 0)
})
