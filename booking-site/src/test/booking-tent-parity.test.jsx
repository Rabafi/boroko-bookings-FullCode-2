// F1 public permanent-tent parity — booking-site regression suite.
//
// Covers the priced family (campsite + tent) through the contracts the public
// page now relies on, plus mounted BookingPage journeys proving tent counts
// are selected, estimated, carried per line, restored, and replayed with a
// stable key. Server-authoritative totals, overcapacity rejection, mismatch
// and exact-replay behavior are exercised for real in
// tests/public-tent-booking-sql.test.mjs (disposable database); the client
// asserts here never author financial truth (amount_paid / payment_status /
// total_amount / balance_due are asserted ABSENT from every outbound payload).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import {
  CAMPSITE_PRICED_KINDS,
  buildGroupRoomLines,
  computeStayTotal,
  findFinancialAuthorshipKeys,
  getAccommodationKindLabel,
  getCampsiteOccupancyDefaults,
  isCampsitePriced,
  isCampsiteUnit,
  restoreBookingOccupancy,
  validateAccommodationOccupancy,
  validateCampsiteOccupancy
} from '../../../src/shared/accommodation.js'

function tentUnit(overrides = {}) {
  return {
    id: 'tent-t1',
    accommodation_kind: 'tent',
    rate_mode: 'site',
    rate_per_night: 100,
    rate_per_person: 70,
    rate_per_tent: 50,
    rate_per_vehicle: 30,
    max_occupancy: 2,
    capacity_adults: 2,
    capacity_children: 2,
    max_tents: 3,
    max_vehicles: 2,
    ...overrides
  }
}

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

function roomUnit(overrides = {}) {
  return {
    id: 'room-101',
    room_number: '101',
    accommodation_kind: 'room',
    rate_mode: 'site',
    rate_per_night: 300,
    max_occupancy: 2,
    ...overrides
  }
}

describe('F1 priced family contract', () => {
  it('recognizes campsite AND tent as priced, room/unit as room-priced', () => {
    expect(CAMPSITE_PRICED_KINDS).toEqual(['campsite', 'tent'])
    expect(isCampsitePriced({ accommodation_kind: 'tent' })).toBe(true)
    expect(isCampsitePriced({ accommodation_kind: 'campsite' })).toBe(true)
    expect(isCampsitePriced({ accommodation_kind: 'room' })).toBe(false)
    expect(isCampsitePriced({ accommodation_kind: 'unit' })).toBe(false)
  })

  it('keeps display wording separate: tents are priced but not campsite units', () => {
    expect(isCampsiteUnit({ accommodation_kind: 'tent' })).toBe(false)
    expect(getAccommodationKindLabel('tent')).toBe('Permanent tent')
  })

  it.each([
    ['site', { adults: 2 }, 100 * 2],
    ['person', { adults: 2, children: 1 }, 70 * 3 * 2],
    ['tent', { adults: 2, tents: 2 }, 50 * 2 * 2],
    ['vehicle', { adults: 1, vehicles: 2 }, 30 * 2 * 2],
    ['composite', { adults: 2, children: 1, tents: 2, vehicles: 1 }, (100 + 70 * 3 + 50 * 2 + 30 * 1) * 2]
  ])('estimates a tent single in %s rate mode like the server shape', (mode, counts, expected) => {
    expect(computeStayTotal(tentUnit({ rate_mode: mode }), { nights: 2, ...counts })).toBe(expected)
  })

  it('builds group lines with per-line tents/vehicles on priced lines only', () => {
    const lines = buildGroupRoomLines(
      [tentUnit(), roomUnit(), campsiteUnit()],
      {
        'tent-t1': { adults: 2, children: 0, tents: 2, vehicles: 1 },
        'room-101': { adults: 9, children: 9, tents: 9, vehicles: 9 },
        'site-a1': { adults: 1, children: 1, tents: 1, vehicles: 0 }
      },
      { adults: 1, children: 0, tents: 0, vehicles: 0 }
    )
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ room_id: 'tent-t1', tents: 2, vehicles: 1 })
    // Hostile room-line counts are zeroed before the domain, never carried.
    expect(lines[1]).toMatchObject({ room_id: 'room-101', tents: 0, vehicles: 0 })
    expect(lines[2]).toMatchObject({ room_id: 'site-a1', tents: 1, vehicles: 0 })
  })

  it('passes a valid 2-adult + 1-child tent stay against max_occupancy 2', () => {
    const result = validateAccommodationOccupancy(tentUnit(), { adults: 2, children: 1, tents: 1, vehicles: 0 })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it.each([
    ['adult cap', { adults: 3, children: 0, tents: 1, vehicles: 0 }, /adult capacity/i],
    ['child cap', { adults: 1, children: 3, tents: 1, vehicles: 0 }, /child capacity/i],
    ['tent cap', { adults: 1, children: 0, tents: 9, vehicles: 0 }, /tent limit/i],
    ['vehicle cap', { adults: 1, children: 0, tents: 0, vehicles: 9 }, /vehicle limit/i]
  ])('rejects tent %s excess with a field-specific message', (_label, counts, pattern) => {
    const result = validateAccommodationOccupancy(tentUnit(), counts)
    expect(result.ok).toBe(false)
    expect(result.errors.some((message) => pattern.test(message))).toBe(true)
  })

  it('requires a tent for per-tent pricing and a vehicle for per-vehicle pricing', () => {
    expect(validateCampsiteOccupancy(tentUnit({ rate_mode: 'tent' }), { adults: 1, children: 0, tents: 0, vehicles: 0 }).ok).toBe(false)
    expect(validateCampsiteOccupancy(tentUnit({ rate_mode: 'vehicle' }), { adults: 1, children: 0, tents: 0, vehicles: 0 }).ok).toBe(false)
  })

  it('keeps the room-style max_occupancy gate for room/unit kinds', () => {
    const result = validateAccommodationOccupancy(roomUnit(), { adults: 2, children: 1, tents: 0, vehicles: 0 })
    expect(result.ok).toBe(false)
    expect(result.errors.some((message) => /maximum occupancy/i.test(message))).toBe(true)
  })

  it('restores saved tents/vehicles counts instead of resetting to zero', () => {
    expect(restoreBookingOccupancy({ adults: 2, children: 1, tents_count: 2, vehicles_count: 1 }))
      .toEqual({ adults: 2, children: 1, tents: 2, vehicles: 1 })
    expect(getCampsiteOccupancyDefaults(tentUnit({ rate_mode: 'tent' }))).toMatchObject({ adults: 1, tents: 1 })
    expect(getCampsiteOccupancyDefaults(tentUnit({ rate_mode: 'vehicle' }))).toMatchObject({ vehicles: 1 })
  })

  it('never authors financial truth on public payloads', () => {
    const payload = {
      idempotency_key: '0123456789abcdef',
      booking_type: 'room',
      room_id: 'tent-t1',
      rooms: [{ room_id: 'tent-t1', adults: 2, children: 0, tents: 2, vehicles: 0 }],
      tents: 2,
      vehicles: 0
    }
    expect(findFinancialAuthorshipKeys(payload)).toEqual([])
    expect(findFinancialAuthorshipKeys({ ...payload, amount_paid: 200, payment_status: 'paid' }))
      .toEqual(expect.arrayContaining(['amount_paid', 'payment_status']))
  })
})

