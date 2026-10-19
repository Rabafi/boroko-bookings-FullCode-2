// @ts-check
/**
 * LodgingOS property presentation resolver (Experience workstream).
 *
 * Single shared source for property-type wording across the desktop shell.
 * It separates *business nouns* (Guest House, Camp, …) from *unit nouns*
 * (Room, Site, Stay unit, …) and derives accommodation labels from the actual
 * accommodation mix — never from profile flags alone.
 *
 * Precedence (presentation only — never grants access):
 *   1. explicit entitlements / configured services (can only ADD site/room
 *      visibility, never remove what the mix shows);
 *   2. determinate accommodation mix (explicit param, then operating profile);
 *   3. property-type profile defaults;
 *   4. legacy safe fallback: rooms-only.
 *
 * Profile flags tailor wording/summaries only. Server/catalog enforcement
 * (moduleCatalog, commercial entitlements, RPCs) remains authoritative.
 */
import { normalizePropertyType, PROPERTY_TYPE_DESCRIPTIONS } from './propertyTypes.js'
import { getUiVocabulary } from './uiVocabulary.js'
import { getAccommodationKindLabel, normalizeAccommodationKind } from './accommodation.js'

/** @typedef {'guest_house' | 'bnb' | 'lodge' | 'camp' | 'motel'} LodgingType */

/** Five supported LodgingOS property types. Contracts agent uses the same literal. */
/** @type {ReadonlyArray<LodgingType>} */
export const SUPPORTED_LODGING_PROPERTY_TYPES = Object.freeze([
  'guest_house',
  'bnb',
  'lodge',
  'camp',
  'motel'
])

/** Alias required by the cross-agent shared interface. */
export const SUPPORTED_LODGING_TYPES = SUPPORTED_LODGING_PROPERTY_TYPES

/** Short operator-facing business nouns (unit nouns stay separate). */
/** @type {Readonly<Record<LodgingType, string>>} */
export const LODGING_BUSINESS_LABELS = Object.freeze({
  guest_house: 'Guest House',
  bnb: 'Bed & Breakfast',
  lodge: 'Lodge',
  camp: 'Camp',
  motel: 'Motel'
})

/** @type {Readonly<Record<LodgingType, string>>} */
const LODGING_BUSINESS_PLURALS = Object.freeze({
  guest_house: 'Guest Houses',
  bnb: 'Bed & Breakfasts',
  lodge: 'Lodges',
  camp: 'Camps',
  motel: 'Motels'
})

/** @type {Readonly<Record<string, LodgingType>>} */
const RAW_ALIAS_TO_SUPPORTED = Object.freeze({
  guest_house: 'guest_house',
  guesthouse: 'guest_house',
  bnb: 'bnb',
  bed_and_breakfast: 'bnb',
  lodge: 'lodge',
  camp: 'camp',
  campsite: 'camp',
  camping: 'camp',
  'camp site': 'camp',
  motel: 'motel'
})

/**
 * Normalize to one of the five supported LodgingOS types, or null when the
 * value is not recognizably a LodgingOS type (hotel/resort/restaurant/bar/
 * pos_only/unknown all yield null — never silently coerced to 'lodge').
 * @param {unknown} value @returns {LodgingType | null}
 */
export function toSupportedLodgingType(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  const direct = RAW_ALIAS_TO_SUPPORTED[raw] || null
  if (direct) return direct
  // Fall back to the shared normalizer so future aliases keep working, but
  // only accept the result when the raw token already meant a supported type.
  const normalized = normalizePropertyType(value)
  if (SUPPORTED_LODGING_PROPERTY_TYPES.includes(/** @type {LodgingType} */ (normalized)) && raw === normalized) {
    // The preceding membership check narrows this normalizer result to the supported set.
    return /** @type {LodgingType} */ (normalized)
  }
  return null
}

/** @param {unknown} value @returns {boolean} */
export function isSupportedLodgingType(value) {
  return toSupportedLodgingType(value) !== null
}

