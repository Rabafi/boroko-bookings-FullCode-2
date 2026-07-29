import {
  LayoutDashboard,
  BedDouble,
  CalendarDays,
  BookOpen,
  BarChart3,
  Users,
  Settings,
  Grid3X3,
  Sparkles,
  UserRound,
  Wrench,
  Receipt,
  CreditCard,
  ShoppingCart,
  Package,
  Boxes,
  ClipboardList,
  Presentation,
  Briefcase,
  Database,
  FileText,
  Banknote,
  Building2,
  LayoutDashboardIcon,
  UserCog,
  Wallet,
  TrendingUp,
  Globe,
  CreditCardIcon,
  Share2,
  UsersIcon,
  ArrowRightLeft,
  MessageSquare,
  ShieldCheck,
  CalendarRange,
  Moon,
  LogIn,
  Clock,
  Ban,
  Calculator,
  Tag,
  UtensilsCrossed,
  LayoutList,
  ChefHat,
  Salad,
  CircleDollarSign,
  ClipboardCheck,
  BookUser,
  Store,
  TableProperties
} from 'lucide-react'
import { resolveModuleVisibility, MODULE_VISIBILITY_STATES, getModuleByKey } from '../../../shared/moduleCatalog.js'
import { normalizePropertyType, isBarOnlyMode, isHotelPropertyType } from '../../../shared/propertyTypes.js'
import { normalizeSubscriptionPlan } from '../../../shared/subscriptionPlans.js'
/**
 * Resolve product id for nav scoping.
 * Pass productId explicitly from product shells. Tests may omit it to keep
 * property-type-level hotel inheritance behavior for catalog assertions.
 */
function resolveNavProductId(productId) {
  if (productId === null || productId === undefined || productId === '') return null
  return String(productId)
}

