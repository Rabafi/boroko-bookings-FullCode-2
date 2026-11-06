import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposOpenChecksApi } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposOpenChecksApi.js'

test('established Open Checks reads a complete, outlet-scoped local tab projection', async () => {
  const calls = []
  const api = createLocalHposOpenChecksApi({
    async query(name, filters) {
      calls.push([name, filters])
      return {
        complete: true,
        scope: { business_id: 'business-a', outlet_id: 'outlet-a', device_id: 'device-a', actor_staff_id: 'staff-a' },
        snapshot_watermark: 9,
        pagination: { has_more: false },
        data: [{ tab_id: 'tab-a', table_label: 'Table 4', owner_staff_id: 'staff-a', owner_name: 'Alex', status: 'open', version: 3, opened_at: '2026-11-05T08:00:00Z', gross_total: '48.50', line_count: 2 }]
      }
    }
  }, { outletId: 'outlet-a' })

  assert.deepEqual(await api.listActiveTabs(), [{
    id: 'tab-a', outlet_id: 'outlet-a', table_name: 'Table 4', tab_name: 'Table 4',
    waiter_id: 'staff-a', waiter_name: 'Alex', status: 'open', tab_version: 3, version: 3,
    created_at: '2026-11-05T08:00:00Z', updated_at: '2026-11-05T08:00:00Z',
    total: '48.50', financial_complete: true, line_count: 2, items: []
  }])
  assert.deepEqual(calls, [['tabs.list', { status: 'open', limit: 200 }]])
})

test('Open Checks refuses incomplete results and does not invent split/transfer behavior', async () => {
  const incomplete = createLocalHposOpenChecksApi({
    async query() { return { complete: true, scope: { business_id: 'business-a', outlet_id: 'outlet-a' }, snapshot_watermark: 1, pagination: { has_more: true }, data: [] } }
  }, { outletId: 'outlet-a' })
  await assert.rejects(incomplete.listActiveTabs(), /could not finish loading/)
  await assert.rejects(incomplete.splitBillEvenly(), /not yet have a matching local atomic command/)
  await assert.rejects(incomplete.transferTabWaiter(), /not yet connected to the local authority/)
})