/**
 * Same-product transition check: true only when BOTH endpoints are among the
 * five supported LodgingOS types. Anything involving hotel/resort/
 * restaurant/bar/pos_only (or unknown) is false.
 * @param {unknown} from @param {unknown} to @returns {boolean}
 */
export function isSameProductTransition(from, to) {
  return toSupportedLodgingType(from) !== null && toSupportedLodgingType(to) !== null
}

/** @param {unknown} propertyType @returns {string} */
export function getLodgingBusinessLabel(propertyType) {
  const supported = toSupportedLodgingType(propertyType)
  if (supported) return LODGING_BUSINESS_LABELS[supported]
  return 'Property'
}

/** Selectable same-product targets for the Settings journey (no duplicates). */
export function getLodgingTypeOptions() {
  return SUPPORTED_LODGING_PROPERTY_TYPES.map((value) => ({
    value,
    label: LODGING_BUSINESS_LABELS[value],
    plural: LODGING_BUSINESS_PLURALS[value],
    description: PROPERTY_TYPE_DESCRIPTIONS[value] || LODGING_BUSINESS_LABELS[value]
  }))
}

/**
 * Read site/room presence from the many mix shapes in the wild:
 * arrays of units, {rooms_or_units, campsites}, {rooms, campsites} counts,
 * {has_rooms, has_sites}, or a campsite_profile {enabled}.
 * Returns nulls when nothing determinate was provided.
 * @param {unknown} mix
 * @returns {{hasRooms: boolean | null, hasSites: boolean | null}}
 */
function readMixFlags(mix) {
  if (Array.isArray(mix)) {
    if (mix.length === 0) return { hasRooms: null, hasSites: null }
    let rooms = false
    let sites = false
    for (const unit of mix) {
      if (unit === null || typeof unit !== 'object') continue
      const kind = normalizeAccommodationKind(
        /** @type {Record<string, unknown>} */ (unit).accommodation_kind
        ?? /** @type {Record<string, unknown>} */ (unit).kind
      )
      if (kind === 'campsite') sites = true
      else rooms = true
    }
    // A unit list is determinate: absence of a side means that side is empty.
    return { hasRooms: rooms, hasSites: sites }
  }
  if (mix === null || typeof mix !== 'object') return { hasRooms: null, hasSites: null }
  const fields = /** @type {Record<string, unknown>} */ (mix)
  const bool = (/** @type {unknown} */ value) => {
    if (value === true) return true
    if (value === false) return false
    return null
  }
  // Count shapes: { rooms: n, campsites: n } / { room_count, site_count }
  const countOf = (/** @type {unknown} */ value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    return null
  }
  const roomCount = countOf(fields.rooms) ?? countOf(fields.room_count) ?? countOf(fields.units)
  const siteCount = countOf(fields.campsites) ?? countOf(fields.site_count) ?? countOf(fields.sites)
  if (roomCount !== null || siteCount !== null) {
    return {
      hasRooms: roomCount !== null ? roomCount > 0 : null,
      hasSites: siteCount !== null ? siteCount > 0 : null
    }
  }
  const rooms = bool(fields.rooms_or_units)
    ?? bool(fields.has_rooms)
    ?? bool(fields.rooms)
    ?? bool(fields.units)
  const sites = bool(fields.campsites)
    ?? bool(fields.has_sites)
    ?? bool(fields.sites)
    ?? bool(fields.enabled)
  return { hasRooms: rooms, hasSites: sites }
}

/** @param {unknown} profile @returns {{hasRooms: boolean | null, hasSites: boolean | null}} */
function readProfileMix(profile) {
  if (profile === null || typeof profile !== 'object') return { hasRooms: null, hasSites: null }
  const fields = /** @type {Record<string, unknown>} */ (profile)
  const fromMix = readMixFlags(fields.accommodation_mix)
  const fromCamp = readMixFlags(fields.campsite_profile)
  return {
    hasRooms: fromMix.hasRooms,
    // A campsite profile only ever asserts site presence, never room absence.
    hasSites: fromMix.hasSites ?? fromCamp.hasSites
  }
}

