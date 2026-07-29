/**
 * Bar Only operating-mode profile for Restaurant & Bar POS.
 * Single source of truth for visibility, service defaults, and bar-facing labels.
 * Does not fork financial contracts — only curates operator UX.
 */
import { getHospitalityMode, HOSPITALITY_MODES, isBarOnlyMode, isRestaurantOnly } from './propertyTypes.js'

/** Paths and prefixes blocked for bar_only (restaurant kitchen/floor/production). */
export const BAR_ONLY_BLOCKED_PATH_PREFIXES = Object.freeze([
  '/hpos/floor',
  '/hpos/kitchen',
  '/hpos/customers',
  '/hpos/expenses',
  '/hpos/growth-tools',
  '/hpos/business-control',
  '/restaurant/floor',
  '/restaurant/kitchen-workspace',
  '/restaurant/kitchen',
  '/restaurant/kitchen-analytics',
  '/restaurant/menu-production',
  '/restaurant/tables',
  '/restaurant/recipes',
  '/restaurant/purchasing',
  '/restaurant/purchase-suggestions',
  '/restaurant/lots-expiry',
  '/restaurant/reservations',
  '/restaurant/combos',
  '/restaurant/recipe-variance',
  '/restaurant/prep-batches',
  '/restaurant/staff-performance',
  '/restaurant/inventory',
  '/restaurant/finance-close',
  '/restaurant/chart-of-accounts',
  '/restaurant/general-ledger',
  '/restaurant/accounts-payable',
  '/restaurant/bank-reconciliation',
  '/restaurant/tax-returns',
  '/restaurant/budgets',
  '/restaurant/balance-sheet',
  '/restaurant/payroll',
  '/restaurant/control-workspace',
  '/restaurant/team-workspace',
  '/restaurant/outlet-control',
  '/pos/kitchen-display'
])

export const BAR_ADDON_PATH_FEATURES = Object.freeze({
  '/hpos/customers': 'customer_accounts',
  '/hpos/expenses': 'expenses',
  '/hpos/business-control': 'advanced_reports',
  '/hpos/growth-tools': 'vouchers',
  '/restaurant/inventory': 'inventory_advanced',
  '/restaurant/menu-production': 'recipes',
  '/restaurant/recipes': 'recipes',
  '/restaurant/purchasing': 'purchasing',
  '/restaurant/purchase-suggestions': 'purchase_suggestions',
  '/restaurant/lots-expiry': 'lots_expiry',
  '/restaurant/recipe-variance': 'variance',
  '/restaurant/prep-batches': 'prep',
  '/restaurant/staff-performance': 'staff_performance',
  '/restaurant/chart-of-accounts': 'restaurant_accounting',
  '/restaurant/general-ledger': 'restaurant_accounting',
  '/restaurant/accounts-payable': 'restaurant_accounting',
  '/restaurant/bank-reconciliation': 'restaurant_accounting',
  '/restaurant/tax-returns': 'restaurant_accounting',
  '/restaurant/budgets': 'restaurant_accounting',
  '/restaurant/balance-sheet': 'restaurant_accounting',
  '/restaurant/payroll': 'payroll',
  '/restaurant/team-workspace': 'workforce_management',
  '/restaurant/outlet-control': 'multi_outlet_controls'
})

/** HPOS dock items for bar_only — no floor/kitchen. */
export const HPOS_DOCK_ITEMS_BAR = Object.freeze([
  { route: '/hpos/pos', label: 'Sell', iconKey: 'sell', capability: 'pos.view' },
  { route: '/hpos/checks', label: 'Open tabs', iconKey: 'checks', capability: 'pos.view' },
  { route: '/hpos/menu', label: 'Products', iconKey: 'menu', capability: 'pos.view' },
  { route: '/hpos/stock', label: 'Stock', iconKey: 'stock', capability: 'inventory.view' },
  { route: '/hpos/cash', label: 'Cash & close', iconKey: 'cash', capability: 'pos.cashup' },
  { route: '/hpos/reports', label: 'Sales', iconKey: 'reports', capability: 'reports.view' }
])

