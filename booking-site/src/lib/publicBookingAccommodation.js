import { computeStayTotal, isCampsitePriced, normalizeRateMode } from '../../../src/shared/accommodation.js'

/** @typedef {{id: string, capacity_adults?: number|string|null, capacity_children?: number|string|null, max_tents?: number|string|null, max_vehicles?: number|string|null, max_occupancy?: number|string|null, total_price?: number|string|null, rate_per_night?: number|string|null, room_type?: unknown, room_number?: unknown, rate_mode?: unknown, accommodation_kind?: unknown}} PublicAccommodationUnitExpectedData */
/** @typedef {{adults: number|string, children: number|string, tents: number|string, vehicles: number|string}} PublicAccommodationCountsExpectedData */
/** @typedef {{room_id: string, adults: number, children: number, tents: number, vehicles: number}} PublicAccommodationLine */
/** @typedef {{roomId: string, label: unknown, room_id: string, adults: number, children: number, tents: number, vehicles: number, total: number}} PublicAccommodationLineEstimate */

/** @param {unknown} value @param {string} label @param {string[]} errors @returns {number|null} */
function readCount(value, label, errors) {
  const raw = value === '' || value === null || value === undefined ? NaN : Number(value)
  if (!Number.isSafeInteger(raw) || raw < 0) {
    errors.push(`${label} must be a whole number of 0 or more.`)
    return null
  }
  return raw
}

/** @param {unknown} value @returns {number|null} */
function readOptionalCap(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0
  return parsed
}

/** @param {(number|null)[]} caps @returns {number|null} */
function sumCaps(caps) {
  return caps.some((cap) => cap === null)
    ? null
    : caps.reduce((sum, cap) => sum + cap, 0)
}

/** @param {PublicAccommodationUnitExpectedData} unit */
function unitCaps(unit) {
  if (isCampsitePriced(unit)) {
    // Mirror the public SQL contract: a NULL capacity column is uncapped;
    // the room-style max_occupancy gate does not apply to priced units.
    return {
      adults: readOptionalCap(unit?.capacity_adults),
      children: readOptionalCap(unit?.capacity_children),
      tents: readOptionalCap(unit?.max_tents),
      vehicles: readOptionalCap(unit?.max_vehicles),
      priced: true,
      rateMode: normalizeRateMode(unit?.rate_mode)
    }
  }
  const occupancy = readOptionalCap(unit?.max_occupancy) ?? 0
  return { adults: occupancy, children: occupancy, tents: 0, vehicles: 0, priced: false, rateMode: 'site' }
}

/** @param {number} total @param {(number|null)[]} caps @param {number[]} [minimums] @returns {number[]|null} */
function allocateCount(total, caps, minimums = []) {
  const minTotal = minimums.reduce((sum, value) => sum + value, 0)
  if (minimums.some((minimum, index) => caps[index] !== null && caps[index] < minimum)) return null
  const capTotal = sumCaps(caps)
  if (total < minTotal || (capTotal !== null && total > capTotal)) return null
  let remaining = total - minTotal
  const result = caps.map((cap, index) => {
    const minimum = minimums[index] || 0
    const available = cap === null ? remaining : Math.max(0, cap - minimum)
    const extra = Math.min(remaining, available)
    remaining -= extra
    return minimum + extra
  })
  return remaining === 0 ? result : null
}

/** @param {PublicAccommodationUnitExpectedData} unit @param {number} nights @returns {number} */
function estimateRoomTotal(unit, nights) {
  const supplied = unit?.total_price
  if (supplied !== null && supplied !== undefined && supplied !== '') {
    const amount = Number(supplied)
    return Number.isFinite(amount) ? amount : 0
  }
  return Math.max(0, Number(unit?.rate_per_night) || 0) * Math.max(1, Number(nights) || 1)
}

/**
 * Builds the public booking's exact per-unit occupancy lines and estimate.
 * Aggregate form counts are assigned in the selected-unit order, subject to
 * each server capacity. Adults have a minimum of one per public booking line,
 * matching the legacy RPC's `greatest(1, adults)` behavior. Counts that do not
 * fit are rejected instead of being dropped, duplicated or synthesized.
 *
 * Full-lodge bookings intentionally use one representative inventory row in
 * the current public RPC. The aggregate property price remains `exclusiveTotal`.
 */
/**
 * @param {unknown} units Route state and session values are not runtime-validated here.
 * @param {PublicAccommodationCountsExpectedData} form
 * @param {{nights?: number, fullLodge?: boolean, exclusiveTotal?: unknown}} [options]
 */
