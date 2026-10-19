import assert from 'node:assert/strict'
import fs from 'node:fs'
import { afterEach, test } from 'node:test'
import { importDomain, importState, makeTempCacheDir, scriptSupabase } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const infrastructure = await importDomain('infrastructure.js')
const syncStore = await importDomain('syncStore.js')
const cacheStore = await importDomain('cacheStore.js')
const bookings = await importDomain('bookings.js')
const LODGE = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '66666666-6666-4666-8666-666666666666'

function isolatedQueue(t, rpc) {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline', 'replayAuthReady', 'syncInProgress', 'syncQueuePromise']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('queue-replay-authority')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE,
    currentUser: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    supabase: scriptSupabase(rpc),
    isOnline: true,
    replayAuthReady: true,
    syncInProgress: false,
    syncQueuePromise: null
  })
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
  return { cacheDir }
}

for (const scenario of [
  {
    name: 'product name uniqueness conflict does not retire a different queued product',
    parent: {
      type: 'rpc',
      table: 'save_bar_product_with_stock',
      _queue_id: 'product-parent-0001',
      _state: 'pending',
      data: { p_lodge_id: LODGE, p_idempotency_key: 'product-intent-0001', payload: { id: '22222222-2222-4222-8222-222222222222', name: 'Cola', price: 25, stock_item_id: '33333333-3333-4333-8333-333333333333' } }
    },
    error: { code: '23505', message: 'A product named Cola already exists in this lodge' }
  },
  {
    name: 'unrelated invoice-number uniqueness conflict does not confirm a booking intent',
    parent: {
      type: 'rpc',
      table: 'create_booking_invoice_group',
      _queue_id: 'invoice-parent-0001',
      _state: 'pending',
      data: { p_lodge_id: LODGE, p_booking_id: '44444444-4444-4444-8444-444444444444', p_idempotency_key: 'booking-intent-0001', p_invoice_number: 'INV-2026-001' }
    },
    error: { code: '23505', message: 'duplicate key violates invoices_lodge_id_invoice_number_key' }
  }
]) {
  test(scenario.name, async (t) => {
    const rpcCalls = []
    isolatedQueue(t, async (name, args) => {
      rpcCalls.push({ name, args })
      state.isOnline = false
      return { data: { success: false, code: scenario.error.code, error: scenario.error.message }, error: null }
    })
    const child = {
      type: 'rpc',
      table: 'dependent_booking_charge',
      _queue_id: 'dependent-child-0001',
      _depends_on: scenario.parent._queue_id,
      _state: 'pending',
      data: { p_lodge_id: LODGE, p_idempotency_key: 'dependent-operation-0001' }
    }
    syncStore.writeSyncQueue([scenario.parent, child])

    await infrastructure.processSyncQueue()

    const pending = syncStore.readSyncQueue()
    const failed = syncStore.readFailedSyncQueue()
    assert.ok(
      [...pending, ...failed].some((item) => item._queue_id === scenario.parent._queue_id),
      'the conflicting parent must remain durably queued or in manual review'
    )
    assert.ok(pending.some((item) => item._queue_id === child._queue_id), 'the dependent must remain pending')
    assert.deepEqual(rpcCalls.map((call) => call.name), [scenario.parent.table], 'a dependent effect must not run after an unconfirmed parent')
    assert.equal(
      [...pending, ...failed].find((item) => item._queue_id === scenario.parent._queue_id)?.data?.p_idempotency_key,
      scenario.parent.data.p_idempotency_key,
      'recovery must retain the original operation key'
    )
  })
}