/**
 * Explicit entitlements / configured services. May only ADD presentation
 * visibility (e.g. a lodge that just enabled campsite services shows site
 * wording); never removes what the mix already shows, never grants access.
 * @param {unknown} entitled
 * @returns {{addRooms: boolean, addSites: boolean}}
 */
function readExplicitServiceHints(entitled) {
  const keys = new Set()
  const collect = (/** @type {unknown} */ value) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') keys.add(entry.trim().toLowerCase())
        else if (entry !== null && typeof entry === 'object') {
          const record = /** @type {Record<string, unknown>} */ (entry)
          for (const candidate of [record.key, record.moduleKey, record.module_key, record.feature]) {
            if (typeof candidate === 'string') keys.add(candidate.trim().toLowerCase())
          }
        }
      }
    } else if (value !== null && typeof value === 'object') {
      for (const [key, flag] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        if (flag === true) keys.add(key.trim().toLowerCase())
      }
    } else if (typeof value === 'string' && value.trim()) {
      keys.add(value.trim().toLowerCase())
    }
  }
  collect(entitled)
  /** @type {(...names: string[]) => boolean} */
  const has = (...names) => names.some((name) => keys.has(name))
  return {
    addSites: has('campsites', 'campsite', 'sites', 'site', 'camp_sites'),
    addRooms: has('rooms', 'room', 'units', 'accommodation')
  }
}

/**
 * @param {unknown} input
 * @returns {{type: LodgingType, businessLabel: string, unitNoun: string, unitNounPlural: string, inventoryLabel: string, inventoryLabelSingular: string, exclusiveUseLabel: string, housekeepingLabel: string, housekeepingDetail: string, navHints: {showSites: boolean, showRooms: boolean, roomsLabel: string, boardLabel: string, boardTitle: string, extraKeywords: string[]}, dashboardHints: {summaryStyle: LodgingType, occupancyDetail: string, firstUnitTitle: string, firstUnitCopy: string, firstUnitAction: string}, mix: {hasRooms: boolean, hasSites: boolean, kind: string, source: string}, notes: string[]}}
 */
