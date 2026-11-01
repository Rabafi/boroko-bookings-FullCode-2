import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('shift opening requires an active catalogue without changing recorded operation outcomes', async (t) => {
  const h = await createHarness(t)
  const blocked = h.envelope('shift.open', { opening_float: '0.00' })
  const first = await h.call('cmd_shift_open', blocked)
  assert.equal(first.ok, false)
  assert.equal(first.error.code, 'CATALOGUE_REQUIRED')
  assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.shifts')).rows[0].n, 0)

  await h.migrator.query(
    `INSERT INTO bar_local.products (business_id, sku, name, price, tax_rate, active)
     VALUES ($1, 'OPEN-1', 'Opening product', 10, 0, true)`, [h.businessId]
  )
  const refusedReplay = await h.call('cmd_shift_open', blocked)
  assert.equal(refusedReplay.ok, false)
  assert.equal(refusedReplay.replayed, true)
  assert.equal(refusedReplay.error.code, 'CATALOGUE_REQUIRED')

  const fresh = h.envelope('shift.open', { opening_float: '0.00' })
  const opened = await h.call('cmd_shift_open', fresh)
  assert.equal(opened.ok, true, JSON.stringify(opened.error))
  await h.migrator.query('UPDATE bar_local.products SET active = false WHERE business_id = $1', [h.businessId])
  const committedReplay = await h.call('cmd_shift_open', fresh)
  assert.equal(committedReplay.ok, true)
  assert.equal(committedReplay.replayed, true)
  assert.deepEqual(committedReplay.receipt, opened.receipt)
  const shifts = await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.shifts')
  assert.equal(shifts.rows[0].n, 1)
})
