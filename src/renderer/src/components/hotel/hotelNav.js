/**
 * Hotel product navigation — independent of Lodge desktopNav groupings/labels.
 * Routes still map to shared app modules; only presentation/IA is hotel-owned.
 * Ops-first: sidebar groups + dense front-desk labels (not magazine chrome).
 *
 * Unpurchased Enterprise add-ons stay visible in More (locked) so operators
 * can discover and request them — they are not hidden from the rail.
 */
import {
  LayoutDashboard,
  BookOpen,
  LogIn,
  Wallet,
  BedDouble,
  CalendarDays,
  Grid3X3,
  Users,
  Sparkles,
  ClipboardList,
  Wrench,
  Building2,
  CreditCard,
  FileBarChart,
  Package,
  Settings,
  Moon,
  Layers,
  BadgeDollarSign,
  Radio,
  Receipt,
  ArrowRightLeft,
  MessageSquare,
  Globe,
  ShieldCheck,
  UserCircle,
  Sun,
  Presentation,
  Database,
  Bot,
  Store
} from 'lucide-react'

/** Flat primary sidebar items (top of rail, outside groups) */
export const HOTEL_STANDALONE = [
  {
    id: 'front-desk',
    label: 'Front desk',
    icon: LayoutDashboard,
    to: '/',
    match: ['/', '/hotel-dashboard']
  }
]

/**
 * Sidebar groups — primary daily operations.
 * Room moves / check-in / folios live here (formerly top command strip).
 */
export const HOTEL_NAV_GROUPS = [
  {
    name: 'Front desk',
    items: [
      {
        to: '/checkin-workflow',
        label: 'Check-in / out',
        icon: LogIn,
        match: ['/checkin-workflow'],
        feature: 'checkin_workflow',
        moduleKey: 'checkin_workflow'
      },
      {
        to: '/room-moves',
        label: 'Room moves',
        icon: ArrowRightLeft,
        match: ['/room-moves'],
        feature: 'room_moves',
        moduleKey: 'room_moves'
      },
      {
        to: '/guests',
        label: 'Guests',
        icon: Users,
        match: ['/guests']
      }
    ]
  },
  {
    name: 'Reservations',
    items: [
      { to: '/bookings', label: 'Reservations', icon: BookOpen, match: ['/bookings'] },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays, match: ['/calendar'] },
      { to: '/quotations', label: 'Quotations', icon: ClipboardList, match: ['/quotations'] },
      { to: '/invoices', label: 'Invoices', icon: CreditCard, match: ['/invoices'] },
      { to: '/prepayments', label: 'Advances', icon: Wallet, match: ['/prepayments'] }
    ]
  },
  {
    name: 'Rooms & house',
    items: [
      { to: '/rooms', label: 'Rooms', icon: BedDouble, match: ['/rooms'] },
      { to: '/roomgrid', label: 'Room grid', icon: Grid3X3, match: ['/roomgrid'] },
      {
        to: '/housekeeping',
        label: 'Housekeeping',
        icon: Sparkles,
        match: ['/housekeeping', '/housekeeping-command-center', '/advanced-housekeeping']
      },
      {
        to: '/maintenance',
        label: 'Maintenance',
        icon: Wrench,
        match: ['/maintenance', '/maintenance-enterprise']
      },
      { to: '/supplies', label: 'Supplies', icon: Package, match: ['/supplies'], feature: 'supplies', moduleKey: 'supplies' }
    ]
  },
  {
    name: 'Commercial',
    items: [
      {
        to: '/folios',
        label: 'Folios',
        icon: Receipt,
        match: ['/folios'],
        feature: 'folios',
        moduleKey: 'folios'
      },
      {
        to: '/rate-plans',
        label: 'Rate plans',
        icon: BadgeDollarSign,
        match: ['/rate-plans', '/rate-calendar', '/revenue-manager', '/promo-codes'],
        // Basic rate plans are Hotel Core; advanced_rates tabs remain feature-gated inside the page.
        feature: 'rate_plans',
        moduleKey: 'rate_plans'
      },
      {
        to: '/corporate',
        label: 'Corporate',
        icon: Building2,
        match: ['/corporate'],
        // Basic corporate settlement is Hotel Core.
        feature: 'corporate_accounts',
        moduleKey: 'corporate_accounts'
      },
      {
        to: '/channel-manager',
        label: 'Channels',
        icon: Radio,
        match: ['/channel-manager', '/booking-engine'],
        feature: 'channel_manager',
        moduleKey: 'channel_manager',
        isAddon: true,
        addonKey: 'channel_manager'
      }
    ]
  },
  {
    name: 'Close & report',
    items: [
      {
        to: '/night-audit-enterprise',
        label: 'Night audit',
        icon: Moon,
        match: ['/night-audit-enterprise', '/audit'],
        feature: 'night_audit_enterprise',
        moduleKey: 'night_audit_enterprise'
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: FileBarChart,
        match: ['/reports', '/hotel-reports', '/enterprise-reports'],
        feature: 'reports',
        moduleKey: 'reports'
      },
      {
        to: '/expenses',
        label: 'Expenses',
        icon: CreditCard,
        match: ['/expenses'],
        feature: 'expenses',
        moduleKey: 'expenses'
      }
    ]
  },
  {
    name: 'Ops tools',
    items: [
      { to: '/pos', label: 'Outlet POS', icon: Package, match: ['/pos'], feature: 'pos', moduleKey: 'pos' },
      { to: '/inventory', label: 'Inventory', icon: Layers, match: ['/inventory'], feature: 'inventory', moduleKey: 'inventory' },
      { to: '/staff', label: 'Team', icon: Users, match: ['/staff'], feature: 'staff', moduleKey: 'staff' }
    ]
  }
]