// ── Mounted BookingPage journeys ────────────────────────────────────────────
// These mount the REAL page (not a harness copy) with router + session state
// and capture the exact RPC payload the page sends.

vi.mock('../lib/publicApi.js', () => ({
  isMissingRpcError: vi.fn(() => false),
  rpc: vi.fn(),
  queueConfirmationEmail: vi.fn()
}))
vi.mock('../lib/analytics.js', () => ({
  trackBeginCheckout: vi.fn(),
  trackBookingRequest: vi.fn()
}))
vi.mock('../lib/errorTracker.js', () => ({
  captureException: vi.fn()
}))

import BookingPage from '../pages/BookingPage.jsx'
import { rpc } from '../lib/publicApi.js'
import { buildPublicAccommodationDraft } from '../lib/publicBookingAccommodation.js'

const lodgeFixture = {
  id: 'lodge-1',
  slug: 'test-lodge',
  lodge_name: 'Test Lodge',
  currency: 'P',
  phone: '',
  email: '',
  whatsapp_number: '',
  website: '',
  logo: '',
  hero_image: ''
}

function tentRoomFixture(overrides = {}) {
  return {
    id: 'tent-t1',
    room_number: 'T1',
    room_type: 'Permanent tent',
    total_price: 0,
    rate_per_night: 100,
    accommodation_kind: 'tent',
    capacity_adults: 2,
    capacity_children: 2,
    max_tents: 3,
    max_vehicles: 2,
    rate_mode: 'tent',
    rate_per_person: 70,
    rate_per_tent: 50,
    rate_per_vehicle: 30,
    max_occupancy: 2,
    photo: null,
    photos: [],
    photo_count: 0,
    amenities: [],
    description: '',
    ...overrides
  }
}

