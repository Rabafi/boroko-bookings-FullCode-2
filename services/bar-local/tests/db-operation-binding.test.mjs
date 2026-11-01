import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness, sha256Json } from './harness.mjs'

test('an operation identifier cannot replay a different command', async (t) => {
  const h = await createHarness(t)
  await h.seedShiftCatalogue()
  const operationId = randomUUID()
  const shiftEnvelope = h.envelope('shift.open', { opening_float: '0' }, operationId)
  const opened = await h.call('cmd_shift_open', shiftEnvelope)
  assert.equal(opened.ok, true, JSON.stringify(opened.error))

  const tabEnvelope = h.envelope('tab.open', { table_label: 'Binding check' }, operationId)
  await assert.rejects(
    () => h.callWith(h.runtime, 'cmd_tab_open', tabEnvelope, { hash: sha256Json(shiftEnvelope.payload) }),
    (error) => error.code === 'BL001' && error.detail === 'IDEMPOTENCY_PAYLOAD_CONFLICT'
  )

  const replay = await h.call('cmd_shift_open', shiftEnvelope)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)

  const tabs = await h.migrator.query('SELECT count(*)::int AS count FROM bar_local.tabs')
  assert.equal(tabs.rows[0].count, 0)
  const operations = await h.migrator.query('SELECT command FROM bar_local.operations WHERE operation_id = $1', [operationId])
  assert.equal(operations.rows.length, 1)
  assert.equal(operations.rows[0].command, 'shift.open')
})
