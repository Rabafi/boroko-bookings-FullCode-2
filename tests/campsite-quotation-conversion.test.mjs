// Campsite quotation conversion carry — behavioral contract.
//
// Independent-review BLOCKING-1: a single accommodation line pointing at a
// campsite converted through convert_quotation_to_booking while silently
// dropping tents/vehicles (booking kept 0/0, no accommodation_kind, no
// details row, no server rate verification). Multi-room conversion had the
// mirror defect server-side (comparison forced tents/vehicles to 0).
//
// These tests drive the REAL domain (src/main/domains/bookings.js) with a
// scripted transport and assert real outputs — not source text:
// - offline single-line campsite conversion projects the quoted occupancy
//   (display-only) while the queued RPC keeps its legacy shape, so old
//   payloads replay unchanged and the server (new migration) owns truth;
// - offline single-line room conversion keeps legacy zeros (no behavior drift);
// - online single conversion calls the server contract with the quotation id
//   and enforces the intent receipt (mismatched receipts throw, no silent
//   second booking);
// - multi-line campsite quotations route per-line tents/vehicles through the
//   group contract (never spread across children, never the room-only path).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { importDomain, importState, makeTempCacheDir, scriptSupabase } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const infrastructure = await importDomain('infrastructure.js')
const bookings = await importDomain('bookings.js')

const LODGE = '22222222-2222-4222-8222-222222222222'
const CUSTOMER = '66666666-6666-4666-8666-666666666666'
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SITE = '33333333-3333-4333-8333-333333333333'
const ROOM = '44444444-4444-4334-8334-444444444444'
const SITE2 = '55555555-5555-4335-8335-555555555555'

function campsiteRoom(id, number) {
  return {
    id,
    lodge_id: LODGE,
    room_number: number,
    accommodation_kind: 'campsite',
    rate_mode: 'site',
    rate_per_night: 150,
    rate_per_person: 75,
    rate_per_tent: 50,
    rate_per_vehicle: 30,
    max_occupancy: 6,
    capacity_adults: 4,
    capacity_children: 4,
    max_tents: 3,
    max_vehicles: 2,
    status: 'available'
  }
}

function normalRoom() {
  return {
    id: ROOM,
    lodge_id: LODGE,
    room_number: '101',
    accommodation_kind: 'room',
    rate_mode: 'site',
    rate_per_night: 500,
    max_occupancy: 2,
    status: 'available'
  }
}

function quotation(id, overrides = {}) {
  return {
    id,
    lodge_id: LODGE,
    customer_id: CUSTOMER,
    customer_name: 'Test Guest',
    quotation_type: 'room',
    room_id: SITE,
    room_name: 'Site A1',
    accommodation_lines: [
      { room_id: SITE, room_name: 'Site A1', adults: 2, children: 1, tents: 2, vehicles: 1, amount: 300 }
    ],
    check_in: '2026-11-10',
    check_out: '2026-11-12',
    adults: 2,
    children: 1,
    subtotal: 300,
    tax_amount: 0,
    total_amount: 300,
    status: 'accepted',
    notes: '',
    ...overrides
  }
}

function isolate(t, { online, rpc }) {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline', 'replayAuthReady', 'syncInProgress', 'syncQueuePromise']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('campsite-quotation-conversion')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE,
    currentUser: { id: ACTOR },
    supabase: rpc ? scriptSupabase(rpc) : null,
    isOnline: online,
    replayAuthReady: true,
    syncInProgress: false,
    syncQueuePromise: null
  })
  infrastructure.writeCache('rooms', [campsiteRoom(SITE, 'A1'), campsiteRoom(SITE2, 'A2'), normalRoom()])
  infrastructure.writeCache('bookings', [])
  infrastructure.writeCache('customers', [{ id: CUSTOMER, lodge_id: LODGE, name: 'Test Guest' }])
  infrastructure.writeCache('quotations', [])
  infrastructure.writeSyncQueue([])
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
  return { cacheDir }
}

