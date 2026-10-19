// Agent C: campsite booking journey behavioral contract.
//
// Exercises the exact shared helpers the desktop booking form uses
// (src/renderer/src/components/Bookings.jsx) against server-mirrored rules
// from supabase/migrations/20260711200000_campsite_booking_pricing_contract.sql
// and the desktop domain readers in src/main/domains/bookings.js:
//
// - createBooking reads data.tents/data.vehicles (bookings.js ~line 901)
// - updateBooking reads data.tents ?? data.tents_count (bookings.js ~line 1416)
// - createMultiRoomBooking reads line.tents/line.vehicles per line
//   (bookings.js ~line 1247) and queues p_tents/p_vehicles (bookings.js ~line 1076)
// - the mesh merge validator requires integer p_tents/p_vehicles and
//   p_adults + p_children >= 1 (meshQueueMerge.js ~line 372)
// - the client must never author amount_paid/payment_status (AGENTS.md rule 3)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGroupRoomLines,
  computeStayTotal,
  describeRateMode,
  findFinancialAuthorshipKeys,
  getCampsiteOccupancyDefaults,
  getCampsiteOccupancyLimits,
  isCampsiteUnit,
  normalizeAccommodationKind,
  normalizeRateMode,
  restoreBookingOccupancy,
  validateCampsiteOccupancy
} from '../src/shared/accommodation.js'

function campsiteUnit(overrides = {}) {
  return {
    id: 'site-a1',
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
    ...overrides
  }
}

test('unit kind normalization recognizes campsite and tent inputs', () => {
  assert.equal(normalizeAccommodationKind('campsite'), 'campsite')
  assert.equal(normalizeAccommodationKind('pitch'), 'campsite')
  assert.equal(normalizeAccommodationKind('tent'), 'tent')
  assert.equal(isCampsiteUnit({ accommodation_kind: 'campsite' }), true)
  assert.equal(isCampsiteUnit({ kind: 'site' }), true)
  assert.equal(isCampsiteUnit({ accommodation_kind: 'room' }), false)
  assert.equal(isCampsiteUnit({ accommodation_kind: 'tent' }), false)
})

test('per-mode estimates incl. composite match server pricing shape', () => {
  const nights = 2
  assert.equal(computeStayTotal(campsiteUnit({ rate_mode: 'site' }), { nights }), 300)
  assert.equal(
    computeStayTotal(campsiteUnit({ rate_mode: 'person' }), { nights, adults: 2, children: 1 }),
    75 * 3 * 2
  )
  assert.equal(
    computeStayTotal(campsiteUnit({ rate_mode: 'tent' }), { nights, adults: 2, tents: 2 }),
    50 * 2 * 2
  )
  assert.equal(
    computeStayTotal(campsiteUnit({ rate_mode: 'vehicle' }), { nights, adults: 1, vehicles: 2 }),
    30 * 2 * 2
  )
  // composite = (site + person * people + tent * tents + vehicle * vehicles) * nights
  assert.equal(
    computeStayTotal(
      campsiteUnit({ rate_mode: 'composite' }),
      { nights, adults: 2, children: 1, tents: 2, vehicles: 1 }
    ),
    (150 + 75 * 3 + 50 * 2 + 30 * 1) * 2
  )
})

test('rate mode labels stay human-readable per mode', () => {
  assert.match(describeRateMode(campsiteUnit({ rate_mode: 'person' })), /person/)
  assert.match(describeRateMode(campsiteUnit({ rate_mode: 'tent' })), /tent/)
  assert.match(describeRateMode(campsiteUnit({ rate_mode: 'vehicle' })), /vehicle/)
  assert.match(describeRateMode(campsiteUnit({ rate_mode: 'composite' })), /Combined/)
  assert.match(describeRateMode(campsiteUnit({ rate_mode: 'site' })), /night/)
  assert.equal(normalizeRateMode('combined'), 'composite')
})