/**
 * Secondary / discovery items — includes sellable add-ons that stay visible when locked.
 * Collapsed under the sidebar "More" control.
 */
export const HOTEL_MORE_ITEMS = [
  {
    to: '/group-operations',
    label: 'Group operations',
    icon: Users,
    match: ['/group-operations'],
    feature: 'group_operations',
    moduleKey: 'group_operations',
    isAddon: true,
    addonKey: 'group_operations',
    pitch: 'Bulk group check-in, rooming lists, and pickup'
  },
  {
    to: '/guest-crm',
    label: 'Guest CRM',
    icon: UserCircle,
    match: ['/guest-crm'],
    feature: 'guest_crm',
    moduleKey: 'guest_crm',
    isAddon: true,
    addonKey: 'guest_crm',
    pitch: 'VIP tags, preferences, and stay history'
  },
  {
    to: '/guest-messaging',
    label: 'Guest messaging',
    icon: MessageSquare,
    match: ['/guest-messaging'],
    feature: 'guest_messaging',
    moduleKey: 'guest_messaging',
    isAddon: true,
    addonKey: 'guest_messaging',
    pitch: 'Automated guest messages and templates'
  },
  {
    to: '/guest-portal',
    label: 'Guest portal',
    icon: Globe,
    match: ['/guest-portal'],
    feature: 'guest_portal',
    moduleKey: 'guest_portal',
    isAddon: true,
    addonKey: 'guest_portal',
    pitch: 'Online check-in and guest self-service'
  },
  {
    to: '/operations-compliance',
    label: 'Compliance',
    icon: ShieldCheck,
    match: ['/operations-compliance'],
    feature: 'operations_compliance',
    moduleKey: 'operations_compliance',
    isAddon: true,
    addonKey: 'operations_compliance',
    pitch: 'Incidents, visitors, and safety controls'
  },
  {
    to: '/multi-property',
    label: 'Multi-property',
    icon: Building2,
    match: ['/multi-property'],
    feature: 'multi_property',
    moduleKey: 'multi_property',
    isAddon: true,
    addonKey: 'multi_property',
    pitch: 'Group dashboard across properties'
  },
  {
    to: '/multi-outlet-pos',
    label: 'Multi-outlet POS',
    icon: Store,
    match: ['/multi-outlet-pos'],
    feature: 'multi_outlet_pos',
    moduleKey: 'multi_outlet_pos',
    isAddon: true,
    addonKey: 'multi_outlet_pos',
    pitch: 'Coordinate restaurant and bar outlets'
  },
  {
    to: '/dayuse',
    label: 'Day use',
    icon: Sun,
    match: ['/dayuse'],
    feature: 'pool',
    moduleKey: 'pool',
    pitch: 'Pool / day-use bookings and follow-up'
  },
  {
    to: '/conference',
    label: 'Conference',
    icon: Presentation,
    match: ['/conference'],
    feature: 'conference',
    moduleKey: 'conference',
    pitch: 'Meeting rooms and conference revenue'
  },
  {
    to: '/bookings?tab=early-late',
    label: 'Early / late stays',
    icon: CalendarDays,
    match: ['/early-late-checkout'],
    feature: 'early_late_checkout',
    moduleKey: 'early_late_checkout',
    pitch: 'Policies and fees for early check-in / late checkout'
  },
  {
    to: '/bookings?tab=cancellations',
    label: 'Cancellation policies',
    icon: ClipboardList,
    match: ['/cancellation-policies'],
    feature: 'cancellation_policies',
    moduleKey: 'cancellation_policies',
    pitch: 'No-show and cancellation fee rules'
  },
  {
    to: '/data-management',
    label: 'Data import',
    icon: Database,
    match: ['/data-management'],
    feature: 'import',
    moduleKey: 'import',
    pitch: 'Import guests, rooms, and history'
  },
    {
      to: '/ai',
      label: 'Ops AI',
      icon: Bot,
      match: ['/ai'],
      feature: null,
      moduleKey: null,
      pitch: 'Ask the assistant for ops help'
    },
    {
      to: '/workforce',
      label: 'Workforce',
      icon: Users,
      match: ['/workforce'],
      feature: 'workforce_management',
      moduleKey: 'workforce_management',
      isAddon: true,
      addonKey: 'staff_operations_workforce',
      pitch: 'Staff scheduling, attendance, and task assignment'
    },
    {
      to: '/assets',
      label: 'Assets',
      icon: Wrench,
      match: ['/assets'],
      feature: 'asset_management',
      moduleKey: 'asset_management',
      isAddon: true,
      addonKey: 'maintenance_asset_management',
      pitch: 'Equipment registry, preventive maintenance, and vendors'
    },
    {
      to: '/venues',
      label: 'Venues',
      icon: Presentation,
      match: ['/venues'],
      feature: 'venue_management',
      moduleKey: 'venue_management',
      isAddon: true,
      addonKey: 'events_venue_management',
      pitch: 'Venue packages, run sheets, and supplier coordination'
    }
  ]

