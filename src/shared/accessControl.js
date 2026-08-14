import { isCommercialFeatureIncluded } from './commercialAccess.js'

export const APP_FEATURES = [
  'reports',
  'expenses',
  'staff',
  'pwa',
  'audit',
  'conference',
  'pool',
  'import',
  'pos',
  'inventory',
  'supplies',
  'online_booking',
  'restaurant_accounting',
  'inventory_advanced',
  'workforce_management',
  'payroll',
  'customer_accounts',
  'multi_outlet_controls',
  'advanced_reports'
]

export const FEATURE_LABELS = {
  reports: 'Reports & analytics',
  expenses: 'Expenses',
  staff: 'Staff management',
  pwa: 'Manager Mobile App',
  audit: 'Night audit',
  conference: 'Conference bookings',
  pool: 'Day use / pool',
  import: 'Data import',
  pos: 'POS / bar',
  inventory: 'Inventory',
  supplies: 'Room supplies',
  online_booking: 'Online booking site',
  front_desk_dashboard: 'Hotel front desk dashboard',
  room_moves: 'Room moves',
  room_attributes: 'Room attributes',
  advanced_reports: 'Enterprise reports',
  rate_calendar: 'Rate calendar',
  promo_codes: 'Promo codes',
  maintenance_enterprise: 'Maintenance Enterprise',
  group_operations: 'Group operations',
  documents: 'Document system',
  hotel_roles: 'Hotel role templates',
  night_audit_enterprise: 'Night audit Enterprise',
  checkin_workflow: 'Check-in / check-out workflow',
  early_late_checkout: 'Early check-in / late checkout',
  cancellation_policies: 'Cancellation policies',
  advanced_booking_engine: 'Advanced booking engine',
  workforce_management: 'Workforce management',
  asset_management: 'Asset management',
  venue_management: 'Venue management',
  restaurant_accounting: 'Accounting',
  inventory_advanced: 'Stock & Purchasing Pro',
  payroll: 'Payroll',
  customer_accounts: 'Customer accounts & loyalty',
  multi_outlet_controls: 'Multi-outlet control'
}

