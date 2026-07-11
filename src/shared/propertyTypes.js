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
  lodge: 'Lodge / Camp',
  camp: 'Lodge / Camp',
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
  lodge: 'Nature or safari accommodation',
  camp: 'Nature or safari accommodation',
  motel: 'Drive-up room accommodation',
  hotel: 'Full-service hotel operations',
  resort: 'Multi-outlet resort operations',
  restaurant: 'Food and beverage focused operation'
}

export const PROPERTY_TYPE_DEFAULTS = {
  guest_house: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance'],
    operation_style: 'simple'
  },
  bnb: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance'],
    operation_style: 'simple'
  },
  lodge: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'day_use', 'events'],
    operation_style: 'managed'
  },
  camp: {
    modules: ['bookings', 'rooms', 'guests', 'invoices', 'housekeeping', 'maintenance', 'day_use', 'events'],
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
  if (raw === 'camp') return 'lodge'
  if (PROPERTY_TYPES[raw]) return raw
  if (raw === 'lodge') return 'lodge'
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

export const HOSPITALITY_MODES = Object.freeze({
  RESTAURANT_BAR: 'restaurant_bar',
  BAR_ONLY: 'bar_only'
})

export function normalizeHospitalityMode(value) {
  const raw = String(value || '').trim().toLowerCase()
  return raw === HOSPITALITY_MODES.BAR_ONLY ? HOSPITALITY_MODES.BAR_ONLY : HOSPITALITY_MODES.RESTAURANT_BAR
}

export function getHospitalityMode(settingsOrProfile) {
  const source = settingsOrProfile?.operating_profile || settingsOrProfile || {}
  return normalizeHospitalityMode(source.hospitality_mode)
}

export function isBarOnlyMode(settingsOrProfile) {
  return getHospitalityMode(settingsOrProfile) === HOSPITALITY_MODES.BAR_ONLY
}

export function getRelevantModules(propertyType, subscriptionPlan) {
  const defaults = getPropertyTypeDefaults(propertyType)
  const baseModules = defaults.modules || []
  
  const planModules = {
    Starter: [],
    Standard: ['reports', 'expenses', 'staff', 'audit', 'conference', 'pool', 'import'],
    Pro: ['pos', 'inventory', 'supplies', 'pwa', 'online_booking'],
    Enterprise: ['hotel_mode', 'room_types', 'physical_inventory', 'floors_sections', 'front_desk_dashboard', 'folios', 'advanced_housekeeping', 'hotel_kpis', 'corporate_accounts', 'rate_plans']
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

export function buildOperatingProfile(propertyType, subscriptionPlan = 'Starter', enterpriseAddons = []) {
  const normalized = normalizePropertyType(propertyType)
  const defaults = getPropertyTypeDefaults(normalized)
  const relevantModules = getRelevantModules(normalized, subscriptionPlan)
  const hiddenModules = getHiddenModules(normalized, subscriptionPlan)
  const enabledModules = relevantModules.filter(m => !hiddenModules.includes(m))

  return {
    property_type: normalized,
    operation_style: defaults.operation_style || 'managed',
    enabled_modules: enabledModules,
    relevant_modules: relevantModules,
    hidden_modules: hiddenModules,
    subscription_plan: subscriptionPlan,
    enterprise_addons: enterpriseAddons,
    capacity_limits: {
      rooms: CAPACITY_LIMITS_DEFAULTS[normalized]?.rooms ?? 1,
      users: CAPACITY_LIMITS_DEFAULTS[normalized]?.users ?? 10,
      monthlyBookings: CAPACITY_LIMITS_DEFAULTS[normalized]?.monthlyBookings ?? 50,
      posOutlets: CAPACITY_LIMITS_DEFAULTS[normalized]?.posOutlets ?? 1,
      properties: CAPACITY_LIMITS_DEFAULTS[normalized]?.properties ?? 1,
    }
  }
}