test('a POS void without an exact receipt remains visible and blocks dependent effects', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    state.isOnline = false
    return { data: { success: false, code: 'idempotency_receipt_unavailable', error: 'This POS void predates exact retry evidence. Keep it for manager review; do not re-key or repeat the void.' }, error: null }
  })
  const parent = {
    type: 'rpc', table: 'approve_pos_void_with_pin', _queue_id: 'pos-void-legacy-receipt', _state: 'pending',
    data: { payload: { override_log_id: '66666666-6666-4666-8666-666666666666', order_id: '77777777-7777-4777-8777-777777777777', lodge_id: LODGE } }
  }
  const child = {
    type: 'rpc', table: 'dependent_booking_charge', _queue_id: 'after-pos-void', _depends_on: parent._queue_id, _state: 'pending',
    data: { p_lodge_id: LODGE, p_idempotency_key: 'after-void-operation' }
  }
  syncStore.writeSyncQueue([parent, child])

  await infrastructure.processSyncQueue()

  const pending = syncStore.readSyncQueue()
  const failed = syncStore.readFailedSyncQueue()
  const dead = failed.find((item) => item._queue_id === parent._queue_id)
  assert.ok(dead, 'unmatched void state must go to visible recovery, not be acknowledged')
  assert.equal(dead.manualRetryOnly, true)
  assert.equal(pending.some((item) => item._queue_id === child._queue_id), true, 'dependent stays blocked')
  assert.deepEqual(calls.map((call) => call.name), [parent.table])
  assert.equal(calls[0].args.payload.override_log_id, parent.data.payload.override_log_id, 'recovery retains the original key')
})
test('the forward POS void contract binds immutable actor, scope and payload before replay success', async () => {
  const source = fs.readFileSync(new URL('../supabase/migrations/20261005060000_luna_pos_void_intent_exact_replay.sql', import.meta.url), 'utf8')
  assert.match(source, /create table public\.pos_void_operation_receipts/i)
  assert.match(source, /payload_hash text not null/i)
  assert.match(source, /actor_id uuid not null/i)
  assert.match(source, /actor_id uuid not null,\s*payload_hash text not null/i,
    'receipt columns must remain in one valid CREATE TABLE definition')
  assert.match(source, /enable row level security/i)
  assert.match(source, /payload - 'pin'/i, 'the immutable fingerprint must exclude the secret PIN')
  assert.match(source, /pg_advisory_xact_lock/i, 'same-key concurrent RPCs must serialize')
  assert.match(source, /idempotency_conflict/i)
  assert.match(source, /idempotency_receipt_unavailable/i)
  assert.match(source, /v_receipt\.payload_hash <> v_payload_hash/i)
  assert.match(source, /v_receipt\.actor_id <> v_actor_id/i)
  assert.match(source, /return v_receipt\.result/i)
})
test('a Bar duplicate-name refusal is terminal manual review and keeps dependent work blocked', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    state.isOnline = false
    return {
      data: {
        success: false,
        code: '23505',
        error: 'A product named "Cola" already exists. Review the existing product before retrying this save.'
      },
      error: null
    }
  })
  const parent = {
    type: 'rpc', table: 'save_bar_product_with_stock', _queue_id: 'bar-product-conflict',
    _state: 'pending', data: { payload: { operation_key: 'bar-product-intent', lodge_id: LODGE, product: { name: 'Cola' } } }
  }
  const child = {
    type: 'rpc', table: 'create_pos_order_v3', _queue_id: 'sale-after-bar-product',
    _depends_on: parent._queue_id, _state: 'pending',
    data: { payload: { submit_intent_id: 'sale-intent' } }
  }
  syncStore.writeSyncQueue([parent, child])

  await infrastructure.processSyncQueue()

  const pending = syncStore.readSyncQueue()
  const failed = syncStore.readFailedSyncQueue()
  const refused = failed.find((item) => item._queue_id === parent._queue_id)
  assert.ok(refused, 'a name conflict must remain visible for review, never be acknowledged as a successful create')
  assert.equal(refused.manualRetryOnly, true, 'replaying the same conflicting payload cannot resolve it')
  assert.ok([...pending, ...failed].some((item) => item._queue_id === child._queue_id), 'dependent sale must remain queued')
  assert.deepEqual(calls.map((call) => call.name), [parent.table], 'dependent sale must not reach the server')
  assert.equal(refused.data.payload.operation_key, parent.data.payload.operation_key, 'manual review retains the original stable operation key')
})
test('a successful authoritative RPC response is still consumed and unlocks its dependent', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push(name)
    return name === 'save_bar_product_with_stock'
      ? { data: { success: true, operation_id: args.p_idempotency_key, operation_type: name, request_hash: 'same-payload-hash', product_id: args.payload.id }, error: null }
      : { data: { success: true, operation_id: args.p_idempotency_key, operation_type: name, request_hash: 'child-payload-hash' }, error: null }
  })
  const parent = {
    type: 'rpc', table: 'save_bar_product_with_stock', _queue_id: 'product-parent-success',
    _state: 'pending', data: { p_lodge_id: LODGE, p_idempotency_key: 'product-intent-success', payload: { id: '55555555-5555-4555-8555-555555555555', name: 'Soda' } }
  }
  const child = {
    type: 'rpc', table: 'dependent_booking_charge', _queue_id: 'dependent-child-success',
    _depends_on: parent._queue_id, _state: 'pending',
    data: { p_lodge_id: LODGE, p_idempotency_key: 'dependent-operation-success' }
  }
  syncStore.writeSyncQueue([parent, child])
  await infrastructure.processSyncQueue()
  assert.deepEqual(calls, [parent.table, child.table])
  assert.deepEqual(syncStore.readSyncQueue(), [])
})

