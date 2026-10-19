import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const infrastructure = await importDomain('infrastructure.js')
const bookings = await importDomain('bookings.js')

const LODGE_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'
const OPERATION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const EVENT_GROUP_ID = `evt-${OPERATION_ID.replace(/-/g, '')}`

function seedIsolatedOfflineDomain(t) {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline', 'replayAuthReady', 'syncInProgress', 'syncQueuePromise']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('event-booking-offline-idempotency')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE_ID,
    currentUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    supabase: null,
    isOnline: false,
    replayAuthReady: true,
    syncInProgress: false,
    syncQueuePromise: null
  })
  infrastructure.writeCache('rooms', [{
    id: '44444444-4444-4334-8334-444444444444',
    lodge_id: LODGE_ID,
    room_number: '101',
    status: 'available'
  }])
  infrastructure.writeCache('customers', [{
    id: CUSTOMER_ID,
    lodge_id: LODGE_ID,
    name: 'Offline Event Group',
    _pending_sync: false
  }])
  infrastructure.writeCache('bookings', [])
  infrastructure.writeSyncQueue([])
  infrastructure.writeFailedSyncQueue([])

  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
}

function eventRequest(overrides = {}) {
  return {
    event_name: 'Offline Event Group',
    check_in: '2026-11-10',
    check_out: '2026-11-12',
    operation_id: OPERATION_ID,
    event_daily_rate: 125,
    deposit_amount: 0,
    payment_method: 'cash',
    created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ...overrides
  }
}

test('offline event retry returns the exact pending intent before conflicting with its cached booking', async (t) => {
  seedIsolatedOfflineDomain(t)

  const first = await bookings.createEventBooking(eventRequest())
  const queuedBeforeRetry = infrastructure.readSyncQueue()
  assert.equal(queuedBeforeRetry.length, 1)
  assert.equal(queuedBeforeRetry[0]._queue_id, `booking-${first.bookingId}`)
  assert.equal(queuedBeforeRetry[0].data.payload.create_idempotency_key, `event-booking:${EVENT_GROUP_ID}`)

  const retry = await bookings.createEventBooking(eventRequest())
  const queuedAfterRetry = infrastructure.readSyncQueue()

  assert.equal(retry.idempotent, true)
  assert.equal(retry.bookingId, first.bookingId)
  assert.deepEqual(queuedAfterRetry, queuedBeforeRetry, 'retry keeps the existing queue envelope and payload unchanged')
  assert.equal(infrastructure.readCache('bookings').length, 1, 'retry does not duplicate the cached event booking')
})

test('offline event retries still reject changed intent payloads and unrelated date conflicts', async (t) => {
  seedIsolatedOfflineDomain(t)
  await bookings.createEventBooking(eventRequest())

  await assert.rejects(
    bookings.createEventBooking(eventRequest({ event_daily_rate: 126 })),
    /already queued with different details/
  )
  await assert.rejects(
    bookings.createEventBooking(eventRequest({ operation_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' })),
    /Cannot create exclusive event/
  )

  assert.equal(infrastructure.readSyncQueue().length, 1)
  assert.equal(infrastructure.readCache('bookings').length, 1)
})
