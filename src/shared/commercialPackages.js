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

const POS_PACKAGE_BY_PLAN = {
  Pro: 'restaurant_growth'
}

function enrichOffer(offer) {
  const plan = getSubscriptionPlan(offer.internalPlan) || {}
  const annual = offer.billingBasis === COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE ? offer.priceBwp : null
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
    internalPlan: offer.internalPlan
  }
}

export function getCommercialPackageCatalog(productId = getRuntimeProductId()) {
  return getCommercialOffers(productId).map(enrichOffer)
}

export function getCommercialPackagePlanNames(productId = getRuntimeProductId()) {
  return getCommercialPackageCatalog(productId).map((entry) => entry.internalPlan)
}

export function getCommercialPackageForKey(commercialPackageKey, productId = getRuntimeProductId()) {
  const offer = getCommercialOffer(productId, commercialPackageKey)
  return offer ? enrichOffer(offer) : null
}

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

export function getCommercialPackageLabel(plan, productId = getRuntimeProductId()) {
  const internalPlan = normalizeSubscriptionPlan(plan)
  // Keep the old label stable for existing Hotel UI and licences. New quote
  // documents use displayName, which is explicitly "Hotel Core".
  if (productId === COMMERCIAL_PRODUCT_IDS.HOTEL && internalPlan === 'Enterprise') return 'Hotel'
  return getCommercialPackageForPlan(internalPlan, productId)?.name || internalPlan
}

export function getCommercialPackageDisplayName({ productId = getRuntimeProductId(), commercialPackageKey, plan } = {}) {
  return getCommercialPackageForKey(commercialPackageKey, productId)?.displayName
    || getCommercialPackageForPlan(plan, productId)?.displayName
    || getCommercialPackageLabel(plan, productId)
}

export const TRIAL_POLICY = {
  trialDays: 30,
  appliesToPlans: ['Starter', 'Standard', 'Pro'],
  copy: 'One 30-day free trial is available once per property. If this property has already used its trial, the quoted paid package applies immediately after approval.'
}

export function getPlanPrice(plan, productId = getRuntimeProductId()) {
  if (productId === COMMERCIAL_PRODUCT_IDS.HOTEL) {
    return { annual: null, monthly: null, setup: null, pricingModel: 'quote_confirmed' }
  }
  if (productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS) {
    const offer = getCommercialPackageForPlan(plan, productId)
    return {
      annual: offer?.priceBwp ?? null,
      monthly: null,
      setup: 0,
      pricingModel: 'annual_license'
    }
  }
  return PLAN_PRICE_CATALOG[normalizeSubscriptionPlan(plan)] || PLAN_PRICE_CATALOG.Starter
}