// supabase.from stub: serves seeded quotation rows through .single() (the real
// online getQuotationById path) and empty lists for background cache refresh.
function makeFrom(quotationsById = {}) {
  return (table) => {
    let id = null
    const stub = new Proxy(function () {}, {
      get: (target, prop) => {
        if (prop === 'then') return (resolve) => resolve({ data: [], error: null })
        if (prop === 'single') return async () => {
          if (table === 'quotations' && id && quotationsById[id]) {
            return { data: quotationsById[id], error: null }
          }
          return { data: null, error: null }
        }
        return (...args) => {
          if (prop === 'eq' && args[0] === 'id') id = args[1]
          return stub
        }
      }
    })
    return stub
  }
}

test('offline single-line campsite conversion projects quoted occupancy without authoring financial truth', async (t) => {
  isolate(t, { online: false })
  const qid = '77777777-7777-4777-8777-777777777777'
  infrastructure.writeCache('quotations', [quotation(qid)])
  const result = await bookings.convertQuotationToBooking(qid, 0, 'cash')
  assert.ok(result.booking_id, 'returns the pending local booking id')
  assert.equal(result.pendingSync, true)

  const [projected] = infrastructure.readCache('bookings')
  assert.equal(projected.tents, 2, 'quoted tent count is projected')
  assert.equal(projected.vehicles, 1, 'quoted vehicle count is projected')
  assert.equal(projected.accommodation_kind, 'campsite')
  assert.equal(projected.rate_mode, 'site')
  assert.equal(projected.total_amount, 0, 'canonical total stays unconfirmed offline')
  assert.equal(projected._financial_estimate, true)
  assert.ok(!('amount_paid' in projected) || projected.amount_paid === undefined, 'no amount_paid authored')
  assert.ok(!('payment_status' in projected) || projected.payment_status === undefined, 'no payment_status authored')

  const queued = infrastructure.readSyncQueue()
  assert.equal(queued.length, 1, 'exactly one queued intent')
  assert.equal(queued[0].table, 'convert_quotation_to_booking')
  assert.deepEqual(
    Object.keys(queued[0].data).sort(),
    ['p_created_by', 'p_deposit_amount', 'p_lodge_id', 'p_payment_method', 'p_quotation_id'].sort(),
    'queued payload keeps its legacy shape so old intents replay unchanged'
  )
  assert.equal(queued[0].data.p_quotation_id, qid)
})

test('offline single-line room conversion keeps legacy zeros (no drift)', async (t) => {
  isolate(t, { online: false })
  const qid = '88888888-8888-4888-8888-888888888888'
  infrastructure.writeCache('quotations', [quotation(qid, {
    room_id: ROOM,
    room_name: 'Room 101',
    accommodation_lines: [{ room_id: ROOM, room_name: 'Room 101', adults: 2, children: 0, tents: 0, vehicles: 0, amount: 1000 }],
    adults: 2,
    children: 0,
    subtotal: 1000,
    total_amount: 1000
  })])
  const result = await bookings.convertQuotationToBooking(qid, 0, 'cash')
  assert.ok(result.booking_id)
  const [projected] = infrastructure.readCache('bookings')
  assert.equal(projected.tents, 0)
  assert.equal(projected.vehicles, 0)
  assert.equal(projected.accommodation_kind, null)
  assert.equal(projected.rate_mode, null)
})

