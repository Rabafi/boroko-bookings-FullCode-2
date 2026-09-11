/**
 * LodgingOS Food & Beverage progressive module registry.
 *
 * Implements the product decision in docs/FNB_PROGRESSIVE_ACTIVATION_PLAN.md:
 * the complete F&B capability set is installed, but the default lodge
 * experience stays compact. Core service modules are on by default;
 * advanced modules are installed but off until a lodge administrator enables
 * them inside Food & Beverage.
 *
 * Module activation is a company preference, NOT a licence or permission
 * grant. Feature RPCs continue to enforce lodge, outlet, actor, capability,
 * state, and idempotency independently of the visible toggle.
 */

// Core modules are always enabled and are not toggleable. They form the
// default compact lodge experience.
export const FNB_CORE_MODULES = Object.freeze([
  { key: 'today', label: 'Today overview', description: 'Actionable counts for the current service day.' },
  { key: 'outlet-context', label: 'Outlet context', description: 'Shared property/outlet selector used across F&B.' },
  { key: 'pos-order', label: 'New order / canonical lodge POS', description: 'Sell through the canonical lodge POS.' },
  { key: 'floor', label: 'Live floor and open checks', description: 'Live tables, areas, and running tabs.' },
  { key: 'kitchen-tickets', label: 'Kitchen and bar tickets', description: 'Live preparation tickets and station timing.' },
  { key: 'menu-availability', label: 'Basic menu availability', description: 'Enable/disable items without deleting history.' },
  { key: 'inventory-entry', label: 'F&B-filtered inventory entry', description: 'Canonical lodge Inventory filtered to F&B.' },
  { key: 'pos-sales-report', label: 'Basic POS sales report', description: 'Server-confirmed POS sales evidence.' },
  { key: 'shift-cashup', label: 'Operator shift and cash-up', description: 'Operator shifts and drawer reconciliation.' }
])

export const FNB_CORE_MODULE_KEYS = Object.freeze(FNB_CORE_MODULES.map((m) => m.key))

// Optional modules are visible but disabled by default. Disabling hides
// operational navigation and stops new work; it never deletes data, reverses
// financial records, or blocks authorised reads of retained audit/history.
export const FNB_OPTIONAL_MODULES = Object.freeze([
  {
    key: 'reservations',
    label: 'Table reservations & waitlist',
    benefit: 'Take bookings ahead of service and run a fair waitlist on busy nights.',
    description: 'Table reservations, confirmations, seating, no-shows, and waitlist.',
    capability: 'pos.service',
    feature: 'pos',
    workspace: 'floor',
    tab: 'reservations',
    requiresEntitlement: 'pos'
  },
  {
    key: 'recipes',
    label: 'Recipes, costing & prep',
    benefit: 'Cost every dish, record prep batches, and explain margin variance.',
    description: 'Recipes, costing, prep batches, and recipe variance.',
    capability: 'inventory.view',
    feature: 'inventory',
    workspace: 'menu',
    tab: null,
    requiresEntitlement: 'inventory'
  },
  {
    key: 'purchasing',
    label: 'Purchasing & expiry lots',
    benefit: 'Order from suppliers, track lots and expiry, and act on reorder signals.',
    description: 'Purchasing, suppliers, reorder suggestions, and expiry lots.',
    capability: 'inventory.manage',
    feature: 'inventory',
    workspace: 'stock',
    tab: null,
    requiresEntitlement: 'inventory'
  },
  {
    key: 'room-service',
    label: 'Room-service fulfilment',
    benefit: 'Deliver food and drinks to rooms with runner tracking and folio posting.',
    description: 'Room-service order type, delivery queue, dispatch, and folio posting.',
    capability: 'pos.manage',
    feature: 'pos',
    workspace: 'room-service',
    tab: null,
    requiresEntitlement: 'pos'
  },
  {
    key: 'meal-plans',
    label: 'Meal plans & vouchers',
    benefit: 'Serve included meals and vouchers without double-charging the folio.',
    description: 'Meal-plan entitlement, redemption, vouchers, and included-meal consumption.',
    capability: 'pos.manage',
    feature: 'pos',
    workspace: 'meal-plans',
    tab: null,
    requiresEntitlement: 'pos'
  },
  {
    key: 'food-safety',
    label: 'Food safety & temperature',
    benefit: 'Prove cold-chain and hygiene checks with immutable audit evidence.',
    description: 'Food-safety check templates, temperature logs, corrective actions, allergen matrix.',
    capability: 'pos.manage',
    feature: 'pos',
    workspace: 'food-safety',
    tab: null,
    requiresEntitlement: 'pos'
  },
  {
    key: 'team',
    label: 'Team roster & tips',
    benefit: 'Plan rosters, review performance, and pay out only earned tip balances.',
    description: 'Team roster, performance, and tips.',
    capability: 'staff.view',
    feature: 'pos',
    workspace: 'team',
    tab: null,
    requiresEntitlement: 'pos'
  },
  {
    key: 'settlement',
    label: 'Settlement & customer funds',
    benefit: 'Reconcile provider settlements and hold deposits as customer liabilities.',
    description: 'Settlement and customer-funds controls.',
    capability: 'reports.view',
    feature: 'reports',
    workspace: 'finance',
    tab: null,
    requiresEntitlement: 'reports'
  },
  {
    key: 'fnb-reports',
    label: 'Consolidated F&B reporting',
    benefit: 'One server-confirmed view of sales, costs, labour, and margin.',
    description: 'Consolidated F&B performance reporting.',
    capability: 'reports.view',
    feature: 'reports',
    workspace: 'fnb-reports',
    tab: null,
    requiresEntitlement: 'reports'
  },
  {
    key: 'invoice-matching',
    label: 'Supplier invoice matching',
    benefit: 'Match ordered, received, and invoiced quantities before money leaves.',
    description: 'Supplier invoice three-way matching with variance approval.',
    capability: 'inventory.manage',
    feature: 'inventory',
    workspace: 'invoice-matching',
    tab: null,
    requiresEntitlement: 'inventory'
  },
  {
    key: 'demand-planning',
    label: 'Demand & prep planning',
    benefit: 'Turn occupancy, events, and history into prep and purchase drafts.',
    description: 'Occupancy-driven demand and prep planning (read-only recommendations).',
    capability: 'inventory.view',
    feature: 'inventory',
    workspace: 'demand-planning',
    tab: null,
    requiresEntitlement: 'inventory'
  }
])