test('limits mirror server columns; unset caps stay uncapped (null)', () => {
  const limits = getCampsiteOccupancyLimits(campsiteUnit())
  assert.deepEqual(
    { capacityAdults: limits.capacityAdults, capacityChildren: limits.capacityChildren, maxTents: limits.maxTents, maxVehicles: limits.maxVehicles },
    { capacityAdults: 4, capacityChildren: 4, maxTents: 3, maxVehicles: 2 }
  )
  assert.equal(limits.rateMode, 'site')
  const uncapped = getCampsiteOccupancyLimits({ accommodation_kind: 'campsite', rate_mode: 'site', max_occupancy: 6 })
  assert.equal(uncapped.capacityAdults, null) // the server enforces only explicit priced-family caps
  assert.equal(uncapped.capacityChildren, null)
  assert.equal(uncapped.maxTents, null)
  assert.equal(uncapped.maxVehicles, null)
  assert.equal(getCampsiteOccupancyLimits({ accommodation_kind: 'room', max_occupancy: 6 }).capacityAdults, 6)
})

test('defaults mirror server minimums (guest required; tent/vehicle per mode)', () => {
  assert.deepEqual(getCampsiteOccupancyDefaults(campsiteUnit({ rate_mode: 'site' })), { adults: 1, children: 0, tents: 0, vehicles: 0 })
  assert.deepEqual(getCampsiteOccupancyDefaults(campsiteUnit({ rate_mode: 'tent' })), { adults: 1, children: 0, tents: 1, vehicles: 0 })
  assert.deepEqual(getCampsiteOccupancyDefaults(campsiteUnit({ rate_mode: 'vehicle' })), { adults: 1, children: 0, tents: 0, vehicles: 1 })
  assert.deepEqual(getCampsiteOccupancyDefaults(campsiteUnit({ rate_mode: 'composite' })), { adults: 1, children: 0, tents: 0, vehicles: 0 })
})

test('validation rejects non-integer, negative and missing occupancy explicitly', () => {
  const unit = campsiteUnit({ rate_mode: 'site' })
  for (const counts of [
    { adults: 'two', children: 0, tents: 0, vehicles: 0 },
    { adults: 1.5, children: 0, tents: 0, vehicles: 0 },
    { adults: '', children: 0, tents: 0, vehicles: 0 },
    { adults: null, children: 0, tents: 0, vehicles: 0 },
    { adults: -1, children: 0, tents: 0, vehicles: 0 },
    { adults: 0, children: 0, tents: 1, vehicles: 0 }
  ]) {
    const result = validateCampsiteOccupancy(unit, counts)
    assert.equal(result.ok, false, JSON.stringify(counts))
    assert.ok(result.errors.length > 0)
  }
  const missing = validateCampsiteOccupancy(unit, { adults: 0, children: 0, tents: 0, vehicles: 0 })
  assert.match(missing.errors[0], /At least one guest/)
})

test('validation rejects capacity excess and per-mode minimums', () => {
  assert.equal(validateCampsiteOccupancy(campsiteUnit(), { adults: 2, children: 1, tents: 2, vehicles: 1 }).ok, true)
  assert.match(
    validateCampsiteOccupancy(campsiteUnit(), { adults: 5, children: 0, tents: 0, vehicles: 0 }).errors[0],
    /adult capacity/
  )
  assert.match(
    validateCampsiteOccupancy(campsiteUnit(), { adults: 1, children: 5, tents: 0, vehicles: 0 }).errors[0],
    /child capacity/
  )
  assert.match(
    validateCampsiteOccupancy(campsiteUnit(), { adults: 2, children: 0, tents: 4, vehicles: 0 }).errors[0],
    /tent limit/
  )
  assert.match(
    validateCampsiteOccupancy(campsiteUnit(), { adults: 2, children: 0, tents: 0, vehicles: 3 }).errors[0],
    /vehicle limit/
  )
  assert.match(
    validateCampsiteOccupancy(campsiteUnit({ rate_mode: 'tent' }), { adults: 2, children: 0, tents: 0, vehicles: 0 }).errors[0],
    /At least one tent/
  )
  assert.match(
    validateCampsiteOccupancy(campsiteUnit({ rate_mode: 'vehicle' }), { adults: 2, children: 0, tents: 0, vehicles: 0 }).errors[0],
    /At least one vehicle/
  )
})

