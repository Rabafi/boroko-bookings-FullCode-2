import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('authenticated local query envelopes preserve nullable shifts and server-derived role scope', async (t) => {
  const h = await createHarness(t)
  const current = await h.query('shift.current')
  assert.equal(current.data, null, 'an absent shift is a valid singular-read result')
  assert.equal(current.scope.role, 'owner')

  const openDrawers = await h.query('drawer.open_shifts')
  assert.deepEqual(openDrawers.data, [])
  assert.equal(openDrawers.scope.role, 'owner', 'the role is sourced from the authenticated service session')
})

test('an outlet with an empty outbox reports zero event watermarks and stable cursor semantics', async (t) => {
  const h = await createHarness(t)
  const result = await h.runtime.query(
    'SELECT bar_local.service_events($1,$2,0,200) AS result',
    [h.ownerTokenHash, h.deviceId]
  )
  assert.deepEqual(result.rows[0].result.events, [])
  assert.equal(result.rows[0].result.event_count, 0)
  assert.equal(result.rows[0].result.next_cursor, 0)
  assert.equal(result.rows[0].result.latest_event_sequence, 0)
  assert.equal(result.rows[0].result.complete, true)
})
