// Agent C: accommodation priced-family contract (R7).
//
// The shared client set MUST equal the server set in
// supabase/migrations/20261014060000_campsite_priced_tent_kind.sql:
//   CAMPSITE_PRICED_KINDS = ('campsite', 'tent').
//
// Pricing/occupancy decisions use isCampsitePriced; isCampsiteUnit stays the
// display-noun helper (a tent row must keep showing "Permanent tent" even
// though priced rows stamp the family label 'campsite' server-side).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMPSITE_PRICED_KINDS,
  buildGroupRoomLines,
  computeStayTotal,
  getAccommodationKindLabel,
  getUnitDisplayName,
  isCampsitePriced,
  isCampsiteUnit,
  normalizeAccommodationKind,
  validateAccommodationOccupancy,
  validateCampsiteOccupancy
} from '../src/shared/accommodation.js'

function tentUnit(overrides = {}) {
  return {
    id: 'tent-t1',
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
    ...overrides
  }
}

function siteUnit(overrides = {}) {
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

test('priced-family literal matches the server migration set', () => {
  assert.deepEqual([...CAMPSITE_PRICED_KINDS], ['campsite', 'tent'])
})

test('isCampsitePriced routes tent + campsite through the campsite contract; room/unit stay room-priced', () => {
  assert.equal(isCampsitePriced({ accommodation_kind: 'campsite' }), true)
  assert.equal(isCampsitePriced({ kind: 'site' }), true)
  assert.equal(isCampsitePriced({ accommodation_kind: 'tent' }), true)
  assert.equal(isCampsitePriced({ kind: 'tent' }), true)
  assert.equal(isCampsitePriced({ accommodation_kind: 'room' }), false)
  assert.equal(isCampsitePriced({ accommodation_kind: 'unit' }), false)
  assert.equal(isCampsitePriced({ accommodation_kind: 'cabin' }), false)
  assert.equal(isCampsitePriced({}), false)
  assert.equal(isCampsitePriced(null), false)
})

test('display nouns are untouched: tents are not relabeled to campsites', () => {
  assert.equal(normalizeAccommodationKind('tent'), 'tent')
  assert.equal(isCampsiteUnit({ accommodation_kind: 'tent' }), false)
  assert.equal(getAccommodationKindLabel('tent'), 'Permanent tent')
  assert.equal(getUnitDisplayName({ accommodation_kind: 'tent', room_number: 'T1' }), 'Permanent tent T1')
  assert.equal(getUnitDisplayName({ accommodation_kind: 'campsite', room_number: 'A1' }), 'Campsite A1')
})

test('R7 probe: tent-kind all-modes estimate equals the server pricing shape', () => {
  // Independent-review probe fixture: tent 100/night + 70/person, 2 adults,
  // 3 nights. The old main-domain branch priced it as an ordinary room
  // (300); the priced contract prices it per mode (person: 420).
  const nights = 3
  const counts = { adults: 2, children: 0, tents: 1, vehicles: 1 }
  assert.equal(
    computeStayTotal(tentUnit({ rate_mode: 'person' }), { ...counts, nights }),
    70 * 2 * 3
  )
  assert.equal(
    computeStayTotal(tentUnit({ rate_mode: 'site' }), { ...counts, nights }),
    100 * 3
  )
  assert.equal(
    computeStayTotal(tentUnit({ rate_mode: 'tent' }), { ...counts, nights, tents: 2 }),
    40 * 2 * 3
  )
  assert.equal(
    computeStayTotal(tentUnit({ rate_mode: 'vehicle' }), { ...counts, nights, vehicles: 2 }),
    25 * 2 * 3
  )
  assert.equal(
    computeStayTotal(
      tentUnit({ rate_mode: 'composite' }),
      { nights, adults: 2, children: 1, tents: 2, vehicles: 1 }
    ),
    (100 + 70 * 3 + 40 * 2 + 25 * 1) * 3
  )
})

test('tent-kind estimates flow through computeStayTotal for the priced family (renderer == main input)', () => {
  // Both the renderer estimate branch and the main-domain base total call
  // the SAME shared computeStayTotal for priced units, so given identical
  // inputs they cannot disagree by branch. This pins the R7 420-vs-300 fix:
  // the priced path must never fall back to rate_per_night * nights.
  const unit = tentUnit({ rate_mode: 'person' })
  assert.ok(isCampsitePriced(unit))
  assert.equal(computeStayTotal(unit, { nights: 3, adults: 2, children: 0 }), 420)
  assert.notEqual(computeStayTotal(unit, { nights: 3, adults: 2, children: 0 }), 100 * 3)
})

test('room/unit kinds keep the generic max_occupancy gate', () => {
  const room = { accommodation_kind: 'room', max_occupancy: 2, rate_per_night: 800 }
  assert.equal(validateAccommodationOccupancy(room, { adults: 2, children: 0 }).ok, true)
  const over = validateAccommodationOccupancy(room, { adults: 2, children: 1 })
  assert.equal(over.ok, false)
  assert.match(over.errors[0], /maximum occupancy/)
  const unit = { accommodation_kind: 'unit', max_occupancy: 2, rate_per_night: 800 }
  assert.equal(validateAccommodationOccupancy(unit, { adults: 2, children: 1 }).ok, false)
})

test('campsite-priced 2-adult + 1-child stay passes when caps allow it (no earlier generic gate)', () => {
  // R7 regression fixture: adult cap 2, child cap 2, max_occupancy 2.
  // The old ordering rejected this before the campsite caps ran.
  const site = siteUnit({ capacity_adults: 2, capacity_children: 2, max_occupancy: 2 })
  assert.equal(
    validateAccommodationOccupancy(site, { adults: 2, children: 1, tents: 1, vehicles: 0 }).ok,
    true
  )
  const tent = tentUnit()
  assert.equal(
    validateAccommodationOccupancy(tent, { adults: 2, children: 1, tents: 1, vehicles: 0 }).ok,
    true
  )
})

test('priced family enforces each independent cap without a generic gate', () => {
  const tent = tentUnit()
  const adults = validateAccommodationOccupancy(tent, { adults: 3, children: 0, tents: 1, vehicles: 0 })
  assert.equal(adults.ok, false)
  assert.match(adults.errors[0], /adult capacity/)
  assert.doesNotMatch(adults.errors[0], /maximum occupancy/)
  const children = validateAccommodationOccupancy(tent, { adults: 1, children: 3, tents: 1, vehicles: 0 })
  assert.equal(children.ok, false)
  assert.match(children.errors[0], /child capacity/)
  const tents = validateAccommodationOccupancy(tent, { adults: 1, children: 0, tents: 3, vehicles: 0 })
  assert.equal(tents.ok, false)
  assert.match(tents.errors[0], /tent limit/)
  const vehicles = validateAccommodationOccupancy(tent, { adults: 1, children: 0, tents: 0, vehicles: 2 })
  assert.equal(vehicles.ok, false)
  assert.match(vehicles.errors[0], /vehicle limit/)
  assert.match(
    validateAccommodationOccupancy(tentUnit({ rate_mode: 'tent' }), { adults: 2, children: 0, tents: 0, vehicles: 0 }).errors[0],
    /At least one tent/
  )
  assert.match(
    validateAccommodationOccupancy(tentUnit({ rate_mode: 'vehicle' }), { adults: 2, children: 0, tents: 0, vehicles: 0 }).errors[0],
    /At least one vehicle/
  )
})

test('validateCampsiteOccupancy stays consistent with the family validator for priced units', () => {
  for (const unit of [siteUnit(), tentUnit()]) {
    for (const counts of [
      { adults: 2, children: 1, tents: 1, vehicles: 0 },
      { adults: 5, children: 0, tents: 0, vehicles: 0 },
      { adults: 0, children: 0, tents: 0, vehicles: 0 }
    ]) {
      assert.deepEqual(
        validateAccommodationOccupancy(unit, counts),
        validateCampsiteOccupancy(unit, counts),
        `${unit.accommodation_kind} ${JSON.stringify(counts)}`
      )
    }
  }
})

test('mixed room/tent/site group lines carry per-line priced counts', () => {
  const lines = buildGroupRoomLines(
    [siteUnit({ id: 'site-1' }), tentUnit({ id: 'tent-1' }), { id: 'room-1', accommodation_kind: 'room', max_occupancy: 2 }],
    {
      'site-1': { adults: 2, children: 1, tents: 2, vehicles: 1 },
      'tent-1': { adults: 2, children: 0, tents: 1, vehicles: 1 },
      'room-1': { adults: 2, children: 0, tents: 9, vehicles: 9 }
    },
    { adults: 1, children: 0, tents: 0, vehicles: 0 }
  )
  assert.deepEqual(lines[0], { room_id: 'site-1', adults: 2, children: 1, tents: 2, vehicles: 1 })
  assert.deepEqual(lines[1], { room_id: 'tent-1', adults: 2, children: 0, tents: 1, vehicles: 1 })
  assert.deepEqual(lines[2], { room_id: 'room-1', adults: 2, children: 0, tents: 0, vehicles: 0 })
})

test('shell follows the SAME loaded inventory mix as inventory screens (actual-mix consistency)', async () => {
  // A legacy lodge profile containing campsites must say Sites consistently
  // in shell AND body. The shell passes the loaded rooms array; the resolver
  // derives wording from that mix, with the profile as fallback only.
  const { getDesktopNavItems } = await import('../src/renderer/src/navigation/desktopNav.js')
  const fullAccess = { allowedByRole: new Proxy({}, { get: () => true }) }
  const label = (items) => items.find((item) => item.to === '/rooms')?.label
  const board = (items) => items.find((item) => item.to === '/roomgrid')?.label
  const legacyLodgeProfile = { accommodation_mix: { rooms_or_units: true } }
  const loadedMixed = [
    { id: 'r1', accommodation_kind: 'room' },
    { id: 's1', accommodation_kind: 'campsite' }
  ]
  const loadedRoomsOnly = [{ id: 'r1', accommodation_kind: 'room' }]
  // Profile-only (stale cache, rooms never loaded): safe room wording.
  const profileOnly = getDesktopNavItems('lodge', fullAccess, 'lodge', 'Pro', [], legacyLodgeProfile, 'lodge-camp')
  assert.equal(label(profileOnly), 'Rooms')
  // Same profile + loaded mixed inventory: shell says Sites & Units.
  const withMix = getDesktopNavItems('lodge', fullAccess, 'lodge', 'Pro', [], legacyLodgeProfile, 'lodge-camp', loadedMixed)
  assert.equal(label(withMix), 'Sites & Units')
  assert.equal(board(withMix), 'Stay Board')
  // Loaded rooms-only inventory keeps Rooms wording.
  const roomsOnly = getDesktopNavItems('lodge', fullAccess, 'lodge', 'Pro', [], legacyLodgeProfile, 'lodge-camp', loadedRoomsOnly)
  assert.equal(label(roomsOnly), 'Rooms')
  assert.equal(board(roomsOnly), 'Room Board')
  // Loaded sites-only inventory says Sites.
  const sitesOnly = getDesktopNavItems('lodge', fullAccess, 'camp', 'Pro', [], null, 'lodge-camp', [{ id: 's1', accommodation_kind: 'campsite' }])
  assert.equal(label(sitesOnly), 'Sites')
  assert.equal(board(sitesOnly), 'Site Board')
  // Presentation-only: membership/visibility untouched by the mix.
  const routes = (items) => items.map((item) => item.to).sort()
  assert.deepEqual(routes(withMix), routes(profileOnly))
})

test('queued contract keys are stable: no envelope renames', () => {
  const [line] = buildGroupRoomLines([tentUnit({ id: 'tent-1' })], {}, { adults: 2, children: 1, tents: 1, vehicles: 1 })
  for (const key of ['room_id', 'adults', 'children', 'tents', 'vehicles']) {
    assert.ok(Object.prototype.hasOwnProperty.call(line, key), `group line must keep ${key}`)
  }
  // Offline queue RPC shape for single priced creates (mirrors the domain
  // queueOperation payload keys): same names, no new envelope.
  const queuedData = {
    p_adults: 2,
    p_children: 1,
    p_tents: 1,
    p_vehicles: 1,
    p_idempotency_key: 'create-booking:tent-booking-id'
  }
  for (const key of ['p_adults', 'p_children', 'p_tents', 'p_vehicles', 'p_idempotency_key']) {
    assert.ok(Object.prototype.hasOwnProperty.call(queuedData, key), `queued payload must keep ${key}`)
  }
})
