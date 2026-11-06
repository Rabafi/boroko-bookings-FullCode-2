import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CAPABILITIES, QUERIES } from '@tsa-bonno/bar-contracts'

test('sales.mine is a POS-view scoped query with validated business dates and cursor', () => {
  const query = QUERIES['sales.mine']
  assert.ok(query)
  assert.equal(query.capability, CAPABILITIES.POS_VIEW)
  assert.deepEqual(query.validate({ from: '2026-11-01', to: '2026-11-05', limit: 50, cursor: '2026-11-04|123' }),
    { from: '2026-11-01', to: '2026-11-05', limit: 50, cursor: '2026-11-04|123' })
  assert.throws(() => query.validate({ outlet_id: 'external-outlet' }), /allowed field|unknown|unexpected/i)
  assert.throws(() => query.validate({ from: '2026-11-06', to: '2026-11-05' }), /on or after/)
  assert.throws(() => query.validate({ cursor: '2026-11-04|1|other' }), /cursor/)
  assert.throws(() => query.validate({ limit: 201 }), /limit/)
})

test('sales.mine SQL enforces actor/outlet scope before returning receipts and paginates stably', () => {
  const migration = readFileSync(fileURLToPath(new URL('../db/migrations/0088_scoped_my_sales_query.sql', import.meta.url)), 'utf8')
  assert.match(migration, /assert_capability\(v_ctx\.capabilities,'pos\.view'\)/)
  assert.match(migration, /s\.business_id=v_ctx\.business_id AND s\.outlet_id=v_ctx\.outlet_id AND s\.actor_staff_id=v_ctx\.staff_id/)
  assert.match(migration, /ORDER BY s\.business_date DESC,s\.receipt_number DESC LIMIT v_limit\+1/)
  assert.match(migration, /\(s\.business_date,s\.receipt_number\)<\(v_cursor_date,v_cursor_receipt\)/)
  assert.match(migration, /'payment_breakdown'/)
  assert.match(migration, /'pos_order_items'/)
})
