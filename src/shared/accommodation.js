/**
 * Accommodation terminology and campsite helpers shared by desktop and web surfaces.
 */

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

export function normalizeAccommodationKind(value) {
  const raw = String(value || 'room').trim().toLowerCase()
  if (raw === 'campsite' || raw === 'site' || raw === 'camp site' || raw === 'pitch') return 'campsite'
  if (raw === 'tent') return 'tent'
  if (raw === 'unit' || raw === 'cabin' || raw === 'chalet') return 'unit'
  return 'room'
}

export function normalizeRateMode(value) {
  const raw = String(value || 'site').trim().toLowerCase()
  if (raw === 'person' || raw === 'per_person' || raw === 'per-person') return 'person'
  if (raw === 'tent' || raw === 'per_tent') return 'tent'
  if (raw === 'vehicle' || raw === 'per_vehicle') return 'vehicle'
  if (raw === 'composite' || raw === 'combined') return 'composite'
  return 'site'
}

export function isCampsiteUnit(unit) {
  return normalizeAccommodationKind(unit?.accommodation_kind || unit?.kind) === 'campsite'
}

export function getAccommodationKindLabel(kind) {
  return ACCOMMODATION_KIND_LABELS[normalizeAccommodationKind(kind)] || 'Room'
}

export function getAccommodationInventoryLabel(propertyType, { plural = true } = {}) {
  const type = String(propertyType || '').toLowerCase()
  if (type === 'camp') return plural ? 'Sites & Rooms' : 'Site / Room'
  return plural ? 'Rooms' : 'Room'
}

export function getAccommodationUnitLabel(unit, { plural = false } = {}) {
  const kind = normalizeAccommodationKind(unit?.accommodation_kind)
  if (kind === 'campsite') return plural ? 'Campsites' : 'Campsite'
  if (kind === 'tent') return plural ? 'Tents' : 'Tent'
  if (kind === 'unit') return plural ? 'Units' : 'Unit'
  return plural ? 'Rooms' : 'Room'
}

export function getUnitDisplayName(unit) {
  if (!unit) return ''
  const number = unit.room_number || unit.site_number || unit.number || ''
  const kind = getAccommodationKindLabel(unit.accommodation_kind)
  return number ? `${kind} ${number}` : kind
}

export function splitAccommodationInventory(units = []) {
  const list = Array.isArray(units) ? units : []
  const campsites = list.filter((u) => isCampsiteUnit(u))
  const rooms = list.filter((u) => !isCampsiteUnit(u))
  return { rooms, campsites }
}

export function computeStayTotal(unit, {
  nights = 1,
  adults = null,
  children = 0,
  tents = null,
  vehicles = null
} = {}) {
  const n = Math.max(Number(nights) || 1, 1)
  const mode = normalizeRateMode(unit?.rate_mode)
  const site = Math.max(Number(unit?.rate_per_night) || 0, 0)
  const person = Math.max(Number(unit?.rate_per_person) || 0, 0)
  const tentRate = Math.max(Number(unit?.rate_per_tent) || 0, 0)
  const vehicleRate = Math.max(Number(unit?.rate_per_vehicle) || 0, 0)

  let people = Math.max((Number(adults) || 0) + (Number(children) || 0), 0)
  let tentCount = Math.max(Number(tents) || 0, 0)
  let vehicleCount = Math.max(Number(vehicles) || 0, 0)

  if (people <= 0 && (mode === 'person' || mode === 'composite')) {
    people = Math.max(Number(unit?.capacity_adults || unit?.max_occupancy) || 2, 1)
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

export function describeRateMode(unit) {
  const mode = normalizeRateMode(unit?.rate_mode)
  if (mode === 'person') return `From ${Number(unit?.rate_per_person || 0).toFixed(2)} / person / night`
  if (mode === 'tent') return `From ${Number(unit?.rate_per_tent || 0).toFixed(2)} / tent / night`
  if (mode === 'vehicle') return `From ${Number(unit?.rate_per_vehicle || 0).toFixed(2)} / vehicle / night`
  if (mode === 'composite') return 'Combined site pricing'
  return `${Number(unit?.rate_per_night || 0).toFixed(2)} / night`
}
