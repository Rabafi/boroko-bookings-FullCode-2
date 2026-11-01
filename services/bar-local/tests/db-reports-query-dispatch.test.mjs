import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

const DISPATCH_SIGNATURE = 'bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)'
const LEGACY_SIGNATURE = 'bar_local.query_dispatch_legacy(text, uuid, uuid, bigint, text, jsonb)'

function assertEnvelope(result) {
  assert.equal(typeof result, 'object')
  assert.notEqual(result, null)
  assert.equal(typeof result.snapshot_watermark, 'number')
  assert.equal(typeof result.as_of, 'string')
  assert.equal(typeof result.complete, 'boolean')
  assert.equal(Array.isArray(result.unavailable), true)
  assert.equal(typeof result.scope, 'object')
  assert.equal(typeof result.pagination, 'object')
  assert.equal(typeof result.pagination.has_more, 'boolean')
  assert.ok('next_cursor' in result.pagination)
}

test('layered report query dispatch preserves legacy routes and envelopes', async (t) => {
  const h = await createHarness(t)
  await h.openShift('100.00')

  const stock = await h.query('reports.stock', {})
  assertEnvelope(stock)
  assert.equal(stock.scope.outlet_id, h.outletId)
  assert.equal(stock.pagination.has_more, false)
  assert.equal(stock.pagination.next_cursor, null)
  assert.deepEqual(Object.keys(stock.data).sort(), [
    'balances', 'low_stock', 'low_stock_threshold', 'movements', 'period', 'valuation', 'valuation_totals'
  ])
  assert.equal(Array.isArray(stock.data.balances), true)
  assert.equal(Array.isArray(stock.data.movements), true)
  assert.equal(Array.isArray(stock.data.low_stock), true)
  assert.equal(Array.isArray(stock.data.valuation), true)
  assert.equal(typeof stock.data.period, 'object')

  const cashup = await h.query('reports.cashup', {})
  assertEnvelope(cashup)
  assert.equal(cashup.scope.outlet_id, h.outletId)
  assert.equal(cashup.pagination.has_more, false)
  assert.equal(cashup.pagination.next_cursor, null)
  assert.equal(Array.isArray(cashup.data.shifts), true)
  assert.equal(cashup.data.shifts.length, 1)
  assert.equal(typeof cashup.data.totals, 'object')
  assert.equal(cashup.data.card_settlement_status, 'unverified_external')
  assert.equal(cashup.unavailable.includes('card_provider_settlement_unverified'), true)

  const bootstrap = await h.query('bootstrap')
  assertEnvelope(bootstrap)
  assert.equal(bootstrap.scope.outlet_id, h.outletId)
  assert.equal(bootstrap.scope.actor_staff_id, h.ownerStaffId)
  assert.equal(bootstrap.data.authority.authority_id, h.authorityId)
  assert.equal(bootstrap.data.outlet.id, h.outletId)

  const menu = await h.query('menu.list')
  assertEnvelope(menu)
  assert.equal(Array.isArray(menu.data), true)

  await assert.rejects(
    () => h.query('reports.not_a_real_report'),
    (error) => error.code === 'BL001' && error.detail === 'QUERY_NOT_REGISTERED'
  )

  const grants = await h.migrator.query(
    `SELECT has_function_privilege('bar_local_runtime', $1, 'EXECUTE') AS dispatch_allowed,
            has_function_privilege('bar_local_runtime', $2, 'EXECUTE') AS legacy_allowed`,
    [DISPATCH_SIGNATURE, LEGACY_SIGNATURE]
  )
  assert.equal(grants.rows[0].dispatch_allowed, true)
  assert.equal(grants.rows[0].legacy_allowed, false)
})
