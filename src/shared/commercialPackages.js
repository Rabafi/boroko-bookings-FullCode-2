import { ENTERPRISE_ADDON_CATALOG } from './enterpriseAddons.js'
import { normalizeSubscriptionPlan } from './subscriptionPlans.js'

export const COMMERCIAL_CURRENCY = 'BWP'
export const COMMERCIAL_CURRENCY_SYMBOL = 'P'

export const PLAN_PRICE_CATALOG = {
  Starter: { annual: 8999, monthly: null, setup: 0 },
  Standard: { annual: 12999, monthly: null, setup: 0 },
  Pro: { annual: 18999, monthly: null, setup: 0 },
  Enterprise: { annual: 37998, monthly: null, setup: 0 }
}

export const TRIAL_POLICY = {
  trialDays: 30,
  appliesToPlans: ['Starter', 'Standard', 'Pro'],
  copy: 'One 30-day free trial is available once per property. If this property has already used its trial, the quoted paid package applies immediately after approval.'
}

export function getPlanPrice(plan) {
  return PLAN_PRICE_CATALOG[normalizeSubscriptionPlan(plan)] || PLAN_PRICE_CATALOG.Starter
}

export function formatCommercialMoney(value, fallback = 'To be confirmed') {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return `${COMMERCIAL_CURRENCY_SYMBOL}${n.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function getAdvertisedEnterpriseAddons(propertyType = 'lodge') {
  return ENTERPRISE_ADDON_CATALOG
    .filter((addon) => addon.advertise === true)
    .filter((addon) => !Array.isArray(addon.eligiblePropertyTypes) || addon.eligiblePropertyTypes.includes(propertyType))
}

export function buildCommercialPricingSnapshot({
  plan = 'Starter',
  addons = [],
  roomCount = 0,
  userCount = 0,
  trialEligible = null,
  trialAlreadyUsed = false
} = {}) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  const selectedAddons = Array.isArray(addons) ? addons : []
  const planPrice = getPlanPrice(normalizedPlan)
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
    note: 'Published package and add-on pricing is included. Payment is manual and activation happens only after Boroko approves payment proof.'
  }
}

export function buildSubscriptionCommercialDocument(request = {}, type = 'quote', input = {}) {
  const documentType = type === 'invoice' ? 'invoice' : 'quote'
  const pricing = input.pricing_snapshot || request.pricing_snapshot || buildCommercialPricingSnapshot({
    plan: request.requested_plan,
    addons: request.requested_addons,
    roomCount: request.room_count,
    userCount: request.user_count,
    trialEligible: request.trial_eligible,
    trialAlreadyUsed: request.trial_already_used
  })
  const annual = Number(pricing.annual_subtotal)
  const setup = Number(pricing.setup_total)
  const totalDueNow = Number(pricing.total_due_now)

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
    package: {
      current_plan: request.current_plan || null,
      requested_plan: request.requested_plan || 'Starter',
      requested_addons: Array.isArray(request.requested_addons) ? request.requested_addons : [],
      room_count: request.room_count || null,
      user_count: request.user_count || null,
      expected_monthly_bookings: request.expected_monthly_bookings || null
    },
    pricing,
    totals: {
      currency: pricing.currency || COMMERCIAL_CURRENCY,
      recurring_amount: Number.isFinite(annual) ? annual : null,
      setup_amount: Number.isFinite(setup) ? setup : null,
      total_due_now: Number.isFinite(totalDueNow) ? totalDueNow : null
    },
    notes: input.notes || pricing.note,
    payment_instructions: input.payment_instructions || 'Manual payment only. Pay by bank transfer/mobile money using the quote number as reference, then send proof of payment to Boroko for review.',
    trial_policy: pricing.trial || null
  }
}
