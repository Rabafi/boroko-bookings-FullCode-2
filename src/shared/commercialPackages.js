// @ts-check
import { ENTERPRISE_ADDON_CATALOG } from './enterpriseAddons.js'
import { getSubscriptionPlan, normalizeSubscriptionPlan } from './subscriptionPlans.js'
import { getRuntimeProductId } from './productIdentity.js'
import {
  COMMERCIAL_BILLING_BASIS,
  COMMERCIAL_PACKAGE_CATALOG,
  COMMERCIAL_PRODUCT_IDS,
  getCommercialAddonOffers,
  getCommercialEntitlementKeys,
  getCommercialOffer,
  getCommercialOffers,
  getHotelAddon
} from './commercialEntitlements.js'

/** @typedef {'lodge-camp' | 'hotel' | 'hospitality-pos'} ProductId */
/** @typedef {'Starter' | 'Standard' | 'Pro' | 'Enterprise'} PlanName */
/** @typedef {{productId: ProductId, commercialPackageKey: string, displayName: string, name: string, internalPlan: PlanName, billingBasis: string, priceBwp: number, salesCopy: string, includedFeatures: readonly string[], excludedFeatures: readonly string[], upgradeTarget: string | null, eligibleOperatingProfiles?: readonly string[] | null}} PackageOffer */
/** @typedef {{annual: number | null, monthly: number | null, setup: number | null, pricingModel?: string}} PlanPrice */
/** @typedef {{plan?: unknown, addons?: string[], roomCount?: unknown, userCount?: unknown, trialEligible?: unknown, trialAlreadyUsed?: unknown, productId?: ProductId}} LegacyPricingOptions */
/** @typedef {{productId?: ProductId, commercialPackageKey?: string, addonKeys?: string[], operatingProfile?: string | null, propertyType?: string | null, trialAlreadyUsed?: unknown, trialEligible?: unknown}} CommercialSnapshotOptions */
/** @typedef {{line_type: 'package' | 'addon', key: string, label: string, billing_basis: string, one_time_amount: number, recurring_amount: number, amount_due_now: number}} CommercialLine */
/** @typedef {{product_id?: ProductId, pricing_snapshot?: unknown, canonical_pricing_snapshot?: unknown, requested_plan?: unknown, requested_addons?: string[], room_count?: unknown, user_count?: unknown, trial_eligible?: unknown, trial_already_used?: unknown, commercial_package_key?: unknown, operating_profile?: unknown, current_plan?: unknown, expected_monthly_bookings?: unknown, quote_number?: unknown, company_name?: unknown, property_name?: unknown, contact_name?: unknown, contact_email?: unknown, contact_phone?: unknown, country?: unknown}} SubscriptionQuoteRequest */
/** @typedef {{pricing_snapshot?: unknown, document_number?: unknown, issued_at?: unknown, valid_until?: unknown, notes?: unknown, payment_instructions?: unknown}} CommercialDocumentInput */

export const COMMERCIAL_CURRENCY = 'BWP'
export const COMMERCIAL_CURRENCY_SYMBOL = 'P'

// Legacy plan pricing remains available for old licences and old quote payloads.
// New product-aware quotes use COMMERCIAL_PACKAGE_CATALOG instead.
export const PLAN_PRICE_CATALOG = {
  Starter: { annual: 8999, monthly: null, setup: 0 },
  Standard: { annual: 12999, monthly: null, setup: 0 },
  Pro: { annual: 18999, monthly: null, setup: 0 },
  Enterprise: { annual: 37998, monthly: null, setup: 0 }
}

/** @type {Partial<Record<PlanName, string>>} */
const POS_PACKAGE_BY_PLAN = {
  Pro: 'restaurant_growth'
}

/** @param {PackageOffer} offer */
function enrichOffer(offer) {
  const plan = getSubscriptionPlan(offer.internalPlan) || {}
  const annual = offer.billingBasis === COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE ? offer.priceBwp : null
  const upgradeOffer = offer.upgradeTarget ? getCommercialOffer(offer.productId, offer.upgradeTarget) : null
  const productUpgradeNudge = offer.productId === COMMERCIAL_PRODUCT_IDS.LODGE_CAMP
    ? upgradeOffer
      ? plan.upgradeNudge
      : 'Pro is the highest LodgingOS package. Hotel operations are licensed separately through HotelOS.'
    : offer.productId === COMMERCIAL_PRODUCT_IDS.HOTEL
      ? 'Extend HotelOS with the optional services quoted for this property.'
      : offer.productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS && offer.commercialPackageKey === 'bar_pos'
        ? 'Bar POS is the Bar package. Extend it with Stock & Purchasing Pro, Accounting & Workforce, or Growth & Multi-Outlet when this bar needs them.'
        : upgradeOffer
          ? `Move to ${upgradeOffer.displayName} when this operation needs its additional workflows.`
          : 'This is the highest package in this POS product line.'
  return {
    ...plan,
    ...offer,
    priceLabel: annual == null
      ? offer.billingBasis === COMMERCIAL_BILLING_BASIS.INITIAL_PURCHASE ? 'Initial purchase' : 'Quote confirmed'
      : `${formatCommercialMoney(annual)}/year`,
    headline: offer.salesCopy,
    pitch: offer.salesCopy,
    summary: offer.salesCopy,
    modules: offer.includedFeatures,
    internalPlan: offer.internalPlan,
    upgradeNudge: productUpgradeNudge
  }
}