export function getPropertyPresentation(input = {}) {
  const fields = (input !== null && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {})
  const rawType = fields.propertyType ?? fields.type ?? null
  const supported = toSupportedLodgingType(rawType)
  // Unknown/legacy product types keep a safe rooms fallback; never throw for
  // stale or offline cache reads.
  /** @type {LodgingType} */
  const type = supported || 'lodge'
  const knownType = supported !== null
  const businessLabel = supported ? LODGING_BUSINESS_LABELS[supported] : getLodgingBusinessLabel(rawType)

  const operatingProfile = fields.operatingProfile ?? fields.profile ?? null
  const explicitMix = readMixFlags(fields.accommodationMix ?? fields.mix ?? null)
  const profileMix = readProfileMix(operatingProfile)
  const serviceHints = readExplicitServiceHints(
    fields.entitledModules ?? fields.configuredServices ?? fields.services ?? null
  )

  const notes = []
  let hasRooms = null
  let hasSites = null
  let source = 'fallback'
  if (explicitMix.hasRooms !== null || explicitMix.hasSites !== null) {
    hasRooms = explicitMix.hasRooms
    hasSites = explicitMix.hasSites
    source = 'explicit'
  } else if (profileMix.hasRooms !== null || profileMix.hasSites !== null) {
    hasRooms = profileMix.hasRooms
    hasSites = profileMix.hasSites
    source = 'profile'
    notes.push('Accommodation wording follows the saved accommodation mix.')
  } else {
    // Profile defaults by type (camp operates mixed sites + rooms/units).
    hasRooms = true
    hasSites = type === 'camp'
    source = type === 'camp' ? 'defaults' : 'fallback'
    if (type !== 'camp') notes.push('No accommodation mix on record; showing room wording until inventory is known.')
  }
  // Explicit entitlements/configured services take precedence by ADDING
  // visibility; they never hide what the mix already shows.
  if (serviceHints.addSites && hasSites !== true) {
    hasSites = true
    source = 'explicit'
    notes.push('Configured services include sites; site wording is shown alongside inventory.')
  }
  if (serviceHints.addRooms && hasRooms !== true) {
    hasRooms = true
    if (source === 'fallback') source = 'explicit'
  }
  // Partial data (e.g. only campsites:false) still needs the safe side.
  if (hasRooms === null) hasRooms = true
  if (hasSites === null) hasSites = false

  const kind = hasRooms && hasSites ? 'mixed' : (hasSites ? 'sites' : 'rooms')
  const unitNoun = kind === 'sites' ? 'Site' : (kind === 'mixed' ? 'Stay unit' : 'Room')
  const unitNounPlural = kind === 'sites' ? 'Sites' : (kind === 'mixed' ? 'Stay units' : 'Rooms')
  const inventoryLabel = kind === 'sites' ? 'Sites' : (kind === 'mixed' ? 'Sites & Units' : 'Rooms')
  const inventoryLabelSingular = kind === 'sites' ? 'Site' : (kind === 'mixed' ? 'Site / Unit' : 'Room')

  let exclusiveUseLabel = 'Full Lodge'
  try {
    const vocab = getUiVocabulary({ productId: 'lodge-camp', propertyType: type })
    if (vocab && typeof vocab.fullPropertyLabel === 'string' && vocab.fullPropertyLabel.trim()) {
      exclusiveUseLabel = vocab.fullPropertyLabel
    }
  } catch {
    // Vocabulary must never break presentation for stale/offline callers.
    notes.push('Property wording fell back to lodge defaults.')
  }

  const housekeepingLabel = 'Housekeeping'
  const housekeepingDetail = kind === 'sites'
    ? 'Site and facility readiness, tracked per site.'
    : (kind === 'mixed'
      ? 'Readiness follows actual inventory: rooms, cabins, tents and sites each keep their own tasks.'
      : 'Room cleaning and turnover.')

  const boardLabel = kind === 'sites' ? 'Site Board' : (kind === 'mixed' ? 'Stay Board' : 'Room Board')
  const extraKeywords = []
  if (hasSites) extraKeywords.push('site', 'sites', 'campsite', 'campsites', 'pitch', 'tent', 'camp')
  if (hasRooms) extraKeywords.push('room', 'rooms', 'unit', 'cabin', 'chalet')

  const summaryStyle = supported || 'lodge'
  const occupancyDetail = kind === 'sites'
    ? 'Sites occupied today'
    : (kind === 'mixed' ? 'Stay units occupied today' : 'Rooms occupied today')
  const firstUnitTitle = kind === 'sites'
    ? 'Add your first site'
    : (kind === 'mixed' ? 'Add your first stay unit' : 'Add your first room')
  const firstUnitCopy = kind === 'sites'
    ? 'Create the site list before bookings, readiness, and availability can work properly.'
    : (kind === 'mixed'
      ? 'Create the site and unit list before bookings, readiness, and availability can work properly.'
      : 'Create the room list before bookings, housekeeping, and availability can work properly.')
  const firstUnitAction = kind === 'sites'
    ? 'Add sites'
    : (kind === 'mixed' ? 'Add units' : 'Add rooms')

  if (!knownType) notes.push('Unknown property type; presentation uses safe room wording without changing stored data.')

  return {
    type,
    businessLabel,
    unitNoun,
    unitNounPlural,
    inventoryLabel,
    inventoryLabelSingular,
    exclusiveUseLabel,
    housekeepingLabel,
    housekeepingDetail,
    navHints: {
      showSites: hasSites,
      showRooms: hasRooms,
      roomsLabel: inventoryLabel,
      boardLabel,
      boardTitle: `Live ${boardLabel}`,
      extraKeywords
    },
    dashboardHints: {
      summaryStyle,
      occupancyDetail,
      firstUnitTitle,
      firstUnitCopy,
      firstUnitAction
    },
    mix: { hasRooms, hasSites, kind, source },
    notes
  }
}