/** @deprecated use HOTEL_STANDALONE + HOTEL_NAV_GROUPS — kept for zone matching helpers */
export const HOTEL_RAIL = [
  {
    id: 'front-desk',
    label: 'Front desk',
    icon: LayoutDashboard,
    to: '/',
    match: ['/', '/hotel-dashboard', '/checkin-workflow', '/room-moves']
  },
  {
    id: 'reservations',
    label: 'Reservations',
    icon: BookOpen,
    to: '/bookings',
    match: ['/bookings', '/quotations', '/invoices', '/prepayments', '/calendar']
  },
  {
    id: 'guests',
    label: 'Guests',
    icon: Users,
    to: '/guests',
    match: ['/guests', '/guest-crm', '/guest-messaging']
  },
  {
    id: 'house',
    label: 'Housekeeping',
    icon: Sparkles,
    to: '/housekeeping',
    match: ['/housekeeping', '/housekeeping-command-center', '/advanced-housekeeping', '/maintenance', '/maintenance-enterprise', '/supplies', '/rooms', '/roomgrid']
  },
  {
    id: 'rates',
    label: 'Revenue',
    icon: BadgeDollarSign,
    to: '/rate-plans',
    match: ['/rate-plans', '/rate-calendar', '/revenue-manager', '/promo-codes', '/booking-engine', '/folios', '/corporate']
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    to: '/reports',
    match: ['/reports', '/hotel-reports', '/enterprise-reports', '/expenses', '/night-audit-enterprise', '/audit']
  },
  {
    id: 'more',
    label: 'More',
    icon: Layers,
    to: null,
    match: []
  }
]

