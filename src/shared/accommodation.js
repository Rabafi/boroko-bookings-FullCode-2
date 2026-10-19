// @ts-check
/**
 * Accommodation terminology and campsite helpers shared by desktop and web surfaces.
 */

/** @typedef {{plural?: boolean}} LabelOptions */
/** @typedef {{nights?: unknown, adults?: unknown, children?: unknown, tents?: unknown, vehicles?: unknown}} StayCountOptions */

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  return value === null || value === undefined
    ? undefined
    : Reflect.get(Object(value), key, value)
}

export const ACCOMMODATION_KINDS = Object.freeze({
  room: 'room',
  unit: 'unit',
  tent: 'tent',
  campsite: 'campsite'
})

export const ACCOMMODATION_KIND_LABELS = Object.freeze({
  room: 'Room',
  unit: 'Unit / Cabin',
  tent: 'Permanent tent',
  campsite: 'Campsite'
})

export const RATE_MODES = Object.freeze({
  site: 'site',
  person: 'person',
  tent: 'tent',
  vehicle: 'vehicle',
  composite: 'composite'
})

export const RATE_MODE_LABELS = Object.freeze({
  site: 'Per site / unit / night',
  person: 'Per person / night',
  tent: 'Per tent / night',
  vehicle: 'Per vehicle / night',
  composite: 'Combined (site + people + tents + vehicles)'
})

/** @param {unknown} value @returns {'room' | 'unit' | 'tent' | 'campsite'} */
export function normalizeAccommodationKind(value) {
  const raw = String(value || 'room').trim().toLowerCase()
  if (raw === 'campsite' || raw === 'site' || raw === 'camp site' || raw === 'pitch') return 'campsite'
  if (raw === 'tent') return 'tent'
  if (raw === 'unit' || raw === 'cabin' || raw === 'chalet') return 'unit'
  return 'room'
}

/** @param {unknown} value @returns {'site' | 'person' | 'tent' | 'vehicle' | 'composite'} */
export function normalizeRateMode(value) {
  const raw = String(value || 'site').trim().toLowerCase()
  if (raw === 'person' || raw === 'per_person' || raw === 'per-person') return 'person'
  if (raw === 'tent' || raw === 'per_tent') return 'tent'
  if (raw === 'vehicle' || raw === 'per_vehicle') return 'vehicle'
  if (raw === 'composite' || raw === 'combined') return 'composite'
  return 'site'
}

/** @param {unknown} unit @returns {boolean} */
export function isCampsiteUnit(unit) {
  return normalizeAccommodationKind(readOptionalField(unit, 'accommodation_kind') || readOptionalField(unit, 'kind')) === 'campsite'
}

/**
 * Campsite-priced family (R7 shared contract — MUST equal the server set in
 * `supabase/migrations/20261014060000_campsite_priced_tent_kind.sql`:
 * `CAMPSITE_PRICED_KINDS = ('campsite', 'tent')`). Normalized 'campsite' and
 * 'tent' route through the campsite occupancy/pricing contract; normalized
 * 'room'/'unit' stay room-priced.
 *
 * Pricing/occupancy decisions MUST use this helper. `isCampsiteUnit` stays
 * the display-noun helper: the server stamps the family label 'campsite' on
 * priced booking rows while `rooms` inventory keeps the truthful 'tent' kind,
 * and per-row display must keep showing "Permanent tent".
 */
export const CAMPSITE_PRICED_KINDS = Object.freeze(['campsite', 'tent'])

/** @param {unknown} unit @returns {boolean} */
export function isCampsitePriced(unit) {
  const kind = normalizeAccommodationKind(
    readOptionalField(unit, 'accommodation_kind') ?? readOptionalField(unit, 'kind')
  )
  return kind === 'campsite' || kind === 'tent'
}

/** @param {unknown} kind @returns {string} */
export function getAccommodationKindLabel(kind) {
  return ACCOMMODATION_KIND_LABELS[normalizeAccommodationKind(kind)] || 'Room'
}

/** @param {unknown} propertyType @param {LabelOptions} [options] @returns {string} */
export function getAccommodationInventoryLabel(propertyType, { plural = true } = {}) {
  const type = String(propertyType || '').toLowerCase()
  if (type === 'camp') return plural ? 'Sites & Rooms' : 'Site / Room'
  return plural ? 'Rooms' : 'Room'
}

/** @param {unknown} unit @param {LabelOptions} [options] @returns {string} */
export function getAccommodationUnitLabel(unit, { plural = false } = {}) {
  const kind = normalizeAccommodationKind(readOptionalField(unit, 'accommodation_kind'))
  if (kind === 'campsite') return plural ? 'Campsites' : 'Campsite'
  if (kind === 'tent') return plural ? 'Tents' : 'Tent'
  if (kind === 'unit') return plural ? 'Units' : 'Unit'
  return plural ? 'Rooms' : 'Room'
}