export const CAPABILITY_LABELS = {
  'dashboard.view': 'Dashboard',
  'bookings.view': 'View bookings',
  'bookings.manage': 'Create and edit bookings',
  'payments.record': 'Record payments',
  'payments.refund': 'Issue refunds',
  'quotations.view': 'View quotations',
  'quotations.manage': 'Create and convert quotations',
  'invoices.view': 'View invoices',
  'invoices.send': 'Send invoices and receipts',
  'guests.view': 'View guest profiles',
  'guests.manage': 'Edit guest profiles',
  'guests.blacklist': 'Blacklist guests',
  'rooms.view': 'View rooms',
  'rooms.manage': 'Edit rooms and rates',
  'housekeeping.manage': 'Update housekeeping',
  'maintenance.view': 'View maintenance',
  'maintenance.manage': 'Manage maintenance',
  'maintenance.preventive': 'Manage preventive maintenance',
  'maintenance.ooo': 'Set rooms out of order',
  'reports.view': 'View reports',
  'expenses.view': 'View expenses',
  'expenses.manage': 'Manage expenses',
  'audit.view': 'Run night audit',
  'staff.view': 'View staff',
  'staff.manage': 'Manage staff accounts',
  'staff.permissions': 'Set staff roles and access',
  'conference.view': 'View conference bookings',
  'conference.manage': 'Manage conference bookings',
  'pool.view': 'View day use entries',
  'pool.manage': 'Manage day use entries',
  'pos.view': 'View POS',
  'pos.service': 'Run table service, reservations and waitlist',
  'pos.manage': 'Manage POS orders',
  'pos.void': 'Void POS orders',
  'pos.discount': 'Apply discounts',
  'pos.price_override': 'Override item prices',
  'pos.menu_manage': 'Manage POS menu items',
  'pos.cashup': 'Open shifts and reconcile cash-up',
  'pos.reports': 'View outlet POS reports',
  'pos.combined_reports': 'View combined company P&L and cross-outlet reports',
  'inventory.view': 'View inventory',
  'inventory.manage': 'Manage inventory',
  'supplies.view': 'View room supplies',
  'supplies.manage': 'Manage room supplies',
  'data.import': 'Import data',
  'data.export': 'Export data',
  'settings.view': 'View settings',
  'settings.manage_general': 'Manage lodge settings',
  'settings.manage_subscription': 'Manage subscription and activation',
  'system.health': 'View system health',
  'sync.manage': 'Retry and clear sync issues',
  'backup.manage': 'Manage backups',
  'admin.clients': 'Manage client portfolio',
  'admin.licensing': 'Manage licensing',
  'admin.overrides': 'Manage feature overrides',
  'admin.billing': 'Manage billing and invoices',
  'admin.support': 'Manage support and broadcasts',
  'online_booking.manage': 'Manage online booking settings',
  'hotel_mode.view': 'Hotel mode',
  'room_types.view': 'View room types',
  'room_types.manage': 'Manage room types',
  'room_attributes.view': 'View room attributes',
  'room_attributes.manage': 'Manage room attributes',
  'physical_inventory.view': 'View physical room inventory',
  'floors_sections.view': 'View floors and sections',
  'floors_sections.manage': 'Manage floors and sections',
  'front_desk_dashboard.view': 'View hotel front desk dashboard',
  'room_moves.view': 'View room moves',
  'room_moves.manage': 'Move guests between rooms',
  'folios.view': 'View hotel folios',
  'folios.manage': 'Post hotel folio charges',
  'advanced_housekeeping.view': 'View advanced housekeeping',
  'hotel_kpis.view': 'View hotel KPIs',
  'corporate_accounts.view': 'View corporate accounts',
  'corporate_accounts.manage': 'Manage corporate accounts',
  'rate_plans.view': 'View rate plans',
  'rate_plans.manage': 'Manage rate plans',
  'payment_gateway.view': 'View payment gateway settings',
  'payment_gateway.manage': 'Manage payment gateway settings',
  'lost_found.view': 'View lost & found items',
  'lost_found.manage': 'Manage lost & found items',
  'channel_manager.manage': 'Manage channel mappings and sync',
  'documents.manage': 'Manage document templates',
  'documents.generate': 'Generate documents',
  'incident_log.view': 'View incident log',
  'incident_log.manage': 'Manage incident log',
  'visitor_register.view': 'View visitor register',
  'visitor_register.manage': 'Manage visitor register',
  'linen_laundry.view': 'View linen & laundry',
  'linen_laundry.manage': 'Manage linen & laundry',
  'emergency_list.view': 'View emergency list',
  'advanced_rates.view': 'View advanced rates',
  'rate_calendar.view': 'View rate calendar',
  'rate_calendar.manage': 'Manage rate calendar',
  'promo_codes.manage': 'Manage promo codes',
  'night_audit.close': 'Close night audit',
  'night_audit.reopen': 'Reopen night audit',
  'night_audit.checks': 'Run night audit checks',
  'checkin.manage': 'Manage check-in workflow',
  'checkout.manage': 'Manage check-out workflow',
  'early_checkin.manage': 'Manage early check-in',
  'late_checkout.manage': 'Manage late checkout',
  'cancellation.manage': 'Manage cancellation policies',
  'cancellation.approve': 'Approve cancellations',
  'revenue_manager.view': 'View revenue manager',
  'advanced_reports.view': 'View advanced reports',
  'reports.export': 'Export reports',
  'accounting.export': 'Export restaurant accounting reports',
  'accounting.close': 'Prepare, approve, or reopen accounting periods',
  'accounting.payroll_export': 'Export private payroll reports',
  'hardware.configure': 'Configure POS hardware and devices',
  'advanced_rates.manage': 'Manage advanced rates',
  'guest_portal.view': 'View guest portal',
  'multi_outlet_pos.view': 'View multi-outlet POS',
  'multi_property.view': 'View multi-property dashboard',
  'guest_messaging.manage': 'Manage guest messaging templates',
  'guest_messaging.send': 'Send guest messages',
  'guest_portal.configure': 'Configure guest portal',
  'advanced_booking_engine.view': 'View advanced booking engine',
  'advanced_booking_engine.manage': 'Manage advanced booking engine',
  'guest_crm.view': 'View guest CRM profiles',
  'guest_crm.manage': 'Manage guest CRM',
  'guest_crm.vip': 'Set VIP levels',
  'guest_crm.blacklist': 'Manage blacklist',
  'housekeeping.assign': 'Assign housekeeping',
  'housekeeping.inspect': 'Inspect rooms',
  'linen.manage': 'Manage linen/laundry',
  'lost_found.manage': 'Manage lost and found',
  'incidents.manage': 'Manage incidents',
  'visitors.manage': 'Manage visitor register',
  'emergency.view': 'View emergency/evacuation list',
  'shift_handover.manage': 'Manage shift handover',
  'corporate_billing.manage': 'Manage corporate billing',
  'corporate_billing.charge': 'Charge to corporate account',
  'group_operations.manage': 'Manage group check-in/out',
  'multi_property.manage': 'Manage property groups',
  'multi_property.switch': 'Switch between properties',
  'operations_compliance.view': 'View operations compliance',
  'operations_compliance.manage': 'Manage operations compliance',
  'workforce_scheduling.view': 'View workforce scheduling',
  'workforce_scheduling.manage': 'Manage workforce scheduling',
  'asset_registry.view': 'View asset registry',
  'asset_registry.manage': 'Manage asset registry',
  'venue_management.view': 'View venue management',
  'venue_management.manage': 'Manage venue management',
  'restaurant_accounting.view': 'View restaurant accounting',
  'restaurant_accounting.manage': 'Manage restaurant accounting',
  'restaurant_payroll.view': 'View restaurant payroll',
  'restaurant_payroll.manage': 'Manage restaurant payroll',
  'accounting.read': 'View restaurant accounting',
  'accounting.manage': 'Prepare restaurant accounting work',
  'accounting.ap_pay': 'Pay approved restaurant supplier bills',
  'accounting.bank_approve': 'Approve restaurant bank reconciliation',
  'accounting.tax_file': 'Record restaurant tax filing evidence',
  'accounting.payroll_view': 'View private restaurant payroll',
  'accounting.payroll_manage': 'Prepare and approve restaurant payroll'
}

