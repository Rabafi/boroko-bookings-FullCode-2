import { ECOSYSTEM_BRAND, PRODUCT_BRANDS } from './brandIdentity.js'

// LodgingOS is the established client. Keep its legacy compatibility identity
// stable so existing customer installations receive LodgingOS updates in place.
const FALLBACK_PRODUCT_ID = 'lodge-camp'

// Route groups used to build per-product allowlists.
// Internal path segments (no leading slash) matching App.jsx Route path values.
const CORE_PREAUTH = Object.freeze(['welcome', 'choose-lodge', 'login', 'setup', 'master-setup'])

const CORE_SHARED = Object.freeze([
  '', // index dashboard
  'settings',
  'staff',
  'reports',
  'expenses',
  'data-management',
  'ai'
])

const ACCOMMODATION_OPS = Object.freeze([
  'rooms',
  'bookings',
  'quotations',
  'invoices',
  'prepayments',
  'calendar',
  'roomgrid',
  'guests',
  'housekeeping',
  'maintenance',
  'audit',
  'conference',
  'dayuse',
  'pos',
  'inventory',
  'supplies',
  'folios',
  'corporate',
  'rate-plans',
  'room-moves',
  'channel-manager',
  'guest-messaging',
  'guest-portal',
  'multi-property',
  'guest-crm',
  'operations-compliance',
  'multi-outlet-pos',
  'group-operations',
  'hotel-dashboard',
  'room-types',
  'floors',
  'room-attributes',
  'hotel-reports',
  'enterprise-reports',
  'advanced-housekeeping',
  'housekeeping-command-center',
  'maintenance-enterprise',
  'hotel-roles',
  'corporate-billing',
  'rate-calendar',
  'revenue-manager',
  'promo-codes',
  'checkin-workflow',
  'early-late-checkout',
  'cancellation-policies',
  'documents',
  'payment-links',
  'booking-engine',
  'night-audit-enterprise',
  'payment-gateway-config',
  'subscription-builder',
  'custom-website'
])

const RESTAURANT_OPS = Object.freeze([
  'pos',
  'inventory',
  'hpos',
  'restaurant'
])
const LODGE_FOOD_BEVERAGE = Object.freeze(['food-beverage'])


function freezeRoutes(...groups) {
  const set = new Set()
  for (const group of groups) {
    for (const route of group) set.add(route)
  }
  return Object.freeze([...set])
}