export const ALL_NAV = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true,
    types: ['lodge', 'restaurant'],
    capability: 'dashboard.view',
    moduleKey: 'dashboard',
    keywords: ['home', 'overview', 'kpi', 'occupancy']
  },
  {
    to: '/hotel-dashboard',
    label: 'Front Desk',
    icon: LayoutDashboardIcon,
    end: true,
    types: ['hotel'],
    capability: 'front_desk_dashboard.view',
    moduleKey: 'front_desk_dashboard',
    keywords: ['arrivals', 'departures', 'in house', 'hotel dashboard', 'front desk']
  },
  {
    to: '/ai',
    label: 'Assistant',
    icon: Sparkles,
    end: true,
    types: ['lodge', 'restaurant'],
    capability: 'dashboard.view',
    moduleKey: null,
    keywords: ['ai', 'assistant', 'help', 'instructions', 'guide', 'find feature', 'locate function', 'how do i', 'local']
  },
  {
    to: '/bookings',
    label: 'Bookings',
    icon: BookOpen,
    types: ['lodge', 'hotel'],
    group: 'Front Desk',
    capability: 'bookings.view',
    moduleKey: 'bookings',
    keywords: ['reservations', 'check in', 'check out']
  },
  {
    to: '/checkin-workflow',
    label: 'Check-in / Out',
    icon: LogIn,
    types: ['hotel'],
    group: 'Front Desk',
    capability: 'checkin.manage',
    moduleKey: 'checkin_workflow',
    keywords: ['checkin', 'checkout', 'checklist', 'registration']
  },
  {
    to: '/folios',
    label: 'Folios',
    icon: Wallet,
    types: ['hotel'],
    group: 'Front Desk',
    capability: 'folios.view',
    moduleKey: 'folios',
    keywords: ['billing', 'split folio', 'charges', 'ledger']
  },
  {
    to: '/quotations',
    label: 'Quotations',
    icon: FileText,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'quotations.view',
    moduleKey: 'quotations',
    keywords: ['quotes', 'estimates']
  },
  {
    to: '/invoices',
    label: 'Invoices',
    icon: CreditCard,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'invoices.view',
    moduleKey: 'invoices',
    keywords: ['billing', 'payments', 'receipts']
  },
  {
    to: '/prepayments',
    label: 'Prepayments',
    icon: Banknote,
    types: ['lodge'],
    group: 'Finance',
    capability: 'invoices.view',
    moduleKey: null,
    keywords: ['customer credit', 'advance payment', 'deposit without dates', 'held money']
  },
  {
    to: '/roomgrid',
    label: 'Room Board',
    icon: Grid3X3,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'rooms.view',
    moduleKey: 'rooms',
    keywords: ['availability', 'rooms', 'grid', 'live board', 'front desk']
  },
  {
    to: '/calendar',
    label: 'Planning',
    icon: CalendarDays,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'bookings.view',
    moduleKey: 'bookings',
    keywords: ['schedule', 'reservations', 'planning', 'occupancy forecast', 'monthly']
  },
  {
    to: '/guests',
    label: 'Guests',
    icon: UserRound,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'guests.view',
    moduleKey: 'guests',
    keywords: ['customers', 'profiles']
  },
  {
    to: '/conference',
    label: 'Events & Venues',
    icon: Presentation,
    types: ['lodge'],
    group: 'Front Desk',
    feature: 'conference',
    tier: 'Standard',
    capability: 'conference.view',
    moduleKey: 'conference',
    keywords: ['events', 'venues', 'meetings', 'banquet', 'weddings', 'parties', 'conference']
  },
  {
    to: '/dayuse',
    label: 'Day Use',
    icon: Briefcase,
    types: ['lodge'],
    group: 'Front Desk',
    feature: 'pool',
    tier: 'Standard',
    capability: 'pool.view',
    moduleKey: 'pool',
    keywords: ['pool', 'day pass']
  },
  {
    to: '/rooms',
    label: 'Rooms',
    icon: BedDouble,
    types: ['lodge'],
    group: 'Property',
    capability: 'rooms.view',
    moduleKey: 'rooms',
    keywords: ['inventory', 'house rooms']
  },
  {
    to: '/housekeeping',
    label: 'Housekeeping',
    icon: Sparkles,
    types: ['lodge'],
    group: 'Property',
    capability: 'housekeeping.manage',
    moduleKey: 'housekeeping',
    keywords: ['cleaning', 'turnover']
  },
  {
    to: '/maintenance',
    label: 'Maintenance',
    icon: Wrench,
    types: ['lodge'],
    group: 'Property',
    capability: 'maintenance.view',
    moduleKey: 'maintenance',
    keywords: ['repairs', 'issues']
  },
  {
    to: '/expenses',
    label: 'Expenses',
    icon: Receipt,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'expenses',
    tier: 'Standard',
    capability: 'expenses.view',
    moduleKey: 'expenses',
    keywords: ['costs', 'purchases']
  },
  {
    to: '/audit',
    label: 'Night Audit',
    icon: ClipboardList,
    types: ['lodge'],
    group: 'Finance',
    feature: 'audit',
    tier: 'Standard',
    capability: 'audit.view',
    moduleKey: 'audit',
    keywords: ['closing', 'reconciliation']
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: BarChart3,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'reports',
    tier: 'Standard',
    capability: 'reports.view',
    moduleKey: 'reports',
    keywords: ['analytics', 'performance', 'insights']
  },
  {
    to: '/pos',
    label: 'POS',
    icon: ShoppingCart,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    moduleKey: 'pos',
    keywords: ['point of sale', 'sales', 'cashier']
  },
  {
    to: '/food-beverage/kitchen',
    label: 'Food & Beverage',
    icon: UtensilsCrossed,
    types: ['lodge'],
    hideInHotelMode: true,
    group: 'Finance',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    moduleKey: 'pos',
    keywords: ['restaurant', 'bar', 'kitchen', 'recipes', 'food cost', 'cash up', 'purchasing', 'outlet']
  },
  // ── Restaurant-only modules ────────────────────────────────────────────────
  {
    to: '/restaurant/floor',
    label: 'Floor & Service',
    icon: TableProperties,
    types: ['restaurant'],
    barOnlyHidden: true,
    group: 'Sell',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    moduleKey: 'pos',
    keywords: ['floor plan', 'table layout', 'seating', 'reservations', 'waitlist']
  },
  {
    to: '/restaurant/kitchen-workspace',
    label: 'Kitchen',
    icon: ChefHat,
    types: ['restaurant'],
    barOnlyHidden: true,
    group: 'Sell',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    moduleKey: 'pos',
    keywords: ['kds', 'tickets', 'orders', 'prep', 'timing', 'analytics']
  },
  {
    to: '/restaurant/menu-production',
    label: 'Menu & Production',
    icon: Salad,
    types: ['restaurant'],
    barOnlyHidden: true,
    group: 'Sell',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.manage',
    moduleKey: 'pos',
    keywords: ['menu items', 'modifier groups', 'categories', 'combos', 'recipes', 'prep', 'food cost']
  },
  {
    to: '/hpos/menu',
    label: 'Products',
    icon: Salad,
    types: ['restaurant'],
    barOnlyOnly: true,
    group: 'Sell',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.manage',
    moduleKey: 'pos',
    keywords: ['drinks', 'products', 'barcode', 'packs', 'cases', 'menu items']
  },
  {
    to: '/pos/bar-display',
    label: 'Bar board',
    icon: ChefHat,
    types: ['restaurant'],
    barOnlyOnly: true,
    group: 'Sell',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    moduleKey: 'pos',
    keywords: ['bar tickets', 'prep display', 'orders board']
  },
  {
    to: '/restaurant/stock-purchasing',
    label: 'Stock & Purchasing',
    icon: Package,
    types: ['restaurant'],
    group: 'Stock',
    feature: 'inventory',
    tier: 'Pro',
    capability: 'inventory.view',
    moduleKey: 'inventory',
    keywords: ['stock count', 'wastage', 'variance', 'adjustments', 'suppliers', 'purchase orders', 'reorder']
  },
  {
    to: '/restaurant/team',
    label: 'Team',
    icon: Users,
    types: ['restaurant'],
    group: 'Team',
    feature: 'staff',
    tier: 'Standard',
    capability: 'staff.view',
    moduleKey: 'staff',
    keywords: ['clock in', 'clock out', 'active shifts', 'performance', 'staff accountability']
  },
  {
    to: '/restaurant/cash-close',
    label: 'Cash & Close',
    icon: CircleDollarSign,
    types: ['restaurant'],
    group: 'Money',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.cashup',
    moduleKey: 'pos',
    keywords: ['float', 'cash up', 'variance', 'drawer', 'end of day', 'close out', 'owner summary']
  },
  {
    to: '/restaurant/customers',
    label: 'Customers & Loyalty',
    icon: BookUser,
    types: ['restaurant'],
    group: 'Growth',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    moduleKey: 'pos',
    keywords: ['customers', 'loyalty points', 'vouchers', 'accounts']
  },
  {
    to: '/restaurant/control',
    label: 'Control',
    icon: ClipboardCheck,
    types: ['restaurant'],
    group: 'Control',
    feature: 'pos',
    tier: 'Standard',
    capability: 'pos.manage',
    moduleKey: 'pos',
    keywords: ['opening', 'closing', 'cleaning', 'tasks', 'exceptions', 'stock low', 'cash variance']
  },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: Package,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'inventory',
    tier: 'Pro',
    capability: 'inventory.view',
    moduleKey: 'inventory',
    keywords: ['stock', 'items']
  },
  {
    to: '/supplies',
    label: 'Room Supplies',
    icon: Boxes,
    types: ['lodge'],
    group: 'Finance',
    feature: 'supplies',
    tier: 'Pro',
    capability: 'supplies.view',
    moduleKey: 'supplies',
    keywords: ['amenities', 'linen', 'supplies']
  },
  {
    to: '/staff',
    label: 'Staff',
    icon: Users,
    types: ['lodge', 'restaurant'],
    group: 'Team',
    feature: 'staff',
    tier: 'Standard',
    capability: 'staff.view',
    moduleKey: 'staff',
    keywords: ['employees', 'team']
  },
  {
    to: '/data-management',
    label: 'Data Management',
    icon: Database,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'import',
    tier: 'Standard',
    capability: 'data.import',
    moduleKey: 'import',
    keywords: ['import', 'export', 'backup']
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    types: ['lodge', 'restaurant'],
    capability: 'settings.view',
    moduleKey: null,
    keywords: ['preferences', 'configuration', 'admin']
  },
  {
    to: '/hotel-dashboard',
    label: 'Hotel Dashboard',
    icon: Building2,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'front_desk_dashboard',
    tier: 'Enterprise',
    capability: 'front_desk_dashboard.view',
    moduleKey: 'front_desk_dashboard',
    keywords: ['arrivals', 'departures', 'in-house', 'no-show', 'hotel front desk']
  },

  {
    to: '/folios',
    label: 'Folios',
    icon: Wallet,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'folios',
    tier: 'Enterprise',
    capability: 'folios.view',
    moduleKey: 'folios',
    keywords: ['hotel billing', 'room charges', 'guest folio']
  },

  {
    to: '/room-moves',
    label: 'Room Moves',
    icon: ArrowRightLeft,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'room_moves',
    tier: 'Enterprise',
    capability: 'room_moves.view',
    moduleKey: 'room_moves',
    keywords: ['room move', 'transfer', 'reassign', 'switch room']
  },
  {
    to: '/corporate',
    label: 'Corporate Accounts',
    icon: UsersIcon,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'corporate_accounts',
    tier: 'Enterprise',
    capability: 'corporate_accounts.view',
    moduleKey: 'corporate_accounts',
    keywords: ['corporate', 'company', 'group billing', 'business accounts']
  },
  {
    to: '/rate-plans',
    label: 'Rate Plans',
    icon: CreditCardIcon,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'rate_plans',
    tier: 'Enterprise',
    capability: 'rate_plans.view',
    moduleKey: 'rate_plans',
    keywords: ['seasonal rates', 'corporate rates', 'package rates', 'pricing']
  },
  {
    to: '/custom-website',
    label: 'Custom Website',
    icon: Globe,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'custom_website',
    tier: 'Enterprise',
    capability: 'custom_website.view',
    moduleKey: 'custom_website',
    keywords: ['website', 'domain', 'booking engine', 'custom site']
  },
  {
    to: '/channel-manager',
    label: 'Channel Manager',
    icon: Share2,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'channel_manager',
    tier: 'Enterprise',
    capability: 'channel_manager.view',
    moduleKey: 'channel_manager',
    keywords: ['ota', 'channels', 'booking.com', 'expedia', 'sync']
  },
  {
    to: '/guest-messaging',
    label: 'Guest Messaging',
    icon: MessageSquare,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'guest_messaging',
    tier: 'Enterprise',
    capability: 'guest_messaging.manage',
    moduleKey: 'guest_messaging',
    keywords: ['messages', 'email', 'whatsapp', 'sms', 'templates']
  },
  {
    to: '/guest-portal',
    label: 'Guest Portal',
    icon: UserCog,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'guest_portal',
    tier: 'Enterprise',
    capability: 'guest_portal.view',
    moduleKey: 'guest_portal',
    keywords: ['guest portal', 'online check-in', 'guest requests']
  },
  {
    to: '/multi-property',
    label: 'Multi-Property',
    icon: Building2,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'multi_property',
    tier: 'Enterprise',
    capability: 'multi_property.view',
    moduleKey: 'multi_property',
    keywords: ['multi property', 'group', 'central office']
  },
  {
    to: '/revenue-manager',
    label: 'Revenue Manager',
    icon: TrendingUp,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'advanced_rates',
    tier: 'Enterprise',
    capability: 'rate_plans.view',
    moduleKey: 'advanced_rates',
    keywords: ['revenue', 'pickup', 'pace', 'forecast', 'competitors']
  },
  {
    to: '/enterprise-reports',
    label: 'Enterprise Reports',
    icon: BarChart3,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'advanced_reports',
    tier: 'Enterprise',
    capability: 'advanced_reports.view',
    moduleKey: 'advanced_reports',
    keywords: ['advanced reports', 'debtor aging', 'pickup', 'pace', 'source']
  },
  {
    to: '/guest-crm',
    label: 'Guest CRM',
    icon: UserRound,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'guest_crm',
    tier: 'Enterprise',
    capability: 'guest_crm.view',
    moduleKey: 'guest_crm',
    keywords: ['crm', 'vip', 'preferences', 'watchlist', 'consent']
  },
  {
    to: '/operations-compliance',
    label: 'Operations Compliance',
    icon: ShieldCheck,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'operations_compliance',
    tier: 'Enterprise',
    capability: 'operations_compliance.view',
    moduleKey: 'operations_compliance',
    keywords: ['compliance', 'incident', 'visitor', 'emergency', 'linen']
  },
  {
    to: '/multi-outlet-pos',
    label: 'Multi-Outlet POS',
    icon: ShoppingCart,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'multi_outlet_pos',
    tier: 'Enterprise',
    capability: 'pos.view',
    moduleKey: 'multi_outlet_pos',
    keywords: ['multi outlet', 'pos pro', 'transfers', 'outlet stock']
  },

  {
    to: '/corporate-billing',
    label: 'Corporate Billing',
    icon: Receipt,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'corporate_accounts',
    tier: 'Enterprise',
    capability: 'corporate_billing.manage',
    moduleKey: 'corporate_accounts',
    keywords: ['corporate billing', 'company charges', 'group billing']
  },
  {
    to: '/documents',
    label: 'Documents',
    icon: FileText,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'documents',
    tier: 'Enterprise',
    capability: 'documents.view',
    moduleKey: 'documents',
    keywords: ['templates', 'forms', 'registration cards', 'statements']
  },
  {
    to: '/hotel-roles',
    label: 'Hotel Roles',
    icon: UserCog,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'hotel_roles',
    tier: 'Enterprise',
    capability: 'hotel_roles.view',
    moduleKey: 'hotel_roles',
    keywords: ['role templates', 'staff positions', 'hotel permissions']
  },
  {
    to: '/night-audit-enterprise',
    label: 'Night Audit (Enterprise)',
    icon: Moon,
    // Lodge shell: deep-link / Command Central only (not daily sidebar clutter).
    // Hotel product surfaces Night Audit through HotelLayout / hotelNav.
    types: ['lodge', 'hotel'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'night_audit_enterprise',
    tier: 'Enterprise',
    capability: 'night_audit.close',
    moduleKey: 'night_audit_enterprise',
    keywords: ['night audit', 'enterprise audit', 'reopen', 'exception', 'day cutover', 'force close']
  },
  {
    to: '/checkin-workflow',
    label: 'Check-in Workflow',
    icon: LogIn,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'checkin_workflow',
    tier: 'Enterprise',
    capability: 'checkin.manage',
    moduleKey: 'checkin_workflow',
    keywords: ['check-in', 'check-out', 'checklist', 'steps']
  },
  {
    to: '/early-late-checkout',
    label: 'Early / Late Checkout',
    icon: Clock,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'early_late_checkout',
    tier: 'Enterprise',
    capability: 'early_checkin.manage',
    moduleKey: 'early_late_checkout',
    keywords: ['early check-in', 'late checkout', 'fee', 'approval']
  },
  {
    to: '/cancellation-policies',
    label: 'Cancellation Policies',
    icon: Ban,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'cancellation_policies',
    tier: 'Enterprise',
    capability: 'cancellation.manage',
    moduleKey: 'cancellation_policies',
    keywords: ['cancellation', 'no-show', 'fee', 'deposit', 'approval']
  },
  {
    to: '/booking-engine',
    label: 'Booking Engine',
    icon: Calculator,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'advanced_booking_engine',
    tier: 'Enterprise',
    capability: 'advanced_booking_engine.view',
    moduleKey: 'advanced_booking_engine',
    keywords: ['booking engine', 'price calculation', 'availability', 'yield']
  },
  {
    to: '/rate-calendar',
    label: 'Rate Calendar',
    icon: CalendarRange,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'advanced_rates',
    tier: 'Enterprise',
    capability: 'rate_plans.view',
    moduleKey: 'rate_calendar',
    keywords: ['rate calendar', 'seasonal rates', 'pricing', 'restrictions']
  },
  {
    to: '/group-operations',
    label: 'Group Operations',
    icon: Users,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'group_operations',
    tier: 'Enterprise',
    capability: 'group_operations.manage',
    moduleKey: 'group_operations',
    keywords: ['group', 'block booking', 'group check-in', 'tour']
  },
  {
    to: '/promo-codes',
    label: 'Promo Codes',
    icon: Tag,
    types: ['lodge'],
    hideFromSidebar: true,
    group: 'Hotel',
    feature: 'advanced_rates',
    tier: 'Enterprise',
    capability: 'promo_codes.manage',
    moduleKey: 'advanced_rates',
    keywords: ['promo codes', 'discount', 'promotion', 'offer']
  },
  {
    to: '/workforce',
    label: 'Workforce Management',
    icon: Users,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'workforce_management',
    tier: 'Enterprise',
    capability: 'workforce_scheduling.view',
    moduleKey: 'workforce_management',
    keywords: ['staff', 'scheduling', 'shifts', 'attendance', 'handover']
  },
  {
    to: '/assets',
    label: 'Asset Management',
    icon: Wrench,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'asset_management',
    tier: 'Enterprise',
    capability: 'asset_registry.view',
    moduleKey: 'asset_management',
    keywords: ['assets', 'equipment', 'registry', 'warranty', 'preventive']
  },
  {
    to: '/venues',
    label: 'Venue Management',
    icon: Presentation,
    types: ['lodge'],
    group: 'Hotel',
    feature: 'venue_management',
    tier: 'Enterprise',
    capability: 'venue_management.view',
    moduleKey: 'venue_management',
    keywords: ['venues', 'events', 'packages', 'run sheet', 'supplier']
  },
]
export const NAV_GROUPS = ['Home', 'Front Desk', 'Sell', 'Property', 'Stock', 'Team', 'Money', 'Growth', 'Control', 'Finance', 'Hotel']