Object.assign(CAPABILITY_LABELS, {
  'command_central.view': 'View Command Central',
  'command_central.companies.manage': 'Manage Command Central companies',
  'command_central.licensing.manage': 'Manage Command Central licensing',
  'command_central.billing.manage': 'Manage Command Central commercial billing',
  'command_central.releases.manage': 'Manage Command Central releases',
  'command_central.support.manage': 'Manage Command Central support',
  'command_central.security.manage': 'Manage Command Central security',
  'command_central.destructive.manage': 'Perform Command Central destructive actions'
})

export const ALL_CAPABILITIES = Object.keys(CAPABILITY_LABELS)

export const STAFF_STATUSES = ['active', 'suspended', 'archived']

export const STAFF_STATUS_LABELS = {
  active: 'Active',
  suspended: 'Suspended',
  archived: 'Archived'
}

export const ROLE_DEFINITIONS = {
  cashier: {
    label: 'POS Operator',
    description: 'POS terminal access for a single outlet. Suitable for cashiers or waiters who take orders, handle payments, and cash up.',
    accent: 'orange',
    highlights: ['POS Terminal', 'Create Orders', 'Cash-Up', 'Outlet-scoped']
  },
  supervisor: {
    label: 'POS Supervisor',
    description: 'POS access with void, discount, and price-override rights. Limited to assigned outlets.',
    accent: 'teal',
    highlights: ['POS Terminal', 'Void Orders', 'Discounts', 'POS Reports']
  },
  receptionist: {
    label: 'Receptionist',
    description: 'Front-desk operations, guests, quotations, invoices, and payment collection.',
    accent: 'emerald',
    highlights: ['Bookings', 'Guests', 'Invoices', 'Payments']
  },
  operations: {
    label: 'Operations',
    description: 'Rooms, housekeeping, and maintenance oversight without finance access.',
    accent: 'amber',
    highlights: ['Rooms', 'Housekeeping', 'Maintenance']
  },
  finance: {
    label: 'Finance',
    description: 'Payments, refunds, expenses, reports, and invoice follow-up.',
    accent: 'sky',
    highlights: ['Payments', 'Refunds', 'Reports', 'Expenses']
  },
  manager: {
    label: 'Manager',
    description: 'Daily operations leader. Can run the lodge and manage staff, but does not own deeper system administration.',
    accent: 'violet',
    highlights: ['Operations', 'Staff', 'Reports', 'Approvals']
  },
  admin: {
    label: 'Admin',
    description: 'System owner for lodge configuration, subscription, recovery tools, and higher-risk controls.',
    accent: 'rose',
    highlights: ['System controls', 'Subscription', 'Backups', 'Recovery']
  },
  super_admin: {
    label: 'Super Admin',
    description: 'Tsa Bonno internal access across clients, licensing, billing, and support.',
    accent: 'slate',
    highlights: ['Client portfolio', 'Licensing', 'Billing', 'Support']
  }
}