/** @param {unknown} unit @returns {string} */
export function getUnitDisplayName(unit) {
  if (!unit) return ''
  const number = readOptionalField(unit, 'room_number') || readOptionalField(unit, 'site_number') || readOptionalField(unit, 'number') || ''
  const kind = getAccommodationKindLabel(readOptionalField(unit, 'accommodation_kind'))
  return number ? `${kind} ${number}` : kind
}

/** @param {unknown} [units] @returns {{rooms: unknown[], campsites: unknown[]}} */
export function splitAccommodationInventory(units = []) {
  const list = Array.isArray(units) ? units : []
  const campsites = list.filter((u) => isCampsiteUnit(u))
  const rooms = list.filter((u) => !isCampsiteUnit(u))
  return { rooms, campsites }
}

/** @param {unknown} unit @param {StayCountOptions} [options] @returns {number} */
export function computeStayTotal(unit, {
  nights = 1,
  adults = null,
  children = 0,
  tents = null,
  vehicles = null
} = {}) {
  const n = Math.max(Number(nights) || 1, 1)
  const mode = normalizeRateMode(readOptionalField(unit, 'rate_mode'))
  const site = Math.max(Number(readOptionalField(unit, 'rate_per_night')) || 0, 0)
  const person = Math.max(Number(readOptionalField(unit, 'rate_per_person')) || 0, 0)
  const tentRate = Math.max(Number(readOptionalField(unit, 'rate_per_tent')) || 0, 0)
  const vehicleRate = Math.max(Number(readOptionalField(unit, 'rate_per_vehicle')) || 0, 0)

  let people = Math.max((Number(adults) || 0) + (Number(children) || 0), 0)
  let tentCount = Math.max(Number(tents) || 0, 0)
  let vehicleCount = Math.max(Number(vehicles) || 0, 0)

  if (people <= 0 && (mode === 'person' || mode === 'composite')) {
    people = Math.max(Number(readOptionalField(unit, 'capacity_adults') || readOptionalField(unit, 'max_occupancy')) || 2, 1)
  }
  let total = site * n
  if (mode === 'person') total = person * people * n
  else if (mode === 'tent') total = tentRate * tentCount * n
  else if (mode === 'vehicle') total = vehicleRate * vehicleCount * n
  else if (mode === 'composite') {
    total = (site * n) + (person * people * n) + (tentRate * tentCount * n) + (vehicleRate * vehicleCount * n)
  }

  return Math.round(Math.max(total, 0) * 100) / 100
}

/** @param {unknown} unit @returns {string} */
export function describeRateMode(unit) {
  const mode = normalizeRateMode(readOptionalField(unit, 'rate_mode'))
  if (mode === 'person') return `From ${Number(readOptionalField(unit, 'rate_per_person') || 0).toFixed(2)} / person / night`
  if (mode === 'tent') return `From ${Number(readOptionalField(unit, 'rate_per_tent') || 0).toFixed(2)} / tent / night`
  if (mode === 'vehicle') return `From ${Number(readOptionalField(unit, 'rate_per_vehicle') || 0).toFixed(2)} / vehicle / night`
  if (mode === 'composite') return 'Combined site pricing'
  return `${Number(readOptionalField(unit, 'rate_per_night') || 0).toFixed(2)} / night`
}

