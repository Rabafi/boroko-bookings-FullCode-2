import { ENTERPRISE_ADDON_CATALOG } from './enterpriseAddons.js'

export const COMMERCIAL_PRODUCT_IDS = Object.freeze({
  LODGE_CAMP: 'lodge-camp',
  HOTEL: 'hotel',
  HOSPITALITY_POS: 'hospitality-pos'
})

export const COMMERCIAL_BILLING_BASIS = Object.freeze({
  ANNUAL_LICENSE: 'annual_license',
  INITIAL_PURCHASE: 'initial_purchase',
  ONE_TIME_ADDON: 'one_time_addon',
  ANNUAL_ADDON: 'annual_addon'
})

const LODGE_FEATURES = Object.freeze([
  'bookings', 'rooms', 'guests', 'quotations', 'invoices', 'housekeeping', 'maintenance'
])

// Starter exposes a deliberately narrow, read-only operational summary. The
// full `reports` entitlement remains a Standard boundary.
const STARTER_FEATURES = Object.freeze([
  ...LODGE_FEATURES, 'basic_reports'
])

const STANDARD_FEATURES = Object.freeze([
  ...STARTER_FEATURES, 'reports', 'expenses', 'staff', 'audit', 'conference', 'dayuse', 'import'
])

const PRO_FEATURES = Object.freeze([
  ...STANDARD_FEATURES, 'pwa', 'online_booking', 'pos', 'inventory', 'supplies', 'room_supplies'
])

/**
 * Hotel Core must run a normal hotel day without optional add-ons.
 * Premium depth (yield, OTA, guest portal/messaging, multi-property, group ops,
 * advanced analytics) stays outside this list and is granted only via add-ons.
 */
const HOTEL_CORE_FEATURES = Object.freeze([
  ...PRO_FEATURES,
  // Property & inventory
  'hotel_mode', 'room_types', 'physical_inventory', 'floors_sections', 'room_attributes',
  // Front desk day
  'front_desk_dashboard', 'room_moves', 'checkin_workflow', 'early_late_checkout', 'cancellation_policies',
  // Housekeeping & maintenance (basic readiness — not mobile analytics packs)
  'advanced_housekeeping', 'housekeeping_command_center', 'maintenance_enterprise',
  // Financial close
  'folios', 'rate_plans', 'corporate_accounts', 'night_audit_enterprise', 'documents',
  // Team & KPIs
  'hotel_roles', 'hotel_kpis', 'subscription_builder'
])

const BAR_POS_FEATURES = Object.freeze([
  'pos', 'bar_counter_sales', 'bar_product_list', 'modifiers', 'tabs', 'receipts', 'bar_pack_stock', 'inventory',
  'bar_stock_basic', 'low_stock_alerts', 'cash_drawer', 'cash_up', 'staff',
  'bar_staff_basic', 'staff_shifts', 'reports', 'bar_reports_basic', 'audit',
  'pwa', 'customer_display', 'bar_board', 'checklists', 'alerts', 'incident_log'
])