export const PWA_ELIGIBLE_ROLES = ['manager', 'admin']

// Roles that bypass outlet restrictions and have full POS access
export const POS_FULL_ACCESS_ROLES = ['manager', 'admin', 'super_admin']

// Roles that require outlet assignment to access POS
export const POS_OUTLET_SCOPED_ROLES = ['cashier', 'supervisor']

const ROLE_CAPABILITIES = {
  cashier: [
    'pos.view',
    'pos.service',
    'pos.manage'
  ],
  supervisor: [
    'pos.view',
    'pos.service',
    'pos.manage',
    'pos.void',
    'pos.discount',
    'pos.price_override',
    'pos.cashup',
    'pos.reports',
    'reports.export'
  ],
  receptionist: [
    'dashboard.view',
    'bookings.view',
    'bookings.manage',
    'payments.record',
    'quotations.view',
    'quotations.manage',
    'invoices.view',
    'invoices.send',
    'guests.view',
    'guests.manage',
    'rooms.view',
    'housekeeping.manage',
    'maintenance.view',
    'conference.view',
    'conference.manage',
    'pool.view',
    'pool.manage',
    'settings.view',
    'system.health'
  ],
  operations: [
    'dashboard.view',
    'bookings.view',
    'guests.view',
    'rooms.view',
    'rooms.manage',
    'housekeeping.manage',
    'maintenance.view',
    'maintenance.manage',
    'maintenance.preventive',
    'maintenance.ooo',
    'settings.view',
    'system.health'
  ],
  finance: [
    'dashboard.view',
    'bookings.view',
    'payments.record',
    'payments.refund',
    'quotations.view',
    'invoices.view',
    'invoices.send',
    'guests.view',
    'reports.view',
    'reports.export',
    'expenses.view',
    'expenses.manage',
    'audit.view',
    'settings.view',
    'settings.manage_subscription',
    'accounting.read',
    'accounting.manage',
    'accounting.ap_pay',
    'accounting.bank_approve',
    'accounting.tax_file',
    'accounting.export',
    'accounting.close',
    'system.health'
  ],
  manager: [
    'dashboard.view',
    'bookings.view',
    'bookings.manage',
    'payments.record',
    'payments.refund',
    'quotations.view',
    'quotations.manage',
    'invoices.view',
    'invoices.send',
    'guests.view',
    'guests.manage',
    'guests.blacklist',
    'rooms.view',
    'rooms.manage',
    'housekeeping.manage',
    'maintenance.view',
    'maintenance.manage',
    'maintenance.preventive',
    'maintenance.ooo',
    'reports.view',
    'reports.export',
    'expenses.view',
    'expenses.manage',
    'audit.view',
    'staff.view',
    'staff.manage',
    'staff.permissions',
    'conference.view',
    'conference.manage',
    'pool.view',
    'pool.manage',
    'data.import',
    'data.export',
    'settings.view',
    'settings.manage_general',
    'system.health',
    'accounting.read',
    'accounting.export',
    'pos.view',
    'pos.service',
    'pos.manage',
    'pos.void',
    'pos.discount',
    'pos.price_override',
    'pos.menu_manage',
    'pos.cashup',
    'pos.reports',
    'pos.combined_reports',
    'inventory.view',
    'inventory.manage',
    'hotel_mode.view',
    'room_types.view',
    'room_types.manage',
    'physical_inventory.view',
    'floors_sections.view',
    'floors_sections.manage',
    'front_desk_dashboard.view',
    'room_moves.view',
    'room_moves.manage',
    'folios.view',
    'folios.manage',
    'advanced_housekeeping.view',
    'hotel_kpis.view',
    'corporate_accounts.view',
    'corporate_accounts.manage',
    'rate_plans.view',
    'rate_plans.manage',
    'lost_found.view',
    'lost_found.manage',
    'incident_log.view',
    'incident_log.manage',
    'visitor_register.view',
    'visitor_register.manage',
    'linen_laundry.view',
    'linen_laundry.manage',
    'emergency_list.view',
    'workforce_scheduling.view',
    'workforce_scheduling.manage',
    'asset_registry.view',
    'asset_registry.manage',
    'venue_management.view',
    'venue_management.manage'
  ],
  admin: [
    ...ALL_CAPABILITIES.filter((capability) => capability.startsWith('admin.') === false)
  ],
  super_admin: [...ALL_CAPABILITIES]
}