test('online single conversion calls the server contract and enforces the intent receipt', async (t) => {
  const qid = '99999999-9999-4999-8999-999999999999'
  const bookingId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const rpcCalls = []
  const seed = quotation(qid)
  isolate(t, {
    online: true,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      assert.equal(name, 'convert_quotation_to_booking')
      return {
        data: {
          success: true,
          booking_id: bookingId,
          invoice_number: 'INV-1',
          operation_id: `quotation-conversion:${qid}`,
          lodge_id: LODGE,
          actor_id: ACTOR,
          receipt: { quotation_id: qid, booking_id: bookingId }
        },
        error: null
      }
    }
  })
  state.supabase.from = makeFrom({ [qid]: seed })
  infrastructure.writeCache('quotations', [seed])
  const result = await bookings.convertQuotationToBooking(qid, 0, 'cash')
  assert.equal(result.booking_id, bookingId)
  assert.equal(rpcCalls.length, 1)
  assert.deepEqual(rpcCalls[0].args, {
    p_quotation_id: qid,
    p_lodge_id: LODGE,
    p_deposit_amount: 0,
    p_payment_method: 'cash',
    p_created_by: ACTOR
  })
})

test('online single conversion rejects a mismatched server receipt instead of double-booking', async (t) => {
  const qid = 'aaaaaaaa-1111-4111-8111-111111111111'
  isolate(t, {
    online: true,
    rpc: async () => ({
      data: {
        success: true,
        booking_id: 'bbbbbbbb-2222-4222-8222-222222222222',
        invoice_number: 'INV-2',
        operation_id: 'quotation-conversion:some-other-quote',
        lodge_id: LODGE,
        actor_id: ACTOR,
        receipt: { quotation_id: qid, booking_id: 'bbbbbbbb-2222-4222-8222-222222222222' }
      },
      error: null
    })
  })
  state.supabase.from = makeFrom({ [qid]: quotation(qid) })
  infrastructure.writeCache('quotations', [quotation(qid)])
  await assert.rejects(
    () => bookings.convertQuotationToBooking(qid, 0, 'cash'),
    /did not match the saved quotation conversion receipt/
  )
})

test('multi-line campsite quotation routes per-line occupancy through the group contract', async (t) => {
  const qid = 'bbbbbbbb-3333-4333-8333-333333333333'
  const rpcCalls = []
  const childA = 'cccccccc-4444-4444-8444-cccccccccccc'
  const childB = 'dddddddd-5555-4555-8555-dddddddddddd'
  const groupId = `quotation-${qid}`
  isolate(t, {
    online: true,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      assert.equal(name, 'create_multi_room_booking')
      return {
        data: {
          success: true,
          booking_ids: [childA, childB],
          group_id: 'eeeeeeee-6666-4666-8666-eeeeeeeeeeee',
          group_invoice_number: 'GINV-1',
          operation_id: `quotation-conversion:${qid}`,
          lodge_id: LODGE,
          actor_id: ACTOR,
          receipt: { group_id: 'eeeeeeee-6666-4666-8666-eeeeeeeeeeee', group_key: groupId, booking_ids: [childA, childB] },
          quotation_id: qid
        },
        error: null
      }
    }
  })
  const seedMulti = quotation(qid, {
    room_id: null,
    room_name: '2 units',
    accommodation_lines: [
      { room_id: SITE, room_name: 'Site A1', adults: 2, children: 1, tents: 2, vehicles: 1, amount: 300 },
      { room_id: SITE2, room_name: 'Site A2', adults: 2, children: 0, tents: 1, vehicles: 0, amount: 150 }
    ],
    adults: 4,
    children: 1,
    subtotal: 450,
    total_amount: 450
  })
  state.supabase.from = makeFrom({ [qid]: seedMulti })
  infrastructure.writeCache('quotations', [seedMulti])
  const result = await bookings.convertQuotationToBooking(qid, 0, 'cash')
  assert.deepEqual(result.booking_ids, [childA, childB])
  assert.equal(rpcCalls.length, 1)
  const rooms = rpcCalls[0].args.p_rooms
  assert.equal(rooms.length, 2)
  assert.deepEqual(
    rooms.map((line) => [line.room_id, line.tents, line.vehicles]),
    [[SITE, 2, 1], [SITE2, 1, 0]],
    'each line carries its own counts; one site counts never spread across children'
  )
})
