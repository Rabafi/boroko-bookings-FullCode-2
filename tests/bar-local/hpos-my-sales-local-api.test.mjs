import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposMySalesApi } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposMySalesApi.js'

const scope = { business_id: 'business-1', outlet_id: 'outlet-1', actor_staff_id: 'cashier-1', role: 'cashier', device_id: 'device-1' }
const sale = (id, receipt) => ({ id, actor_staff_id: 'cashier-1', receipt_number: String(receipt), business_date: '2026-11-05',
  status: 'completed', transaction_type: null, total: 10, tip_total: 0, payment_breakdown: [{ method: 'cash', amount: 10 }],
  pos_order_items: [{ id: `line-${id}`, item_name: 'Water', quantity: 1, net_subtotal: 10 }] })
const envelope = (data, pagination = { has_more: false, next_cursor: null }, actor = scope.actor_staff_id) => ({ data, pagination,
  complete: true, snapshot_watermark: 7, scope: { ...scope, actor_staff_id: actor }, as_of: '2026-11-05T10:00:00.000Z', unavailable: [] })

test('My Sales loads every local page using the authenticated staff query', async () => {
  const calls = []
  const api = createLocalHposMySalesApi({ async query(name, filters) {
    calls.push([name, filters])
    return filters.cursor ? envelope([sale('sale-1', 1)]) : envelope([sale('sale-2', 2)], { has_more: true, next_cursor: '2026-11-05|2' })
  } }, { outletId: 'outlet-1', staffId: 'cashier-1' })
  const rows = await api.list({ from: '2026-11-05', to: '2026-11-05' })
  assert.deepEqual(calls, [
    ['sales.mine', { from: '2026-11-05', to: '2026-11-05', limit: 200 }],
    ['sales.mine', { from: '2026-11-05', to: '2026-11-05', limit: 200, cursor: '2026-11-05|2' }]
  ])
  assert.deepEqual(rows.map((row) => row.id), ['sale-2', 'sale-1'])
  assert.ok(rows.every((row) => row.outlet_id === 'outlet-1' && row.actor_staff_id === 'cashier-1'))
})

test('My Sales refuses foreign, incomplete or malformed local receipt history', async () => {
  const foreign = createLocalHposMySalesApi({ query: async () => envelope([sale('foreign', 10)], undefined, 'cashier-2') },
    { outletId: 'outlet-1', staffId: 'cashier-1' })
  await assert.rejects(foreign.list({ from: '2026-11-05', to: '2026-11-05' }), /business outlet or operator|foreign receipt/)
  const incomplete = createLocalHposMySalesApi({ query: async () => ({ ...envelope([]), complete: false }) },
    { outletId: 'outlet-1', staffId: 'cashier-1' })
  await assert.rejects(incomplete.list({ from: '2026-11-05', to: '2026-11-05' }), /incomplete|finish loading/)
  const malformed = createLocalHposMySalesApi({ query: async () => envelope([{ ...sale('bad', 1), status: 'unknown' }]) },
    { outletId: 'outlet-1', staffId: 'cashier-1' })
  await assert.rejects(malformed.list({ from: '2026-11-05', to: '2026-11-05' }), /invalid or foreign receipt/)
})