function roomFixture(overrides = {}) {
  return {
    id: 'room-101',
    room_number: '101',
    room_type: 'Standard room',
    total_price: 300,
    rate_per_night: 150,
    accommodation_kind: 'room',
    capacity_adults: null,
    capacity_children: null,
    max_tents: null,
    max_vehicles: null,
    rate_mode: 'site',
    rate_per_person: 0,
    rate_per_tent: 0,
    rate_per_vehicle: 0,
    max_occupancy: 2,
    photo: null,
    photos: [],
    photo_count: 0,
    amenities: [],
    description: '',
    ...overrides
  }
}

function guestFormFixture(overrides = {}) {
  return {
    guest_first_name: 'Thabo',
    guest_last_name: 'Modise',
    guest_email: 'thabo@example.com',
    guest_phone: '+2677123456',
    adults: 2,
    children: 0,
    tents: 2,
    vehicles: 0,
    notes: '',
    ...overrides
  }
}

function renderBookingPage({ room, rooms, bookingType = 'room', form = {} } = {}) {
  window.sessionStorage.clear()
  window.sessionStorage.setItem('booking-form-data', JSON.stringify(guestFormFixture(form)))
  const state = {
    lodge: lodgeFixture,
    room,
    rooms,
    bookingType,
    checkIn: '2026-11-10',
    checkOut: '2026-11-12',
    nights: 2
  }
  render(
    <MemoryRouter initialEntries={[{ pathname: '/test-lodge/book', state }]}>
      <Routes>
        <Route path="/:slug/book" element={<BookingPage />} />
        <Route path="/:slug/success" element={<div data-testid="booking-success" />} />
      </Routes>
    </MemoryRouter>
  )
}

function mockOnlineBookingSuccess(totalAmount = 200) {
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'create_online_booking') {
      return {
        data: {
          success: true,
          booking_id: 'booking-1',
          booking_ids: ['booking-1'],
          total_amount: totalAmount,
          confirmation_token: 'token-1',
          guest_email: 'thabo@example.com'
        },
        error: null
      }
    }
    return { data: null, error: null }
  })
}

function lastOnlineBookingPayload() {
  const call = vi.mocked(rpc).mock.calls.find(([name]) => name === 'create_online_booking')
  expect(call).toBeDefined()
  return call[1].payload
}

async function submitBookingRequest() {
  fireEvent.click(screen.getByRole('button', { name: /send booking request/i }))
  // Generous timeout: jsdom suites on loaded machines can exceed the 1s
  // default between click and the async RPC dispatch.
  await waitFor(() => {
    expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'create_online_booking')).toBe(true)
  }, { timeout: 10000 })
}