/** Secondary links for search palette and overflow */
export const HOTEL_MENUS = {
  'front-desk': [
    { to: '/', label: 'Front desk board', icon: LayoutDashboard },
    { to: '/checkin-workflow', label: 'Check-in / check-out', icon: LogIn },
    { to: '/room-moves', label: 'Room moves', icon: ArrowRightLeft },
    { to: '/guests', label: 'Guest profiles', icon: Users }
  ],
  reservations: [
    { to: '/bookings', label: 'Reservations', icon: BookOpen },
    { to: '/quotations', label: 'Quotations', icon: ClipboardList },
    { to: '/invoices', label: 'Invoices', icon: CreditCard },
    { to: '/prepayments', label: 'Advances / credit', icon: Wallet },
    { to: '/room-moves', label: 'Room moves', icon: Layers },
    { to: '/bookings?tab=early-late', label: 'Early / late requests', icon: CalendarDays },
    { to: '/bookings?tab=cancellations', label: 'Cancellation policies', icon: ClipboardList }
  ],
  rooms: [
    { to: '/rooms', label: 'Room inventory', icon: BedDouble },
    { to: '/roomgrid', label: 'Room grid', icon: Grid3X3 },
    { to: '/room-moves', label: 'Room moves', icon: Layers }
  ],
  calendar: [
    { to: '/calendar', label: 'Stay calendar', icon: CalendarDays },
    { to: '/roomgrid', label: 'Occupancy grid', icon: Grid3X3 }
  ],
  folios: [
    { to: '/folios', label: 'Guest folios', icon: Wallet },
    { to: '/corporate', label: 'Corporate accounts', icon: Building2 }
  ],
  house: [
    { to: '/housekeeping', label: 'Housekeeping', icon: Sparkles },
    { to: '/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/supplies', label: 'Room supplies', icon: Package }
  ],
  rates: [
    { to: '/rate-plans', label: 'Rate plans', icon: BadgeDollarSign },
    { to: '/channel-manager', label: 'Channels', icon: Radio }
  ],
  night: [
    { to: '/night-audit-enterprise', label: 'Night audit', icon: Moon },
    { to: '/audit', label: 'Classic audit', icon: ClipboardList }
  ],
  reports: [
    { to: '/reports', label: 'Operations reports', icon: FileBarChart },
    { to: '/expenses', label: 'Expenses', icon: CreditCard }
  ],
  more: HOTEL_MORE_ITEMS.map(({ to, label, icon }) => ({ to, label, icon }))
}