/** @param {ProductId} [productId] */
export function getCommercialPackageCatalog(productId = getRuntimeProductId()) {
  return getCommercialOffers(productId).map(enrichOffer)
}

/** @param {ProductId} [productId] */
export function getCommercialPackagePlanNames(productId = getRuntimeProductId()) {
  return getCommercialPackageCatalog(productId).map((entry) => entry.internalPlan)
}

/** @param {unknown} commercialPackageKey @param {ProductId} [productId] */
export function getCommercialPackageForKey(commercialPackageKey, productId = getRuntimeProductId()) {
  const offer = getCommercialOffer(productId, commercialPackageKey)
  return offer ? enrichOffer(offer) : null
}

/** @param {unknown} plan @param {ProductId} [productId] */
export function getCommercialPackageForPlan(plan, productId = getRuntimeProductId()) {
  const internalPlan = normalizeSubscriptionPlan(plan)
  const commercialKey = productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS
    ? POS_PACKAGE_BY_PLAN[internalPlan]
    : productId === COMMERCIAL_PRODUCT_IDS.HOTEL
      ? 'hotel_core'
      : String(internalPlan).toLowerCase()
  return getCommercialPackageForKey(commercialKey, productId)
    || (internalPlan === 'Enterprise' ? { ...getSubscriptionPlan('Enterprise'), internalPlan } : getCommercialPackageCatalog(productId)[0])
}

/** @param {unknown} plan @param {ProductId} [productId] */
export function getCommercialPackageLabel(plan, productId = getRuntimeProductId()) {
  const internalPlan = normalizeSubscriptionPlan(plan)
  // Keep the old label stable for existing Hotel UI and licences. New quote
  // documents use displayName, which is explicitly "Hotel Core".
  if (productId === COMMERCIAL_PRODUCT_IDS.HOTEL && internalPlan === 'Enterprise') return 'Hotel'
  return getCommercialPackageForPlan(internalPlan, productId)?.name || internalPlan
}

/** @param {{productId?: ProductId, commercialPackageKey?: unknown, plan?: unknown}} [options] */
export function getCommercialPackageDisplayName({ productId = getRuntimeProductId(), commercialPackageKey, plan } = {}) {
  return getCommercialPackageForKey(commercialPackageKey, productId)?.displayName
    || (/** @type {{displayName?: string} | null | undefined} */ (getCommercialPackageForPlan(plan, productId)))?.displayName
    || getCommercialPackageLabel(plan, productId)
}

export const TRIAL_POLICY = {
  trialDays: 30,
  appliesToPlans: ['Starter', 'Standard', 'Pro'],
  copy: 'One 30-day free trial is available once per property. If this property has already used its trial, the quoted paid package applies immediately after approval.'
}

/** @param {unknown} plan @param {ProductId} [productId] @returns {PlanPrice} */
export function getPlanPrice(plan, productId = getRuntimeProductId()) {
  if (productId === COMMERCIAL_PRODUCT_IDS.HOTEL) {
    return { annual: null, monthly: null, setup: null, pricingModel: 'quote_confirmed' }
  }
  if (productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS) {
    const offer = getCommercialPackageForPlan(plan, productId)
    return {
      annual: /** @type {{priceBwp?: number} | null | undefined} */ (offer)?.priceBwp ?? null,
      monthly: null,
      setup: 0,
      pricingModel: 'annual_license'
    }
  }
  return /** @type {Record<PlanName, PlanPrice>} */ (PLAN_PRICE_CATALOG)[normalizeSubscriptionPlan(plan)] || PLAN_PRICE_CATALOG.Starter
}