export const BAR_POS_ADDON_CATALOG = Object.freeze([
  Object.freeze({
    productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
    addonKey: 'bar_stock_purchasing_pro',
    displayName: 'Stock & Purchasing Pro',
    description: 'Supplier purchasing, reorder suggestions, lots and expiry, recipes, wastage, valuation and advanced stock margin control.',
    billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_ADDON,
    oneTimePriceBwp: 0,
    annualPriceBwp: 3000,
    eligiblePropertyTypes: Object.freeze(['restaurant', 'bar']),
    eligibleOperatingProfiles: Object.freeze(['bar_only']),
    eligiblePackageKeys: Object.freeze(['bar_pos']),
    includedFeatures: Object.freeze([
      'inventory_advanced', 'stock_control', 'suppliers', 'purchasing', 'purchase_suggestions',
      'lots_expiry', 'recipes', 'prep', 'variance', 'wastage', 'stock_valuation',
      'advanced_margin'
    ])
  }),
  Object.freeze({
    productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
    addonKey: 'bar_accounting_workforce',
    displayName: 'Accounting & Workforce',
    description: 'Accounting, supplier finance, bank and tax work, budgets, statements, rosters, workforce analytics, payroll and controlled tip payouts.',
    billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_ADDON,
    oneTimePriceBwp: 0,
    annualPriceBwp: 6000,
    eligiblePropertyTypes: Object.freeze(['restaurant', 'bar']),
    eligibleOperatingProfiles: Object.freeze(['bar_only']),
    eligiblePackageKeys: Object.freeze(['bar_pos']),
    includedFeatures: Object.freeze([
      'restaurant_accounting', 'workforce_management', 'workforce_scheduling',
      'staff_performance', 'performance', 'payroll', 'tips_payouts', 'expenses'
    ])
  }),
  Object.freeze({
    productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
    addonKey: 'bar_growth_multi_outlet',
    displayName: 'Growth & Multi-Outlet',
    description: 'Customer accounts, loyalty, promotions, vouchers, multi-outlet control, central catalogues, owner oversight and advanced trends.',
    billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_ADDON,
    oneTimePriceBwp: 0,
    annualPriceBwp: 5000,
    eligiblePropertyTypes: Object.freeze(['restaurant', 'bar']),
    eligibleOperatingProfiles: Object.freeze(['bar_only']),
    eligiblePackageKeys: Object.freeze(['bar_pos']),
    includedFeatures: Object.freeze([
      'bar_crm', 'customer_accounts', 'loyalty', 'promotions', 'vouchers',
      'multi_outlet_controls', 'multi_outlet_pos', 'central_menu_publishing',
      'stock_transfers', 'owner_mobile_view', 'advanced_reports'
    ])
  })
])

const RESTAURANT_SERVICE_FEATURES = Object.freeze([
  'pos', 'menus', 'modifiers', 'tables', 'tabs', 'receipts', 'kitchen_tickets',
  'bar_tickets', 'stations', 'cash_drawer', 'cash_up', 'staff', 'reports'
])

const RESTAURANT_CONTROL_FEATURES = Object.freeze([
  ...RESTAURANT_SERVICE_FEATURES, 'inventory', 'stock_control', 'suppliers', 'purchasing', 'recipes',
  'prep', 'variance', 'performance', 'owner_digest', 'checklists', 'alerts', 'incident_log',
  'restaurant_accounting'
])

const RESTAURANT_GROWTH_FEATURES = Object.freeze([
  ...RESTAURANT_CONTROL_FEATURES, 'loyalty', 'customer_accounts', 'vouchers', 'delivery_tracking',
  'multi_outlet_controls', 'central_menu_publishing', 'stock_transfers', 'owner_mobile_view'
])

const EXCLUDED_LODGE_LIMITS = Object.freeze([
  'No LodgingOS booking, room, or user usage caps',
  'No LodgingOS upgrade ladder'
])

function offer({
  productId,
  commercialPackageKey,
  displayName,
  legacyName = displayName,
  internalPlan,
  billingBasis,
  priceBwp,
  includedFeatures = [],
  excludedFeatures = [],
  upgradeTarget = null,
  eligibleOperatingProfiles = null,
  salesCopy,
  compatibility = {}
}) {
  return Object.freeze({
    productId,
    commercialPackageKey,
    displayName,
    // `name` is retained for existing renderer/catalog callers. New flows should
    // use displayName so Hotel Core is never confused with the Enterprise key.
    name: legacyName,
    internalPlan,
    billingBasis,
    priceBwp,
    includedFeatures: Object.freeze([...includedFeatures]),
    excludedFeatures: Object.freeze([...excludedFeatures]),
    upgradeTarget,
    eligibleOperatingProfiles: eligibleOperatingProfiles ? Object.freeze([...eligibleOperatingProfiles]) : null,
    salesCopy,
    hasUsageLimits: compatibility.hasUsageLimits !== false,
    compatibilityPlan: internalPlan
  })
}