export const HOTEL_PAGE_META = {
  '/': {
    kicker: 'Front desk',
    title: 'Today’s board',
    sub: 'Arrivals, departures, room status, and open balances.'
  },
  '/hotel-dashboard': {
    kicker: 'Front desk',
    title: 'Today’s board',
    sub: 'Arrivals, departures, room status, and open balances.'
  },
  '/bookings': {
    kicker: 'Reservations',
    title: 'Reservations',
    sub: 'Create, amend, and settle guest stays.'
  },
  '/rooms': {
    kicker: 'Rooms',
    title: 'Room inventory',
    sub: 'Rooms, status, and sellable inventory.'
  },
  '/roomgrid': {
    kicker: 'Rooms',
    title: 'Room grid',
    sub: 'Visual occupancy and status board.'
  },
  '/calendar': {
    kicker: 'Reservations',
    title: 'Stay calendar',
    sub: 'Availability and booking timeline.'
  },
  '/folios': {
    kicker: 'Billing',
    title: 'Guest folios',
    sub: 'Charges, payments, splits, and folio control.'
  },
  '/checkin-workflow': {
    kicker: 'Front desk',
    title: 'Check-in / check-out',
    sub: 'Guided arrival and departure workflow.'
  },
  '/room-moves': {
    kicker: 'Front desk',
    title: 'Room moves',
    sub: 'Move in-house guests between rooms with an audit trail.'
  },
  '/housekeeping': {
    kicker: 'House',
    title: 'Housekeeping',
    sub: 'Dirty, clean, inspection, and assignments.'
  },
  '/rate-plans': {
    kicker: 'Commercial',
    title: 'Rate plans',
    sub: 'Seasonal, corporate, and package rates.'
  },
  '/night-audit-enterprise': {
    kicker: 'Close',
    title: 'Night audit',
    sub: 'Exceptions, blockers, and business-date close.'
  },
  '/reports': {
    kicker: 'Reports',
    title: 'Reports',
    sub: 'Occupancy, revenue, and operational reporting.'
  },
  '/settings': {
    kicker: 'Admin',
    title: 'Settings',
    sub: 'Hotel identity, devices, billing, and system controls.'
  },
  '/staff': {
    kicker: 'Team',
    title: 'Staff & access',
    sub: 'Roles, shifts, and capability control.'
  },
  '/guests': {
    kicker: 'Guests',
    title: 'Guest profiles',
    sub: 'History, preferences, and stay records.'
  },
  '/corporate': {
    kicker: 'Commercial',
    title: 'Corporate accounts',
    sub: 'Negotiated rates and corporate settlement.'
  },
  '/pos': {
    kicker: 'F&B',
    title: 'Outlet POS',
    sub: 'Restaurant and bar charging for hotel outlets.'
  },
  '/expenses': {
    kicker: 'Finance',
    title: 'Expenses',
    sub: 'Property operating costs.'
  },
  '/maintenance': {
    kicker: 'House',
    title: 'Maintenance',
    sub: 'Tickets and room-blocking work orders.'
  },
  '/group-operations': {
    kicker: 'More',
    title: 'Group operations',
    sub: 'Group stays, rooming lists, and pickup control.'
  },
  '/guest-crm': {
    kicker: 'More',
    title: 'Guest CRM',
    sub: 'VIP profiles, preferences, and relationship history.'
  },
  '/guest-messaging': {
    kicker: 'More',
    title: 'Guest messaging',
    sub: 'Templates and automated guest communication.'
  },
  '/guest-portal': {
    kicker: 'More',
    title: 'Guest portal',
    sub: 'Self-service check-in and guest requests.'
  },
  '/multi-property': {
    kicker: 'More',
    title: 'Multi-property',
    sub: 'Central view across properties in the group.'
  },
  '/operations-compliance': {
    kicker: 'More',
    title: 'Compliance',
    sub: 'Incidents, visitors, and operational safety.'
  },
  '/workforce': {
    kicker: 'More',
    title: 'Workforce',
    sub: 'Scheduling, attendance, handovers, and task management.'
  },
  '/assets': {
    kicker: 'More',
    title: 'Assets',
    sub: 'Equipment registry, preventive schedules, and vendor management.'
  },
  '/venues': {
    kicker: 'More',
    title: 'Venues',
    sub: 'Venue packages, run sheets, deposits, and supplier coordination.'
  }
}

/** Optional / premium keys only — Hotel Core features are not treated as purchasable add-ons. */
const ADDON_FEATURE_KEYS = [
  'channel_manager',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'multi_outlet_pos',
  'guest_messaging',
  'guest_crm',
  'advanced_reports',
  'advanced_booking_engine',
  'operations_compliance',
  'group_operations',
  'payment_gateway',
  'custom_website',
  'workforce_management',
  'asset_management',
  'venue_management'
]

/** Build effective addon list from entitlement (same idea as lodge Layout). */
export function getHotelEffectiveAddons(entitlement = {}) {
  const addons = new Set(Array.isArray(entitlement.enterprise_addons) ? entitlement.enterprise_addons : [])
  const features = entitlement.effective_features || {}
  for (const key of ADDON_FEATURE_KEYS) {
    if (features[key] === true) addons.add(key)
  }
  if (features.rate_calendar === true || features.promo_codes === true) addons.add('advanced_rates')
  return [...addons]
}