export const FNB_OPTIONAL_MODULE_KEYS = Object.freeze(FNB_OPTIONAL_MODULES.map((m) => m.key))

export const FNB_ALL_MODULE_KEYS = Object.freeze([...FNB_CORE_MODULE_KEYS, ...FNB_OPTIONAL_MODULE_KEYS])

export function isFnbModuleKey(value) {
  return FNB_ALL_MODULE_KEYS.includes(String(value || ''))
}

export function isFnbOptionalModuleKey(value) {
  return FNB_OPTIONAL_MODULE_KEYS.includes(String(value || ''))
}

export function getFnbOptionalModule(key) {
  return FNB_OPTIONAL_MODULES.find((m) => m.key === String(key || '')) || null
}

export function getFnbModuleDefaultEnabled(key) {
  if (FNB_CORE_MODULE_KEYS.includes(String(key || ''))) return true
  return false
}

/**
 * Normalise a server preference payload into a Map keyed by module key.
 * Server rows carry { module_key, enabled, entitled, can_manage, reason, version }.
 * Missing optional modules resolve to disabled-by-default, entitled unknown.
 */
export function normalizeFnbPreferences(rows) {
  const map = new Map()
  for (const def of FNB_OPTIONAL_MODULES) {
    // Fail closed before the server responds: never claim entitlement or a
    // manageable disabled state without server proof. The panel renders these
    // as "Checking access…" with no activation action.
    map.set(def.key, {
      key: def.key,
      enabled: false,
      entitled: false,
      canManage: false,
      reason: 'entitlement_unverified',
      version: 0,
      isCore: false,
      definition: def
    })
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.module_key || row?.key || '')
    if (!isFnbOptionalModuleKey(key)) continue
    const reason = String(row?.reason || '')
    map.set(key, {
      key,
      // A module counts as enabled only when the server says so AND the
      // verified entitlement still holds (the server already masks enabled
      // when entitlement lapses; double-guard here against stale caches).
      enabled: row?.enabled === true && row?.entitled === true,
      entitled: row?.entitled === true,
      canManage: row?.can_manage === true || row?.canManage === true,
      reason,
      version: Number.isFinite(Number(row?.version)) ? Number(row.version) : 0,
      isCore: false,
      definition: getFnbOptionalModule(key)
    })
  }
  return map
}

/**
 * Resolve the operator-facing display state for one module preference.
 * The renderer must not infer entitlement from the toggle.
 */
export function resolveFnbModuleDisplayState(entry) {
  if (!entry) {
    return { state: 'unknown', actionLabel: '', message: '' }
  }
  if (entry.reason === 'entitlement_unverified') {
    return { state: 'unverified', actionLabel: 'Checking access…', message: 'Licence access is being verified. Activation is unavailable until the server confirms.' }
  }
  if (entry.enabled) return { state: 'enabled', actionLabel: 'Disable', message: '' }
  if (entry.entitled === false) {
    return { state: 'request_access', actionLabel: 'Request access', message: entry.reason || 'This lodge does not include this module.' }
  }
  if (entry.canManage === false) {
    return { state: 'ask_admin', actionLabel: 'Ask an administrator', message: entry.reason || 'An administrator can enable this module.' }
  }
  return { state: 'disabled', actionLabel: 'Enable', message: '' }
}

export function getFnbEnabledWorkspaceKeys(preferenceMap) {
  const enabled = new Set(FNB_CORE_MODULE_KEYS)
  for (const [key, entry] of preferenceMap || []) {
    if (entry?.enabled) enabled.add(key)
  }
  return enabled
}