export function buildPublicAccommodationDraft(units, form, {
  nights = 1,
  fullLodge = false,
  exclusiveTotal = 0
} = {}) {
  // Existing array and id checks choose rows; this expected view does not validate their remaining fields.
  const selected = /** @type {PublicAccommodationUnitExpectedData[]} */ (
    Array.isArray(units) ? units.filter((unit) => unit?.id) : []
  )
  const allocationUnits = fullLodge ? selected.slice(0, 1) : selected
  /** @type {string[]} */
  const errors = []
  const adults = readCount(form?.adults, 'Adults', errors)
  const children = readCount(form?.children, 'Children', errors)
  const tents = readCount(form?.tents, 'Tents', errors)
  const vehicles = readCount(form?.vehicles, 'Vehicles', errors)
  if (!allocationUnits.length) errors.push('Select at least one accommodation unit.')

  const limits = allocationUnits.map(unitCaps)
  const adultCaps = limits.map((limit) => limit.adults)
  const minAdults = limits.map(() => 1)
  const pricedIndexes = limits.flatMap((limit, index) => limit.priced ? [index] : [])
  const roomIndexes = limits.flatMap((limit, index) => limit.priced ? [] : [index])
  let adultsPerUnit = null
  const everyLineCanMeetMinimumAdults = adultCaps.every((cap) => cap === null || cap >= 1)
  if (adults !== null && adults >= allocationUnits.length && everyLineCanMeetMinimumAdults) {
    // Every selected line is stored as a separate booking and the SQL legacy
    // path coerces each line to at least one adult. Put extras into priced
    // units first so room capacity remains available for child occupants.
    /** @type {number[]} */
    const assigned = Array(allocationUnits.length).fill(1)
    let remaining = adults - allocationUnits.length
    for (const index of [...pricedIndexes, ...roomIndexes]) {
      const cap = adultCaps[index]
      const available = cap === null ? remaining : Math.max(0, cap - 1)
      const extra = Math.min(remaining, available)
      assigned[index] += extra
      remaining -= extra
    }
    if (remaining === 0) adultsPerUnit = assigned
  }
  if (adults !== null && adultsPerUnit === null) {
    const minimum = allocationUnits.length
    const cap = sumCaps(adultCaps)
    errors.push(adults < minimum
      ? `Choose at least ${minimum} adult${minimum === 1 ? '' : 's'} so each selected unit has one.`
      : (cap === null ? 'Adults could not be assigned to the selected units.' : `Adults exceed the selected units' combined capacity of ${cap}.`))
  }

  const childCaps = limits.map((limit, index) => limit.priced
    ? limit.children
    : (adultsPerUnit ? Math.max(0, (limit.adults ?? 0) - adultsPerUnit[index]) : limit.adults))
  let childrenPerUnit = null
  if (children !== null) {
    const pricedChildCaps = pricedIndexes.map((index) => childCaps[index])
    const pricedChildCapacity = sumCaps(pricedChildCaps)
    const onPriced = pricedChildCapacity === null ? children : Math.min(children, pricedChildCapacity)
    const pricedAllocation = allocateCount(onPriced, pricedChildCaps)
    /** @type {number[]} */
    const assigned = Array(allocationUnits.length).fill(0)
    if (pricedAllocation) pricedIndexes.forEach((index, offset) => { assigned[index] = pricedAllocation[offset] })
    const remaining = children - onPriced
    const roomChildCaps = roomIndexes.map((index) => childCaps[index])
    const roomAllocation = allocateCount(remaining, roomChildCaps)
    if (pricedAllocation && roomAllocation) {
      roomIndexes.forEach((index, offset) => { assigned[index] = roomAllocation[offset] })
      childrenPerUnit = assigned
    }
  }
  if (children !== null && childrenPerUnit === null) {
    const cap = sumCaps(childCaps)
    errors.push(cap === null
      ? 'Children could not be assigned to the selected units.'
      : `Children exceed the selected units' remaining capacity of ${cap}.`)
  }

  const pricedLimits = pricedIndexes.map((index) => limits[index])
  const tentMinimums = pricedLimits.map((limit) => limit.rateMode === 'tent' ? 1 : 0)
  const vehicleMinimums = pricedLimits.map((limit) => limit.rateMode === 'vehicle' ? 1 : 0)
  if (!pricedIndexes.length && tents !== null && tents > 0) {
    errors.push('Tents can only be included with a campsite-priced unit. Change the tent count to 0 for this room-only stay.')
  }
  if (!pricedIndexes.length && vehicles !== null && vehicles > 0) {
    errors.push('Vehicles can only be included with a campsite-priced unit. Change the vehicle count to 0 for this room-only stay.')
  }
  const tentsPerPricedUnit = tents === null ? null : allocateCount(tents, pricedLimits.map((limit) => limit.tents), tentMinimums)
  if (tents !== null && tentsPerPricedUnit === null && pricedIndexes.length) {
    const cap = sumCaps(pricedLimits.map((limit) => limit.tents))
    const minimum = tentMinimums.reduce((sum, value) => sum + value, 0)
    errors.push(tents < minimum
      ? `Choose at least ${minimum} tents for the selected per-tent priced units.`
      : (cap === null ? 'Tents could not be assigned to the selected units.' : `Tents exceed the selected units' combined limit of ${cap}.`))
  }
  const vehiclesPerPricedUnit = vehicles === null ? null : allocateCount(vehicles, pricedLimits.map((limit) => limit.vehicles), vehicleMinimums)
  if (vehicles !== null && vehiclesPerPricedUnit === null && pricedIndexes.length) {
    const cap = sumCaps(pricedLimits.map((limit) => limit.vehicles))
    const minimum = vehicleMinimums.reduce((sum, value) => sum + value, 0)
    errors.push(vehicles < minimum
      ? `Choose at least ${minimum} vehicles for the selected per-vehicle priced units.`
      : (cap === null ? 'Vehicles could not be assigned to the selected units.' : `Vehicles exceed the selected units' combined limit of ${cap}.`))
  }

  /** @type {number[]} */
  const tentCounts = Array(allocationUnits.length).fill(0)
  /** @type {number[]} */
  const vehicleCounts = Array(allocationUnits.length).fill(0)
  pricedIndexes.forEach((unitIndex, index) => {
    if (tentsPerPricedUnit) tentCounts[unitIndex] = tentsPerPricedUnit[index]
    if (vehiclesPerPricedUnit) vehicleCounts[unitIndex] = vehiclesPerPricedUnit[index]
  })

  /** @type {PublicAccommodationLine[]} */
  const lines = allocationUnits.map((unit, index) => ({
    room_id: unit.id,
    adults: adultsPerUnit?.[index] ?? 0,
    children: childrenPerUnit?.[index] ?? 0,
    tents: tentCounts[index],
    vehicles: vehicleCounts[index]
  }))
  /** @type {PublicAccommodationLineEstimate[]} */
  const lineEstimates = allocationUnits.map((unit, index) => ({
    roomId: unit.id,
    label: unit?.room_type || unit?.room_number || 'Accommodation',
    ...lines[index],
    total: limits[index]?.priced
      ? computeStayTotal(unit, { nights, adults: lines[index].adults, children: lines[index].children, tents: lines[index].tents, vehicles: lines[index].vehicles })
      : estimateRoomTotal(unit, nights)
  }))
  const estimate = fullLodge
    ? (Number.isFinite(Number(exclusiveTotal)) ? Number(exclusiveTotal) : 0)
    : lineEstimates.reduce((sum, line) => sum + (Number(line.total) || 0), 0)

  const maxAdults = sumCaps(limits.map((limit, index) => limit.priced
    ? limit.adults
    : Math.max(0, (limit.adults ?? 0) - (childrenPerUnit?.[index] || 0))))
  const maxChildren = sumCaps(childCaps)
  const maxTents = sumCaps(pricedLimits.map((limit) => limit.tents))
  const maxVehicles = sumCaps(pricedLimits.map((limit) => limit.vehicles))
  const maxGuests = sumCaps(limits.map((limit, index) => limit.priced
    ? ((limit.adults === null || limit.children === null) ? null : limit.adults + limit.children)
    : limit.adults))

  return {
    lines,
    lineEstimates,
    errors: [...new Set(errors)],
    valid: errors.length === 0,
    estimate,
    limits: { adults: maxAdults, children: maxChildren, tents: maxTents, vehicles: maxVehicles, guests: maxGuests },
    totals: {
      adults: lines.reduce((sum, line) => sum + line.adults, 0),
      children: lines.reduce((sum, line) => sum + line.children, 0),
      tents: lines.reduce((sum, line) => sum + line.tents, 0),
      vehicles: lines.reduce((sum, line) => sum + line.vehicles, 0)
    }
  }
}