/**
 * Whether a hotel sidebar item should show as locked upsell.
 * Unpurchased add-ons stay visible (locked) — they are not hidden.
 */
export function isHotelNavItemLocked(item, { features = {}, addons = [] } = {}) {
  if (!item) return false

  const featureKey = item.feature || null
  const addonKey = item.addonKey || (item.isAddon ? item.moduleKey : null)
  const hasFeatureMap = features && typeof features === 'object' && Object.keys(features).length > 0

  // Explicit feature flag off → locked (persuade upgrade / enable add-on)
  if (featureKey && hasFeatureMap && features[featureKey] === false) {
    return true
  }

  // Catalogued add-on not purchased → locked upsell (still shown)
  if (item.isAddon && addonKey) {
    const owned = addons.includes(addonKey)
      || (hasFeatureMap && (features[addonKey] === true || (featureKey && features[featureKey] === true)))
    if (!owned) return true
  }

  return false
}

export function annotateHotelNavItem(item, context) {
  const locked = isHotelNavItemLocked(item, context)
  return {
    ...item,
    isLocked: locked,
    lockBadge: locked ? (item.isAddon ? 'Add-on' : 'Upgrade') : null
  }
}

export function getHotelPageMeta(pathname = '/') {
  const path = String(pathname || '/').split('?')[0] || '/'
  if (HOTEL_PAGE_META[path]) return HOTEL_PAGE_META[path]
  const match = Object.keys(HOTEL_PAGE_META)
    .filter((key) => key !== '/' && path.startsWith(key))
    .sort((a, b) => b.length - a.length)[0]
  return HOTEL_PAGE_META[match] || {
    kicker: 'Operations',
    title: 'Hotel workspace',
    sub: 'Property operations console.'
  }
}

export function pathMatchesHotelZone(pathname, zone) {
  const path = String(pathname || '/')
  if (!zone?.match?.length) return false
  return zone.match.some((prefix) => {
    if (prefix === '/') return path === '/' || path === ''
    return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix)
  })
}

export function pathMatchesHotelItem(pathname, item) {
  const path = String(pathname || '/')
  const pathOnly = path.split('?')[0] || '/'
  if (item?.match?.length) {
    return item.match.some((prefix) => {
      if (prefix === '/') return pathOnly === '/' || pathOnly === ''
      return pathOnly === prefix || pathOnly.startsWith(`${prefix}/`) || pathOnly.startsWith(prefix)
    })
  }
  if (!item?.to) return false
  const toOnly = String(item.to).split('?')[0]
  if (toOnly === '/') return pathOnly === '/' || pathOnly === '' || pathOnly === '/hotel-dashboard'
  return pathOnly === toOnly || pathOnly.startsWith(`${toOnly}/`) || path === item.to
}

/** Flatten all navigable hotel links for command palette */
export function getHotelSearchItems({ includeLocked = true, features = {}, addons = [] } = {}) {
  const seen = new Set()
  const items = []
  const push = (link, group) => {
    if (!link?.to || seen.has(link.to)) return
    const annotated = annotateHotelNavItem(link, { features, addons })
    if (!includeLocked && annotated.isLocked) return
    seen.add(link.to)
    items.push({
      to: link.to,
      label: annotated.isLocked ? `${link.label} (locked)` : link.label,
      icon: link.icon,
      group,
      isLocked: annotated.isLocked,
      keywords: [link.label, group, link.to, link.pitch, annotated.isLocked ? 'addon upgrade' : ''].filter(Boolean)
    })
  }
  for (const item of HOTEL_STANDALONE) push(item, 'Front desk')
  for (const group of HOTEL_NAV_GROUPS) {
    for (const item of group.items) push(item, group.name)
  }
  for (const item of HOTEL_MORE_ITEMS) push(item, 'More')
  for (const [key, links] of Object.entries(HOTEL_MENUS)) {
    for (const link of links) push(link, key.replace(/-/g, ' '))
  }
  push({ to: '/settings', label: 'Settings', icon: Settings }, 'Admin')
  return items
}
