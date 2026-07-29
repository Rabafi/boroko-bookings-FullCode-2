export const ENTERPRISE_ADDON_CATEGORIES = {
  booking_engine: 'booking_engine',
  revenue: 'revenue',
  corporate: 'corporate',
  operations: 'operations',
  guest: 'guest',
  finance: 'finance',
  outlets: 'outlets',
  security: 'security',
  workforce: 'workforce',
  assets: 'assets',
  events: 'events',
  multi_property: 'multi_property'
}

export const ENTERPRISE_ADDON_STATUS = {
  planned: 'planned',
  requestable: 'requestable',
  active: 'active'
}

export const ENTERPRISE_ADDON_CATALOG = [
  {
    key: 'custom_website',
    label: 'Custom Direct Booking Website',
    category: ENTERPRISE_ADDON_CATEGORIES.booking_engine,
    description: 'Setup/readiness checklist. Not an operational website deployment.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['custom_website'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'payment_gateway',
    label: 'Online Payment Gateway',
    category: ENTERPRISE_ADDON_CATEGORIES.booking_engine,
    description: 'Property-owned merchant gateway integration with server-side webhook verification.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['payment_gateway'],
    status: ENTERPRISE_ADDON_STATUS.requestable,
    advertise: true,
    price: { annual: 9000, setup: 6000, pricingModel: 'published' }
  },
  {
    key: 'rate_plans',
    label: 'Rate Plans (included in Hotel Core)',
    category: ENTERPRISE_ADDON_CATEGORIES.revenue,
    description: 'Basic seasonal, corporate, package, weekday/weekend, and restriction rates are included in Hotel Core. Purchase Advanced Rate Engine for yield automation and recommendations.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['rate_plans'],
    // Included in Hotel Core — retained for legacy entitlement keys only; not sold separately.
    status: ENTERPRISE_ADDON_STATUS.active,
    advertise: false
  },
  {
    key: 'channel_manager',
    label: 'Channel Manager',
    category: ENTERPRISE_ADDON_CATEGORIES.revenue,
    description: 'Availability and rate synchronization for external booking channels.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['channel_manager'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'corporate_accounts',
    label: 'Corporate Accounts (included in Hotel Core)',
    category: ENTERPRISE_ADDON_CATEGORIES.corporate,
    description: 'Basic company profiles, billing contacts, charge allocation, invoices/statements, and settlement are included in Hotel Core. Centralised credit limits, multi-property debtors, and aging workflows remain premium reporting/ops depth.',
    eligiblePropertyTypes: ['lodge', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['corporate_accounts'],
    status: ENTERPRISE_ADDON_STATUS.active,
    advertise: false
  },
  {
    key: 'advanced_housekeeping_mobile',
    label: 'Housekeeping Mobile & Productivity',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Mobile-first housekeeping assignments and productivity analytics. Basic dirty/clean/inspect/assign readiness is included in Hotel Core.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['advanced_housekeeping'],
    // Do not re-sell core readiness; keep planned until a distinct mobile/analytics runtime ships.
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'staff_operations_workforce',
    label: 'Staff Operations & Workforce',
    category: ENTERPRISE_ADDON_CATEGORIES.workforce,
    description: 'Hotel staff scheduling, task assignment, attendance, handovers, training checklists, and workforce productivity controls.',
    eligiblePropertyTypes: ['lodge', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['staff', 'hotel_roles', 'operations_compliance'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'maintenance_asset_management',
    label: 'Maintenance & Asset Management',
    category: ENTERPRISE_ADDON_CATEGORIES.assets,
    description: 'Property asset registry, equipment history, preventive schedules, downtime analytics, warranties, and technician workflows.',
    eligiblePropertyTypes: ['lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['maintenance_enterprise', 'room_attributes', 'advanced_reports'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'events_venue_management',
    label: 'Events & Venue Management',
    category: ENTERPRISE_ADDON_CATEGORIES.events,
    description: 'Advanced hotel events, venue packages, banquet timelines, deposits, supplier coordination, group rooms, and post-event settlement.',
    eligiblePropertyTypes: ['lodge', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['conference', 'group_operations', 'folios', 'advanced_reports'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'guest_portal',
    label: 'Guest Portal',
    category: ENTERPRISE_ADDON_CATEGORIES.guest,
    description: 'Online check-in, guest requests, preferences, and post-stay interaction.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['guest_portal'],
    status: ENTERPRISE_ADDON_STATUS.requestable,
    advertise: true,
    price: { annual: 9000, setup: 5000, pricingModel: 'published' }
  },
  {
    key: 'multi_property',
    label: 'Multi-Property Dashboard',
    category: ENTERPRISE_ADDON_CATEGORIES.multi_property,
    description: 'Central office visibility, group reporting, and property switching foundations.',
    eligiblePropertyTypes: ['lodge', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['multi_property'],
    status: ENTERPRISE_ADDON_STATUS.requestable,
    advertise: true,
    price: { annual: 18000, setup: 12000, pricingModel: 'published' }
  },
  // ── Phase 10: Expanded Add-ons ──────────────────────────────────────────
  {
    key: 'advanced_rates',
    label: 'Advanced Rate Engine',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Seasonal rates, corporate rates, package rates, promo codes, and stay restrictions.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['advanced_rates', 'rate_calendar'],
    status: ENTERPRISE_ADDON_STATUS.requestable,
    advertise: true,
    price: { annual: 12000, setup: 5000, pricingModel: 'published' }
  },
  {
    key: 'linen_laundry',
    label: 'Linen & Laundry',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Track linen stock, laundry batches, and damaged linen charges.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['linen_laundry'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'lost_found',
    label: 'Lost & Found',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Log, track, and manage guest lost and found items.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['lost_found'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'incident_log',
    label: 'Incident Log',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Record and manage operational incidents and safety events.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['incident_log'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'visitor_register',
    label: 'Visitor Register',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Track guest visitors, contractors, and day visitors.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['visitor_register'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'emergency_list',
    label: 'Emergency / Evacuation List',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Real-time guest and staff presence for emergency situations.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['emergency_list'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'multi_outlet_pos',
    label: 'Multi-Outlet POS Pro',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Centralized stock, cross-outlet transfers, and outlet-level profit tracking.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['multi_outlet_pos'],
    status: ENTERPRISE_ADDON_STATUS.requestable,
    advertise: true,
    price: { annual: 9000, setup: 4000, pricingModel: 'published' }
  },
  {
    key: 'guest_messaging',
    label: 'Guest Messaging',
    category: ENTERPRISE_ADDON_CATEGORIES.guest,
    description: 'Automated message templates, triggers, and delivery for guest communication.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['guest_messaging'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'guest_crm',
    label: 'Guest CRM',
    category: ENTERPRISE_ADDON_CATEGORIES.guest,
    description: 'Guest profiles, stay history, preferences, VIP tiers, and blacklist management.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['guest_crm'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'advanced_reports',
    label: 'Advanced Reports',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Enterprise reporting across occupancy, pickup, source/channel, debtors, productivity, downtime, and exceptions.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['advanced_reports'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'documents',
    label: 'Document System (included in Hotel Core)',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Operational templates for quotations, invoices, folios, receipts, and registration cards are included in Hotel Core.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['documents'],
    status: ENTERPRISE_ADDON_STATUS.active,
    advertise: false
  },
  {
    key: 'hotel_roles',
    label: 'Hotel Role Templates (included in Hotel Core)',
    category: ENTERPRISE_ADDON_CATEGORIES.security,
    description: 'Predefined front-desk, housekeeping, and maintenance role templates are included in Hotel Core. Workforce scheduling remains a premium module.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['hotel_roles'],
    status: ENTERPRISE_ADDON_STATUS.active,
    advertise: false
  },
  {
    key: 'advanced_booking_engine',
    label: 'Advanced Booking Engine',
    category: ENTERPRISE_ADDON_CATEGORIES.booking_engine,
    description: 'Server-side price calculations, availability checks, yield rules, and upsells.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['advanced_booking_engine'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'room_attributes',
    label: 'Room Attributes (included in Hotel Core)',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Essential room attributes (view, bed type, accessibility) are included in Hotel Core. Attribute-driven selling and merchandising remain premium revenue depth.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['room_attributes'],
    status: ENTERPRISE_ADDON_STATUS.active,
    advertise: false
  },
  {
    key: 'operations_compliance',
    label: 'Operations Compliance',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Compliance tracking, incident logging, visitor register, emergency lists, and linen management.',
    eligiblePropertyTypes: ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort'],
    requiresEnterprise: true,
    moduleKeys: ['operations_compliance'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  },
  {
    key: 'group_operations',
    label: 'Group Operations',
    category: ENTERPRISE_ADDON_CATEGORIES.operations,
    description: 'Group check-in, group check-out, rooming list conversion, pickup, and unsold-room release.',
    eligiblePropertyTypes: ['motel', 'hotel', 'resort', 'lodge'],
    requiresEnterprise: true,
    moduleKeys: ['group_operations'],
    status: ENTERPRISE_ADDON_STATUS.planned,
    advertise: false
  }
]

export function getEnterpriseAddonByKey(key) {
  return ENTERPRISE_ADDON_CATALOG.find((addon) => addon.key === key) || null
}

export function getEnterpriseAddonsByStatus(status) {
  return ENTERPRISE_ADDON_CATALOG.filter((addon) => addon.status === status)
}

export function getEligibleEnterpriseAddons(propertyType) {
  return ENTERPRISE_ADDON_CATALOG.filter((addon) => addon.eligiblePropertyTypes.includes(propertyType))
}

export function getRequestableEnterpriseAddons(propertyType, enabledAddons = []) {
  return getEligibleEnterpriseAddons(propertyType)
    .filter((addon) => addon.status === ENTERPRISE_ADDON_STATUS.requestable && addon.advertise === true)
    .map((addon) => ({
      ...addon,
      enabled: isEnterpriseAddonEnabled(addon.key, enabledAddons)
    }))
}

export function isEnterpriseAddonEnabled(addonKey, enabledAddons = []) {
  return Array.isArray(enabledAddons) && enabledAddons.includes(addonKey)
}