test('priced kinds treat nullable independent capacities as uncapped despite max_occupancy', () => {
  const noExplicitCaps = { accommodation_kind: 'tent', max_occupancy: 2, capacity_adults: null, capacity_children: null }
  assert.equal(getCampsiteOccupancyLimits(noExplicitCaps).capacityAdults, null)
  assert.equal(validateCampsiteOccupancy(noExplicitCaps, { adults: 3, children: 0 }).ok, true)

  const uncappedAdults = { accommodation_kind: 'tent', max_occupancy: 2, capacity_adults: null, capacity_children: 2 }
  assert.equal(validateCampsiteOccupancy(uncappedAdults, { adults: 3, children: 2 }).ok, true)

  const uncappedChildren = { accommodation_kind: 'campsite', max_occupancy: 2, capacity_adults: 3, capacity_children: null }
  assert.equal(validateCampsiteOccupancy(uncappedChildren, { adults: 3, children: 4 }).ok, true)
})

test('edit restores saved counts from either column shape; never resets to zero', () => {
  // Live domain update shape (tents/vehicles).
  assert.deepEqual(
    restoreBookingOccupancy({ adults: 2, children: 1, tents: 3, vehicles: 1 }),
    { adults: 2, children: 1, tents: 3, vehicles: 1 }
  )
  // Stored booking row shape (tents_count/vehicles_count).
  assert.deepEqual(
    restoreBookingOccupancy({ adults: 4, children: 2, tents_count: 2, vehicles_count: 2 }),
    { adults: 4, children: 2, tents: 2, vehicles: 2 }
  )
  // Faithful restore: a saved zero stays zero, a missing row gets defaults.
  assert.deepEqual(
    restoreBookingOccupancy({ adults: 1, children: 0, tents_count: 0, vehicles_count: 0 }),
    { adults: 1, children: 0, tents: 0, vehicles: 0 }
  )
  assert.deepEqual(restoreBookingOccupancy({}), { adults: 1, children: 0, tents: 0, vehicles: 0 })
  assert.deepEqual(restoreBookingOccupancy(null), { adults: 1, children: 0, tents: 0, vehicles: 0 })
})

test('group lines carry per-line counts; room lines never carry tents/vehicles', () => {
  const site = campsiteUnit({ id: 'site-1', rate_mode: 'composite' })
  const room = { id: 'room-1', accommodation_kind: 'room', max_occupancy: 2, rate_per_night: 800 }
  const lines = buildGroupRoomLines(
    [site, room],
    {
      'site-1': { adults: 2, children: 1, tents: 2, vehicles: 1 },
      'room-1': { adults: 2, children: 0, tents: 9, vehicles: 9 }
    },
    { adults: 1, children: 0, tents: 0, vehicles: 0 }
  )
  assert.deepEqual(lines[0], { room_id: 'site-1', adults: 2, children: 1, tents: 2, vehicles: 1 })
  // Domain zeroes tents/vehicles for non-campsite units; the UI shape matches.
  assert.deepEqual(lines[1], { room_id: 'room-1', adults: 2, children: 0, tents: 0, vehicles: 0 })
})

test('group lines fall back to form-level counts for single stays', () => {
  const site = campsiteUnit({ id: 'site-1', rate_mode: 'person' })
  const [line] = buildGroupRoomLines([site], {}, { adults: '2', children: '1', tents: '1', vehicles: '0' })
  assert.deepEqual(line, { room_id: 'site-1', adults: 2, children: 1, tents: 1, vehicles: 0 })
})