describe('F1 BookingPage tent journeys (mounted)', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('shows tent count controls for a permanent tent and carries them per line', async () => {
    mockOnlineBookingSuccess()
    renderBookingPage({ room: tentRoomFixture() })
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    // Vehicle controls stay hidden outside vehicle/composite modes.
    expect(screen.queryByLabelText('Vehicles')).not.toBeInTheDocument()
    // Server-shaped estimate: 2 nights x 50/tent x 2 tents = P200.
    expect(await screen.findAllByText('P200')).not.toHaveLength(0)
    await submitBookingRequest()
    const payload = lastOnlineBookingPayload()
    expect(payload.rooms).toEqual([{ room_id: 'tent-t1', adults: 2, children: 0, tents: 2, vehicles: 0 }])
    expect(payload.tents).toBe(2)
    expect(payload.vehicles).toBe(0)
    expect(typeof payload.idempotency_key).toBe('string')
    expect(payload.idempotency_key.length).toBeGreaterThanOrEqual(16)
    expect(findFinancialAuthorshipKeys(payload)).toEqual([])
  })

  it('keeps room singles on the room path with zeroed tents/vehicles', async () => {
    mockOnlineBookingSuccess(300)
    renderBookingPage({ room: roomFixture(), form: { adults: 1, children: 0, tents: 0, vehicles: 0 } })
    expect(await screen.findByText(/Complete your request/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Tents')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Vehicles')).not.toBeInTheDocument()
    await submitBookingRequest()
    const payload = lastOnlineBookingPayload()
    expect(payload.rooms).toEqual([{ room_id: 'room-101', adults: 1, children: 0, tents: 0, vehicles: 0 }])
  })

  it('carries tents on the tent line and zeroes them on the room line in a group', async () => {
    mockOnlineBookingSuccess()
    const tent = tentRoomFixture()
    const room = roomFixture()
    renderBookingPage({ room: tent, rooms: [tent, room], bookingType: 'multi_room' })
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    await submitBookingRequest()
    const payload = lastOnlineBookingPayload()
    expect(payload.rooms).toHaveLength(2)
    const tentLine = payload.rooms.find((line) => line.room_id === 'tent-t1')
    const roomLine = payload.rooms.find((line) => line.room_id === 'room-101')
    expect(tentLine.tents).toBe(2)
    expect(roomLine.tents).toBe(0)
    expect(roomLine.vehicles).toBe(0)
  })

  it('allocates every guest once across mixed room and priced lines, preserving room child capacity', async () => {
    mockOnlineBookingSuccess()
    const room = roomFixture({ max_occupancy: 2 })
    const priced = tentRoomFixture({
      id: 'priced-site-1',
      room_number: 'S1',
      accommodation_kind: 'campsite',
      rate_mode: 'composite',
      capacity_adults: 3,
      capacity_children: 0,
      max_tents: 4,
      max_vehicles: 2,
      rate_per_night: 100,
      rate_per_person: 10,
      rate_per_tent: 20,
      rate_per_vehicle: 5
    })
    renderBookingPage({
      room,
      rooms: [room, priced],
      bookingType: 'multi_room',
      form: { adults: 3, children: 1, tents: 2, vehicles: 1 }
    })
    await submitBookingRequest()
    const payload = lastOnlineBookingPayload()
    expect(payload.rooms).toEqual([
      { room_id: 'room-101', adults: 1, children: 1, tents: 0, vehicles: 0 },
      { room_id: 'priced-site-1', adults: 2, children: 0, tents: 2, vehicles: 1 }
    ])
    expect(payload.adults).toBe(payload.rooms.reduce((sum, line) => sum + line.adults, 0))
    expect(payload.children).toBe(payload.rooms.reduce((sum, line) => sum + line.children, 0))
    expect(payload.tents).toBe(payload.rooms.reduce((sum, line) => sum + line.tents, 0))
    expect(payload.vehicles).toBe(payload.rooms.reduce((sum, line) => sum + line.vehicles, 0))
  })

  it('keeps full-lodge exclusive pricing and sends one aggregate receipt contract', async () => {
    mockOnlineBookingSuccess(2400)
    const representative = roomFixture({ total_price: 2400, max_occupancy: 4 })
    const other = roomFixture({ id: 'room-102', room_number: '102', total_price: 400 })
    renderBookingPage({
      room: representative,
      rooms: [representative, other],
      bookingType: 'full_lodge',
      form: { adults: 3, children: 1, tents: 0, vehicles: 0 }
    })
    expect(await screen.findAllByText(/P2,400/)).not.toHaveLength(0)
    await submitBookingRequest()
    const payload = lastOnlineBookingPayload()
    expect(payload.booking_type).toBe('full_lodge')
    expect(payload.rooms).toBeUndefined()
    expect(payload.room_id).toBe('room-101')
    expect(payload.adults).toBe(3)
    expect(payload.children).toBe(1)
  })

  it('blocks and explains stale tent/vehicle counts on a room-only stay', async () => {
    renderBookingPage({ room: roomFixture(), form: { adults: 1, tents: 2, vehicles: 1 } })
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    expect(screen.getByLabelText('Vehicles')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Tents can only be included with a campsite-priced unit/i)
    fireEvent.click(screen.getByRole('button', { name: /send booking request/i }))
    expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'create_online_booking')).toBe(false)
  })

  it('keeps allocation feasibility invariant when unit selection order changes', () => {
    const room = roomFixture({ max_occupancy: 2 })
    const priced = tentRoomFixture({ capacity_adults: 3, capacity_children: 0, rate_mode: 'site' })
    const form = { adults: 3, children: 1, tents: 0, vehicles: 0 }
    const roomFirst = buildPublicAccommodationDraft([room, priced], form)
    const pricedFirst = buildPublicAccommodationDraft([priced, room], form)
    expect(roomFirst.valid).toBe(true)
    expect(pricedFirst.valid).toBe(true)
    expect(roomFirst.totals).toEqual(pricedFirst.totals)
    expect(roomFirst.lines.reduce((sum, line) => sum + line.adults, 0)).toBe(3)
    expect(roomFirst.lines.reduce((sum, line) => sum + line.children, 0)).toBe(1)
  })

  it('rejects zero-capacity priced units instead of inventing the required adult', () => {
    const result = buildPublicAccommodationDraft(
      [tentRoomFixture({ capacity_adults: 0, rate_mode: 'site' })],
      { adults: 1, children: 0, tents: 0, vehicles: 0 }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/combined capacity of 0/i)
  })

  it.each([
    ['tent', 'max_tents', 'rate_mode', 'tent'],
    ['vehicle', 'max_vehicles', 'rate_mode', 'vehicle']
  ])('rejects a per-%s minimum on a unit whose cap is zero', (label, capField, modeField, mode) => {
    const first = tentRoomFixture({ id: `${label}-zero`, [capField]: 0, [modeField]: mode })
    const second = tentRoomFixture({ id: `${label}-capacity`, [capField]: 5, [modeField]: 'site' })
    const counts = label === 'tent' ? { tents: 2, vehicles: 0 } : { tents: 0, vehicles: 2 }
    const result = buildPublicAccommodationDraft([first, second], { adults: 2, children: 0, ...counts })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(new RegExp(label, 'i'))
  })

  it('does not discard saved tents or vehicles from room-only draft counts', () => {
    const result = buildPublicAccommodationDraft(
      [roomFixture()],
      { adults: 1, children: 0, tents: 2, vehicles: 1 }
    )
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Tents can only be included/i)
    expect(result.errors.join(' ')).toMatch(/Vehicles can only be included/i)
  })

  it('does not block a valid 2-adult + 1-child tent stay at max_occupancy 2', async () => {
    mockOnlineBookingSuccess(410)
    renderBookingPage({ room: tentRoomFixture(), form: { adults: 2, children: 1, tents: 1, vehicles: 0 } })
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    await submitBookingRequest()
    const payload = lastOnlineBookingPayload()
    expect(payload.adults).toBe(2)
    expect(payload.children).toBe(1)
  })

  it('treats absent independent guest caps as uncapped even when max_occupancy is lower', async () => {
    mockOnlineBookingSuccess(300)
    const tent = tentRoomFixture({ capacity_adults: null, capacity_children: null, max_occupancy: 2 })
    renderBookingPage({ room: tent, form: { adults: 3, children: 0, tents: 1, vehicles: 0 } })
    await submitBookingRequest()
    expect(lastOnlineBookingPayload().adults).toBe(3)
    expect(lastOnlineBookingPayload().rooms[0]).toMatchObject({ room_id: 'tent-t1', adults: 3, children: 0, tents: 1 })
  })

  it('restores persisted tent counts instead of resetting them to zero', async () => {
    mockOnlineBookingSuccess()
    // Uncapped server cap (null max_tents) must preserve the saved count.
    renderBookingPage({ room: tentRoomFixture({ max_tents: null }), form: { tents: 2 } })
    const tentsInput = await screen.findByLabelText('Tents')
    expect(tentsInput.value).toBe('2')
    await submitBookingRequest()
    expect(lastOnlineBookingPayload().rooms[0].tents).toBe(2)
  })

  it('submits with the persisted stable key (exact replay identity)', async () => {
    mockOnlineBookingSuccess()
    window.sessionStorage.clear()
    window.sessionStorage.setItem('booking-form-data', JSON.stringify(guestFormFixture()))
    window.sessionStorage.setItem('booking-idempotency-key', JSON.stringify('stable-test-key-0123456789abcdef'))
    const state = {
      lodge: lodgeFixture,
      room: tentRoomFixture(),
      bookingType: 'room',
      checkIn: '2026-11-10',
      checkOut: '2026-11-12',
      nights: 2
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/test-lodge/book', state }]}>
        <Routes>
          <Route path="/:slug/book" element={<BookingPage />} />
          <Route path="/:slug/success" element={<div data-testid="booking-success" />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    await submitBookingRequest()
    expect(lastOnlineBookingPayload().idempotency_key).toBe('stable-test-key-0123456789abcdef')
  })

  it('reuses the persisted key on a refresh remount (retry replays the same intent)', async () => {
    mockOnlineBookingSuccess()
    window.sessionStorage.clear()
    window.sessionStorage.setItem('booking-form-data', JSON.stringify(guestFormFixture()))
    window.sessionStorage.setItem('booking-idempotency-key', JSON.stringify('stable-test-key-0123456789abcdef'))
    const state = {
      lodge: lodgeFixture,
      room: tentRoomFixture(),
      bookingType: 'room',
      checkIn: '2026-11-10',
      checkOut: '2026-11-12',
      nights: 2
    }
    const harness = (
      <MemoryRouter initialEntries={[{ pathname: '/test-lodge/book', state }]}>
        <Routes>
          <Route path="/:slug/book" element={<BookingPage />} />
          <Route path="/:slug/success" element={<div data-testid="booking-success" />} />
        </Routes>
      </MemoryRouter>
    )
    const first = render(harness)
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    first.unmount()
    render(harness)
    expect(await screen.findByLabelText('Tents')).toBeInTheDocument()
    await submitBookingRequest()
    expect(lastOnlineBookingPayload().idempotency_key).toBe('stable-test-key-0123456789abcdef')
  })
})
