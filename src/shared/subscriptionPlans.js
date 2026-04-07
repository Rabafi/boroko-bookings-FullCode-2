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

const PLANS = {
  Starter: {
    name: 'Starter',
    badge: 'Core Operations',
    priceLabel: 'Entry',
    headline: 'Run a small lodge day to day',
    pitch: 'Front-desk and room operations for small lodges',
    audience: 'Best for small lodges that need reliable daily operations without back-office analytics.',
    summary: 'Bookings, quotations, invoices, guests, rooms, housekeeping, and maintenance in one dependable workflow.',
    modules: [
      'Dashboard',
      'Bookings',
      'Quotations',
      'Invoices',
      'Room Grid',
      'Calendar',
      'Guests',
      'Rooms',
      'Housekeeping',
      'Maintenance',
      'Settings'
    ],
    upgradeNudge: 'Upgrade to Standard for reports, expenses, staff, and night audit.'
  },
  Standard: {
    name: 'Standard',
    badge: 'Business Control',
    priceLabel: 'Mid-tier',
    headline: 'See the business, not just the bookings',
    pitch: 'Adds owner-control tools like reports, expenses, staff, and audit',
    audience: 'Best for growing lodges that need visibility, accountability, and stronger operational discipline.',
    summary: 'Adds reports, expenses, staff management, night audit, imports, conference bookings, and day use.',
    modules: [
      'Everything in Starter',
      'Reports & Analytics',
      'Expenses Tracking',
      'Staff Management',
      'Night Audit',
      'Data Management',
      'Conference Bookings',
      'Pool / Day Use'
    ],
    upgradeNudge: 'Upgrade to Pro for Manager PWA, POS, inventory, and room supplies.'
  },
  Pro: {
    name: 'Pro',
    badge: 'Revenue Expansion',
    priceLabel: 'Full Suite',
    headline: 'Monetize more operations from one system',
    pitch: 'Adds Manager PWA plus POS, inventory, and room supplies',
    audience: 'Best for lodges with bar, restaurant, stock control, or mobile owner oversight needs.',
    summary: 'Unlocks the manager PWA and extra revenue operations with POS, inventory, and room supplies.',
    modules: [
      'Everything in Standard',
      'Manager PWA',
      'Point of Sale (POS)',
      'Inventory Management',
      'Room Supplies Tracker',
      'Online Booking Site'
    ],
    upgradeNudge: 'Top-tier commercial suite for lodges that want one system across the whole operation.'
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

export function buildUpgradeRequestDescription({
  lodgeName,
  currentPlan,
  requestedPlan,
  requestedFeature,
  notes
} = {}) {
  const normalizedRequestedPlan = normalizeSubscriptionPlan(requestedPlan || currentPlan)
  const requestedPlanMeta = getSubscriptionPlan(normalizedRequestedPlan)
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

  lines.push('')
  lines.push(`Requested package outcome: ${requestedPlanMeta.summary}`)

  if (notes?.trim()) {
    lines.push('')
    lines.push('Notes:')
    lines.push(notes.trim())
  }

  return lines.join('\n')
}
