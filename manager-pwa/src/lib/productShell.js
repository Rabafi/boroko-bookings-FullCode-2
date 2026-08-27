/**
 * Manager PWA shell presentation derived from server-authoritative product_family.
 * Navigation and labels adapt for display only — never invent financial authority.
 */
import {
  BedDouble,
  BookOpen,
  CreditCard,
  Home,
  Menu,
  MessageCircle,
  Package,
  ShoppingCart
} from 'lucide-react'
import {
  PRODUCT_FAMILY_IDS,
  getProductFamilyLabel,
  resolveProductFamily
} from '@shared/productIdentity'

const LODGE_NAV = Object.freeze([
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen },
  { to: '/rooms', label: 'Rooms', icon: BedDouble },
  { to: '/money', label: 'Money', icon: CreditCard },
  { to: '/control', label: 'Inbox', icon: MessageCircle, inbox: true },
  { to: '/more', label: 'Menu', icon: Menu }
])

const HOTEL_NAV = Object.freeze([
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/hotel-dashboard', label: 'Front Desk', icon: BookOpen },
  { to: '/rooms', label: 'Rooms', icon: BedDouble },
  { to: '/money', label: 'Money', icon: CreditCard },
  { to: '/control', label: 'Inbox', icon: MessageCircle, inbox: true },
  { to: '/more', label: 'Menu', icon: Menu }
])

const POS_NAV = Object.freeze([
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/pos', label: 'Sales', icon: ShoppingCart },
  { to: '/inventory', label: 'Stock', icon: Package },
  { to: '/money', label: 'Money', icon: CreditCard },
  { to: '/control', label: 'Inbox', icon: MessageCircle, inbox: true },
  { to: '/more', label: 'Menu', icon: Menu }
])

// Routes are a product-experience boundary. They do not grant authority (the
// server and capability checks do that), but they prevent a manually entered
// URL from opening the wrong product's manager page.
const ACCOMMODATION_ONLY_ROUTES = new Set([
  '/rooms',
  '/bookings',
  '/housekeeping',
  '/maintenance',
  '/supplies',
  '/quotations',
  '/invoices',
  '/prepayments',
  '/guests',
  '/conference',
  '/day-use'
])

const RESTAURANT_ONLY_ROUTES = new Set(['/restaurant-owner', '/restaurant/service', '/restaurant/cash-close', '/restaurant/floor', '/restaurant/kitchen-workspace', '/restaurant/menu-production'])

const HOTEL_ONLY_ROUTES = new Set(['/hotel-dashboard', '/folios', '/checkin-workflow', '/night-audit-enterprise', '/hotel-revenue'])

const LODGE_ONLY_ROUTES = new Set(['/calendar', '/roomgrid'])

