export const PROPERTY_TYPES = {
  guest_house: 'guest_house',
  bnb: 'bnb',
  lodge: 'lodge',
  camp: 'camp',
  motel: 'motel',
  hotel: 'hotel',
  resort: 'resort',
  restaurant: 'restaurant',
  apartment_hotel: 'apartment_hotel',
  hostel: 'hostel',
  serviced_apartments: 'serviced_apartments'
}

export const PROPERTY_TYPE_ORDER = [
  'guest_house',
  'bnb',
  'lodge',
  'camp',
  'motel',
  'hotel',
  'resort',
  'restaurant'
]

export const PROPERTY_TYPE_LABELS = {
  guest_house: 'Guest House',
  bnb: 'Bed & Breakfast',
  lodge: 'Lodge',
  camp: 'Camp / Campsite',
  motel: 'Motel',
  hotel: 'Hotel',
  resort: 'Resort',
  restaurant: 'Restaurant / POS Only',
  apartment_hotel: 'Apartment Hotel',
  hostel: 'Hostel',
  serviced_apartments: 'Serviced Apartments'
}

export const PROPERTY_TYPE_DESCRIPTIONS = {
  guest_house: 'Simple accommodation with a few rooms',
  bnb: 'Accommodation with breakfast service',
  lodge: 'Nature or safari lodge with rooms or units',
  camp: 'Camp with campsites, tented stays, and optional rooms',
  motel: 'Drive-up room accommodation',
  hotel: 'Full-service hotel operations',
  resort: 'Multi-outlet resort operations',
  restaurant: 'Food and beverage focused operation'
}

export const PROPERTY_TYPE_DEFAULTS = {
  guest_house: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'supplies'],
    operation_style: 'simple'
  },
  bnb: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'supplies'],
    operation_style: 'simple'
  },
  lodge: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'day_use', 'events'],
    operation_style: 'managed'
  },
  camp: {
    modules: ['bookings', 'rooms', 'campsites', 'guests', 'invoices', 'housekeeping', 'maintenance', 'day_use', 'events'],
    operation_style: 'managed'
  },
  motel: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'front_desk_dashboard'],
    operation_style: 'commercial'
  },
  hotel: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'front_desk_dashboard', 'folios', 'hotel_kpis', 'pos', 'corporate_accounts', 'rate_plans'],
    operation_style: 'hotel'
  },
  resort: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'front_desk_dashboard', 'folios', 'hotel_kpis', 'pos', 'corporate_accounts', 'rate_plans', 'day_use', 'events', 'multi_outlet'],
    operation_style: 'hotel'
  },
  restaurant: {
    modules: ['pos', 'inventory', 'outlets', 'cash_up', 'staff', 'expenses', 'reports'],
    operation_style: 'commercial'
  }
}

export const OPERATION_STYLES = {
  simple: 'simple',
  managed: 'managed',
  commercial: 'commercial',
  hotel: 'hotel',
  group: 'group'
}

export const OPERATION_STYLE_LABELS = {
  simple: 'Simple',
  managed: 'Managed',
  commercial: 'Commercial',
  hotel: 'Hotel',
  group: 'Group'
}

export function normalizePropertyType(propertyType) {
  const raw = String(propertyType || '').trim().toLowerCase()
  // Keep camp as a first-class property type so campsite inventory and terminology work.
  if (PROPERTY_TYPES[raw]) return raw
  if (raw === 'lodge') return 'lodge'
  if (raw === 'camp' || raw === 'campsite' || raw === 'camping') return 'camp'
  if (raw === 'guesthouse' || raw === 'guest_house') return 'guest_house'
  if (raw === 'bed_and_breakfast' || raw === 'bnb') return 'bnb'
  if (raw === 'motel') return 'motel'
  if (raw === 'hotel') return 'hotel'
  if (raw === 'resort') return 'resort'
  if (raw === 'restaurant' || raw === 'pos_only') return 'restaurant'
  return 'lodge'
}

export function getPropertyTypeLabel(propertyType) {
  return PROPERTY_TYPE_LABELS[normalizePropertyType(propertyType)] || 'Lodge'
}

export function getPropertyTypeDefaults(propertyType) {
  return PROPERTY_TYPE_DEFAULTS[normalizePropertyType(propertyType)] || PROPERTY_TYPE_DEFAULTS.lodge
}

export function isHotelPropertyType(propertyType) {
  const normalized = normalizePropertyType(propertyType)
  return ['motel', 'hotel', 'resort'].includes(normalized)
}

export function isResortPropertyType(propertyType) {
  const normalized = normalizePropertyType(propertyType)
  return normalized === 'resort'
}

export function isRestaurantOnly(propertyType) {
  return normalizePropertyType(propertyType) === 'restaurant'
}