const CAPABILITY_FEATURE_REQUIREMENTS = {
  'reports.view': 'reports',
  'expenses.view': 'expenses',
  'expenses.manage': 'expenses',
  'audit.view': 'audit',
  'staff.view': 'staff',
  'staff.manage': 'staff',
  'staff.permissions': 'staff',
  'conference.view': 'conference',
  'conference.manage': 'conference',
  'pool.view': 'pool',
  'pool.manage': 'pool',
  'data.import': 'import',
  'pos.view': 'pos',
  'pos.service': 'pos',
  'pos.manage': 'pos',
  'pos.void': 'pos',
  'pos.discount': 'pos',
  'pos.price_override': 'pos',
  'pos.menu_manage': 'pos',
  'pos.cashup': 'pos',
  'pos.reports': 'pos',
  'pos.combined_reports': 'reports',
  'inventory.view': 'inventory',
  'inventory.manage': 'inventory',
  'supplies.view': 'supplies',
  'supplies.manage': 'supplies',
  'online_booking.manage': 'online_booking',
  'hotel_mode.view': 'hotel_mode',
  'room_types.view': 'room_types',
  'room_types.manage': 'room_types',
  'room_attributes.view': 'room_attributes',
  'room_attributes.manage': 'room_attributes',
  'physical_inventory.view': 'physical_inventory',
  'floors_sections.view': 'floors_sections',
  'floors_sections.manage': 'floors_sections',
  'front_desk_dashboard.view': 'front_desk_dashboard',
  'room_moves.view': 'room_moves',
  'room_moves.manage': 'room_moves',
  'folios.view': 'folios',
  'folios.manage': 'folios',
  'advanced_housekeeping.view': 'advanced_housekeeping',
  'hotel_kpis.view': 'hotel_kpis',
  'corporate_accounts.view': 'corporate_accounts',
  'corporate_accounts.manage': 'corporate_accounts',
  'rate_plans.view': 'rate_plans',
  'rate_plans.manage': 'rate_plans',
  'payment_gateway.view': 'payment_gateway',
  'payment_gateway.manage': 'payment_gateway',
  'lost_found.view': 'lost_found',
  'lost_found.manage': 'lost_found',
  'incident_log.view': 'incident_log',
  'incident_log.manage': 'incident_log',
  'visitor_register.view': 'visitor_register',
  'visitor_register.manage': 'visitor_register',
  'linen_laundry.view': 'linen_laundry',
  'linen_laundry.manage': 'linen_laundry',
  'emergency_list.view': 'emergency_list',
  'rate_calendar.view': 'rate_calendar',
  'rate_calendar.manage': 'rate_calendar',
  'promo_codes.manage': 'promo_codes',
  'revenue_manager.view': 'revenue_manager',
  'advanced_reports.view': 'advanced_reports',
  'reports.export': 'reports',
  'accounting.export': 'restaurant_accounting',
  'accounting.close': 'restaurant_accounting',
  'accounting.payroll_export': 'restaurant_accounting',
  'advanced_rates.view': 'advanced_rates',
  'advanced_rates.manage': 'advanced_rates',
  'guest_portal.view': 'guest_portal',
  'advanced_booking_engine.view': 'advanced_booking_engine',
  'advanced_booking_engine.manage': 'advanced_booking_engine',
  'multi_outlet_pos.view': 'multi_outlet_pos',
  'multi_property.view': 'multi_property',
  'guest_messaging.manage': 'guest_messaging',
  'guest_messaging.send': 'guest_messaging',
  'guest_portal.configure': 'guest_portal',
  'guest_crm.view': 'customer_accounts',
  'guest_crm.manage': 'customer_accounts',
  'guest_crm.vip': 'customer_accounts',
  'guest_crm.blacklist': 'customer_accounts',
  'channel_manager.view': 'channel_manager',
  'channel_manager.manage': 'channel_manager',
  'documents.view': 'documents',
  'documents.manage': 'documents',
  'documents.generate': 'documents',
  'hotel_roles.view': 'hotel_roles',
  'night_audit.close': 'night_audit_enterprise',
  'night_audit.reopen': 'night_audit_enterprise',
  'night_audit.checks': 'night_audit_enterprise',
  'housekeeping.assign': 'advanced_housekeeping',
  'housekeeping.inspect': 'advanced_housekeeping',
  'maintenance.preventive': 'maintenance_enterprise',
  'maintenance.ooo': 'maintenance_enterprise',
  'checkin.manage': 'checkin_workflow',
  'checkout.manage': 'checkin_workflow',
  'early_checkin.manage': 'early_late_checkout',
  'late_checkout.manage': 'early_late_checkout',
  'cancellation.manage': 'cancellation_policies',
  'cancellation.approve': 'cancellation_policies',
  'group_operations.manage': 'group_operations',
  'operations_compliance.view': 'operations_compliance',
  'operations_compliance.manage': 'operations_compliance',
  'workforce_scheduling.view': 'workforce_management',
  'workforce_scheduling.manage': 'workforce_management',
  'asset_registry.view': 'asset_management',
  'asset_registry.manage': 'asset_management',
  'venue_management.view': 'venue_management',
  'venue_management.manage': 'venue_management',
  'restaurant_accounting.view': 'restaurant_accounting',
  'restaurant_accounting.manage': 'restaurant_accounting',
  'restaurant_payroll.view': 'restaurant_accounting',
  'restaurant_payroll.manage': 'restaurant_accounting',
  'accounting.read': 'restaurant_accounting',
  'accounting.manage': 'restaurant_accounting',
  'accounting.ap_pay': 'restaurant_accounting',
  'accounting.bank_approve': 'restaurant_accounting',
  'accounting.tax_file': 'restaurant_accounting',
  'accounting.payroll_view': 'restaurant_accounting',
  'accounting.payroll_manage': 'restaurant_accounting'
}