export const COMMERCIAL_PACKAGE_CATALOG = Object.freeze({
  [COMMERCIAL_PRODUCT_IDS.LODGE_CAMP]: Object.freeze([
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.LODGE_CAMP,
      commercialPackageKey: 'starter',
      displayName: 'Starter',
      internalPlan: 'Starter',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 8999,
      includedFeatures: STARTER_FEATURES,
      excludedFeatures: ['reports', 'expenses', 'staff', 'audit', 'pos', 'inventory', 'online_booking'],
      upgradeTarget: 'standard',
      salesCopy: 'Daily lodge operations plus a view-only 1, 7, or 30-day operating summary.'
    }),
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.LODGE_CAMP,
      commercialPackageKey: 'standard',
      displayName: 'Standard',
      internalPlan: 'Standard',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 12999,
      includedFeatures: STANDARD_FEATURES,
      excludedFeatures: ['pos', 'inventory', 'online_booking', 'pwa'],
      upgradeTarget: 'pro',
      salesCopy: 'Owner control with reporting, expenses, staff accountability, audit, and broader operations.'
    }),
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.LODGE_CAMP,
      commercialPackageKey: 'pro',
      displayName: 'Pro',
      internalPlan: 'Pro',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 18999,
      includedFeatures: PRO_FEATURES,
      excludedFeatures: EXCLUDED_LODGE_LIMITS,
      upgradeTarget: null,
      salesCopy: 'Full LodgingOS commercial operations with mobile oversight, direct booking, POS, and stock control.'
    })
  ]),
  [COMMERCIAL_PRODUCT_IDS.HOTEL]: Object.freeze([
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.HOTEL,
      commercialPackageKey: 'hotel_core',
      displayName: 'Hotel Core',
      legacyName: 'Hotel',
      internalPlan: 'Enterprise',
      billingBasis: COMMERCIAL_BILLING_BASIS.INITIAL_PURCHASE,
      priceBwp: 37998,
      includedFeatures: HOTEL_CORE_FEATURES,
      excludedFeatures: EXCLUDED_LODGE_LIMITS,
      salesCopy: 'Hotel-native front desk, reservations, rooms, check-in/out, folios, basic rate plans, corporate settlement, housekeeping, night audit, operational documents, and core reports. Optional services (channels, guest portal, advanced revenue, multi-property) are quoted separately.',
      compatibility: { hasUsageLimits: false }
    })
  ]),
  [COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS]: Object.freeze([
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
      commercialPackageKey: 'bar_pos',
      displayName: 'Bar POS',
      internalPlan: 'Pro',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 4500,
      includedFeatures: BAR_POS_FEATURES,
      excludedFeatures: ['kitchen', 'tables', 'recipes', 'restaurant_production'],
      upgradeTarget: 'restaurant_service',
      eligibleOperatingProfiles: ['bar_only'],
      salesCopy: 'Counter sales with modifiers, open tabs and receipts; drink products, pack stock, low-stock alerts, cash-up, staff shifts, reports, Manager mobile oversight, customer display, and bar board.',
      compatibility: { hasUsageLimits: false }
    }),
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
      commercialPackageKey: 'restaurant_service',
      displayName: 'Restaurant Service',
      internalPlan: 'Pro',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 8999,
      includedFeatures: RESTAURANT_SERVICE_FEATURES,
      excludedFeatures: ['stock_control', 'recipes', 'prep', 'variance', 'loyalty', 'multi_outlet_controls'],
      upgradeTarget: 'restaurant_control',
      eligibleOperatingProfiles: ['restaurant_bar'],
      salesCopy: 'POS service with menus, modifiers, tables, tabs, receipts, kitchen and bar tickets, stations, cash-up, and basic staff controls.',
      compatibility: { hasUsageLimits: false }
    }),
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
      commercialPackageKey: 'restaurant_control',
      displayName: 'Restaurant Control',
      internalPlan: 'Pro',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 12999,
      includedFeatures: RESTAURANT_CONTROL_FEATURES,
      excludedFeatures: ['loyalty', 'customer_accounts', 'vouchers', 'delivery_tracking', 'multi_outlet_controls'],
      upgradeTarget: 'restaurant_growth',
      eligibleOperatingProfiles: ['restaurant_bar'],
      salesCopy: 'Restaurant Service plus stock, suppliers, purchasing, recipes, prep, variance, performance, owner digest, checklists, and alerts.',
      compatibility: { hasUsageLimits: false }
    }),
    offer({
      productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
      commercialPackageKey: 'restaurant_growth',
      displayName: 'Restaurant Growth',
      internalPlan: 'Pro',
      billingBasis: COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE,
      priceBwp: 18999,
      includedFeatures: RESTAURANT_GROWTH_FEATURES,
      excludedFeatures: [],
      upgradeTarget: null,
      eligibleOperatingProfiles: ['restaurant_bar'],
      salesCopy: 'Restaurant Control plus loyalty, customer accounts, vouchers, delivery, multi-outlet, central menus, transfers, and owner mobile view.',
      compatibility: { hasUsageLimits: false }
    })
  ])
})