test('legacy queue payload compat: UI field names match domain readers', () => {
  // createBooking/updateBooking read data.adults/data.children/data.tents
  // (+ data.tents_count fallback on update) and the offline queue carries
  // p_adults/p_children/p_tents/p_vehicles under the SAME queue format
  // (queueOperation('rpc', 'create_campsite_booking', {...})). The UI must
  // keep sending these exact keys — no renames, no new envelope.
  const singlePayload = {
    customer_id: 'cust-1',
    room_id: 'site-1',
    check_in: '2026-11-01',
    check_out: '2026-11-03',
    adults: 2,
    children: 1,
    tents: 2,
    vehicles: 1,
    notes: '',
    created_by: 'user-1'
  }
  for (const key of ['adults', 'children', 'tents', 'vehicles']) {
    assert.ok(Object.prototype.hasOwnProperty.call(singlePayload, key), `UI payload must keep ${key}`)
  }
  const groupLine = buildGroupRoomLines([campsiteUnit({ id: 'site-1' })], {}, singlePayload)[0]
  for (const key of ['room_id', 'adults', 'children', 'tents', 'vehicles']) {
    assert.ok(Object.prototype.hasOwnProperty.call(groupLine, key), `group line must keep ${key}`)
  }
})

test('quotation lines carry campsite occupancy into group conversion', () => {
  // Quotations.jsx handleSave persists tents/vehicles on accommodation_lines
  // and bookings.js normalizeQuotationAccommodationLines preserves them
  // (legacy lines without the keys default to 0). Conversion feeds those
  // lines into the per-line campsite contract via buildGroupRoomLines.
  const site = campsiteUnit({ id: 'site-9', rate_mode: 'composite' })
  const quotationLines = [
    { room_id: 'site-9', room_name: 'Campsite A9', adults: 2, children: 1, tents: 2, vehicles: 1, amount: 500 },
    { room_id: 'room-9', room_name: 'Room 9', adults: 2, children: 0, amount: 800 }
  ]
  const roomGuests = Object.fromEntries(quotationLines.map((line) => [line.room_id, line]))
  const lines = buildGroupRoomLines(
    [site, { id: 'room-9', accommodation_kind: 'room', max_occupancy: 2 }],
    roomGuests,
    { adults: 1, children: 0, tents: 0, vehicles: 0 }
  )
  assert.deepEqual(lines[0], { room_id: 'site-9', adults: 2, children: 1, tents: 2, vehicles: 1 })
  assert.deepEqual(lines[1], { room_id: 'room-9', adults: 2, children: 0, tents: 0, vehicles: 0 })
  // Composite estimate from converted quotation occupancy matches the server shape.
  assert.equal(
    computeStayTotal(site, { nights: 2, adults: 2, children: 1, tents: 2, vehicles: 1 }),
    (150 + 75 * 3 + 50 * 2 + 30 * 1) * 2
  )
})

test('no amount_paid/payment_status authorship in UI payload shapes', () => {
  const base = {
    customer_id: 'cust-1',
    room_id: 'site-1',
    check_in: '2026-11-01',
    check_out: '2026-11-03',
    adults: 2,
    children: 0,
    tents: 1,
    vehicles: 0,
    deposit_amount: 50,
    notes: '',
    created_by: 'user-1'
  }
  const updateShape = { ...base, expected_updated_at: '2026-10-01T00:00:00Z' }
  const groupShape = {
    ...base,
    rooms: buildGroupRoomLines([campsiteUnit({ id: 'site-1' })], {}, base)
  }
  for (const payload of [base, updateShape, groupShape]) {
    assert.deepEqual(findFinancialAuthorshipKeys(payload), [], JSON.stringify(Object.keys(payload)))
  }
  // deposit_amount is a legitimate ledger intent and must NOT be flagged.
  assert.deepEqual(findFinancialAuthorshipKeys({ deposit_amount: 50 }), [])
  // Tripwire works when future code regresses.
  assert.deepEqual(
    findFinancialAuthorshipKeys({ ...base, amount_paid: 100, payment_status: 'paid', total_amount: 300 }),
    ['amount_paid', 'payment_status', 'total_amount']
  )
})

// ─── Agent C (R7): real-domain path with scripted transport ────────────────
// Exercises the ACTUAL main-process bookings domain (the same module the
// desktop IPC facade calls) with an isolated cache dir and a scripted
// Supabase transport: offline queue assertions plus one online RPC-contract
// assertion. Renderer and domain share the same computeStayTotal /
// validateAccommodationOccupancy module instances imported above.
import fs from 'node:fs'
import { importDomain, importState, makeTempCacheDir, scriptSupabase } from './helpers/domain-test-setup.mjs'