const SHELL = Object.freeze({
  [PRODUCT_FAMILY_IDS.LODGE_CAMP]: Object.freeze({
    productFamily: PRODUCT_FAMILY_IDS.LODGE_CAMP,
    productFamilyLabel: getProductFamilyLabel(PRODUCT_FAMILY_IDS.LODGE_CAMP),
    brandTitle: 'Tsa Bonno LodgingOS Manager',
    loginTagline: 'Leadership access for lodge and camp managers',
    chooserTitle: 'Select your business',
    chooserSubtitle: 'Your account is linked to more than one property',
    businessNoun: 'lodge',
    businessNounTitle: 'Lodge',
    rootClass: 'pwa-product-lodge',
    accentRing: 'ring-green-400/25',
    accentBg: 'bg-green-500/14',
    accentText: 'text-green-200',
    accentIcon: 'text-green-400',
    accentIconBg: 'bg-green-900/40',
    focusRing: 'focus:ring-green-500',
    primaryButton: 'bg-green-600 hover:bg-green-500',
    themeColor: '#174c3a',
    nav: LODGE_NAV,
    primaryRoutes: Object.freeze(['/', '/bookings', '/rooms', '/money', '/control', '/more']),
    accommodationModules: true,
    restaurantModules: false,
    showRoomsNav: true,
    showBookingsNav: true
  }),
  [PRODUCT_FAMILY_IDS.HOTEL]: Object.freeze({
    productFamily: PRODUCT_FAMILY_IDS.HOTEL,
    productFamilyLabel: getProductFamilyLabel(PRODUCT_FAMILY_IDS.HOTEL),
    brandTitle: 'Tsa Bonno HotelOS Manager',
    loginTagline: 'Leadership access for hotel managers and admins',
    chooserTitle: 'Select your hotel',
    chooserSubtitle: 'Your account is linked to more than one property',
    businessNoun: 'hotel',
    businessNounTitle: 'Hotel',
    rootClass: 'pwa-product-hotel',
    accentRing: 'ring-amber-400/25',
    accentBg: 'bg-amber-500/14',
    accentText: 'text-amber-100',
    accentIcon: 'text-amber-300',
    accentIconBg: 'bg-amber-950/50',
    focusRing: 'focus:ring-amber-500',
    primaryButton: 'bg-amber-700 hover:bg-amber-600',
    themeColor: '#3d2b1f',
    nav: HOTEL_NAV,
    primaryRoutes: Object.freeze(['/', '/bookings', '/rooms', '/money', '/control', '/more']),
    accommodationModules: true,
    restaurantModules: false,
    showRoomsNav: true,
    showBookingsNav: true
  }),
  [PRODUCT_FAMILY_IDS.HOSPITALITY_POS]: Object.freeze({
    productFamily: PRODUCT_FAMILY_IDS.HOSPITALITY_POS,
    productFamilyLabel: getProductFamilyLabel(PRODUCT_FAMILY_IDS.HOSPITALITY_POS),
    brandTitle: 'Tsa Bonno Restaurant & Bar POS Manager',
    loginTagline: 'Owner and manager access for restaurant and bar operations',
    chooserTitle: 'Select your business',
    chooserSubtitle: 'Your account is linked to more than one restaurant or bar',
    businessNoun: 'business',
    businessNounTitle: 'Business',
    rootClass: 'pwa-product-pos',
    accentRing: 'ring-orange-400/25',
    accentBg: 'bg-orange-500/14',
    accentText: 'text-orange-100',
    accentIcon: 'text-orange-300',
    accentIconBg: 'bg-orange-950/50',
    focusRing: 'focus:ring-orange-500',
    primaryButton: 'bg-orange-700 hover:bg-orange-600',
    themeColor: '#5c3a2a',
    nav: POS_NAV,
    primaryRoutes: Object.freeze(['/', '/pos', '/inventory', '/money', '/control', '/more']),
    accommodationModules: false,
    restaurantModules: true,
    showRoomsNav: false,
    showBookingsNav: false
  })
})

/**
 * @param {string|null|undefined} productFamily - Server product_family only.
 * Do not pass a client-chosen "mode".
 */
export function getPwaShellConfig(productFamily) {
  const family = resolveProductFamily(productFamily || PRODUCT_FAMILY_IDS.LODGE_CAMP)
  return SHELL[family] || SHELL[PRODUCT_FAMILY_IDS.LODGE_CAMP]
}

export function getPwaNavItems(productFamily, { inboxEnabled = true } = {}) {
  const shell = getPwaShellConfig(productFamily)
  return shell.nav.filter((item) => !item.inbox || inboxEnabled)
}

/**
 * Product-aware route allowlist for the single Manager PWA. The product family
 * comes from the server-issued session; it is never selected by the client.
 */
export function isPwaRouteAllowed(pathname, productFamily, hospitalityMode = null, enabledFeatures = null) {
  const path = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/'
  const shell = getPwaShellConfig(productFamily)
  const barOnly = String(hospitalityMode || '').toLowerCase() === 'bar_only'

  if (barOnly && ['/restaurant/floor', '/restaurant/kitchen-workspace'].includes(path)) return false
  // The generic Financial Audit is a lodging/night-audit surface. Bar managers
  // use the POS report and server-certified cash controls instead.
  if (barOnly && path === '/audit') return false
  if (barOnly && path === '/restaurant-owner' && enabledFeatures?.owner_mobile_view !== true) return false

  if (ACCOMMODATION_ONLY_ROUTES.has(path)) return shell.accommodationModules === true
  if (RESTAURANT_ONLY_ROUTES.has(path)) return shell.restaurantModules === true
  if (HOTEL_ONLY_ROUTES.has(path)) return shell.productFamily === PRODUCT_FAMILY_IDS.HOTEL
  if (LODGE_ONLY_ROUTES.has(path)) return shell.productFamily === PRODUCT_FAMILY_IDS.LODGE_CAMP
  return true
}

export function isAccommodationProductFamily(productFamily) {
  return getPwaShellConfig(productFamily).accommodationModules === true
}

export function isRestaurantProductFamily(productFamily) {
  return getPwaShellConfig(productFamily).restaurantModules === true
}

export function isBarHospitalityMode(hospitalityMode) {
  return String(hospitalityMode || '').trim().toLowerCase() === 'bar_only'
}
