import { normalizePropertyType, isHotelPropertyType, isRestaurantOnly } from './propertyTypes.js'
import { normalizeSubscriptionPlan } from './subscriptionPlans.js'

export const MODULE_CATEGORIES = {
  core: 'core',
  front_desk: 'front_desk',
  property: 'property',
  finance: 'finance',
  team: 'team',
  hotel: 'hotel',
  enterprise: 'enterprise',
  addon: 'addon'
}

export const MODULE_VISIBILITY_STATES = {
  visible: 'visible',
  locked: 'locked',
  hidden: 'hidden'
}

export const MODULE_CATALOG = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Overview of property performance and key metrics',
    category: MODULE_CATEGORIES.core,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/'],
    capabilities: ['dashboard.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'bookings',
    label: 'Bookings',
    description: 'Manage reservations and guest stays',
    category: MODULE_CATEGORIES.front_desk,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/bookings'],
    capabilities: ['bookings.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'quotations',
    label: 'Quotations',
    description: 'Create and send price quotes to guests',
    category: MODULE_CATEGORIES.front_desk,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/quotations'],
    capabilities: ['quotations.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'invoices',
    label: 'Invoices',
    description: 'Generate and manage invoices',
    category: MODULE_CATEGORIES.front_desk,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/invoices'],
    capabilities: ['invoices.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'rooms',
    label: 'Rooms',
    description: 'Manage room inventory and availability',
    category: MODULE_CATEGORIES.property,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/rooms'],
    capabilities: ['rooms.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'guests',
    label: 'Guests',
    description: 'Guest profiles and stay history',
    category: MODULE_CATEGORIES.front_desk,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/guests'],
    capabilities: ['guests.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'housekeeping',
    label: 'Housekeeping',
    description: 'Room cleaning and turnover management',
    category: MODULE_CATEGORIES.property,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/housekeeping'],
    capabilities: ['housekeeping.manage'],
    rolloutStatus: 'live'
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    description: 'Track repairs and property issues',
    category: MODULE_CATEGORIES.property,
    requiredPlan: 'Starter',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 0,
    routes: ['/maintenance'],
    capabilities: ['maintenance.view', 'maintenance.preventive', 'maintenance.ooo'],
    rolloutStatus: 'live'
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Performance and financial reporting',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 80,
    routes: ['/reports'],
    capabilities: ['reports.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Track costs and purchases',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 75,
    routes: ['/expenses'],
    capabilities: ['expenses.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'staff',
    label: 'Staff',
    description: 'Employee management and roles',
    category: MODULE_CATEGORIES.team,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 70,
    routes: ['/staff'],
    capabilities: ['staff.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'audit',
    label: 'Night Audit',
    description: 'End-of-day reconciliation',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 65,
    routes: ['/audit'],
    capabilities: ['audit.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'conference',
    label: 'Events & Venues',
    description: 'Conference and event management',
    category: MODULE_CATEGORIES.front_desk,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['lodge', 'camp', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 60,
    routes: ['/conference'],
    capabilities: ['conference.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'pool',
    label: 'Day Use',
    description: 'Day-use and pool revenue management',
    category: MODULE_CATEGORIES.front_desk,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['lodge', 'camp', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 55,
    routes: ['/dayuse'],
    capabilities: ['pool.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'import',
    label: 'Data Management',
    description: 'Import and export lodge data',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Standard',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 50,
    routes: ['/data-management'],
    capabilities: ['data.import'],
    rolloutStatus: 'live'
  },
  {
    key: 'pwa',
    label: 'Manager Mobile App',
    description: 'Mobile owner and manager oversight',
    category: MODULE_CATEGORIES.core,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 85,
    routes: ['/custom-website'],
    capabilities: ['pwa.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'pos',
    label: 'POS',
    description: 'Point of sale for food, drinks, and extras',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 80,
    routes: ['/pos'],
    capabilities: ['pos.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Stock control and item management',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 75,
    routes: ['/inventory'],
    capabilities: ['inventory.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'restaurant_owner',
    label: 'Restaurant Owner Dashboard',
    description: 'Read-only owner view of daily POS sales, tables, and operations',
    category: MODULE_CATEGORIES.core,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 85,
    routes: ['/restaurant-owner'],
    capabilities: [],
    rolloutStatus: 'live'
  },
  {
    key: 'supplies',
    label: 'Room Supplies',
    description: 'Track room consumables and amenities',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    // Room amenities/consumables apply to every accommodation property type.
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 70,
    routes: ['/supplies'],
    capabilities: ['supplies.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'online_booking',
    label: 'Public Booking Site',
    description: 'Branded public booking page',
    category: MODULE_CATEGORIES.core,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 90,
    routes: ['/custom-website'],
    capabilities: ['online_booking.view'],
    rolloutStatus: 'live'
  },
  {
    key: 'hotel_mode',
    label: 'Hotel Mode',
    description: 'Hotel-grade property management',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 100,
    routes: ['/hotel-dashboard', '/folios', '/checkin-workflow'],
    capabilities: ['hotel_mode.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'checkin_workflow',
    label: 'Check-in / Check-out Workflow',
    description: 'Structured arrival and departure checklists with folio and room status updates',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 96,
    routes: ['/checkin-workflow'],
    capabilities: ['checkin.manage', 'checkout.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'room_types',
    label: 'Room Types',
    description: 'Manage different room categories',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 95,
    routes: ['/room-types'],
    capabilities: ['room_types.view', 'room_types.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'room_attributes',
    label: 'Room Attributes',
    description: 'Essential room attributes (view type, bed type, amenities, accessibility) for Hotel Core inventory',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 68,
    routes: ['/room-attributes'],
    capabilities: ['room_attributes.view', 'room_attributes.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'physical_inventory',
    label: 'Physical Room Inventory',
    description: 'Track individual physical rooms under room types',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 90,
    routes: ['/room-types'],
    capabilities: ['physical_inventory.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'floors_sections',
    label: 'Floors & Sections',
    description: 'Organize rooms by floors, wings, or sections',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 85,
    routes: ['/floors'],
    capabilities: ['floors_sections.view', 'floors_sections.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'front_desk_dashboard',
    label: 'Front Desk Dashboard',
    description: 'Real-time arrivals/departures/in-house board',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 100,
    routes: ['/hotel-dashboard'],
    capabilities: ['front_desk_dashboard.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'folios',
    label: 'Hotel Folios',
    description: 'Hotel-style billing with room charges',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 95,
    routes: ['/folios'],
    capabilities: ['folios.view', 'folios.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'room_moves',
    label: 'Room Moves',
    description: 'Move in-house guests between rooms',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 90,
    routes: ['/room-moves'],
    capabilities: ['room_moves.view', 'room_moves.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'advanced_housekeeping',
    label: 'Advanced Housekeeping',
    description: 'Supervisor inspection and turnaround tracking',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 80,
    routes: ['/advanced-housekeeping', '/housekeeping-command-center'],
    capabilities: ['advanced_housekeeping.view', 'housekeeping.assign', 'housekeeping.inspect'],
    rolloutStatus: 'active'
  },
  {
    key: 'hotel_kpis',
    label: 'Hotel KPIs',
    description: 'Occupancy, ADR, and RevPAR metrics',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 85,
    routes: ['/hotel-reports'],
    capabilities: ['hotel_kpis.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'corporate_accounts',
    label: 'Corporate Accounts',
    description: 'Company billing profiles, settlement, invoices, and outstanding balances (Hotel Core)',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 75,
    routes: ['/corporate', '/corporate-billing'],
    capabilities: ['corporate_accounts.view', 'corporate_accounts.manage', 'corporate_billing.manage', 'corporate_billing.charge'],
    rolloutStatus: 'active'
  },
  {
    key: 'rate_plans',
    label: 'Rate Plans',
    description: 'Basic seasonal, corporate, package, and restriction rates (Hotel Core)',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 80,
    routes: ['/rate-plans'],
    capabilities: ['rate_plans.view', 'rate_plans.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'custom_website',
    label: 'Custom Direct Booking Website',
    description: 'Custom website with your own domain',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'custom_website',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 70,
    routes: ['/custom-website'],
    capabilities: ['custom_website.view'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'payment_gateway',
    label: 'Online Payment Gateway',
    description: 'Accept online payments through your website',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'payment_gateway',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 75,
    routes: [],
    capabilities: ['payment_gateway.view', 'payment_gateway.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'channel_manager',
    label: 'Channel Manager',
    description: 'Sync availability across booking channels',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'channel_manager',
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 65,
    routes: ['/channel-manager'],
    capabilities: ['channel_manager.view', 'channel_manager.manage'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'multi_property',
    label: 'Multi-Property Dashboard',
    description: 'Manage multiple properties from one place',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'multi_property',
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 60,
    routes: ['/multi-property'],
    capabilities: ['multi_property.view', 'multi_property.manage', 'multi_property.switch'],
    rolloutStatus: 'active'
  },
  // ── Phase 10: Expanded Add-ons ──────────────────────────────────────────
  {
    key: 'advanced_rates',
    label: 'Advanced Rate Engine',
    description: 'Seasonal rates, corporate rates, package rates, promo codes, and stay restrictions',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'advanced_rates',
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 65,
    routes: ['/revenue-manager', '/promo-codes'],
    capabilities: ['rate_plans.view', 'rate_plans.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'rate_calendar',
    label: 'Rate Calendar',
    description: 'Daily rate management, seasonal pricing, and occupancy-based adjustments',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'advanced_rates',
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 64,
    routes: ['/rate-calendar'],
    capabilities: ['rate_calendar.view', 'rate_calendar.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'guest_messaging',
    label: 'Guest Messaging',
    description: 'Automated message templates, triggers, and delivery for guest communication',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'guest_messaging',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 67,
    routes: ['/guest-messaging'],
    capabilities: ['guest_messaging.manage', 'guest_messaging.send'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'guest_portal',
    label: 'Guest Portal',
    description: 'Online check-in, guest requests, preferences, and post-stay interaction',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'guest_portal',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 68,
    routes: ['/guest-portal'],
    capabilities: ['guest_portal.view', 'guest_portal.configure'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'guest_crm',
    label: 'Guest CRM',
    description: 'Guest profiles, VIP management, preferences, stay history, and consent tracking',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'guest_crm',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 69,
    routes: ['/guest-crm'],
    capabilities: ['guest_crm.view', 'guest_crm.manage', 'guest_crm.vip', 'guest_crm.blacklist'],
    rolloutStatus: 'active'
  },
  {
    key: 'advanced_reports',
    label: 'Enterprise Reports',
    description: 'Pickup, pace, source/channel, debtor aging, housekeeping, and maintenance reporting',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'advanced_reports',
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 68,
    routes: ['/enterprise-reports'],
    capabilities: ['advanced_reports.view', 'reports.export'],
    rolloutStatus: 'active'
  },
  {
    key: 'multi_outlet_pos',
    label: 'Multi-Outlet POS Pro',
    description: 'Centralized stock, cross-outlet transfers, and outlet-level profit tracking',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'multi_outlet_pos',
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 72,
    routes: ['/multi-outlet-pos'],
    capabilities: ['pos.view', 'outlets.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'linen_laundry',
    label: 'Linen & Laundry',
    description: 'Track linen stock, laundry batches, and damaged linen charges',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'linen_laundry',
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 76,
    routes: ['/linen-laundry'],
    capabilities: ['linen_laundry.view', 'linen_laundry.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'lost_found',
    label: 'Lost & Found',
    description: 'Log, track, and manage guest lost and found items',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'lost_found',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 78,
    routes: ['/lost-found'],
    capabilities: ['lost_found.view', 'lost_found.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'incident_log',
    label: 'Incident Log',
    description: 'Record and manage operational incidents and safety events',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'incident_log',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 79,
    routes: ['/incidents'],
    capabilities: ['incident_log.view', 'incident_log.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'visitor_register',
    label: 'Visitor Register',
    description: 'Track guest visitors, contractors, and day visitors',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'visitor_register',
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 80,
    routes: ['/visitors'],
    capabilities: ['visitor_register.view', 'visitor_register.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'emergency_list',
    label: 'Emergency / Evacuation List',
    description: 'Real-time guest and staff presence for emergency situations',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'emergency_list',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 82,
    routes: ['/emergency'],
    capabilities: ['emergency_list.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'subscription_builder',
    label: 'Subscription Package Builder',
    description: 'Request plan upgrades and add-ons from Settings',
    category: MODULE_CATEGORIES.core,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'always',
    upsellPriority: 50,
    routes: ['/subscription-builder'],
    capabilities: [],
    rolloutStatus: 'active'
  },
  {
    key: 'documents',
    label: 'Document System',
    description: 'Operational templates for folio, invoice, registration card, and statement rendering (Hotel Core)',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 70,
    routes: ['/documents'],
    capabilities: ['documents.view', 'documents.manage', 'documents.generate'],
    rolloutStatus: 'active'
  },
  {
    key: 'hotel_roles',
    label: 'Hotel Role Templates',
    description: 'Predefined role templates for hotel-specific staff positions (Hotel Core)',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 65,
    routes: ['/hotel-roles'],
    capabilities: ['hotel_roles.view'],
    rolloutStatus: 'active'
  },
  {
    key: 'night_audit_enterprise',
    label: 'Night Audit (Enterprise)',
    description: 'Transactional night audit close with exception handling and reopen',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['hotel', 'motel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 95,
    routes: ['/night-audit-enterprise'],
    capabilities: ['night_audit.close', 'night_audit.reopen', 'night_audit.checks'],
    rolloutStatus: 'active'
  },
  {
    key: 'checkin_workflow',
    label: 'Check-in / Check-out Workflow',
    description: 'Structured check-in and check-out checklists and configurable step management',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['hotel', 'motel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 90,
    routes: ['/checkin-workflow'],
    capabilities: ['checkin.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'early_late_checkout',
    label: 'Early Check-in / Late Checkout',
    description: 'Early check-in and late checkout policy engine with fee calculation and approval workflow',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['hotel', 'motel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 85,
    routes: ['/early-late-checkout'],
    capabilities: ['early_checkin.manage', 'late_checkout.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'cancellation_policies',
    label: 'Cancellation & No-Show Policies',
    description: 'Cancellation policy engine with fee calculation, deposit handling, and approval workflow',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['hotel', 'motel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 80,
    routes: ['/cancellation-policies'],
    capabilities: ['cancellation.manage', 'cancellation.approve'],
    rolloutStatus: 'active'
  },
  {
    key: 'advanced_booking_engine',
    label: 'Advanced Booking Engine',
    description: 'Server-side price calculations, availability checks, yield rules, and upsells',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'advanced_booking_engine',
    allowedPropertyTypes: ['motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 66,
    routes: ['/booking-engine'],
    capabilities: ['advanced_booking_engine.view', 'advanced_booking_engine.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'maintenance_enterprise',
    label: 'Maintenance (Enterprise)',
    description: 'Preventive maintenance, out-of-order rooms, downtime history, and maintenance analytics',
    category: MODULE_CATEGORIES.hotel,
    requiredPlan: 'Enterprise',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 78,
    routes: ['/maintenance-enterprise'],
    capabilities: ['maintenance.view', 'maintenance.preventive', 'maintenance.ooo'],
    rolloutStatus: 'active'
  },
  {
    key: 'group_operations',
    label: 'Group Operations',
    description: 'Group check-in, group check-out, rooming list conversion, pickup, and unsold-room release',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'group_operations',
    allowedPropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    visibility: 'hotel_only',
    upsellPriority: 77,
    routes: ['/group-operations'],
    capabilities: ['group_operations.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'operations_compliance',
    label: 'Operations Compliance',
    description: 'Compliance tracking, incident logging, visitor register, emergency lists, and linen management',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'operations_compliance',
    allowedPropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'property_type_relevant',
    upsellPriority: 81,
    routes: ['/operations-compliance'],
    capabilities: ['operations_compliance.view', 'operations_compliance.manage'],
    rolloutStatus: 'active'
  },
  {
    key: 'workforce_management',
    label: 'Workforce Management',
    description: 'Staff scheduling, shift templates, attendance, task assignment, handovers, and productivity',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'staff_operations_workforce',
    allowedPropertyTypes: ['lodge', 'motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 82,
    routes: ['/workforce'],
    capabilities: ['workforce_scheduling.view', 'workforce_scheduling.manage'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'asset_management',
    label: 'Asset Management',
    description: 'Property asset registry, equipment history, preventive schedules, warranty tracking, and vendor management',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'maintenance_asset_management',
    allowedPropertyTypes: ['lodge', 'camp', 'motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 83,
    routes: ['/assets'],
    capabilities: ['asset_registry.view', 'asset_registry.manage'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'venue_management',
    label: 'Venue Management',
    description: 'Venue packages, event planning, run sheets, supplier coordination, deposit milestones, and settlement',
    category: MODULE_CATEGORIES.addon,
    requiredPlan: 'Enterprise',
    isAddon: true,
    addonKey: 'events_venue_management',
    allowedPropertyTypes: ['lodge', 'motel', 'hotel', 'resort'],
    visibility: 'hotel_only',
    upsellPriority: 84,
    routes: ['/venues'],
    capabilities: ['venue_management.view', 'venue_management.manage'],
    rolloutStatus: 'foundation'
  },
  {
    key: 'restaurant_accounting',
    label: 'Restaurant & Bar Accounting',
    description: 'Business accounting, supplier finance, bank, tax, budgets, statements and payroll',
    category: MODULE_CATEGORIES.finance,
    requiredPlan: 'Pro',
    isAddon: false,
    addonKey: null,
    allowedPropertyTypes: ['restaurant'],
    visibility: 'property_type_relevant',
    upsellPriority: 91,
    routes: ['/restaurant/chart-of-accounts', '/restaurant/general-ledger', '/restaurant/accounts-payable', '/restaurant/bank-reconciliation', '/restaurant/tax-returns', '/restaurant/budgets', '/restaurant/balance-sheet', '/restaurant/payroll'],
    capabilities: ['restaurant_accounting.view', 'restaurant_payroll.view'],
    rolloutStatus: 'guarded'
  }
]

export function getModuleByKey(moduleKey) {
  return MODULE_CATALOG.find(m => m.key === moduleKey) || null
}

export function getModulesByCategory(category) {
  return MODULE_CATALOG.filter(m => m.category === category)
}

export function getModulesByPlan(requiredPlan) {
  return MODULE_CATALOG.filter(m => {
    const planOrder = ['Starter', 'Standard', 'Pro', 'Enterprise']
    const requiredIndex = planOrder.indexOf(m.requiredPlan)
    const planIndex = planOrder.indexOf(requiredPlan)
    return planIndex >= requiredIndex
  })
}

export function getAddonModules() {
  return MODULE_CATALOG.filter(m => m.isAddon)
}

export function getEnterpriseModules() {
  return MODULE_CATALOG.filter(m => m.requiredPlan === 'Enterprise')
}

export function resolveModuleVisibility(moduleKey, propertyType, subscriptionPlan, addons = []) {
  const module = getModuleByKey(moduleKey)
  if (!module) return MODULE_VISIBILITY_STATES.hidden

  const normalizedPropertyType = normalizePropertyType(propertyType)
  const normalizedPlan = normalizeSubscriptionPlan(subscriptionPlan)

  if (!module.allowedPropertyTypes.includes(normalizedPropertyType)) {
    return MODULE_VISIBILITY_STATES.hidden
  }

  if (module.visibility === 'hotel_only' && !isHotelPropertyType(normalizedPropertyType)) {
    return MODULE_VISIBILITY_STATES.hidden
  }

  if (isRestaurantOnly(normalizedPropertyType) && !module.allowedPropertyTypes.includes('restaurant')) {
    return MODULE_VISIBILITY_STATES.hidden
  }

  const planOrder = ['Starter', 'Standard', 'Pro', 'Enterprise']
  const requiredIndex = planOrder.indexOf(module.requiredPlan)
  const currentPlanIndex = planOrder.indexOf(normalizedPlan)

  if (currentPlanIndex >= requiredIndex) {
    if (module.isAddon && !addons.includes(module.addonKey)) {
      return MODULE_VISIBILITY_STATES.hidden
    }
    return MODULE_VISIBILITY_STATES.visible
  }

  if (module.isAddon && !addons.includes(module.addonKey)) {
    return MODULE_VISIBILITY_STATES.hidden
  }

  if (module.visibility === 'property_type_relevant' && module.allowedPropertyTypes.includes(normalizedPropertyType)) {
    return MODULE_VISIBILITY_STATES.locked
  }

  if (module.visibility === 'hotel_only' && isHotelPropertyType(normalizedPropertyType)) {
    return MODULE_VISIBILITY_STATES.locked
  }

  return MODULE_VISIBILITY_STATES.hidden
}

export function getVisibleModules(propertyType, subscriptionPlan, addons = []) {
  return MODULE_CATALOG.filter(m => {
    const visibility = resolveModuleVisibility(m.key, propertyType, subscriptionPlan, addons)
    return visibility === MODULE_VISIBILITY_STATES.visible
  })
}

export function getLockedModules(propertyType, subscriptionPlan, addons = []) {
  return MODULE_CATALOG.filter(m => {
    const visibility = resolveModuleVisibility(m.key, propertyType, subscriptionPlan, addons)
    return visibility === MODULE_VISIBILITY_STATES.locked
  })
}

export function getHiddenModules(propertyType, subscriptionPlan, addons = []) {
  return MODULE_CATALOG.filter(m => {
    const visibility = resolveModuleVisibility(m.key, propertyType, subscriptionPlan, addons)
    return visibility === MODULE_VISIBILITY_STATES.hidden
  })
}

export function getRelevantModules(propertyType, subscriptionPlan, addons = []) {
  return MODULE_CATALOG.filter(m => {
    const visibility = resolveModuleVisibility(m.key, propertyType, subscriptionPlan, addons)
    return visibility !== MODULE_VISIBILITY_STATES.hidden
  })
}

export function canAccessModule(moduleKey, propertyType, subscriptionPlan, addons = [], userCapabilities = []) {
  const visibility = resolveModuleVisibility(moduleKey, propertyType, subscriptionPlan, addons)
  if (visibility !== MODULE_VISIBILITY_STATES.visible) return false

  const module = getModuleByKey(moduleKey)
  if (!module) return false

  if (module.capabilities.length === 0) return true

  return module.capabilities.some(cap => userCapabilities.includes(cap))
}

export function getUpsellRecommendations(propertyType, subscriptionPlan, addons = []) {
  const locked = getLockedModules(propertyType, subscriptionPlan, addons)
  return locked
    .sort((a, b) => b.upsellPriority - a.upsellPriority)
    .slice(0, 5)
    .map(m => ({
      moduleKey: m.key,
      label: m.label,
      description: m.description,
      requiredPlan: m.requiredPlan,
      isAddon: m.isAddon
    }))
}