test('an exact POS void receipt replay rechecks the original outlet authorization', () => {
  const source = fs.readFileSync(new URL('../supabase/migrations/20261005060000_luna_pos_void_intent_exact_replay.sql', import.meta.url), 'utf8')
  const replayStart = source.indexOf('if found then', source.indexOf('select r.* into v_receipt'))
  const replayEnd = source.indexOf('return v_receipt.result', replayStart)
  assert.ok(replayStart >= 0 && replayEnd > replayStart)
  const replay = source.slice(replayStart, replayEnd)
  assert.match(replay, /v_receipt\.outlet_id/i, 'the committed receipt must retain the server-resolved outlet scope')
  assert.match(replay, /app_require_pos_outlet_access\(v_lodge_id,\s*v_receipt\.outlet_id\)/i,
    'the current actor must still have access to the outlet before receiving a replay result')
})
test('offline multi-room quotation conversion is one quoted group intent ordered after its saved prerequisites', async (t) => {
  isolatedQueue(t, async () => { throw new Error('offline quote conversion must not dispatch an RPC') })
  state.isOnline = false
  const quotationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const roomA = '22222222-2222-4222-8222-222222222222'
  const roomB = '33333333-3333-4333-8333-333333333333'
  cacheStore.writeCache('rooms', [
    { id: roomA, room_number: 'A', room_type: 'Standard', rate_per_night: 100, max_occupancy: 4 },
    { id: roomB, room_number: 'B', room_type: 'Standard', rate_per_night: 110, max_occupancy: 4 }
  ])
  cacheStore.writeCache('customers', [{ id: CUSTOMER, name: 'Offline Guest', _pending_sync: true }])
  const quotation = {
    id: quotationId, lodge_id: LODGE, customer_id: CUSTOMER, customer_name: 'Offline Guest',
    status: 'sent', check_in: '2026-11-05', check_out: '2026-11-08', notes: 'Accepted stay terms',
    accommodation_lines: [
      { room_id: roomA, adults: 1, children: 0, amount: 300 },
      { room_id: roomB, adults: 2, children: 0, amount: 330 }
    ],
    subtotal: 630, tax_amount: 0, total_amount: 630, _pending_sync: true
  }
  cacheStore.writeCache('quotations', [quotation])
  syncStore.writeSyncQueue([
    { type: 'rpc', table: 'create_quotation', _queue_id: `quotation-${quotationId}`, data: { payload: { id: quotationId } } },
    { type: 'rpc', table: 'mark_quotation_sent', _queue_id: `quotation-sent-${quotationId}`, data: { p_id: quotationId } },
    { type: 'rpc', table: 'create_customer', _queue_id: `customer-${CUSTOMER}`, data: { id: CUSTOMER } }
  ])

  const result = await bookings.convertQuotationToBooking(quotationId, 0, 'cash')
  assert.equal(result.pendingSync, true)
  assert.equal(result.booking_ids.length, 2)
  let queue = syncStore.readSyncQueue()
  assert.equal(queue.filter((item) => item.table === 'create_multi_room_booking').length, 1)
  assert.equal(queue.some((item) => item.table === 'update_quotation'), false, 'conversion must not queue a second quote lifecycle write')
  const group = queue.find((item) => item.table === 'create_multi_room_booking')
  assert.equal(group.data.p_total_amount, quotation.subtotal, 'the saved group intent carries the accepted subtotal')
  assert.deepEqual([...group._depends_on_all].sort(), [
    `customer-${CUSTOMER}`, `quotation-${quotationId}`, `quotation-sent-${quotationId}`
  ].sort(), 'the group cannot outrun its customer, quotation create or sent transition')

  // The last released desktop payload omitted p_total_amount. A retry must
  // resume that saved payload unchanged instead of replacing it with a new hash.
  syncStore.writeSyncQueue(queue.map((item) => item._queue_id === group._queue_id
    ? { ...item, data: { ...item.data, p_total_amount: null } }
    : item))
  const resumed = await bookings.createMultiRoomBooking({
    customer_id: quotation.customer_id, check_in: quotation.check_in, check_out: quotation.check_out,
    rooms: quotation.accommodation_lines.map((line) => ({ room_id: line.room_id, adults: line.adults, children: line.children })),
    deposit_amount: 0, payment_method: 'cash', notes: quotation.notes,
    group_id: `quotation-${quotationId}`, idempotency_key: `quotation-conversion:${quotationId}`,
    quotation_id: quotationId, total_amount: quotation.subtotal, created_by: state.currentUser.id
  })
  assert.equal(resumed.idempotent, true)
  queue = syncStore.readSyncQueue()
  assert.equal(queue.filter((item) => item.table === 'create_multi_room_booking').length, 1)
  assert.equal(queue.find((item) => item.table === 'create_multi_room_booking').data.p_total_amount, null,
    'legacy payload is retained exactly for replay')
})
test('a server-confirmed group with a broken quotation link is journaled for manual recovery', async (t) => {
  isolatedQueue(t, async () => {
    state.isOnline = false
    return { data: {
      success: true,
      group_id: '99999999-9999-4999-8999-999999999999',
      booking_ids: ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'],
      quotation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      quotation_recovery_required: true,
      manual_review_required: true,
      quotation_error: 'The committed group and quotation pointer disagree; preserve both for manager review.'
    }, error: null }
  })
  const bookingIds = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']
  const quotationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  cacheStore.writeCache('bookings', bookingIds.map((id) => ({ id, _pending_sync: true, _sync_state: 'pending' })))
  cacheStore.writeCache('quotations', [{ id: quotationId, status: 'accepted', _pending_sync: true }])
  syncStore.writeSyncQueue([{
    type: 'rpc', table: 'create_multi_room_booking', _queue_id: 'booking-group-recovery-test',
    _local_booking_ids: bookingIds,
    data: { p_lodge_id: LODGE, p_group_key: `quotation-${quotationId}`, p_idempotency_key: `quotation-conversion:${quotationId}` }
  }])

  await infrastructure.processSyncQueue()

  assert.deepEqual(syncStore.readSyncQueue(), [], 'the confirmed group effect is consumed so replay cannot create it again')
  assert.ok(cacheStore.readCache('bookings').every((row) => row._sync_state === 'synced'), 'committed bookings stay server-confirmed')
  const quote = cacheStore.readCache('quotations').find((row) => row.id === quotationId)
  assert.equal(quote._manual_review_required, true)
  assert.equal(quote._sync_state, 'failed')
  assert.equal(quote._pending_sync, true)
  assert.match(quote._sync_error, /pointer disagree/)
  assert.ok(syncStore.readOperationJournal({ limit: 20 }).some((entry) =>
    entry.event === 'quotation_conversion_manual_review' && entry.financial === true && entry.queue_id === 'booking-group-recovery-test'
  ), 'the quote recovery warning is durably journaled beside the original group intent')
})