/** @param {unknown} value @param {string} [fallback] @returns {string} */
export function formatCommercialMoney(value, fallback = 'To be confirmed') {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return `${COMMERCIAL_CURRENCY_SYMBOL}${n.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** @param {string} [propertyType] @param {ProductId | null} [productId] */
export function getAdvertisedEnterpriseAddons(propertyType = 'lodge', productId = null) {
  const resolvedProductId = productId || (['hotel', 'resort'].includes(propertyType) ? 'hotel' : getRuntimeProductId())
  if (resolvedProductId !== COMMERCIAL_PRODUCT_IDS.HOTEL) return []
  return ENTERPRISE_ADDON_CATALOG
    .filter((addon) => addon.advertise === true)
    .filter((addon) => !Array.isArray(addon.eligiblePropertyTypes) || addon.eligiblePropertyTypes.includes(propertyType))
}

/** @param {LegacyPricingOptions} [options] */
function buildLegacyPricingSnapshot({
  plan = 'Starter',
  addons = [],
  roomCount = 0,
  userCount = 0,
  trialEligible = null,
  trialAlreadyUsed = false,
  productId = getRuntimeProductId()
} = {}) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  const selectedAddons = Array.isArray(addons) ? addons : []
  const planPrice = getPlanPrice(normalizedPlan, productId)
  const packageLabel = getCommercialPackageLabel(normalizedPlan, productId)
  /** @type {Record<string, {label: string, annual: number | null, monthly: number | null, setup: number | null, pricing_model: string}>} */
  const addonRows = {}

  for (const key of selectedAddons) {
    const addon = ENTERPRISE_ADDON_CATALOG.find((entry) => entry.key === key)
    if (!addon) continue
    addonRows[key] = {
      label: addon.label,
      annual: /** @type {{annual?: number | null} | null | undefined} */ (addon.price)?.annual ?? null,
      monthly: /** @type {{monthly?: number | null} | null | undefined} */ (addon.price)?.monthly ?? null,
      setup: addon.price?.setup ?? null,
      pricing_model: addon.price?.pricingModel || 'quote_confirmed'
    }
  }

  const knownAddonAnnual = Object.values(addonRows).reduce((sum, addon) => (
    addon.annual !== null && addon.annual !== undefined && Number.isFinite(Number(addon.annual)) ? sum + Number(addon.annual) : sum
  ), 0)
  const knownAddonSetup = Object.values(addonRows).reduce((sum, addon) => (
    addon.setup !== null && addon.setup !== undefined && Number.isFinite(Number(addon.setup)) ? sum + Number(addon.setup) : sum
  ), 0)
  const annualSubtotal = planPrice.annual !== null && planPrice.annual !== undefined && Number.isFinite(Number(planPrice.annual))
    ? Number(planPrice.annual) + knownAddonAnnual
    : null
  const setupTotal = planPrice.setup !== null && planPrice.setup !== undefined && Number.isFinite(Number(planPrice.setup))
    ? Number(planPrice.setup) + knownAddonSetup
    : null
  const resolvedTrialEligible = trialEligible === null
    ? TRIAL_POLICY.appliesToPlans.includes(normalizedPlan) && trialAlreadyUsed !== true
    : Boolean(trialEligible)

  return {
    plan: normalizedPlan,
    package_label: packageLabel,
    product_id: productId,
    plan_price: planPrice,
    addons: addonRows,
    room_count: Number(roomCount) || null,
    user_count: Number(userCount) || null,
    currency: COMMERCIAL_CURRENCY,
    currency_symbol: COMMERCIAL_CURRENCY_SYMBOL,
    annual_subtotal: annualSubtotal,
    setup_total: setupTotal,
    total_due_after_trial: annualSubtotal,
    total_due_now: resolvedTrialEligible ? 0 : annualSubtotal,
    trial: {
      eligible: resolvedTrialEligible,
      already_used: trialAlreadyUsed === true,
      days: TRIAL_POLICY.trialDays,
      policy: TRIAL_POLICY.copy
    },
    note: productId === COMMERCIAL_PRODUCT_IDS.HOTEL
      ? 'Hotel pricing is confirmed by quotation. Payment is manual and activation happens only after Tsa Bonno approves payment proof.'
      : 'Published package and add-on pricing is included. Payment is manual and activation happens only after Tsa Bonno approves payment proof.'
  }
}

/** @param {CommercialSnapshotOptions} [options] */
export function buildCommercialOfferSnapshot({
  productId = getRuntimeProductId(),
  commercialPackageKey,
  addonKeys = [],
  operatingProfile = null,
  propertyType = null,
  trialAlreadyUsed = false,
  trialEligible = null
} = {}) {
  const selected = getCommercialOffer(productId, commercialPackageKey)
  if (!selected) throw new Error(`Unknown commercial package: ${productId}/${commercialPackageKey}`)
  if (selected.eligibleOperatingProfiles?.length && !selected.eligibleOperatingProfiles.includes(/** @type {string} */ (operatingProfile))) {
    throw new Error(`${selected.displayName} is not available for operating profile ${operatingProfile || 'unknown'}`)
  }
  const resolvedTrialEligible = trialEligible === null || trialEligible === undefined
    ? (TRIAL_POLICY.appliesToPlans.includes(selected.internalPlan) && trialAlreadyUsed !== true)
    : Boolean(trialEligible)

  /** @type {CommercialLine[]} */
  const lines = /** @type {CommercialLine[]} */ ([{
    line_type: 'package',
    key: selected.commercialPackageKey,
    label: selected.displayName,
    billing_basis: selected.billingBasis,
    one_time_amount: selected.billingBasis === COMMERCIAL_BILLING_BASIS.INITIAL_PURCHASE ? selected.priceBwp : 0,
    recurring_amount: selected.billingBasis === COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE ? selected.priceBwp : 0,
    amount_due_now: selected.priceBwp
  }])
  const eligibleAddons = getCommercialAddonOffers(productId, propertyType)
    .filter((addon) => !addon.eligiblePackageKeys || addon.eligiblePackageKeys.includes(selected.commercialPackageKey))
  for (const key of [...new Set(Array.isArray(addonKeys) ? addonKeys : [])]) {
    const addon = eligibleAddons.find((entry) => entry.addonKey === key)
    if (!addon) throw new Error(`Invalid add-on for ${productId}: ${key}`)
    // Bar annual bundles are prepaid with their first annual term. Hotel
    // recurring add-ons retain their existing contract model: their first
    // recurring charge is not represented as due immediately.
    const addonDueNow = Number(addon.oneTimePriceBwp || 0)
      + (productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS && addon.billingBasis === COMMERCIAL_BILLING_BASIS.ANNUAL_ADDON
        ? Number(addon.annualPriceBwp || 0)
        : 0)
    lines.push({
      line_type: 'addon',
      key: addon.addonKey,
      label: addon.displayName,
      billing_basis: addon.billingBasis,
      one_time_amount: addon.oneTimePriceBwp,
      recurring_amount: addon.annualPriceBwp || 0,
      amount_due_now: addonDueNow
    })
  }
  const fullDueNow = lines.reduce((sum, line) => sum + Number(line.amount_due_now || 0), 0)
  const recurringAnnual = lines.reduce((sum, line) => sum + Number(line.recurring_amount || 0), 0)
  const oneTimeTotal = lines.reduce((sum, line) => sum + Number(line.one_time_amount || 0), 0)
  // Trial: first term free once per property. Due now becomes 0 but the
  // recurring annual still shows what applies after the trial.
  const totalDueNow = resolvedTrialEligible ? 0 : fullDueNow
  return {
    product_id: productId,
    commercial_package_key: selected.commercialPackageKey,
    package_label: selected.displayName,
    internal_plan: selected.internalPlan,
    billing_basis: selected.billingBasis,
    currency: COMMERCIAL_CURRENCY,
    lines,
    totals: {
      total_due_now: totalDueNow,
      one_time_total: oneTimeTotal,
      recurring_annual: recurringAnnual,
      full_due_now_without_trial: fullDueNow
    },
    trial: {
      eligible: resolvedTrialEligible,
      already_used: trialAlreadyUsed === true,
      days: TRIAL_POLICY.trialDays,
      policy: TRIAL_POLICY.copy
    },
    included_features: getCommercialEntitlementKeys({ productId, commercialPackageKey: selected.commercialPackageKey, selectedAddonKeys: addonKeys }),
    excluded_features: selected.excludedFeatures,
    operating_profile: operatingProfile,
    property_type: propertyType,
    note: productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS
      ? 'The total due now includes the first annual term of the selected Bar package and annual add-ons. Payment is not collected here; activation occurs only after Tsa Bonno approves payment proof.'
      : 'This quote is a request for manual review. Payment is not collected here and activation occurs only after Tsa Bonno approves payment proof.'
  }
}

/** @param {LegacyPricingOptions & CommercialSnapshotOptions} [options] */
export function buildCommercialPricingSnapshot(options = {}) {
  if (options.commercialPackageKey) {
    return buildCommercialOfferSnapshot({
      productId: options.productId,
      commercialPackageKey: options.commercialPackageKey,
      addonKeys: options.addons,
      operatingProfile: options.operatingProfile,
      propertyType: options.propertyType,
      trialAlreadyUsed: options.trialAlreadyUsed,
      trialEligible: options.trialEligible
    })
  }
  return buildLegacyPricingSnapshot(options)
}

/** @param {SubscriptionQuoteRequest} [request] @param {string} [type] @param {CommercialDocumentInput} [input] */
export function buildSubscriptionCommercialDocument(request = {}, type = 'quote', input = {}) {
  const documentType = type === 'invoice' ? 'invoice' : 'quote'
  const pricing = input.pricing_snapshot || request.canonical_pricing_snapshot || request.pricing_snapshot || buildLegacyPricingSnapshot({
    plan: request.requested_plan,
    addons: request.requested_addons,
    roomCount: request.room_count,
    userCount: request.user_count,
    trialEligible: request.trial_eligible,
    trialAlreadyUsed: request.trial_already_used,
    productId: request.product_id
  })
  // Snapshot payloads may come from persisted request data; these typed views
  // preserve direct property reads without claiming that the payload validates.
  const pricingRecord = /** @type {{totals?: unknown, annual_subtotal?: unknown, setup_total?: unknown, total_due_now?: unknown, package_label?: unknown, product_id?: unknown, commercial_package_key?: unknown, operating_profile?: unknown, internal_plan?: unknown, requested_plan?: unknown, currency?: unknown, one_time_total?: unknown, note?: unknown, trial?: unknown}} */ (pricing)
  const totals = /** @type {{total_due_now?: unknown, recurring_annual?: unknown, one_time_total?: unknown}} */ (pricingRecord.totals || {})
  const legacyAnnual = pricingRecord.annual_subtotal === null || pricingRecord.annual_subtotal === undefined ? null : Number(pricingRecord.annual_subtotal)
  const legacySetup = pricingRecord.setup_total === null || pricingRecord.setup_total === undefined ? null : Number(pricingRecord.setup_total)
  const totalDueNow = totals.total_due_now ?? (pricingRecord.total_due_now === null || pricingRecord.total_due_now === undefined ? null : Number(pricingRecord.total_due_now))
  const recurringAmount = totals.recurring_annual ?? (Number.isFinite(legacyAnnual) ? legacyAnnual : null)
  const packageName = pricingRecord.package_label || getCommercialPackageDisplayName({
    productId: request.product_id,
    commercialPackageKey: request.commercial_package_key,
    plan: request.requested_plan
  })

  return {
    document_type: documentType,
    document_number: input.document_number || request.quote_number || null,
    issued_at: input.issued_at || new Date().toISOString(),
    valid_until: input.valid_until || null,
    status: documentType === 'invoice' ? 'invoice_sent' : 'quoted',
    customer: {
      company_name: request.company_name || '',
      property_name: request.property_name || '',
      contact_name: request.contact_name || '',
      contact_email: request.contact_email || '',
      contact_phone: request.contact_phone || '',
      country: request.country || ''
    },
    product: {
      product_id: request.product_id || pricingRecord.product_id || null,
      package_key: request.commercial_package_key || pricingRecord.commercial_package_key || null,
      operating_profile: request.operating_profile || pricingRecord.operating_profile || null
    },
    package: {
      current_plan: request.current_plan || null,
      requested_plan: request.requested_plan || pricingRecord.internal_plan || 'Starter',
      package_name: packageName,
      requested_addons: Array.isArray(request.requested_addons) ? request.requested_addons : [],
      room_count: request.room_count || null,
      user_count: request.user_count || null,
      expected_monthly_bookings: request.expected_monthly_bookings || null
    },
    pricing,
    totals: {
      currency: pricingRecord.currency || COMMERCIAL_CURRENCY,
      recurring_amount: Number.isFinite(Number(recurringAmount)) ? Number(recurringAmount) : null,
      setup_amount: Number.isFinite(Number(legacySetup)) ? Number(legacySetup) : (Number.isFinite(Number(totals.one_time_total)) ? Number(totals.one_time_total) : null),
      total_due_now: Number.isFinite(Number(totalDueNow)) ? Number(totalDueNow) : null
    },
    notes: input.notes || pricingRecord.note,
    payment_instructions: input.payment_instructions || 'Manual payment only. Pay by bank transfer or mobile money using the quote number as reference, then send proof of payment to Tsa Bonno for review.',
    trial_policy: pricingRecord.trial || null
  }
}

export { COMMERCIAL_BILLING_BASIS, COMMERCIAL_PACKAGE_CATALOG, COMMERCIAL_PRODUCT_IDS, getCommercialAddonOffers, getCommercialOffer, getCommercialOffers, getHotelAddon }
