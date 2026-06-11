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
  'online_booking'
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
  online_booking: 'Online booking site'
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
  'pos.manage': 'Manage POS orders',
  'pos.void': 'Void POS orders',
  'pos.discount': 'Apply discounts',
  'pos.price_override': 'Override item prices',
  'pos.menu_manage': 'Manage POS menu items',
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
  'online_booking.manage': 'Manage online booking settings'
}

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
    description: 'Boroko internal access across clients, licensing, billing, and support.',
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
    'pos.manage'
  ],
  supervisor: [
    'pos.view',
    'pos.manage',
    'pos.void',
    'pos.discount',
    'pos.price_override',
    'pos.reports'
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
    'expenses.view',
    'expenses.manage',
    'audit.view',
    'settings.view',
    'settings.manage_subscription',
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
    'reports.view',
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
    'pos.view',
    'pos.manage',
    'pos.void',
    'pos.discount',
    'pos.price_override',
    'pos.menu_manage',
    'pos.reports',
    'pos.combined_reports'
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
  'pos.manage': 'pos',
  'pos.void': 'pos',
  'pos.discount': 'pos',
  'pos.price_override': 'pos',
  'pos.menu_manage': 'pos',
  'pos.reports': 'pos',
  'pos.combined_reports': 'reports',
  'inventory.view': 'inventory',
  'inventory.manage': 'inventory',
  'supplies.view': 'supplies',
  'supplies.manage': 'supplies',
  'online_booking.manage': 'online_booking'
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

export function buildCapabilitySnapshot({ role, isMasterAdmin = false, features = {}, capabilityOverrides = {} } = {}) {
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
    const override = Object.prototype.hasOwnProperty.call(normalizedOverrides, capability)
      ? normalizedOverrides[capability]
      : null

    if (featureBlocked) blockedByFeature[capability] = requiredFeature
    capabilities[capability] = roleAllows && !featureBlocked
    effectiveCapabilities[capability] = featureBlocked ? false : override ?? roleAllows
  })

  return {
    role: normalizedRole,
    roleLabel: getRoleDefinition(normalizedRole).label,
    capabilities: effectiveCapabilities,
    allowedByRole,
    effectiveCapabilities,
    blockedByFeature,
    capabilityOverrides: normalizedOverrides,
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