export const HOTEL_ADDON_CATALOG = Object.freeze(
  ENTERPRISE_ADDON_CATALOG
    .filter((addon) => addon.advertise === true)
    .filter((addon) => Array.isArray(addon.eligiblePropertyTypes) && addon.eligiblePropertyTypes.some((type) => ['hotel', 'resort'].includes(type)))
    .map((addon) => Object.freeze({
      productId: COMMERCIAL_PRODUCT_IDS.HOTEL,
      addonKey: addon.key,
      displayName: addon.label,
      description: addon.description,
      billingBasis: addon.price?.annual ? COMMERCIAL_BILLING_BASIS.ANNUAL_ADDON : COMMERCIAL_BILLING_BASIS.ONE_TIME_ADDON,
      oneTimePriceBwp: Number(addon.price?.setup || 0),
      annualPriceBwp: addon.price?.annual == null ? null : Number(addon.price.annual),
      eligiblePropertyTypes: Object.freeze(addon.eligiblePropertyTypes.filter((type) => ['hotel', 'resort'].includes(type))),
      includedFeatures: Object.freeze([...(addon.moduleKeys || [])]),
      sourceAddon: addon
    }))
)

export function getCommercialOffers(productId) {
  return COMMERCIAL_PACKAGE_CATALOG[productId] || []
}

export function getCommercialOffer(productId, commercialPackageKey) {
  return getCommercialOffers(productId).find((entry) => entry.commercialPackageKey === commercialPackageKey) || null
}

export function getHotelAddon(addonKey) {
  return HOTEL_ADDON_CATALOG.find((entry) => entry.addonKey === addonKey) || null
}

export function getCommercialAddon(productId, addonKey) {
  if (productId === COMMERCIAL_PRODUCT_IDS.HOTEL) return getHotelAddon(addonKey)
  if (productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS) {
    return BAR_POS_ADDON_CATALOG.find((entry) => entry.addonKey === addonKey) || null
  }
  return null
}

export function getCommercialAddonOffers(productId, propertyType = null) {
  if (productId === COMMERCIAL_PRODUCT_IDS.HOTEL) {
    return HOTEL_ADDON_CATALOG.filter((addon) => !propertyType || addon.eligiblePropertyTypes.includes(propertyType))
  }
  if (productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS) {
    return BAR_POS_ADDON_CATALOG.filter((addon) => !propertyType || addon.eligiblePropertyTypes.includes(propertyType))
  }
  return []
}

export function resolveCommercialOffer({ productId, commercialPackageKey, internalPlan } = {}) {
  if (commercialPackageKey) return getCommercialOffer(productId, commercialPackageKey)
  const offers = getCommercialOffers(productId)
  return offers.find((entry) => entry.internalPlan === internalPlan) || null
}

export function isCommercialSelectionEligible({ productId, commercialPackageKey, operatingProfile } = {}) {
  const selected = getCommercialOffer(productId, commercialPackageKey)
  if (!selected) return false
  if (!selected.eligibleOperatingProfiles || selected.eligibleOperatingProfiles.length === 0) return true
  return selected.eligibleOperatingProfiles.includes(operatingProfile)
}

export function getCommercialEntitlementKeys({ productId, commercialPackageKey, selectedAddonKeys = [] } = {}) {
  const offer = getCommercialOffer(productId, commercialPackageKey)
  if (!offer) return []
  const keys = new Set(offer.includedFeatures)
  for (const addonKey of selectedAddonKeys) {
    const addon = getCommercialAddon(productId, addonKey)
    const eligible = !addon?.eligiblePackageKeys || addon.eligiblePackageKeys.includes(commercialPackageKey)
    if (eligible && addon && addon.productId === productId) addon.includedFeatures.forEach((key) => keys.add(key))
  }
  return [...keys]
}