export function isCampPropertyType(propertyType) {
  return normalizePropertyType(propertyType) === 'camp'
}

export function supportsCampsites(propertyType, operatingProfile = null) {
  if (isCampPropertyType(propertyType)) return true
  const mix = operatingProfile?.accommodation_mix || operatingProfile?.campsite_profile
  if (mix?.campsites === true || mix?.enabled === true) return true
  return false
}

export const HOSPITALITY_MODES = Object.freeze({
  RESTAURANT_BAR: 'restaurant_bar',
  BAR_ONLY: 'bar_only'
})

export function normalizeHospitalityMode(value) {
  const raw = String(value || '').trim().toLowerCase()
  return raw === HOSPITALITY_MODES.BAR_ONLY ? HOSPITALITY_MODES.BAR_ONLY : HOSPITALITY_MODES.RESTAURANT_BAR
}

export function getHospitalityMode(settingsOrProfile) {
  const root = settingsOrProfile && typeof settingsOrProfile === 'object' ? settingsOrProfile : {}
  let nested = root.operating_profile
  if (typeof nested === 'string') {
    try { nested = JSON.parse(nested) } catch { nested = {} }
  }
  const source = nested && typeof nested === 'object' ? nested : {}
  const packageKey = String(root.commercial_package_key || root.package_key || source.commercial_package_key || '').trim().toLowerCase()
  if (packageKey === 'bar_pos') return HOSPITALITY_MODES.BAR_ONLY
  const explicit = source.hospitality_mode || root.hospitality_mode || root.operating_mode
  return explicit ? normalizeHospitalityMode(explicit) : HOSPITALITY_MODES.RESTAURANT_BAR
}

export function isBarOnlyMode(settingsOrProfile) {
  return getHospitalityMode(settingsOrProfile) === HOSPITALITY_MODES.BAR_ONLY
}

/**
 * Explicit hospitality_mode already stored on a company (not the default fallback).
 * Once set, restaurant_bar vs bar_only is a priced product choice and must not be
 * operator-switchable in Settings or later profile edits.
 */
export function getExplicitHospitalityMode(settingsOrProfile) {
  const root = settingsOrProfile && typeof settingsOrProfile === 'object' ? settingsOrProfile : {}
  let source = root.operating_profile || root
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = {} }
  }
  const raw = source.hospitality_mode || root.hospitality_mode || root.operating_mode
  if (raw == null || String(raw).trim() === '') return null
  return normalizeHospitalityMode(raw)
}

/**
 * Merge operating_profile patches while locking hospitality_mode after first set.
 * First write may set the mode; subsequent writes always keep the existing mode.
 */
export function mergeOperatingProfileWithLockedHospitalityMode(nextProfile = {}, existingProfile = {}) {
  const next = nextProfile && typeof nextProfile === 'object' ? { ...nextProfile } : {}
  const existing = existingProfile && typeof existingProfile === 'object' ? existingProfile : {}
  const locked = getExplicitHospitalityMode(existing)
  const merged = { ...existing, ...next }
  if (locked) {
    merged.hospitality_mode = locked
  } else if (next.hospitality_mode != null && String(next.hospitality_mode).trim() !== '') {
    merged.hospitality_mode = normalizeHospitalityMode(next.hospitality_mode)
  }
  return merged
}

/**
 * Resolve property_type for settings save.
 * Product family is chosen by app + setup (Lodge / Hotel / POS). After setup is
 * complete, Settings must not reclassify the business (e.g. lodge → hotel).
 * First bootstrap / incomplete setup may still set the type from the payload.
 */
export function resolveLockedPropertyType(incomingSettings = {}, existingSettings = {}) {
  const existingRaw = existingSettings?.property_type || existingSettings?.business_type || ''
  const incomingRaw = incomingSettings?.property_type || incomingSettings?.business_type || ''
  const existing = existingRaw ? normalizePropertyType(existingRaw) : null
  const incoming = incomingRaw ? normalizePropertyType(incomingRaw) : null
  const setupComplete = existingSettings?.setup_complete === true

  if (setupComplete && existing) return existing
  return incoming || existing || 'lodge'
}

export function getRelevantModules(propertyType, subscriptionPlan) {
  const defaults = getPropertyTypeDefaults(propertyType)
  const baseModules = defaults.modules || []
  
  const planModules = {
    Starter: [],
    Standard: ['reports', 'expenses', 'staff', 'audit', 'conference', 'pool', 'import'],
    Pro: ['pos', 'inventory', 'supplies', 'pwa', 'online_booking'],
    Enterprise: [
      'hotel_mode', 'room_types', 'physical_inventory', 'floors_sections', 'room_attributes',
      'front_desk_dashboard', 'folios', 'advanced_housekeeping', 'housekeeping_command_center',
      'maintenance_enterprise', 'hotel_kpis', 'corporate_accounts', 'rate_plans', 'room_moves',
      'checkin_workflow', 'early_late_checkout', 'cancellation_policies', 'night_audit_enterprise',
      'documents', 'hotel_roles', 'subscription_builder'
    ]
  }
  
  const planAdditions = planModules[subscriptionPlan] || []
  return [...new Set([...baseModules, ...planAdditions])]
}

