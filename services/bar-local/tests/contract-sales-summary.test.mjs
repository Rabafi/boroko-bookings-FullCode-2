import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITIES, QUERIES } from '@tsa-bonno/bar-contracts'

test('sales summary is a report query with bounded filters', () => {
  const query = QUERIES['reports.sales_summary']
  assert.equal(query.version, 1)
  assert.equal(query.capability, CAPABILITIES.POS_REPORTS)
  const filters = query.validate({ from: '2026-10-01', to: '2026-10-20', shift_id: '00000000-0000-4000-8000-000000000001' })
  assert.equal(filters.from, '2026-10-01')
  assert.equal(filters.to, '2026-10-20')
  assert.equal(filters.shift_id, '00000000-0000-4000-8000-000000000001')
  assert.throws(() => query.validate({ unknown_filter: true }), /unknown_filter/)
})