/** HPOS dock items for restaurant service — floor and kitchen remain primary. */
export const HPOS_DOCK_ITEMS_RESTAURANT = Object.freeze([
  { route: '/hpos/pos', label: 'Sell', iconKey: 'sell', capability: 'pos.view' },
  { route: '/hpos/checks', label: 'Open checks', iconKey: 'checks', capability: 'pos.view' },
  { route: '/hpos/floor', label: 'Floor', iconKey: 'floor', capability: 'pos.view' },
  { route: '/hpos/kitchen', label: 'Kitchen', iconKey: 'kitchen', capability: 'pos.view' },
  { route: '/hpos/menu', label: 'Menu', iconKey: 'menu', capability: 'pos.view' },
  { route: '/hpos/stock', label: 'Stock', iconKey: 'stock', capability: 'inventory.view' },
  { route: '/hpos/cash', label: 'Cash & close', iconKey: 'cash', capability: 'pos.cashup' }
])

export const HPOS_MORE_ITEMS_RESTAURANT = Object.freeze([
  { route: '/restaurant/floor-workspace', label: 'Floor & reservations', capability: 'pos.manage' },
  { route: '/restaurant/kitchen-workspace', label: 'Kitchen operations', capability: 'pos.manage' },
  { route: '/restaurant/menu-production', label: 'Menu & production', capability: 'pos.menu_manage' },
  { route: '/restaurant/inventory', label: 'Inventory control', capability: 'inventory.view' },
  { route: '/restaurant/team-workspace', label: 'Team & performance', capability: 'staff.view' },
  { route: '/restaurant/finance-close', label: 'Finance & close', capability: 'reports.view' },
  { route: '/restaurant/chart-of-accounts', label: 'Chart of accounts', capability: 'accounting.read' },
  { route: '/restaurant/general-ledger', label: 'General ledger', capability: 'accounting.read' },
  { route: '/restaurant/accounts-payable', label: 'Accounts payable', capability: 'accounting.read' },
  { route: '/restaurant/bank-reconciliation', label: 'Bank reconciliation', capability: 'accounting.read' },
  { route: '/restaurant/tax-returns', label: 'Tax working papers', capability: 'accounting.read' },
  { route: '/restaurant/budgets', label: 'Budgets', capability: 'accounting.read' },
  { route: '/restaurant/balance-sheet', label: 'Financial statements', capability: 'accounting.read' },
  { route: '/restaurant/payroll', label: 'Payroll', capability: 'accounting.payroll_view' },
  { route: '/restaurant/control-workspace', label: 'Controls & guest policy', capability: 'pos.manage' },
  { route: '/staff', label: 'Staff management', capability: 'staff.manage' },
  { route: '/hpos/customers', label: 'Customers', capability: 'pos.view' },
  { route: '/hpos/business-control', label: 'Business overview', capability: 'pos.manage' },
  { route: '/restaurant/outlet-control', label: 'Outlet control', capability: 'pos.manage' },
  { route: '/pos/customer-display', label: 'Customer display', capability: 'pos.view' },
  { route: '/settings', label: 'Settings', capability: 'settings.view' },
  { route: '/hpos/system-health', label: 'System Health', capability: 'settings.view' },
  { route: '/settings?tab=license', label: 'Subscription', capability: 'settings.view' },
  { route: '/data-management', label: 'Data & backup', capability: 'data.import' }
])