/** @param {unknown} value @returns {number | null} */
function readOptionalCountCap(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function readCountWithFallback(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.floor(parsed)
}

/**
 * Server-mirrored occupancy limits for one accommodation unit.
 * Mirrors `accommodation_booking_expected_total` / `create_campsite_booking`:
 * priced campsite/tent kinds enforce capacity_adults, capacity_children,
 * max_tents and max_vehicles only when set (null means uncapped server-side).
 * Room/unit kinds retain their generic max_occupancy fallback.
 * @param {unknown} unit @returns {{capacityAdults: number | null, capacityChildren: number | null, maxTents: number | null, maxVehicles: number | null, maxOccupancy: number, rateMode: string, kind: string}}
 */
export function getCampsiteOccupancyLimits(unit) {
  const priced = isCampsitePriced(unit)
  const capacityAdults = readOptionalCountCap(
    readOptionalField(unit, 'capacity_adults') ?? (priced ? undefined : readOptionalField(unit, 'max_occupancy'))
  )
  const capacityChildren = readOptionalCountCap(readOptionalField(unit, 'capacity_children'))
  const maxTents = readOptionalCountCap(readOptionalField(unit, 'max_tents'))
  const maxVehicles = readOptionalCountCap(readOptionalField(unit, 'max_vehicles'))
  const maxOccupancy = Math.max(
    1,
    readCountWithFallback(
      readOptionalField(unit, 'max_occupancy') ?? readOptionalField(unit, 'capacity_adults'),
      2
    )
  )
  return {
    capacityAdults,
    capacityChildren,
    maxTents,
    maxVehicles,
    maxOccupancy,
    rateMode: normalizeRateMode(readOptionalField(unit, 'rate_mode')),
    kind: normalizeAccommodationKind(readOptionalField(unit, 'accommodation_kind') ?? readOptionalField(unit, 'kind'))
  }
}

/**
 * Form defaults mirroring server minimums: at least one guest overall
 * (server rejects adults + children < 1), at least one tent for tent mode and
 * at least one vehicle for vehicle mode. Composite mode needs no tents or
 * vehicles unless the operator adds them.
 * @param {unknown} unit @returns {{adults: number, children: number, tents: number, vehicles: number}}
 */
export function getCampsiteOccupancyDefaults(unit) {
  const mode = normalizeRateMode(readOptionalField(unit, 'rate_mode'))
  return {
    adults: 1,
    children: 0,
    tents: mode === 'tent' ? 1 : 0,
    vehicles: mode === 'vehicle' ? 1 : 0
  }
}

/** @param {unknown} value @returns {boolean} */
function isWholeCount(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0
}

/**
 * Validate occupancy counts against server-mirrored rules before save.
 * Returns explicit, operator-actionable errors; an empty errors array means
 * the payload is safe to send to the authoritative RPC (which revalidates).
 * @param {unknown} unit @param {{adults?: unknown, children?: unknown, tents?: unknown, vehicles?: unknown}} [counts]
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateCampsiteOccupancy(unit, counts = {}) {
  const errors = []
  const { adults = null, children = 0, tents = 0, vehicles = 0 } = counts || {}
  const limits = getCampsiteOccupancyLimits(unit)

  for (const [label, value] of [['Adults', adults], ['Children', children], ['Tents', tents], ['Vehicles', vehicles]]) {
    if (!isWholeCount(value)) {
      errors.push(`${label} must be a whole number of 0 or more.`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const adultCount = Number(adults)
  const childCount = Number(children)
  const tentCount = Number(tents)
  const vehicleCount = Number(vehicles)

  if (adultCount + childCount < 1) {
    errors.push('At least one guest is required: set adults or children before saving.')
  }
  if (limits.capacityAdults !== null && adultCount > limits.capacityAdults) {
    errors.push(`Adults (${adultCount}) exceed this site's adult capacity (${limits.capacityAdults}).`)
  }
  if (limits.capacityChildren !== null && childCount > limits.capacityChildren) {
    errors.push(`Children (${childCount}) exceed this site's child capacity (${limits.capacityChildren}).`)
  }
  if (!isCampsitePriced(unit)
    && adultCount + childCount > limits.maxOccupancy
    && limits.capacityAdults === null
    && limits.capacityChildren === null) {
    errors.push(`Guests (${adultCount + childCount}) exceed maximum occupancy (${limits.maxOccupancy}).`)
  }
  if (isCampsitePriced(unit)) {
    if (limits.maxTents !== null && tentCount > limits.maxTents) {
      errors.push(`Tents (${tentCount}) exceed this site's tent limit (${limits.maxTents}).`)
    }
    if (limits.maxVehicles !== null && vehicleCount > limits.maxVehicles) {
      errors.push(`Vehicles (${vehicleCount}) exceed this site's vehicle limit (${limits.maxVehicles}).`)
    }
    if (limits.rateMode === 'tent' && tentCount < 1) {
      errors.push('At least one tent is required for per-tent pricing.')
    }
    if (limits.rateMode === 'vehicle' && vehicleCount < 1) {
      errors.push('At least one vehicle is required for per-vehicle pricing.')
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Restore saved occupancy when opening an existing booking for edit.
 * Reads both the live column names (tents/vehicles) and the stored booking
 * columns (tents_count/vehicles_count); saved values are never reset to zero.
 * @param {unknown} booking @returns {{adults: number, children: number, tents: number, vehicles: number}}
 */
export function restoreBookingOccupancy(booking) {
  if (!booking || typeof booking !== 'object') {
    return { adults: 1, children: 0, tents: 0, vehicles: 0 }
  }
  return {
    adults: readCountWithFallback(readOptionalField(booking, 'adults'), 1),
    children: readCountWithFallback(readOptionalField(booking, 'children'), 0),
    tents: readCountWithFallback(
      readOptionalField(booking, 'tents') ?? readOptionalField(booking, 'tents_count'),
      0
    ),
    vehicles: readCountWithFallback(
      readOptionalField(booking, 'vehicles') ?? readOptionalField(booking, 'vehicles_count'),
      0
    )
  }
}

/**
 * Build per-line group payloads for multi-unit stays.
 * Tents/vehicles travel only on campsite-priced lines (campsite + tent kinds;
 * room/unit lines always carry 0, mirroring the desktop domain which zeroes
 * them for non-priced units).
 * Field names match the domain readers (`line.tents`, `line.vehicles`,
 * `data.tents`, `data.vehicles`); the queue format is unchanged.
 * @param {unknown[]} [selectedRooms] @param {Record<string, {adults?: unknown, children?: unknown, tents?: unknown, vehicles?: unknown}>} [roomGuests] @param {{adults?: unknown, children?: unknown, tents?: unknown, vehicles?: unknown}} [fallback]
 * @returns {Array<{room_id: unknown, adults: number, children: number, tents: number, vehicles: number}>}
 */
export function buildGroupRoomLines(selectedRooms = [], roomGuests = {}, fallback = {}) {
  const rooms = Array.isArray(selectedRooms) ? selectedRooms : []
  const guests = roomGuests && typeof roomGuests === 'object' ? roomGuests : {}
  const fallbackCounts = fallback && typeof fallback === 'object' ? fallback : {}
  return rooms.map((room) => {
    const roomId = readOptionalField(room, 'id')
    const perRoom = room !== null && typeof room === 'object' ? guests[String(roomId)] : null
    const source = perRoom && typeof perRoom === 'object' ? perRoom : fallbackCounts
    // Priced-family lines (campsite AND tent kinds) carry tents/vehicles;
    // room/unit lines always carry 0, mirroring the desktop domain and the
    // server multi-room contract. Queue field names are unchanged.
    const priced = isCampsitePriced(room)
    return {
      room_id: roomId,
      adults: Math.max(1, readCountWithFallback(source.adults ?? fallbackCounts.adults, 1)),
      children: Math.max(0, readCountWithFallback(source.children ?? fallbackCounts.children, 0)),
      tents: priced ? Math.max(0, readCountWithFallback(source.tents ?? fallbackCounts.tents, 0)) : 0,
      vehicles: priced ? Math.max(0, readCountWithFallback(source.vehicles ?? fallbackCounts.vehicles, 0)) : 0
    }
  })
}

/**
 * Accommodation-family occupancy validator (R7 shared contract).
 *
 * Campsite-priced units (`isCampsitePriced`: campsite + tent kinds) enforce
 * the independent server-mirrored caps — capacity_adults, capacity_children,
 * max_tents, max_vehicles plus rate-mode minimums — with NO earlier generic
 * `max_occupancy` gate, so a valid 2-adult + 1-child stay passes when the
 * adult cap is 2, the child cap is 2 and max_occupancy is 2. Room/unit kinds
 * keep the existing generic `max_occupancy` gate.
 *
 * Used by BOTH renderer validation and main-domain pre-checks. The server
 * RPC remains authoritative; this never authors financial truth.
 * @param {unknown} unit @param {{adults?: unknown, children?: unknown, tents?: unknown, vehicles?: unknown}} [counts]
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAccommodationOccupancy(unit, counts = {}) {
  if (!isCampsitePriced(unit)) {
    const errors = []
    const adults = counts?.adults ?? null
    const children = counts?.children ?? 0
    if (!isWholeCount(adults) || !isWholeCount(children)) {
      errors.push('Adults and children must be whole numbers of 0 or more.')
      return { ok: false, errors }
    }
    const total = Number(adults) + Number(children)
    if (total < 1) {
      errors.push('At least one guest is required: set adults or children before saving.')
    }
    const limits = getCampsiteOccupancyLimits(unit)
    if (total > limits.maxOccupancy) {
      errors.push(`Guests (${total}) exceed maximum occupancy (${limits.maxOccupancy}).`)
    }
    return { ok: errors.length === 0, errors }
  }
  return validateCampsiteOccupancy(unit, counts)
}

/**
 * Fail-closed tripwire: client payloads must never author persisted financial
 * truth (`amount_paid`, `payment_status`, `total_amount`, `balance_due`).
 * Deposits (`deposit_amount`) are legitimate ledger intents and are allowed.
 * @param {unknown} payload @returns {string[]} offending keys present on the payload
 */
export function findFinancialAuthorshipKeys(payload) {
  if (!payload || typeof payload !== 'object') return []
  const forbidden = ['amount_paid', 'payment_status', 'total_amount', 'balance_due']
  return forbidden.filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
}