export function normalizeAppRole(role) {
  const raw = String(role || '').trim().toLowerCase()
  if (raw === 'superadmin') return 'super_admin'
  if (raw === 'administrator') return 'admin'
  if (raw === 'frontdesk' || raw === 'front_desk') return 'receptionist'
  if (raw === 'ops') return 'operations'
  if (raw === 'accounts' || raw === 'accounting') return 'finance'
  if (raw === 'pos_cashier' || raw === 'barcashier' || raw === 'kitchencashier') return 'cashier'
  if (raw === 'pos_supervisor') return 'supervisor'
  if (raw in ROLE_DEFINITIONS) return raw
  return 'receptionist'
}

export function normalizeStaffStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  return STAFF_STATUSES.includes(normalized) ? normalized : 'active'
}

function getRoleDefinition(role) {
  return ROLE_DEFINITIONS[normalizeAppRole(role)] || ROLE_DEFINITIONS.receptionist
}

function normalizeCapabilityOverrides(overrides = null) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(overrides).filter(([capability, allowed]) => (
      ALL_CAPABILITIES.includes(capability) && typeof allowed === 'boolean'
    ))
  )
}

export function buildCapabilitySnapshot({
  role,
  isMasterAdmin = false,
  features = {},
  capabilityOverrides = {},
  productId = null,
  commercialPackageKey = null,
  commercialAddonKeys = []
} = {}) {
  if (isMasterAdmin) {
    const allTrue = Object.fromEntries(ALL_CAPABILITIES.map((capability) => [capability, true]))
    return {
      role: 'super_admin',
      roleLabel: 'Master Admin',
      capabilities: allTrue,
      allowedByRole: allTrue,
      effectiveCapabilities: allTrue,
      blockedByFeature: {},
      capabilityOverrides: {},
      features: { ...features },
      enabledCount: ALL_CAPABILITIES.length
    }
  }

  const normalizedRole = normalizeAppRole(role)
  const normalizedOverrides = normalizeCapabilityOverrides(capabilityOverrides)
  const allowedByRole = Object.fromEntries(ALL_CAPABILITIES.map((capability) => [
    capability,
    (ROLE_CAPABILITIES[normalizedRole] || []).includes(capability)
  ]))

  const blockedByFeature = {}
  const capabilities = {}
  const effectiveCapabilities = {}

  ALL_CAPABILITIES.forEach((capability) => {
    const requiredFeature = CAPABILITY_FEATURE_REQUIREMENTS[capability]
    const roleAllows = allowedByRole[capability] === true
    const featureBlocked = Boolean(requiredFeature) && features?.[requiredFeature] === false
    const commercialBlocked = Boolean(requiredFeature) && !isCommercialFeatureIncluded(
      productId,
      commercialPackageKey,
      requiredFeature,
      commercialAddonKeys
    )
    const override = Object.prototype.hasOwnProperty.call(normalizedOverrides, capability)
      ? normalizedOverrides[capability]
      : null

    if (featureBlocked || commercialBlocked) {
      blockedByFeature[capability] = commercialBlocked ? `commercial:${requiredFeature}` : requiredFeature
    }
    capabilities[capability] = roleAllows && !featureBlocked && !commercialBlocked
    effectiveCapabilities[capability] = featureBlocked || commercialBlocked ? false : override ?? roleAllows
  })

  return {
    role: normalizedRole,
    roleLabel: getRoleDefinition(normalizedRole).label,
    capabilities: effectiveCapabilities,
    allowedByRole,
    effectiveCapabilities,
    blockedByFeature,
    capabilityOverrides: normalizedOverrides,
    productId,
    commercialPackageKey,
    commercialAddonKeys: [...new Set(Array.isArray(commercialAddonKeys) ? commercialAddonKeys : [])],
    features: { ...features },
    enabledCount: Object.values(effectiveCapabilities).filter(Boolean).length
  }
}

export function canAccessCapability(snapshot, capability) {
  return snapshot?.capabilities?.[capability] === true
}

export function getRoleOptions() {
  return Object.entries(ROLE_DEFINITIONS).map(([value, definition]) => ({
    value,
    ...definition
  }))
}

export function getRoleCapabilities(role, features = {}, capabilityOverrides = {}) {
  return buildCapabilitySnapshot({ role, features, capabilityOverrides }).capabilities
}

export function isPwaEligibleRole(role) {
  return PWA_ELIGIBLE_ROLES.includes(normalizeAppRole(role))
}

/**
 * Returns true if the role has unrestricted access to all outlets.
 * Cashier and supervisor roles are outlet-scoped and must have allowed_outlet_ids set.
 */
export function isPosFullAccessRole(role) {
  return POS_FULL_ACCESS_ROLES.includes(normalizeAppRole(role))
}

/**
 * Returns true if the role is outlet-scoped (cashier or supervisor).
 * These roles must have allowed_outlet_ids set to access POS.
 */
export function isPosOutletScopedRole(role) {
  return POS_OUTLET_SCOPED_ROLES.includes(normalizeAppRole(role))
}