/**
 * Human one-line accommodation mix summary for the Settings journey.
 * @param {unknown} mixInput @param {unknown} [operatingProfile]
 * @returns {string}
 */
export function summarizeAccommodationMix(mixInput, operatingProfile = null) {
  const fromExplicit = readMixFlags(mixInput)
  const fromProfile = readProfileMix(operatingProfile)
  const hasRooms = fromExplicit.hasRooms ?? fromProfile.hasRooms
  const hasSites = fromExplicit.hasSites ?? fromProfile.hasSites
  if (hasRooms === true && hasSites === true) return 'Mixed: rooms/units and sites'
  if (hasSites === true && hasRooms !== true) return 'Sites only'
  if (hasRooms === true && hasSites !== true) return 'Rooms/units only'
  if (hasRooms === false && hasSites === false) return 'No inventory recorded yet'
  return 'Inventory mix not recorded yet (room wording in use)'
}

/**
 * Per-row unit display name that keeps business nouns separate from unit
 * nouns: a camp row can be a Room, Unit / Cabin, Permanent tent or Campsite.
 * Delegates to accommodation.js so no second mapping table exists here.
 * @param {Record<string, unknown> | null | undefined} unit
 * @returns {string}
 */
export function getPresentationUnitName(unit) {
  if (!unit) return ''
  const number = unit.room_number || unit.site_number || unit.number || ''
  // Single label table lives in accommodation.js — never duplicated here.
  const kindLabel = getAccommodationKindLabel(unit.accommodation_kind ?? unit.kind)
  return number ? `${kindLabel} ${number}` : String(kindLabel)
}

/**
 * Advisory local wording diff used only when the server preview API is
 * unavailable. Never a substitute for server blockers.
 * @param {unknown} currentType @param {unknown} targetType
 * @returns {string[]}
 */
export function describePresentationDiff(currentType, targetType) {
  const current = getPropertyPresentation({ propertyType: toSupportedLodgingType(currentType) || 'lodge' })
  const target = getPropertyPresentation({ propertyType: toSupportedLodgingType(targetType) || 'lodge' })
  const diff = []
  if (current.businessLabel !== target.businessLabel) {
    diff.push(`Business wording: ${current.businessLabel} → ${target.businessLabel}.`)
  }
  if (current.inventoryLabel !== target.inventoryLabel) {
    diff.push(`Inventory label: ${current.inventoryLabel} → ${target.inventoryLabel}.`)
  }
  if (current.navHints.boardLabel !== target.navHints.boardLabel) {
    diff.push(`Board label: ${current.navHints.boardLabel} → ${target.navHints.boardLabel}.`)
  }
  if (current.exclusiveUseLabel !== target.exclusiveUseLabel) {
    diff.push(`Exclusive-use wording: ${current.exclusiveUseLabel} → ${target.exclusiveUseLabel}.`)
  }
  if (diff.length === 0) diff.push('Wording and navigation stay the same; only the stored property type changes.')
  return diff
}

/**
 * Map a property-type transition failure to an actionable operator message.
 * Never invents success; unknown failures stay explicit and retry-safe.
 * @param {unknown} error
 * @returns {{kind: string, message: string, retryable: boolean}}
 */