export const HPOS_MORE_ITEMS_BAR = Object.freeze([
  { route: '/hpos/menu', label: 'Products', capability: 'pos.menu_manage' },
  { route: '/hpos/stock', label: 'Stock counts', capability: 'inventory.view' },
  { route: '/hpos/cash', label: 'Cash & close', capability: 'pos.cashup' },
  { route: '/hpos/reports', label: 'Sales report', capability: 'reports.view' },
  { route: '/staff', label: 'Staff accounts', capability: 'staff.manage' },
  { route: '/hpos/team', label: 'Shifts & cashiers', capability: 'pos.manage' },
  { route: '/hpos/system-health?tab=audit', label: 'Audit trail', capability: 'audit.view' },
  { route: '/hpos/control', label: 'Bar checklists', capability: 'pos.manage' },
  { route: '/restaurant/inventory', label: 'Stock & Purchasing Pro', capability: 'inventory.view', feature: 'inventory_advanced' },
  { route: '/restaurant/menu-production', label: 'Recipes & margin', capability: 'inventory.view', feature: 'recipes' },
  { route: '/restaurant/team-workspace', label: 'Workforce', capability: 'staff.view', feature: 'workforce_management' },
  { route: '/restaurant/chart-of-accounts', label: 'Accounting', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/general-ledger', label: 'General ledger', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/accounts-payable', label: 'Supplier bills', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/bank-reconciliation', label: 'Bank reconciliation', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/tax-returns', label: 'Tax working papers', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/budgets', label: 'Budgets', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/balance-sheet', label: 'Financial statements', capability: 'accounting.read', feature: 'restaurant_accounting' },
  { route: '/restaurant/payroll', label: 'Payroll', capability: 'accounting.payroll_view', feature: 'payroll' },
  { route: '/hpos/expenses', label: 'Bar expenses', capability: 'expenses.view', feature: 'expenses' },
  { route: '/hpos/customers', label: 'Customers & loyalty', capability: 'pos.view', feature: 'customer_accounts' },
  { route: '/hpos/growth-tools', label: 'Vouchers', capability: 'pos.manage', feature: 'vouchers' },
  { route: '/restaurant/outlet-control', label: 'Multi-outlet control', capability: 'pos.manage', feature: 'multi_outlet_controls' },
  { route: '/hpos/business-control', label: 'Growth analytics', capability: 'pos.manage', feature: 'advanced_reports' },
  { route: '/pos/bar-display', label: 'Bar board', capability: 'pos.view' },
  { route: '/pos/customer-display', label: 'Customer display', capability: 'pos.view' },
  { route: '/settings', label: 'Settings', capability: 'settings.view' },
  { route: '/hpos/system-health', label: 'System Health', capability: 'settings.view' },
  { route: '/settings?tab=license', label: 'Subscription', capability: 'settings.view' },
  { route: '/data-management', label: 'Data & backup', capability: 'data.import' }
])

/** Service modes shown on the HPOS terminal. */
export const HPOS_SERVICE_MODES_RESTAURANT = Object.freeze([
  { id: 'table', label: 'Table service', emoji: '🍽️' },
  { id: 'takeaway', label: 'Takeaway', emoji: '📦' },
  { id: 'delivery', label: 'Delivery', emoji: '🛵' }
])

export const HPOS_SERVICE_MODES_BAR = Object.freeze([
  { id: 'counter', label: 'Counter', emoji: '🍺' },
  { id: 'tab', label: 'Open tab', emoji: '🧾' }
])

export const BAR_PACK_SIZES = Object.freeze([6, 12, 24])

export const BAR_PRODUCT_CATEGORIES = Object.freeze([
  'Beer', 'Spirits', 'Softs', 'Wine', 'Snacks', 'Simple Food', 'Other'
])

/** Evidence keys used by the focused Bar POS launch checklist. */
export const BAR_BASE_SETUP_STAGE_KEYS = Object.freeze([
  'business_profile',
  'tax_service',
  'outlets',
  'menu_categories',
  'menu_pricing',
  'modifiers_combos',
  'inventory',
  'payments_tips',
  'receipt_hardware',
  'daily_checklists'
])

/**
 * Normalize hash or pathname for route checks.
 * @param {string} path
 */
export function normalizeAppPath(path = '') {
  let raw = String(path || '').trim()
  if (raw.startsWith('#')) raw = raw.slice(1)
  if (!raw.startsWith('/')) raw = `/${raw}`
  return raw.split('?')[0] || '/'
}

/**
 * True when a path must not be shown or reachable in bar_only mode.
 * @param {string} path
 */