export const PRODUCT_DEFINITIONS = Object.freeze({
  'lodge-camp': Object.freeze({
    id: 'lodge-camp',
    name: PRODUCT_BRANDS['lodge-camp'].name,
    brandName: PRODUCT_BRANDS['lodge-camp'].name,
    shortName: PRODUCT_BRANDS['lodge-camp'].shortName,
    businessNoun: 'lodge',
    businessNounTitle: 'Lodge',
    businessNounPlural: 'lodges',
    chooserTitle: 'Choose a Lodge on This Computer',
    tagline: 'Manage your lodge operations from one clear workspace.',
    loginTagline: 'Sign in to continue front-desk and back-office work with this lodge.',
    appId: 'com.boroko.bookings',
    appDataName: 'boroko-bookings',
    allowedPropertyTypes: Object.freeze(['guest_house', 'bnb', 'lodge', 'camp', 'motel']),
    hospitalityModes: Object.freeze([]),
    theme: Object.freeze({
      id: 'lodge',
      rootClass: 'product-shell-lodge',
      // Lodge live UI is frozen — theme tokens exist for shell APIs only.
      accent: 'emerald',
      gradient: 'from-green-900 via-green-800 to-green-700'
    }),
    allowedRoutePrefixes: freezeRoutes(CORE_PREAUTH, CORE_SHARED, ACCOMMODATION_OPS, RESTAURANT_OPS, LODGE_FOOD_BEVERAGE),
    defaultHome: '/',
    releaseRepo: 'boroko-bookings-releases'
  }),
  hotel: Object.freeze({
    id: 'hotel',
    name: PRODUCT_BRANDS.hotel.name,
    brandName: PRODUCT_BRANDS.hotel.name,
    shortName: PRODUCT_BRANDS.hotel.shortName,
    businessNoun: 'hotel',
    businessNounTitle: 'Hotel',
    businessNounPlural: 'hotels',
    chooserTitle: 'Choose a Hotel on This Computer',
    tagline: 'Run front desk, rooms, rates, and hotel operations from one property workspace.',
    loginTagline: 'Sign in to continue front-desk, folio, and back-office work for this hotel.',
    appId: 'com.boroko.hotel',
    appDataName: 'boroko-hotel',
    allowedPropertyTypes: Object.freeze(['hotel', 'resort']),
    hospitalityModes: Object.freeze([]),
    theme: Object.freeze({
      id: 'hotel',
      rootClass: 'product-shell-hotel',
      // Ops-first shell: Lodge-like structure, hotel copper palette (not magazine/editorial).
      accent: 'ops-copper',
      gradient: 'from-[#f0ebe4] via-[#f7f3ed] to-[#e6dfd5]'
    }),
    // Hotel keeps accommodation + enterprise; pure restaurant HPOS shell is POS product only.
    allowedRoutePrefixes: freezeRoutes(CORE_PREAUTH, CORE_SHARED, ACCOMMODATION_OPS),
    defaultHome: '/',
    releaseRepo: 'boroko-hotel-releases'
  }),
  'hospitality-pos': Object.freeze({
    id: 'hospitality-pos',
    name: PRODUCT_BRANDS['hospitality-pos'].name,
    brandName: PRODUCT_BRANDS['hospitality-pos'].name,
    shortName: PRODUCT_BRANDS['hospitality-pos'].shortName,
    businessNoun: 'business',
    businessNounTitle: 'Business',
    businessNounPlural: 'businesses',
    chooserTitle: 'Choose a Restaurant or Bar on This Computer',
    tagline: 'Run restaurant service or bar sales, stock, cash-up and team control from one workspace.',
    loginTagline: 'Sign in to run POS sales, stock, shifts and cash-up for this business.',
    appId: 'com.boroko.hospitalitypos',
    appDataName: 'boroko-hospitality-pos',
    // pos_only normalizes to restaurant via normalizePropertyTypeForProduct.
    allowedPropertyTypes: Object.freeze(['restaurant', 'pos_only']),
    hospitalityModes: Object.freeze(['restaurant_bar', 'bar_only']),
    theme: Object.freeze({
      id: 'hospitality-pos',
      rootClass: 'product-shell-hpos',
      accent: 'terracotta',
      gradient: 'from-[#6f8061] via-[#d08a64] to-[#f1dfc6]'
    }),
    allowedRoutePrefixes: freezeRoutes(CORE_PREAUTH, CORE_SHARED, RESTAURANT_OPS),
    // Land on the sell terminal — not a bare /hpos prefix that can fail route resolution.
    defaultHome: '/hpos/pos',
    releaseRepo: 'boroko-hospitality-pos-releases'
  })
})

export function getRuntimeProductId() {
  if (typeof __TSA_BONNO_PRODUCT__ === 'string' && PRODUCT_DEFINITIONS[__TSA_BONNO_PRODUCT__]) return __TSA_BONNO_PRODUCT__
  return FALLBACK_PRODUCT_ID
}

export function getProductDefinition(productId = getRuntimeProductId()) {
  return PRODUCT_DEFINITIONS[productId] || PRODUCT_DEFINITIONS[FALLBACK_PRODUCT_ID]
}

export function normalizePropertyTypeForProduct(propertyType) {
  const raw = String(propertyType || '').trim().toLowerCase()
  if (raw === 'pos_only') return 'restaurant'
  if (raw === 'campsite' || raw === 'camping') return 'camp'
  if (raw === 'guesthouse' || raw === 'guest house') return 'guest_house'
  if (raw === 'bed_and_breakfast' || raw === 'bed & breakfast') return 'bnb'
  if (raw === 'apartment-hotel') return 'apartment_hotel'
  if (raw === 'serviced apartments') return 'serviced_apartments'
  return raw || 'lodge'
}

/** Authoritative product-family ids used by desktop installers and Manager PWA. */
export const PRODUCT_FAMILY_IDS = Object.freeze({
  LODGE_CAMP: 'lodge-camp',
  HOTEL: 'hotel',
  HOSPITALITY_POS: 'hospitality-pos'
})

export const PRODUCT_FAMILY_LABELS = Object.freeze({
  'lodge-camp': PRODUCT_BRANDS['lodge-camp'].name,
  hotel: PRODUCT_BRANDS.hotel.name,
  'hospitality-pos': PRODUCT_BRANDS['hospitality-pos'].name
})