export function mapPropertyTransitionError(error) {
  const code = String(
    (error !== null && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error).code : null)
    ?? (error !== null && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error).error_code : null)
    ?? ''
  ).trim().toLowerCase()
  const text = String(
    (error !== null && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error).message : null)
    ?? (error !== null && typeof error === 'object' ? /** @type {Record<string, unknown>} */ (error).error : null)
    ?? error ?? ''
  )
  const haystack = `${code} ${text}`.toLowerCase()
  /** @type {(...needles: string[]) => boolean} */
  const match = (...needles) => needles.some((needle) => haystack.includes(needle))
  // Exact server/main-process codes first (see propertyTransitions domain +
  // property_type_transitions migration); message substrings as fallback.
  if (['property_transition_offline'].includes(code) || match('offline', 'network', 'enotfound', 'econnrefused', 'failed to fetch', 'no internet', 'internet connection', 'not connected')) {
    return { kind: 'offline', message: 'You appear to be offline. Reconnect, then use “Check outcome” before retrying — the change is online-only and is never queued locally.', retryable: true }
  }
  if (['capability_denied', 'lodge_scope_denied', 'unauthenticated'].includes(code)
    || match('denied', 'forbidden', 'not authorized', 'not authorised', 'permission', 'capability', 'unauthorized', 'unauthorised', 'admin only', 'administrator', 'sign in again', 'access denied')) {
    return { kind: 'denied', message: 'You do not have permission to change the property type for this lodge. Ask an administrator with property-settings capability to do this.', retryable: false }
  }
  if (['expected_state_conflict', 'stale_preview'].includes(code)
    || match('stale', 'version_mismatch', 'expected_updated_at', 'expected_property_type', 'concurrent', 'modified by', 'changed since', 'out of date', 'reload', 'changed since the preview')) {
    return { kind: 'stale', message: 'Settings changed since this preview was made. Reload settings to get a fresh preview, then confirm again.', retryable: true }
  }
  if (['setup_incomplete', 'settings_missing'].includes(code)
    || match('blocker', 'incompatible', 'has_blockers', 'booked inventory', 'active booking', 'pending operation', 'repair path', 'resolve first', 'setup is not complete', 'complete setup')) {
    return { kind: 'blocker', message: text || 'This change is blocked by existing inventory, bookings, or configuration. Follow the listed repair steps, then preview again.', retryable: false }
  }
  if (['idempotency_key_reuse_mismatch', 'invalid_idempotency_key', 'validation_failed', 'property_transition_key_required'].includes(code)
    || match('idempotency_mismatch', 'idempotency key', 'mismatched key', 'payload mismatch', 'key reuse', 'must be a uuid')) {
    return { kind: 'conflict', message: 'That retry used a different payload with an existing operation key. Use “Check outcome” with the original key instead of starting a new change.', retryable: false }
  }
  if (['cross_product_rejected'].includes(code)) {
    return { kind: 'conflict', message: 'Property type changes stay inside LodgingOS (guest house, B&B, lodge, camp, motel). Hotel, resort, restaurant, bar and POS-only belong to other products.', retryable: false }
  }
  if (['not_found'].includes(code) || match('no property-type transition is recorded', 'no transition is recorded')) {
    return { kind: 'unknown', message: text || 'No property-type transition is recorded for that key on this lodge. It is safe to commit with it.', retryable: true }
  }
  if (match('conflict', '409', 'already in progress', 'another transition')) {
    return { kind: 'conflict', message: text || 'Another property-type change is already in progress. Use “Check outcome” before starting a new one.', retryable: true }
  }
  if (match('timeout', 'timed out', 'ambiguous', 'uncertain', 'unknown outcome')) {
    return { kind: 'timeout', message: 'The change may or may not have been saved. Do not start a new change — use “Check outcome” with the same operation key first.', retryable: true }
  }
  if (match('unavailable', 'not implemented', 'no preview', 'missing rpc', 'is not a function')) {
    return { kind: 'unavailable', message: 'The server transition service is not available in this build. Update the desktop app (and database, if prompted) before changing property type.', retryable: false }
  }
  return { kind: 'unknown', message: text || 'The property type could not be changed. Use “Check outcome” before retrying.', retryable: true }
}