const { state: bookingState } = await importState()
const bookingsDomain = await importDomain('bookings.js')
const journeyCache = await importDomain('cacheStore.js')
const journeySync = await importDomain('syncStore.js')

const JOURNEY_LODGE = '22222222-2222-4222-8222-222222222222'
const JOURNEY_ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const JOURNEY_CUSTOMER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const JOURNEY_TENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const JOURNEY_SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const JOURNEY_ROOM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function journeyTentRoom() {
  return {
    id: JOURNEY_TENT,
    room_number: 'T1',
    room_type: 'Permanent tent',
    accommodation_kind: 'tent',
    rate_mode: 'person',
    rate_per_night: 100,
    rate_per_person: 70,
    rate_per_tent: 40,
    rate_per_vehicle: 25,
    max_occupancy: 2,
    capacity_adults: 2,
    capacity_children: 2,
    max_tents: 2,
    max_vehicles: 1,
    status: 'available'
  }
}

function journeyRoomsCache() {
  return [
    journeyTentRoom(),
    {
      id: JOURNEY_SITE,
      room_number: 'A1',
      room_type: 'Campsite',
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
    },
    {
      id: JOURNEY_ROOM,
      room_number: '101',
      room_type: 'Double',
      accommodation_kind: 'room',
      rate_per_night: 800,
      max_occupancy: 2,
      status: 'available'
    }
  ]
}

// Chainable query stub: list reads resolve rows, single() reports no row so
// domain readers fall back to the seeded local cache (same as offline).
function journeyTableChain() {
  let proxy
  proxy = new Proxy(
    {
      then(resolve, reject) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject)
      },
      single: async () => ({ data: null, error: { message: 'no row' } })
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop]
        return () => proxy
      }
    }
  )
  return proxy
}

