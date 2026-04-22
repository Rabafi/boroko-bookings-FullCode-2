export const SUBSCRIPTION_PLAN_ORDER = ['Starter', 'Standard', 'Pro']

const PLAN_ALIASES = {
  basic: 'Starter',
  starter: 'Starter',
  standard: 'Standard',
  premium: 'Pro',
  pro: 'Pro'
}

const FEATURE_REQUIRED_PLAN = {
  reports: 'Standard',
  expenses: 'Standard',
  staff: 'Standard',
  audit: 'Standard',
  conference: 'Standard',
  pool: 'Standard',
  import: 'Standard',
  pwa: 'Pro',
  pos: 'Pro',
  inventory: 'Pro',
  supplies: 'Pro',
  online_booking: 'Pro'
}

const FEATURE_UPGRADE_CONTEXT = {
  reports: 'The lodge needs owner visibility through performance and financial reporting.',
  expenses: 'The lodge needs better control over expenses and money leakage.',
  staff: 'The lodge needs stronger staff accountability and role-based control.',
  audit: 'The lodge needs a proper end-of-day close and tighter operational discipline.',
  conference: 'The lodge wants to manage conference or event revenue inside Boroko.',
  pool: 'The lodge wants to manage day-use or pool revenue more cleanly.',
  import: 'The lodge needs easier setup, migration, or bulk data handling.',
  pwa: 'The lodge wants mobile owner or manager oversight away from the front desk.',
  pos: 'The lodge wants to sell food, drinks, or extras from the same system.',
  inventory: 'The lodge needs stock control for a wider operation.',
  supplies: 'The lodge wants better tracking of room consumables and supply usage.',
  online_booking: 'The lodge wants a branded public booking page, direct guest enquiries, and more direct sales.'
}

const PLANS = {
  Starter: {
    name: 'Starter',
    badge: 'Daily Ops',
    spotlight: null,
    priceLabel: 'Entry',
    headline: 'Everything needed to run a small lodge front desk',
    pitch: 'Covers the daily guest, booking, room, and front-desk basics',
    audience: 'Best for small lodges that need a dependable daily operations system before they invest in deeper business controls.',
    summary: 'A practical daily-use package for bookings, guests, room availability, quotations, invoices, housekeeping, and maintenance.',
    modules: [
      'Take and manage bookings',
      'Keep room availability clear',
      'Send quotations and invoices',
      'Track guests and stays',
      'Run housekeeping and maintenance',
      'Work from one front-desk system'
    ],
    upgradeNudge: 'Upgrade to Standard when you want owner visibility, expense control, staff accountability, and night audit.'
  },
  Standard: {
    name: 'Standard',
    badge: 'Owner Control',
    spotlight: 'Most Popular',
    priceLabel: 'Mid-tier',
    headline: 'The complete management package for most serious lodges',
    pitch: 'Adds the business-control tools owners quickly start asking for',
    audience: 'Best for growing lodges that want reports, expense tracking, staff control, and better day-to-day discipline without jumping to the full commercial suite.',
    summary: 'Adds reports, expenses, staff management, night audit, imports, conference bookings, and day use so the owner can manage the business properly.',
    modules: [
      'Everything in Starter',
      'See lodge performance clearly',
      'Track expenses and money leaks',
      'Control staff and accountability',
      'Close the day with night audit',
      'Handle conference and day-use business'
    ],
    upgradeNudge: 'Upgrade to Pro when you want direct online bookings, mobile oversight, POS, inventory, and stronger revenue operations.'
  },
  Pro: {
    name: 'Pro',
    badge: 'Direct Growth',
    spotlight: 'Best for Direct Bookings',
    priceLabel: 'Full Suite',
    headline: 'The premium growth package for branded, direct-booking lodges',
    pitch: 'Adds your own public booking page plus the commercial tools to run more of the business from one system',
    audience: 'Best for lodges that want their own branded booking URL, direct guest enquiries, mobile owner oversight, and full commercial control.',
    summary: 'Unlocks a branded booking page for each lodge, direct guest enquiries, mobile oversight, POS, inventory, and room supplies.',
    modules: [
      'Everything in Standard',
      'Own a branded booking page',
      'Receive direct guest enquiries',
      'Show amenities, policies, and contact options',
      'Run POS and stock control',
      'Manage more of the business from one system'
    ],
    upgradeNudge: 'Best for lodges that want to sell directly, look more premium online, and run a wider operation from one system.'
  }
}

export function normalizeSubscriptionPlan(plan) {
  const raw = String(plan || '').trim().toLowerCase()
  return PLAN_ALIASES[raw] || 'Starter'
}

export function getSubscriptionPlan(plan) {
  return PLANS[normalizeSubscriptionPlan(plan)]
}

export function getAllSubscriptionPlans() {
  return SUBSCRIPTION_PLAN_ORDER.map((planName) => PLANS[planName])
}

export function formatSubscriptionPlan(plan) {
  return getSubscriptionPlan(plan).name
}

export function getFeatureRequiredPlan(featureName) {
  return FEATURE_REQUIRED_PLAN[featureName] || 'Standard'
}

function getFeatureUpgradeContext(featureName) {
  return FEATURE_UPGRADE_CONTEXT[featureName] || ''
}

function inferFeatureKey(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (FEATURE_REQUIRED_PLAN[raw]) return raw
  if (raw.includes('online')) return 'online_booking'
  if (raw.includes('report')) return 'reports'
  if (raw.includes('expense')) return 'expenses'
  if (raw.includes('staff')) return 'staff'
  if (raw.includes('audit')) return 'audit'
  if (raw.includes('conference')) return 'conference'
  if (raw.includes('pool') || raw.includes('day use')) return 'pool'
  if (raw.includes('import')) return 'import'
  if (raw.includes('pwa')) return 'pwa'
  if (raw.includes('pos')) return 'pos'
  if (raw.includes('inventory')) return 'inventory'
  if (raw.includes('suppl')) return 'supplies'
  return ''
}

export function buildUpgradeRequestDescription({
  lodgeName,
  currentPlan,
  requestedPlan,
  requestedFeature,
  requestedFeatureKey,
  notes
} = {}) {
  const normalizedRequestedPlan = normalizeSubscriptionPlan(requestedPlan || currentPlan)
  const requestedPlanMeta = getSubscriptionPlan(normalizedRequestedPlan)
  const featureKey = inferFeatureKey(requestedFeatureKey || requestedFeature)
  const featureContext = getFeatureUpgradeContext(featureKey)
  const lines = [
    `${lodgeName || 'This lodge'} is requesting an upgrade review.`,
    ''
  ]

  if (currentPlan) {
    lines.push(`Current plan: ${normalizeSubscriptionPlan(currentPlan)}`)
  }

  lines.push(`Requested plan: ${normalizedRequestedPlan}`)
  lines.push(`Reason: ${requestedPlanMeta.pitch}.`)

  if (requestedFeature) {
    lines.push(`Blocked feature: ${requestedFeature}`)
  }

  if (featureContext) {
    lines.push(`Business need: ${featureContext}`)
  }

  lines.push('')
  lines.push(`Requested package outcome: ${requestedPlanMeta.summary}`)

  if (normalizedRequestedPlan === 'Pro') {
    lines.push('Commercial value: A branded lodge URL, direct booking requests, WhatsApp contact, property policies, room amenities, and a stronger online sales presence.')
  }

  if (notes?.trim()) {
    lines.push('')
    lines.push('Notes:')
    lines.push(notes.trim())
  }

  return lines.join('\n')
}