/**
 * Resolve product family from company property type.
 * Product boundary (matches server resolve_product_family):
 * - motel -> lodge-camp (not hotel)
 * - restaurant / pos_only -> hospitality-pos
 * - hotel / resort -> hotel
 */
export function resolveProductFamily(propertyTypeOrFamily) {
  const raw = String(propertyTypeOrFamily || '').trim().toLowerCase()
  if (raw === PRODUCT_FAMILY_IDS.LODGE_CAMP || raw === PRODUCT_FAMILY_IDS.HOTEL || raw === PRODUCT_FAMILY_IDS.HOSPITALITY_POS) {
    return raw
  }
  const normalized = normalizePropertyTypeForProduct(propertyTypeOrFamily)
  if (normalized === 'restaurant') return PRODUCT_FAMILY_IDS.HOSPITALITY_POS
  if (normalized === 'hotel' || normalized === 'resort' || normalized === 'apartment_hotel' || normalized === 'serviced_apartments') {
    return PRODUCT_FAMILY_IDS.HOTEL
  }
  // motel, lodge, camp, guest_house, bnb, hostel, default
  return PRODUCT_FAMILY_IDS.LODGE_CAMP
}

export function getProductFamilyLabel(productFamily) {
  const family = resolveProductFamily(productFamily)
  return PRODUCT_FAMILY_LABELS[family] || PRODUCT_FAMILY_LABELS['lodge-camp']
}

export function isLodgeCampProductFamily(productFamily) {
  return resolveProductFamily(productFamily) === PRODUCT_FAMILY_IDS.LODGE_CAMP
}

export function isHotelProductFamily(productFamily) {
  return resolveProductFamily(productFamily) === PRODUCT_FAMILY_IDS.HOTEL
}

export function isHospitalityPosProductFamily(productFamily) {
  return resolveProductFamily(productFamily) === PRODUCT_FAMILY_IDS.HOSPITALITY_POS
}

// Product identity is a hard boundary.  The shared runtime may contain all
// modules, but a Restaurant profile must never make the Hotel or Lodge app
// present itself as the POS product (and vice versa).
export function isProductCompatiblePropertyType(productId, propertyType) {
  const product = getProductDefinition(productId)
  const normalized = normalizePropertyTypeForProduct(propertyType)
  // allowedPropertyTypes may list aliases (e.g. pos_only); compare on normalized form.
  const allowed = (product.allowedPropertyTypes || []).map((value) => normalizePropertyTypeForProduct(value))
  return allowed.includes(normalized)
}

export function getProductMismatchMessage(productId = getRuntimeProductId(), propertyType = '') {
  const product = getProductDefinition(productId)
  const normalized = normalizePropertyTypeForProduct(propertyType)
  const actualLabel =
    normalized === 'restaurant' ? 'Restaurant & Bar POS' :
    normalized === 'hotel' || normalized === 'resort' ? 'Hotel' :
    normalized === 'lodge' || normalized === 'camp' || normalized === 'guest_house' || normalized === 'bnb' || normalized === 'motel'
      ? PRODUCT_BRANDS['lodge-camp'].name
      : normalized || 'another'
  return `This account belongs to a ${actualLabel} business, not ${product.name}. Use the matching ${ECOSYSTEM_BRAND.name} app or sign in with an account assigned to a ${product.name} business.`
}

export function createProductMismatchError(productId = getRuntimeProductId(), propertyType = '') {
  const error = new Error(getProductMismatchMessage(productId, propertyType))
  error.code = 'product_profile_mismatch'
  return error
}

/**
 * Normalize a hash path or route path to the first segment used in product allowlists.
 * Examples: "/bookings" -> "bookings", "/hpos/floor" -> "hpos", "/" -> ""
 */
export function getRoutePrefix(pathname = '') {
  const cleaned = String(pathname || '').replace(/^#/, '').split('?')[0].trim()
  if (!cleaned || cleaned === '/') return ''
  const parts = cleaned.replace(/^\//, '').split('/').filter(Boolean)
  return parts[0] || ''
}

export function isProductRouteAllowed(pathname, productId = getRuntimeProductId()) {
  const product = getProductDefinition(productId)
  const prefix = getRoutePrefix(pathname)
  const allowed = product.allowedRoutePrefixes || []
  return allowed.includes(prefix)
}

export function assertPropertyTypeMatchesProduct(propertyType, productId = getRuntimeProductId()) {
  if (isProductCompatiblePropertyType(productId, propertyType)) return true
  throw createProductMismatchError(productId, propertyType)
}