function withJourneyState(t, { online = false, rpc = null } = {}) {
  const cacheDir = makeTempCacheDir('campsite-journey')
  const previous = {
    cacheDir: bookingState.cacheDir,
    lodgeId: bookingState.lodgeId,
    currentUser: bookingState.currentUser,
    supabase: bookingState.supabase,
    isOnline: bookingState.isOnline
  }
  Object.assign(bookingState, {
    cacheDir,
    lodgeId: JOURNEY_LODGE,
    currentUser: { id: JOURNEY_ACTOR },
    supabase: rpc
      ? { rpc, from: () => journeyTableChain() }
      : { rpc: async () => { throw new Error('offline: no RPC transport') } },
    isOnline: online
  })
  journeyCache.writeCache('rooms', journeyRoomsCache())
  journeyCache.writeCache('bookings', [])
  t.after(() => {
    Object.assign(bookingState, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
  return cacheDir
}

function journeyQueue() {
  return journeySync.readSyncQueue()
}

test('domain offline: tent-kind 2+1 vs max_occupancy=2 queues create_campsite_booking with tents/vehicles/keys', async (t) => {
  withJourneyState(t)
  const id = await bookingsDomain.createBooking({
    customer_id: JOURNEY_CUSTOMER,
    room_id: JOURNEY_TENT,
    check_in: '2026-11-01',
    check_out: '2026-11-04',
    adults: 2,
    children: 1,
    tents: 1,
    vehicles: 0,
    created_by: JOURNEY_ACTOR
  })
  assert.match(id, /^[0-9a-f-]{36}$/i)
  const items = journeyQueue()
  assert.equal(items.length, 1)
  const item = items[0]
  assert.equal(item.table, 'create_campsite_booking')
  assert.equal(item._queue_id, `booking-${id}`)
  // Stable operation key: derived deterministically from the booking id.
  assert.equal(item.data.p_idempotency_key, bookingsDomain.createBookingIdempotencyKey(id))
  assert.equal(item.data.p_idempotency_key, `create-booking:${id}`)
  assert.deepEqual(
    { adults: item.data.p_adults, children: item.data.p_children, tents: item.data.p_tents, vehicles: item.data.p_vehicles },
    { adults: 2, children: 1, tents: 1, vehicles: 0 }
  )
})

test('domain offline: room-kind 3 guests vs max_occupancy 2 keeps the generic gate', async (t) => {
  withJourneyState(t)
  await assert.rejects(
    () => bookingsDomain.createBooking({
      customer_id: JOURNEY_CUSTOMER,
      room_id: JOURNEY_ROOM,
      check_in: '2026-11-01',
      check_out: '2026-11-04',
      adults: 2,
      children: 1,
      created_by: JOURNEY_ACTOR
    }),
    /maximum occupancy/
  )
  assert.equal(journeyQueue().length, 0)
})

test('domain offline: tent-kind over adult cap fails with the priced-cap error, never the generic gate', async (t) => {
  withJourneyState(t)
  await assert.rejects(
    () => bookingsDomain.createBooking({
      customer_id: JOURNEY_CUSTOMER,
      room_id: JOURNEY_TENT,
      check_in: '2026-11-01',
      check_out: '2026-11-04',
      adults: 3,
      children: 0,
      tents: 1,
      vehicles: 0,
      created_by: JOURNEY_ACTOR
    }),
    (error) => {
      assert.match(error.message, /adult capacity/)
      assert.doesNotMatch(error.message, /maximum occupancy/)
      return true
    }
  )
  assert.equal(journeyQueue().length, 0)
})

test('domain offline: queued envelope is stable so replay preserves tents/vehicles/keys', async (t) => {
  withJourneyState(t)
  const id = await bookingsDomain.createBooking({
    customer_id: JOURNEY_CUSTOMER,
    room_id: JOURNEY_TENT,
    check_in: '2026-11-01',
    check_out: '2026-11-04',
    adults: 2,
    children: 0,
    tents: 2,
    vehicles: 1,
    created_by: JOURNEY_ACTOR
  })
  const first = journeyQueue()[0]
  // Exact envelope key set: any rename/addition fails loudly here.
  assert.deepEqual(Object.keys(first.data).sort(), [
    'p_allow_total_override',
    'p_booking_id',
    'p_created_by',
    'p_customer_id',
    'p_check_in',
    'p_check_out',
    'p_deposit_amount',
    'p_deposit_method',
    'p_idempotency_key',
    'p_invoice_number',
    'p_lodge_id',
    'p_notes',
    'p_room_id',
    'p_total_amount',
    'p_adults',
    'p_children',
    'p_tents',
    'p_vehicles'
  ].sort())
  assert.equal(first.data.p_tents, 2)
  assert.equal(first.data.p_vehicles, 1)
  // Re-read: replay sees the same stable keys (no key rotation).
  const reread = journeyQueue()[0]
  assert.equal(reread._queue_id, first._queue_id)
  assert.equal(reread.data.p_idempotency_key, first.data.p_idempotency_key)
  assert.equal(reread.data.p_idempotency_key, `create-booking:${id}`)
})

test('domain offline: mixed tent/room group queues per-line priced counts', async (t) => {
  withJourneyState(t)
  // Lines are built with the REAL renderer helper: even a hostile tents: 9
  // on the room row is zeroed before it reaches the domain, so one unit's
  // counts are never allocated across every child.
  const rooms = journeyRoomsCache()
  const lines = buildGroupRoomLines(
    rooms.filter((room) => [JOURNEY_TENT, JOURNEY_ROOM].includes(room.id)),
    {
      [JOURNEY_TENT]: { adults: 2, children: 0, tents: 1, vehicles: 1 },
      [JOURNEY_ROOM]: { adults: 2, children: 0, tents: 9, vehicles: 9 }
    },
    { adults: 1, children: 0, tents: 0, vehicles: 0 }
  )
  const result = await bookingsDomain.createMultiRoomBooking({
    customer_id: JOURNEY_CUSTOMER,
    check_in: '2026-11-01',
    check_out: '2026-11-04',
    rooms: lines,
    deposit_amount: 0,
    created_by: JOURNEY_ACTOR
  })
  assert.equal(result.success, true)
  assert.equal(result.booking_ids.length, 2)
  const items = journeyQueue()
  assert.equal(items.length, 1)
  assert.equal(items[0].table, 'create_multi_room_booking')
  const queuedRooms = items[0].data.p_rooms
  assert.equal(queuedRooms.length, 2)
  const tentLine = queuedRooms.find((line) => line.room_id === JOURNEY_TENT)
  const roomLine = queuedRooms.find((line) => line.room_id === JOURNEY_ROOM)
  assert.deepEqual(
    { adults: tentLine.adults, children: tentLine.children, tents: tentLine.tents, vehicles: tentLine.vehicles },
    { adults: 2, children: 0, tents: 1, vehicles: 1 }
  )
  // Room lines never carry tents/vehicles into the campsite contract.
  assert.equal(roomLine.tents, 0)
  assert.equal(roomLine.vehicles, 0)
})

test('domain offline: tent update preserves tents through update_campsite_booking', async (t) => {
  withJourneyState(t)
  const id = await bookingsDomain.createBooking({
    customer_id: JOURNEY_CUSTOMER,
    room_id: JOURNEY_TENT,
    check_in: '2026-11-01',
    check_out: '2026-11-04',
    adults: 2,
    children: 0,
    tents: 1,
    vehicles: 0,
    created_by: JOURNEY_ACTOR
  })
  await bookingsDomain.updateBooking(id, {
    customer_id: JOURNEY_CUSTOMER,
    room_id: JOURNEY_TENT,
    check_in: '2026-11-01',
    check_out: '2026-11-04',
    adults: 2,
    children: 1,
    tents: 2,
    vehicles: 1,
    notes: '',
    created_by: JOURNEY_ACTOR
  })
  const update = journeyQueue().find((item) => item.table === 'update_campsite_booking')
  assert.ok(update, 'expected an update_campsite_booking queue item')
  assert.equal(update.data.payload.tents, 2)
  assert.equal(update.data.payload.vehicles, 1)
  assert.equal(update.data.payload.adults, 2)
  assert.equal(update.data.payload.children, 1)
})

test('domain online: tent create uses the server quote shape (renderer == server)', async (t) => {
  const rpcCalls = []
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args })
    if (name === 'get_next_invoice_number') return { data: 'INV-JOURNEY-001', error: null }
    // Server-shape authoritative total for the R7 probe inputs.
    if (name === 'accommodation_booking_expected_total') return { data: 420, error: null }
    if (name === 'create_campsite_booking') {
      return { data: { success: true, booking_id: 'server-booking-1' }, error: null }
    }
    throw new Error(`unexpected RPC in test: ${name}`)
  }
  withJourneyState(t, { online: true, rpc: scriptSupabase(rpc).rpc })
  // Renderer-side estimate for the same inputs (the exact shared fn).
  const rendererEstimate = computeStayTotal(journeyTentRoom(), { nights: 3, adults: 2, children: 0, tents: 0, vehicles: 0 })
  assert.equal(rendererEstimate, 420)
  const bookingId = await bookingsDomain.createBooking({
    customer_id: JOURNEY_CUSTOMER,
    room_id: JOURNEY_TENT,
    check_in: '2026-11-01',
    check_out: '2026-11-04',
    adults: 2,
    children: 0,
    tents: 0,
    vehicles: 0,
    created_by: JOURNEY_ACTOR
  })
  assert.equal(bookingId, 'server-booking-1')
  const quote = rpcCalls.find((call) => call.name === 'accommodation_booking_expected_total')
  assert.ok(quote, 'expected a server quote call for the priced path')
  assert.equal(quote.args.p_tents, 0)
  const create = rpcCalls.find((call) => call.name === 'create_campsite_booking')
  assert.ok(create, 'tent kind must route to create_campsite_booking, not create_booking')
  assert.ok(!rpcCalls.some((call) => call.name === 'create_booking'), 'room RPC must not fire for tent kind')
})