export function getBarAddonFeatureForPath(path) {
  const normalized = normalizeAppPath(path)
  const match = Object.entries(BAR_ADDON_PATH_FEATURES).find(([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}/`))
  return match?.[1] || null
}

export function isBarOnlyBlockedPath(path, enabledFeatures = []) {
  const normalized = normalizeAppPath(path)
  const requiredAddonFeature = getBarAddonFeatureForPath(normalized)
  if (requiredAddonFeature && new Set(enabledFeatures || []).has(requiredAddonFeature)) return false
  return BAR_ONLY_BLOCKED_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  )
}

/**
 * Map UI service mode to the POS order payload service_mode + table/tab fields.
 * Reuses existing tab/session contracts (no new money RPCs).
 */
export function resolvePosServicePayload(uiServiceMode, { tableName = '', tabName = '' } = {}) {
  const mode = String(uiServiceMode || '').toLowerCase()
  if (mode === 'counter') {
    return {
      service_mode: 'counter',
      table_name: null,
      tab_name: null,
      requiresTableOrTab: false,
      openSession: false
    }
  }
  if (mode === 'tab') {
    const name = String(tabName || tableName || '').trim()
    return {
      service_mode: 'table',
      table_name: name || null,
      tab_name: name || null,
      requiresTableOrTab: true,
      openSession: true
    }
  }
  if (mode === 'table') {
    const name = String(tableName || '').trim()
    return {
      service_mode: 'table',
      table_name: name || null,
      tab_name: name || null,
      requiresTableOrTab: true,
      openSession: true
    }
  }
  if (mode === 'delivery') {
    return {
      service_mode: 'delivery',
      table_name: null,
      tab_name: null,
      requiresTableOrTab: false,
      openSession: false
    }
  }
  // takeaway default for restaurant
  return {
    service_mode: mode === 'takeaway' ? 'takeaway' : (mode || 'takeaway'),
    table_name: null,
    tab_name: null,
    requiresTableOrTab: false,
    openSession: false
  }
}

/**
 * Default terminal service mode for the hospitality mode.
 * @param {object|string|null} settingsOrMode
 */
export function getDefaultHposServiceMode(settingsOrMode) {
  if (settingsOrMode === true || settingsOrMode === HOSPITALITY_MODES.BAR_ONLY) {
    return 'counter'
  }
  if (typeof settingsOrMode === 'string') {
    return settingsOrMode === HOSPITALITY_MODES.BAR_ONLY ? 'counter' : 'table'
  }
  return isBarOnlyMode(settingsOrMode) ? 'counter' : 'table'
}

/**
 * @param {object|boolean|null} settingsOrBarOnly
 */
export function getHposServiceModes(settingsOrBarOnly) {
  const barOnly = typeof settingsOrBarOnly === 'boolean'
    ? settingsOrBarOnly
    : isBarOnlyMode(settingsOrBarOnly)
  return barOnly ? HPOS_SERVICE_MODES_BAR : HPOS_SERVICE_MODES_RESTAURANT
}

/**
 * @param {object|boolean|null} settingsOrBarOnly
 */
export function getHposDockItems(settingsOrBarOnly) {
  const barOnly = typeof settingsOrBarOnly === 'boolean'
    ? settingsOrBarOnly
    : isBarOnlyMode(settingsOrBarOnly)
  return barOnly ? HPOS_DOCK_ITEMS_BAR : HPOS_DOCK_ITEMS_RESTAURANT
}

/**
 * @param {object|boolean|null} settingsOrBarOnly
 */
export function getHposMoreItems(settingsOrBarOnly) {
  const barOnly = typeof settingsOrBarOnly === 'boolean'
    ? settingsOrBarOnly
    : isBarOnlyMode(settingsOrBarOnly)
  return barOnly ? HPOS_MORE_ITEMS_BAR : HPOS_MORE_ITEMS_RESTAURANT
}

/**
 * Dashboard / home shortcuts for restaurant property types.
 * @param {object|boolean|null} settingsOrBarOnly
 */
export function getRestaurantDashboardShortcuts(settingsOrBarOnly) {
  const barOnly = typeof settingsOrBarOnly === 'boolean'
    ? settingsOrBarOnly
    : isBarOnlyMode(settingsOrBarOnly)

  if (barOnly) {
    return Object.freeze([
      { label: 'Sell', to: '/hpos/pos', feature: 'pos', tier: 'Pro' },
      { label: 'Products', to: '/hpos/menu', feature: 'pos', tier: 'Pro' },
      { label: 'Stock Counts', to: '/hpos/stock', feature: 'inventory', tier: 'Pro' },
      { label: 'Cash & Close', to: '/hpos/cash', feature: 'pos', tier: 'Pro' },
      { label: 'Sales', to: '/hpos/reports', feature: 'reports', tier: 'Pro' },
      { label: 'Bar board', to: '/pos/bar-display', feature: 'pos', tier: 'Pro' },
      { label: 'Settings', to: '/settings', feature: null, tier: null }
    ])
  }

  return Object.freeze([
    { label: 'POS', to: '/pos', feature: 'pos', tier: 'Pro' },
    { label: 'Floor & Service', to: '/restaurant/floor', feature: 'pos', tier: 'Pro' },
    { label: 'Kitchen', to: '/restaurant/kitchen-workspace', feature: 'pos', tier: 'Pro' },
    { label: 'Menu & Production', to: '/restaurant/menu-production', feature: 'pos', tier: 'Pro' },
    { label: 'Stock & Purchasing', to: '/restaurant/stock-purchasing', feature: 'inventory', tier: 'Pro' },
    { label: 'Team', to: '/restaurant/team', feature: 'staff', tier: 'Standard' },
    { label: 'Cash & Close', to: '/restaurant/cash-close', feature: 'pos', tier: 'Pro' },
    { label: 'Expenses', to: '/expenses', feature: 'expenses', tier: 'Standard' },
    { label: 'Reports', to: '/reports', feature: 'reports', tier: 'Standard' },
    { label: 'Customers', to: '/restaurant/customers', feature: 'staff', tier: 'Standard' },
    { label: 'Control', to: '/restaurant/control', feature: 'staff', tier: 'Standard' },
    { label: 'Data', to: '/data-management', feature: null, tier: null },
    { label: 'Settings', to: '/settings', feature: null, tier: null }
  ])
}

/**
 * Full bar mode profile for UI consumers and tests.
 * @param {object|null} settingsOrProfile
 */
export function getBarModeProfile(settingsOrProfile = null) {
  const mode = getHospitalityMode(settingsOrProfile)
  const barOnly = mode === HOSPITALITY_MODES.BAR_ONLY

  return Object.freeze({
    hospitalityMode: mode,
    barOnly,
    restaurantBar: !barOnly,
    defaultServiceMode: getDefaultHposServiceMode(barOnly),
    serviceModes: getHposServiceModes(barOnly),
    dockItems: getHposDockItems(barOnly),
    moreItems: getHposMoreItems(barOnly),
    dashboardShortcuts: getRestaurantDashboardShortcuts(barOnly),
    blockedPathPrefixes: barOnly ? BAR_ONLY_BLOCKED_PATH_PREFIXES : Object.freeze([]),
    productListLabel: barOnly ? 'Drinks & products' : 'Menu & Production',
    sellLabel: barOnly ? 'Sell' : 'Service',
    searchPlaceholder: barOnly ? 'Search drinks or scan barcode… ( / )' : 'Search menu... ( / )',
    staffRoleLabel: barOnly ? 'Bartender / cashier' : 'Waiter',
    packSizes: BAR_PACK_SIZES,
    defaultProductCategories: barOnly ? BAR_PRODUCT_CATEGORIES : Object.freeze(['Food', 'Drinks', 'Other'])
  })
}

/**
 * Whether the current settings describe a restaurant (or hospitality POS) in bar_only.
 * @param {object|null} settings
 */
export function isHospitalityBarOnly(settings) {
  if (!settings) return false
  const propertyType = settings.property_type || settings.business_type
  if (propertyType && !isRestaurantOnly(propertyType) && propertyType !== 'restaurant') {
    // Still allow pure operating_profile checks for tests / partial settings.
    if (!settings.operating_profile && settings.hospitality_mode == null) return false
  }
  return isBarOnlyMode(settings)
}

export { HOSPITALITY_MODES, isBarOnlyMode, getHospitalityMode }
