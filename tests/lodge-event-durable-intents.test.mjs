import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const infrastructure = await importDomain('infrastructure.js')
const events = await importDomain('events.js')

const LODGE_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function setup(t, rpc) {
  const previous = Object.fromEntries(['cacheDir', 'lodgeId', 'currentUser', 'backendSession', 'supabase', 'isOnline'].map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('lodge-event-durable-intents')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE_ID,
    currentUser: { id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' },
    backendSession: { token: 'test-session' },
    supabase: {
      rpc,
      from() {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          limit: () => query,
          then(resolve) { resolve({ data: [], error: null }) }
        }
        return query
      }
    },
    isOnline: true
  })
  infrastructure.writeSyncQueue([])
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
}

test('online event creation persists the exact RPC envelope before an uncertain response', async (t) => {
  let sentPayload
  setup(t, async (name, args) => {
    assert.equal(name, 'create_event_booking')
    sentPayload = args.payload
    throw Object.assign(new Error('socket reset after dispatch'), { code: 'ECONNRESET' })
  })

  const request = {
    id: EVENT_ID,
    operation_id: EVENT_ID,
    idempotency_key: `event-op:${EVENT_ID}`,
    event_name: 'Smith Wedding',
    client_name: 'Doofy Mokoka',
    reservation_scope: 'venue_with_rooms',
    booking_date: '2026-11-10',
    start_time: '10:00',
    end_time: '18:00',
    room_ids: ['cccccccc-dddd-4eee-8fff-000000000001']
  }
  await assert.rejects(events.createEventBooking(request), /socket reset/)

  const queue = infrastructure.readSyncQueue()
  assert.equal(queue.length, 1)
  assert.equal(queue[0]._queue_id, `event-${EVENT_ID}`)
  assert.equal(queue[0].table, 'create_event_booking')
  assert.deepEqual(queue[0].data.payload, sentPayload)
  assert.equal(queue[0].data.payload.idempotency_key, request.idempotency_key)
})

test('uncertain event payment survives close/reopen and blocks changed amount or method', async (t) => {
  const calls = []
  setup(t, async (name, args) => {
    calls.push({ name, args })
    throw Object.assign(new Error('connection lost after dispatch'), { code: 'ECONNRESET' })
  })

  await assert.rejects(
    events.updateEventPayment(EVENT_ID, 500, 'cash', 'payment', 'evt-pay-stable-operation'),
    /connection lost/
  )
  assert.deepEqual(events.getPendingEventPaymentIntent(EVENT_ID), {
    amount: 500,
    method: 'cash',
    type: 'payment',
    idempotency_key: 'evt-pay-stable-operation',
    scope: 'event',
    pending: true
  })

  await assert.rejects(
    events.updateEventPayment(EVENT_ID, 501, 'cash', 'payment', 'evt-pay-new-operation'),
    /uncertain result/
  )
  await assert.rejects(
    events.updateEventPayment(EVENT_ID, 500, 'card', 'payment', 'evt-pay-new-operation'),
    /uncertain result/
  )
  assert.equal(calls.length, 1, 'changed payloads never reach the financial RPC')
  const queued = infrastructure.readSyncQueue()
  assert.equal(queued.length, 1)
  assert.deepEqual(queued[0].data, calls[0].args)
  assert.equal(queued[0]._queue_id, `event-pay-${EVENT_ID}-evt-pay-stable-operation`)
})

test('uncertain consolidated invoice payment retries the exact saved envelope', async (t) => {
  const calls = []
  setup(t, async (name, args) => {
    calls.push({ name, args })
    if (calls.length === 1) throw Object.assign(new Error('connection lost after dispatch'), { code: 'ECONNRESET' })
    return { data: { success: true, payment_id: 'payment-1' }, error: null }
  })

  await assert.rejects(
    events.recordEventInvoicePayment(EVENT_ID, 900, 'bank transfer', 'invoice-pay-stable-operation'),
    /connection lost/
  )
  assert.deepEqual(events.getPendingEventPaymentIntent(EVENT_ID), {
    amount: 900,
    method: 'bank transfer',
    type: 'payment',
    idempotency_key: 'invoice-pay-stable-operation',
    scope: 'group',
    pending: true
  })
  await assert.rejects(
    events.recordEventInvoicePayment(EVENT_ID, 901, 'bank transfer', 'invoice-pay-replacement-operation'),
    /uncertain result/
  )
  assert.equal(calls.length, 1, 'changed payloads never reach the financial RPC')

  const result = await events.recordEventInvoicePayment(EVENT_ID, 900, 'bank transfer', 'invoice-pay-replacement-operation')
  assert.equal(result.success, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].name, 'record_event_invoice_payment')
  assert.deepEqual(calls[1], calls[0], 'retry must resend the original event, amount, method and key')
  assert.equal(infrastructure.readSyncQueue()[0]._state, 'committed')
  assert.equal(events.getPendingEventPaymentIntent(EVENT_ID), null)
})

test('offline event payment keeps server-owned totals unchanged and labels its estimate', async (t) => {
  setup(t, async () => {
    throw new Error('offline payment must not reach Supabase')
  })
  state.isOnline = false
  infrastructure.writeCache('conference-bookings', [{
    id: EVENT_ID,
    total_amount: 1000,
    amount_paid: 250,
    balance_due: 750,
    payment_status: 'partial'
  }])

  const result = await events.updateEventPayment(EVENT_ID, 100, 'cash', 'payment', 'offline-event-payment-key')
  const [cached] = infrastructure.readCache('conference-bookings')
  assert.equal(result.queued, true)
  assert.equal(cached.amount_paid, 250)
  assert.equal(cached.balance_due, 750)
  assert.equal(cached.payment_status, 'partial')
  assert.equal(cached._estimated_amount_paid, 350)
  assert.equal(cached._estimated_balance_due, 650)
  assert.equal(cached._estimated_payment_status, 'partial')
})

test('a definitive group payment rejection releases the original form lock', async (t) => {
  setup(t, async () => ({
    data: { success: false, reconciliation_required: true, error: 'Receipts need reconciliation' },
    error: null
  }))

  const result = await events.recordEventInvoicePayment(EVENT_ID, 900, 'cash', 'invoice-pay-rejected-operation')
  assert.equal(result.success, false)
  assert.equal(result.reconciliation_required, true)
  assert.equal(events.getPendingEventPaymentIntent(EVENT_ID), null)
  assert.equal(infrastructure.readSyncQueue()[0]._state, 'committed')
})

test('a successful exact online RPC leaves a durable committed marker for crash cleanup', async (t) => {
  setup(t, async () => ({ data: { success: true, event_id: EVENT_ID }, error: null }))
  const queueId = `event-${EVENT_ID}`
  infrastructure.queueOperation('rpc', 'create_event_booking', { payload: { id: EVENT_ID, idempotency_key: 'event-op:committed' } }, null, { _queue_id: queueId })
  assert.equal(infrastructure.markQueuedOperationCommitted(queueId), true)
  assert.equal(infrastructure.readSyncQueue()[0]._state, 'committed')
})