export function formatCommercialMoney(value, fallback = 'To be confirmed') {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return `${COMMERCIAL_CURRENCY_SYMBOL}${n.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function getAdvertisedEnterpriseAddons(propertyType = 'lodge', productId = null) {
  const resolvedProductId = productId || (['hotel', 'resort'].includes(propertyType) ? 'hotel' : getRuntimeProductId())
  if (resolvedProductId !== COMMERCIAL_PRODUCT_IDS.HOTEL) return []
  return ENTERPRISE_ADDON_CATALOG
    .filter((addon) => addon.advertise === true)
    .filter((addon) => !Array.isArray(addon.eligiblePropertyTypes) || addon.eligiblePropertyTypes.includes(propertyType))
}

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
  const addonRows = {}

  for (const key of selectedAddons) {
    const addon = ENTERPRISE_ADDON_CATALOG.find((entry) => entry.key === key)
    if (!addon) continue
    addonRows[key] = {
      label: addon.label,
      annual: addon.price?.annual ?? null,
      monthly: addon.price?.monthly ?? null,
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

export function buildCommercialOfferSnapshot({
  productId = getRuntimeProductId(),
  commercialPackageKey,
  addonKeys = [],
  operatingProfile = null,
  propertyType = null
} = {}) {
  const selected = getCommercialOffer(productId, commercialPackageKey)
  if (!selected) throw new Error(`Unknown commercial package: ${productId}/${commercialPackageKey}`)
  if (selected.eligibleOperatingProfiles?.length && !selected.eligibleOperatingProfiles.includes(operatingProfile)) {
    throw new Error(`${selected.displayName} is not available for operating profile ${operatingProfile || 'unknown'}`)
  }

  const lines = [{
    line_type: 'package',
    key: selected.commercialPackageKey,
    label: selected.displayName,
    billing_basis: selected.billingBasis,
    one_time_amount: selected.billingBasis === COMMERCIAL_BILLING_BASIS.INITIAL_PURCHASE ? selected.priceBwp : 0,
    recurring_amount: selected.billingBasis === COMMERCIAL_BILLING_BASIS.ANNUAL_LICENSE ? selected.priceBwp : 0,
    amount_due_now: selected.priceBwp
  }]
  const eligibleAddons = getCommercialAddonOffers(productId, propertyType)
    .filter((addon) => !addon.eligiblePackageKeys || addon.eligiblePackageKeys.includes(selected.commercialPackageKey))
  for (const key of [...new Set(Array.isArray(addonKeys) ? addonKeys : [])]) {
    const addon = eligibleAddons.find((entry) => entry.addonKey === key)
    if (!addon) throw new Error(`Invalid add-on for ${productId}: ${key}`)
    lines.push({
      line_type: 'addon',
      key: addon.addonKey,
      label: addon.displayName,
      billing_basis: addon.billingBasis,
      one_time_amount: addon.oneTimePriceBwp,
      recurring_amount: addon.annualPriceBwp || 0,
      amount_due_now: addon.oneTimePriceBwp
    })
  }
  const totalDueNow = lines.reduce((sum, line) => sum + Number(line.amount_due_now || 0), 0)
  const recurringAnnual = lines.reduce((sum, line) => sum + Number(line.recurring_amount || 0), 0)
  const oneTimeTotal = lines.reduce((sum, line) => sum + Number(line.one_time_amount || 0), 0)
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
      recurring_annual: recurringAnnual
    },
    included_features: getCommercialEntitlementKeys({ productId, commercialPackageKey: selected.commercialPackageKey, selectedAddonKeys: addonKeys }),
    excluded_features: selected.excludedFeatures,
    operating_profile: operatingProfile,
    property_type: propertyType,
    note: 'This quote is a request for manual review. Payment is not collected here and activation occurs only after Tsa Bonno approves payment proof.'
  }
}

export function buildCommercialPricingSnapshot(options = {}) {
  if (options.commercialPackageKey) {
    return buildCommercialOfferSnapshot({
      productId: options.productId,
      commercialPackageKey: options.commercialPackageKey,
      addonKeys: options.addons,
      operatingProfile: options.operatingProfile,
      propertyType: options.propertyType
    })
  }
  return buildLegacyPricingSnapshot(options)
}

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
  const totals = pricing.totals || {}
  const legacyAnnual = pricing.annual_subtotal === null || pricing.annual_subtotal === undefined ? null : Number(pricing.annual_subtotal)
  const legacySetup = pricing.setup_total === null || pricing.setup_total === undefined ? null : Number(pricing.setup_total)
  const totalDueNow = totals.total_due_now ?? (pricing.total_due_now === null || pricing.total_due_now === undefined ? null : Number(pricing.total_due_now))
  const recurringAmount = totals.recurring_annual ?? (Number.isFinite(legacyAnnual) ? legacyAnnual : null)
  const packageName = pricing.package_label || getCommercialPackageDisplayName({
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
      product_id: request.product_id || pricing.product_id || null,
      package_key: request.commercial_package_key || pricing.commercial_package_key || null,
      operating_profile: request.operating_profile || pricing.operating_profile || null
    },
    package: {
      current_plan: request.current_plan || null,
      requested_plan: request.requested_plan || pricing.internal_plan || 'Starter',
      package_name: packageName,
      requested_addons: Array.isArray(request.requested_addons) ? request.requested_addons : [],
      room_count: request.room_count || null,
      user_count: request.user_count || null,
      expected_monthly_bookings: request.expected_monthly_bookings || null
    },
    pricing,
    totals: {
      currency: pricing.currency || COMMERCIAL_CURRENCY,
      recurring_amount: Number.isFinite(Number(recurringAmount)) ? Number(recurringAmount) : null,
      setup_amount: Number.isFinite(Number(legacySetup)) ? Number(legacySetup) : (Number.isFinite(Number(totals.one_time_total)) ? Number(totals.one_time_total) : null),
      total_due_now: Number.isFinite(Number(totalDueNow)) ? Number(totalDueNow) : null
    },
    notes: input.notes || pricing.note,
    payment_instructions: input.payment_instructions || 'Manual payment only. Pay by bank transfer or mobile money using the quote number as reference, then send proof of payment to Tsa Bonno for review.',
    trial_policy: pricing.trial || null
  }
}

export { COMMERCIAL_BILLING_BASIS, COMMERCIAL_PACKAGE_CATALOG, COMMERCIAL_PRODUCT_IDS, getCommercialAddonOffers, getCommercialOffer, getCommercialOffers, getHotelAddon }