export function getDesktopNavItems(bizType, access, propertyType = null, subscriptionPlan = null, addons = [], operatingProfile = null, productId = null) {
  const navProductId = resolveNavProductId(productId)
  // LodgingOS must not surface HotelOS enterprise navigation or locked hotel
  // upgrade clutter (including motel, which is hotel-class by property type but
  // ships on the Lodge product). Hotel product uses HotelLayout, not this shell.
  const lodgeProductScoped = navProductId === 'lodge-camp'
  const normalizedPropertyType = normalizePropertyType(propertyType || bizType)
  const normalizedPlan = normalizeSubscriptionPlan(subscriptionPlan)
  // Lodge product never enters hotel nav mode — hotel-class types stay lodge ops.
  const hotelMode = !lodgeProductScoped && isHotelPropertyType(normalizedPropertyType)
  const barOnlyMode = normalizedPropertyType === 'restaurant' && isBarOnlyMode(operatingProfile)
  // On lodge product, never inherit pure hotel-type entries via bizType=hotel.
  const effectiveBizType = lodgeProductScoped && bizType === 'hotel' ? 'lodge' : bizType

  return ALL_NAV.reduce((acc, item) => {
    // Hotel properties inherit lodge navigation plus hotel-only entries.
    const typeMatch = item.types.includes(effectiveBizType)
      || (effectiveBizType === 'hotel' && item.types.includes('lodge'))
    if (!typeMatch) return acc
    if (item.hideFromSidebar) return acc
    if (hotelMode && item.hideInHotelMode) return acc
    if (barOnlyMode && item.barOnlyHidden) return acc
    if (item.barOnlyOnly && !barOnlyMode) return acc

    // Lodge product: hotel-only catalog modules and pure hotel-type rail items stay out.
    if (lodgeProductScoped) {
      if (item.types?.length === 1 && item.types[0] === 'hotel') return acc
      if (item.moduleKey) {
        const mod = getModuleByKey(item.moduleKey)
        if (mod?.visibility === 'hotel_only') return acc
      }
    }

    let visibility = null
    let isLocked = false

    if (item.moduleKey) {
      // Lodge product evaluates visibility as a non-hotel property so hotel_only
      // modules cannot flip to locked just because settings.property_type is motel.
      const visibilityPropertyType = lodgeProductScoped && isHotelPropertyType(normalizedPropertyType)
        ? 'lodge'
        : normalizedPropertyType
      visibility = resolveModuleVisibility(item.moduleKey, visibilityPropertyType, normalizedPlan, addons)
      if (visibility === MODULE_VISIBILITY_STATES.hidden) return acc
      if (visibility === MODULE_VISIBILITY_STATES.locked) isLocked = true
    } else {
      visibility = MODULE_VISIBILITY_STATES.visible
    }

    // Lodge product: never show locked Hotel-group upsells as daily nav clutter.
    if (lodgeProductScoped && isLocked && item.group === 'Hotel') return acc

    if (!isLocked) {
      if (item.capability && access?.allowedByRole?.[item.capability] !== true) return acc
    }

    acc.push({ ...item, visibility, isLocked })
    return acc
  }, [])
}

