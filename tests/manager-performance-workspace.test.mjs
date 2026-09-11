import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildPerformanceMetrics, formatPerformanceValue, mergePerformanceActivity } from '../manager-pwa/src/lib/performance.js'

test('performance activity is chronological and keeps non-ledger values out of cash display', () => {
  const rows = mergePerformanceActivity({
    activity: [{ id: 'audit-1', title: 'Payment recorded', amount: 45, created_at: '2026-09-09T12:00:00Z' }],
    quotations: [{ id: 'quote-1', total_amount: 999, created_at: '2026-09-09T11:00:00Z', status: 'draft' }],
    conference: [{ id: 'event-1', total_amount: 888, created_at: '2026-09-09T10:00:00Z', status: 'confirmed' }],
    dayUse: [{ id: 'day-1', total: 777, created_at: '2026-09-09T09:00:00Z', status: 'open' }]
  }, 10)
  assert.deepEqual(rows.map((row) => row.id), ['activity:audit-1', 'quotation:quote-1', 'conference:event-1', 'day_use:day-1'])
  assert.equal(rows[0].amount, 45)
  assert.equal(rows[1].amount, null)
  assert.equal(rows[2].amount, null)
  assert.equal(rows[3].amount, null)
})

test('Restaurant-Bar monetary metrics fail closed when the POS period is not certified', () => {
  const metrics = buildPerformanceMetrics({ restaurantMode: true, pos: { complete: false, net_sales: 300, sale_count: 4, returns_total: 10 }, inventory: [], staff: [] })
  assert.equal(metrics.find((metric) => metric.key === 'sales').value, null)
  assert.equal(metrics.find((metric) => metric.key === 'returns').value, null)
  assert.equal(formatPerformanceValue(null, 'money'), 'Unavailable')
})

test('the protected performance workspace is reachable for every product family', () => {
  const app = readFileSync(new URL('../manager-pwa/src/App.jsx', import.meta.url), 'utf8')
  const more = readFileSync(new URL('../manager-pwa/src/pages/More.jsx', import.meta.url), 'utf8')
  const shell = readFileSync(new URL('../manager-pwa/src/lib/productShell.js', import.meta.url), 'utf8')
  assert.match(app, /path="\/performance"[\s\S]*Guard capability="dashboard\.view"/)
  assert.match(more, /to="\/performance"/)
  assert.doesNotMatch(shell, /ACCOMMODATION_ONLY_ROUTES\.add\('\/performance'\)/)
})