export function getHiddenModules(propertyType, subscriptionPlan) {
  const hidden = []
  
  if (!isHotelPropertyType(propertyType)) {
    hidden.push('hotel_mode', 'room_types', 'physical_inventory', 'floors_sections', 'front_desk_dashboard', 'hotel_kpis')
  }
  
  if (isRestaurantOnly(propertyType)) {
    hidden.push('bookings', 'rooms', 'guests', 'housekeeping', 'maintenance')
  }
  
  if (subscriptionPlan === 'Starter') {
    hidden.push('reports', 'expenses', 'staff', 'audit', 'conference', 'pool', 'import')
  }
  
  return [...new Set(hidden)]
}

export function propertyTypeToBusinessType(propertyType) {
  const normalized = normalizePropertyType(propertyType)
  if (normalized === 'restaurant') return 'restaurant'
  return 'lodge'
}

const CAPACITY_LIMITS_DEFAULTS = {
  hotel:      { rooms: 50,  users: 10, monthlyBookings: 500, posOutlets: 5,  properties: 3 },
  resort:     { rooms: 80,  users: 10, monthlyBookings: 800, posOutlets: 8,  properties: 3 },
  motel:      { rooms: 30,  users: 10, monthlyBookings: 200, posOutlets: 2,  properties: 1 },
  lodge:      { rooms: 20,  users: 10, monthlyBookings: 150, posOutlets: 2,  properties: 3 },
  camp:       { rooms: 15,  users: 10, monthlyBookings: 100, posOutlets: 1,  properties: 1 },
  bnb:        { rooms: 6,   users: 10, monthlyBookings: 40,  posOutlets: 0,  properties: 1 },
  guest_house: { rooms: 10, users: 10, monthlyBookings: 80,  posOutlets: 1,  properties: 1 },
  restaurant:  { rooms: 0,  users: 10, monthlyBookings: 0,   posOutlets: 3,  properties: 1 },
}

export function buildOperatingProfile(propertyType, subscriptionPlan = 'Starter', enterpriseAddons = [], options = {}) {
  const normalized = normalizePropertyType(propertyType)
  const defaults = getPropertyTypeDefaults(normalized)
  const relevantModules = getRelevantModules(normalized, subscriptionPlan)
  const hiddenModules = getHiddenModules(normalized, subscriptionPlan)
  const enabledModules = relevantModules.filter(m => !hiddenModules.includes(m))
  const campsitesEnabled = options.campsitesEnabled === true || normalized === 'camp'
  const hospitalityMode = options.hospitalityMode != null
    ? normalizeHospitalityMode(options.hospitalityMode)
    : (options.hospitality_mode != null ? normalizeHospitalityMode(options.hospitality_mode) : null)

  return {
    property_type: normalized,
    operation_style: defaults.operation_style || 'managed',
    enabled_modules: enabledModules,
    relevant_modules: relevantModules,
    hidden_modules: hiddenModules,
    subscription_plan: subscriptionPlan,
    enterprise_addons: enterpriseAddons,
    ...(hospitalityMode ? { hospitality_mode: hospitalityMode } : {}),
    accommodation_mix: {
      rooms_or_units: options.roomsOrUnits !== false,
      campsites: campsitesEnabled,
      whole_property_exclusive_use: options.wholeProperty === true
    },
    campsite_profile: {
      enabled: campsitesEnabled,
      has_numbered_sites: campsitesEnabled,
      has_powered_sites: campsitesEnabled,
      has_unpowered_sites: campsitesEnabled,
      supports_per_person_pricing: campsitesEnabled,
      supports_per_site_pricing: campsitesEnabled,
      supports_vehicle_or_tent_limits: campsitesEnabled
    },
    capacity_limits: {
      rooms: CAPACITY_LIMITS_DEFAULTS[normalized]?.rooms ?? 1,
      users: CAPACITY_LIMITS_DEFAULTS[normalized]?.users ?? 10,
      monthlyBookings: CAPACITY_LIMITS_DEFAULTS[normalized]?.monthlyBookings ?? 50,
      posOutlets: CAPACITY_LIMITS_DEFAULTS[normalized]?.posOutlets ?? 1,
      properties: CAPACITY_LIMITS_DEFAULTS[normalized]?.properties ?? 1,
    }
  }
}