export function getNavItemVisibility(item, propertyType, subscriptionPlan, addons = []) {
  if (!item.moduleKey) return MODULE_VISIBILITY_STATES.visible

  const normalizedPropertyType = normalizePropertyType(propertyType)
  const normalizedPlan = normalizeSubscriptionPlan(subscriptionPlan)

  return resolveModuleVisibility(item.moduleKey, normalizedPropertyType, normalizedPlan, addons)
}

export function getNavGroupsByVisibility(propertyType, subscriptionPlan, addons = []) {
  const normalizedPropertyType = normalizePropertyType(propertyType)
  const normalizedPlan = normalizeSubscriptionPlan(subscriptionPlan)
  const hotelMode = isHotelPropertyType(normalizedPropertyType)

  const groups = {}

  for (const item of ALL_NAV) {
    if (!item.group) continue
    if (item.hideFromSidebar) continue
    if (hotelMode && item.hideInHotelMode) continue

    const visibility = getNavItemVisibility(item, normalizedPropertyType, normalizedPlan, addons)
    if (visibility === MODULE_VISIBILITY_STATES.hidden) continue

    if (!groups[item.group]) {
      groups[item.group] = []
    }

    groups[item.group].push({
      ...item,
      visibility
    })
  }

  return groups
}

export function isHotelNavEnabled(propertyType) {
  return isHotelPropertyType(normalizePropertyType(propertyType))
}
