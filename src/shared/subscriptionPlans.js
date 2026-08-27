export const SUBSCRIPTION_PLAN_ORDER = ['Starter', 'Standard', 'Pro', 'Enterprise']

const PLAN_ALIASES = {
  basic: 'Starter',
  starter: 'Starter',
  standard: 'Standard',
  premium: 'Pro',
  pro: 'Pro',
  trial: 'Pro',
  enterprise: 'Enterprise',
  hotel: 'Enterprise',
  resort: 'Enterprise'
}

const FEATURE_REQUIRED_PLAN = {
  basic_reports: 'Starter',
  starter_backup: 'Starter',
  starter_backup_automation: 'Starter',
  staff_basic: 'Starter',
  prepayments_basic: 'Starter',
  prepayments_management: 'Standard',
  prepayments_advanced: 'Pro',
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
  online_booking: 'Pro',
  hotel_mode: 'Enterprise',
  room_types: 'Enterprise',
  physical_inventory: 'Enterprise',
  floors_sections: 'Enterprise',
  front_desk_dashboard: 'Enterprise',
  room_moves: 'Enterprise',
  folios: 'Enterprise',
  advanced_housekeeping: 'Enterprise',
  hotel_kpis: 'Enterprise',
  corporate_accounts: 'Enterprise',
  rate_plans: 'Enterprise',
  custom_website: 'Enterprise',
  payment_gateway: 'Enterprise',
  channel_manager: 'Enterprise',
  multi_property: 'Enterprise',
  subscription_builder: 'Starter',
  advanced_rates: 'Enterprise',
  guest_portal: 'Enterprise',
  multi_outlet_pos: 'Enterprise',
  linen_laundry: 'Enterprise',
  lost_found: 'Enterprise',
  incident_log: 'Enterprise',
  visitor_register: 'Enterprise',
  emergency_list: 'Enterprise'
}

const FEATURE_UPGRADE_CONTEXT = {
  basic_reports: 'The lodge needs a certified daily, 7-day, or 30-day operating summary.',
  starter_backup: 'The lodge needs a customer-owned core-data copy for support-led recovery.',
  starter_backup_automation: 'The lodge needs an opt-in weekly encrypted backup safeguard in a customer-owned folder.',
  staff_basic: 'The lodge needs to manage its two Starter user accounts safely.',
  prepayments_basic: 'The lodge needs a safe Guest Deposits ledger for money received before dates are confirmed.',
  prepayments_management: 'The lodge needs a searchable deposit portfolio, reconciliation controls, and server-certified exports.',
  prepayments_advanced: 'The lodge needs advanced deposit liability visibility, alerts, and payment-control affordances.',
  reports: 'The lodge needs owner visibility through performance and financial reporting.',
  expenses: 'The lodge needs better control over expenses and money leakage.',
  staff: 'The lodge needs stronger staff accountability and role-based control.',
  audit: 'The lodge needs a proper end-of-day close and tighter operational discipline.',
  conference: 'The lodge wants to manage conference or event revenue inside Tsa Bonno.',
  pool: 'The lodge wants to manage day-use or pool revenue more cleanly.',
  import: 'The lodge needs easier setup, migration, or bulk data handling.',
  pwa: 'The lodge wants mobile owner or manager oversight away from the front desk.',
  pos: 'The lodge wants to sell food, drinks, or extras from the same system.',
  inventory: 'The lodge needs stock control for a wider operation.',
  supplies: 'The lodge wants better tracking of room consumables and supply usage.',
  online_booking: 'The lodge wants a branded public booking page, direct guest enquiries, and more direct sales.',
  hotel_mode: 'The property needs hotel-grade operations with room types, physical inventory, and front-desk dashboards.',
  room_types: 'The property needs to manage different room categories with distinct rates and inventory.',
  physical_inventory: 'The property needs to track individual physical rooms under each room type.',
  floors_sections: 'The property needs to organize rooms by floors, wings, or sections for operational clarity.',
  front_desk_dashboard: 'The property needs a real-time arrivals/departures/in-house board for front-desk operations.',
  room_moves: 'The property needs audited room moves for in-house and active hotel stays.',
  folios: 'The property needs hotel-style billing with room charges, POS posting, and split billing.',
  advanced_housekeeping: 'The property needs supervisor inspection, turnaround tracking, and mobile housekeeping.',
  hotel_kpis: 'The property needs hotel-specific metrics like occupancy, ADR, and RevPAR.',
  corporate_accounts: 'The property needs corporate billing, group blocks, and company statements.',
  rate_plans: 'The property needs seasonal rates, corporate rates, and package pricing.',
  custom_website: 'The property wants a custom direct booking website with its own domain.',
  payment_gateway: 'The property wants to accept online payments directly through its website.',
  channel_manager: 'The property wants to sync availability and rates across multiple booking channels.',
  multi_property: 'The group needs to manage multiple properties from a central dashboard.',
  subscription_builder: 'The property wants to request upgrades or add-ons from inside the app.',
  advanced_rates: 'The property needs restriction-based rates, promo codes, and advanced revenue rules.',
  guest_portal: 'The property wants guest self-service before and during stays.',
  multi_outlet_pos: 'The property needs cross-outlet stock, transfers, and outlet profitability.',
  linen_laundry: 'The property needs linen stock and laundry-batch tracking.',
  lost_found: 'The property needs a controlled lost-and-found register.',
  incident_log: 'The property needs operational incident tracking and follow-up records.',
  visitor_register: 'The property needs visitor and contractor sign-in tracking.',
  emergency_list: 'The property needs a real-time list for emergencies or evacuation.'
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
    summary: 'A practical daily-use package for bookings, guests, room availability, quotations, invoices, housekeeping, maintenance, and a certified basic operating summary.',
    modules: [
      'Take and manage bookings',
      'Keep room availability clear',
      'Send quotations and invoices',
      'Track guests and stays',
      'Run housekeeping and maintenance',
      'Review a basic daily, 7-day, or 30-day summary',
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
    summary: 'Adds full reports and exports, expenses, staff management, night audit, imports, conference bookings, and day use so the owner can manage the business properly.',
    modules: [
      'Everything in Starter',
      'Use full reports, analysis, and exports',
      'Track expenses and money leaks',
      'Control staff and accountability',
      'Close the day with night audit',
      'Handle conference and day-use business'
    ],
    upgradeNudge: 'Upgrade to Pro when you want the exclusive Manager Mobile App, public booking site, POS, inventory, and stronger revenue operations.'
  },
  Pro: {
    name: 'Pro',
    badge: 'Premium Suite',
    spotlight: 'Mobile App + Booking Site',
    priceLabel: 'Full Suite',
    headline: 'The premium suite with exclusive Manager Mobile App and public booking site',
    pitch: 'Adds the Manager Mobile App, a branded public booking site, and the high-grade commercial tools for a stronger lodge operation',
    audience: 'Best for lodges that want mobile owner oversight, their own branded booking URL, direct guest enquiries, POS, stock control, and full commercial visibility.',
    summary: 'Unlocks the exclusive Manager Mobile App, branded booking site, direct guest enquiries, POS revenue, inventory, room supplies, and wider revenue control.',
    modules: [
      'Everything in Standard',
      'Exclusive Manager Mobile App for owner oversight',
      'Public booking site with a branded lodge URL',
      'Direct guest enquiries and WhatsApp contact',
      'POS, outlet revenue, and stock control',
      'Inventory, room supplies, and premium operations'
    ],
    upgradeNudge: 'Upgrade to Enterprise for hotel-grade PMS with room types, physical inventory, folios, front-desk dashboards, and advanced operations.'
  },
  Enterprise: {
    name: 'Enterprise',
    badge: 'Hotel PMS',
    spotlight: 'Hotel-Grade Operations',
    priceLabel: 'Enterprise',
    headline: 'Hotel-grade PMS and enterprise hospitality operations',
    pitch: 'Full property management system with room types, physical inventory, folios, front-desk dashboards, and advanced hotel operations',
    audience: 'Best for motels, hotels, resorts, large lodges, high-volume properties, multi-department operations, and future multi-property groups.',
    summary: 'Complete hotel PMS with room types, physical inventory, floors/sections, front-desk dashboard, arrivals/departures, folios, advanced housekeeping, hotel KPIs, and Enterprise add-on catalog.',
    modules: [
      'Everything in Pro',
      'Hotel/motel/resort property mode',
      'Room types and physical room inventory',
      'Floors, wings, and sections',
      'Front-desk dashboard with arrivals/departures',
      'Hotel folios with room charges and POS posting',
      'Advanced housekeeping with supervisor inspection',
      'Hotel KPIs and reporting',
      'Enterprise add-on catalog'
    ],
    upgradeNudge: 'Enterprise includes all core hotel operations. Add advanced rates, custom websites, payment gateways, and multi-property through Enterprise add-ons.'
  }
}

const PLAN_USAGE_LIMITS = {
  Starter: {
    monthlyBookings: 50,
    monthlyBookingsGrace: 2,
    rooms: 6,
    users: 2
  },
  Standard: {
    monthlyBookings: 200,
    monthlyBookingsGrace: 5,
    rooms: 20,
    users: 5
  },
  Pro: {
    monthlyBookings: 500,
    monthlyBookingsGrace: 10,
    rooms: 30,
    users: 10
  },
  Enterprise: {
    monthlyBookings: 2000,
    monthlyBookingsGrace: 50,
    rooms: 100,
    users: 25
  }
}

export const MONTHLY_USAGE_RESET_COPY = 'Usage resets on the 1st of each month.'
const UPGRADE_NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000
const UPGRADE_INTENT_LOG_KEY = 'boroko:upgrade-intent-log'
const UPGRADE_INTENT_LOG_LIMIT = 50

const PLAN_UPSELL_BENEFITS = {
  Starter: {
    nextPlan: 'Standard',
    capacities: ['200 bookings/month', '20 rooms', '5 users'],
    features: ['Full Reports, Analytics & Exports', 'Staff Management', 'Expenses', 'Night Audit', 'Conference and Day Use']
  },
  Standard: {
    nextPlan: 'Pro',
    capacities: ['500 bookings/month', '30 rooms', '10 users'],
    features: ['POS', 'Inventory', 'Room Supplies', 'Manager Mobile App', 'Public Booking Site']
  },
  Pro: {
    nextPlan: 'Enterprise',
    capacities: ['2,000 bookings/month', '100 rooms', '25 users'],
    features: ['Hotel Mode', 'Room Types', 'Physical Inventory', 'Front Desk Dashboard', 'Folios', 'Hotel KPIs']
  },
  Enterprise: {
    nextPlan: null,
    capacities: ['Capacity packs available', 'Add-on catalog', 'Multi-property ready'],
    features: ['Advanced Rates', 'Custom Website', 'Payment Gateway', 'Channel Manager', 'Multi-Property']
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

export function getPlanUsageLimits(plan) {
  return PLAN_USAGE_LIMITS[normalizeSubscriptionPlan(plan)]
}

export function isUnlimited(value) {
  return value == null || value === Infinity
}

export function getNextSubscriptionPlan(plan) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  const planIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizedPlan)
  if (planIndex === -1 || planIndex >= SUBSCRIPTION_PLAN_ORDER.length - 1) return null
  return SUBSCRIPTION_PLAN_ORDER[planIndex + 1]
}

export function getPlanUpsell(plan) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  return PLAN_UPSELL_BENEFITS[normalizedPlan] || PLAN_UPSELL_BENEFITS.Starter
}

export function getUsageLimitStatus({ used = 0, limit = null, grace = 0 } = {}) {
  return getUsageLimitStatusWithGrace({ used, limit, grace })
}

export function getUsageLimitStatusWithGrace({ used = 0, limit = null, grace = 0 } = {}) {
  const safeUsed = Number.isFinite(Number(used)) ? Number(used) : 0
  if (isUnlimited(limit)) {
    return {
      used: safeUsed,
      limit: null,
      grace: null,
      effectiveLimit: null,
      ratio: 0,
      percentUsed: 0,
      state: 'unlimited',
      blocked: false,
      isBlocked: false,
      isInGrace: false,
      isAtLimit: false,
      isAbovePlan: false,
      remainingGrace: null,
      badgeLabel: 'Unlimited'
    }
  }
  const safeLimit = Math.max(0, Number(limit) || 0)
  const safeGrace = Math.max(0, Number(grace) || 0)
  const effectiveLimit = safeLimit + safeGrace
  const ratio = safeLimit > 0 ? safeUsed / safeLimit : 1
  const percentUsed = safeLimit > 0 ? Math.round(ratio * 100) : 100
  const isInGrace = safeGrace > 0 && safeUsed > safeLimit && safeUsed <= effectiveLimit
  const blocked = safeUsed >= effectiveLimit
  const isAtLimit = safeUsed >= safeLimit
  const isAbovePlan = safeUsed > safeLimit
  const state = blocked
    ? 'blocked'
    : isInGrace
      ? 'grace'
      : ratio >= 0.95
      ? 'critical'
      : ratio >= 0.8
        ? 'warning'
        : 'ok'
  const badgeLabel = blocked
    ? isAbovePlan
      ? 'Above plan limit'
      : 'Limit reached'
    : isInGrace
      ? 'In grace'
      : isAbovePlan
        ? 'Above plan limit'
        : state === 'warning' || state === 'critical'
          ? 'Near limit'
          : 'Available'
  return {
    used: safeUsed,
    limit: safeLimit,
    grace: safeGrace,
    effectiveLimit,
    ratio,
    percentUsed,
    state,
    blocked,
    isBlocked: blocked,
    isInGrace,
    isAtLimit,
    isAbovePlan,
    remainingGrace: safeGrace > 0 ? Math.max(0, effectiveLimit - safeUsed) : 0,
    badgeLabel
  }
}

export function getUsageStateKey(status = {}) {
  if (!status || typeof status !== 'object') return 'normal'
  if (status.state === 'unlimited') return 'enterprise'
  if (status.isAbovePlan) return 'above_plan'
  if (status.state === 'blocked') return 'blocked'
  if (status.state === 'grace') return 'in_grace'
  if (status.state === 'critical') return 'critical'
  if (status.state === 'warning') return 'near_limit'
  return 'normal'
}

export function getUsagePriorityScore(statusOrKey = '') {
  const key = typeof statusOrKey === 'string' ? statusOrKey : getUsageStateKey(statusOrKey)
  const order = {
    blocked: 50,
    above_plan: 49,
    in_grace: 40,
    critical: 30,
    near_limit: 20,
    normal: 10,
    enterprise: 0,
    unknown: 0
  }
  return order[key] || 0
}

export function getUsageStatePresentation(statusOrKey = '') {
  const key = typeof statusOrKey === 'string' ? statusOrKey : getUsageStateKey(statusOrKey)
  const styles = {
    normal: {
      label: 'Normal',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-800'
    },
    near_limit: {
      label: 'Near limit',
      cls: 'border-amber-200 bg-amber-50 text-amber-800'
    },
    critical: {
      label: 'Critical',
      cls: 'border-orange-200 bg-orange-50 text-orange-800'
    },
    in_grace: {
      label: 'In grace',
      cls: 'border-blue-200 bg-blue-50 text-blue-800'
    },
    blocked: {
      label: 'Blocked',
      cls: 'border-red-200 bg-red-50 text-red-800'
    },
    above_plan: {
      label: 'Above plan',
      cls: 'border-red-900 bg-red-950 text-red-100'
    },
    enterprise: {
      label: 'Enterprise',
      cls: 'border-purple-200 bg-purple-50 text-purple-800'
    }
  }
  return { key, ...(styles[key] || styles.normal) }
}

export function getEarlyUpgradePromptState({
  plan,
  bookingsUsage = 0,
  roomsUsage = 0,
  usersUsage = 0,
  limits = getPlanUsageLimits(plan)
} = {}) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  if (normalizedPlan === 'Enterprise') {
    return {
      shouldPrompt: false,
      plan: normalizedPlan,
      reason: '',
      metric: null,
      stateKey: 'enterprise'
    }
  }

  const bookingsStatus = getUsageLimitStatusWithGrace({
    used: bookingsUsage,
    limit: limits.monthlyBookings,
    grace: limits.monthlyBookingsGrace
  })
  const roomsStatus = getUsageLimitStatus({ used: roomsUsage, limit: limits.rooms })
  const usersStatus = getUsageLimitStatus({ used: usersUsage, limit: limits.users })

  const metrics = [
    { key: 'bookings', label: 'bookings', status: bookingsStatus },
    { key: 'rooms', label: 'rooms', status: roomsStatus },
    { key: 'users', label: 'users', status: usersStatus }
  ].filter((metric) => {
    const percent = Number(metric.status?.percentUsed || 0)
    return percent >= 80 && percent < 100 && metric.status?.state !== 'blocked'
  }).sort((left, right) => right.status.percentUsed - left.status.percentUsed)

  if (metrics.length === 0) {
    return {
      shouldPrompt: false,
      plan: normalizedPlan,
      reason: '',
      metric: null,
      stateKey: getUsageStateKey(bookingsStatus)
    }
  }

  const metric = metrics[0]
  return {
    shouldPrompt: true,
    plan: normalizedPlan,
    reason: `You’re approaching your plan limits. Consider upgrading to avoid interruptions.`,
    metric: metric.key,
    stateKey: getUsageStateKey(metric.status)
  }
}

export function formatPlanLimits(plan) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  const limits = getPlanUsageLimits(normalizedPlan)
  const bookings = isUnlimited(limits.monthlyBookings)
    ? 'Unlimited bookings'
    : `${limits.monthlyBookings} bookings per month`
  const grace = isUnlimited(limits.monthlyBookingsGrace) || !limits.monthlyBookingsGrace
    ? 'No grace bookings'
    : `+${limits.monthlyBookingsGrace} grace bookings`
  const rooms = isUnlimited(limits.rooms)
    ? 'Unlimited rooms'
    : `${limits.rooms} rooms`
  const users = isUnlimited(limits.users)
    ? 'Unlimited users'
    : `${limits.users} users`

  return {
    plan: normalizedPlan,
    bookings,
    grace,
    rooms,
    users,
    resetCopy: MONTHLY_USAGE_RESET_COPY,
    bookingExplanation: 'A booking counts when its status is confirmed, checked_in, or checked_out.',
    graceExplanation: 'You can exceed the monthly booking limit slightly using a small grace allowance.'
  }
}

function readStoredJson(storageKey, fallback) {
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStoredJson(storageKey, value) {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function getUpgradeNudgeCooldownState(storageKey, now = Date.now(), cooldownMs = UPGRADE_NUDGE_COOLDOWN_MS) {
  const entry = readStoredJson(storageKey, null)
  const lastShownAt = Number(entry?.lastShownAt || 0)
  const nextAllowedAt = Number(entry?.nextAllowedAt || 0)
  const allowed = !Number.isFinite(nextAllowedAt) || nextAllowedAt <= now

  return {
    allowed,
    lastShownAt: Number.isFinite(lastShownAt) ? lastShownAt : null,
    nextAllowedAt: Number.isFinite(nextAllowedAt) ? nextAllowedAt : null,
    cooldownMs
  }
}

export function markUpgradeNudgeShown(storageKey, now = Date.now(), cooldownMs = UPGRADE_NUDGE_COOLDOWN_MS) {
  const state = {
    lastShownAt: now,
    nextAllowedAt: now + cooldownMs
  }
  writeStoredJson(storageKey, state)
  return state
}

export function trackUpgradeIntent({
  lodgeId = '',
  lodgeName = '',
  plan = 'Starter',
  usage = {},
  recommendation = null,
  trigger = 'modal'
} = {}) {
  const event = {
    lodgeId: lodgeId || '',
    lodgeName: lodgeName || '',
    plan: normalizeSubscriptionPlan(plan),
    usage: {
      bookings: Number(usage?.bookings ?? usage?.monthlyBookings ?? usage?.targetMonthBookings ?? 0),
      rooms: Number(usage?.rooms ?? 0),
      users: Number(usage?.users ?? 0)
    },
    recommendedPlan: normalizeSubscriptionPlan(recommendation?.recommendedPlan || recommendation?.plan || plan),
    trigger: String(trigger || 'modal').trim().toLowerCase(),
    timestamp: new Date().toISOString()
  }

  const existing = readStoredJson(UPGRADE_INTENT_LOG_KEY, [])
  const nextLog = Array.isArray(existing) ? [event, ...existing].slice(0, UPGRADE_INTENT_LOG_LIMIT) : [event]
  writeStoredJson(UPGRADE_INTENT_LOG_KEY, nextLog)

  try {
    console.info?.('[Tsa Bonno] upgrade intent', event)
  } catch {
    // Best-effort only.
  }

  return event
}

export function canCreateBooking({ plan, used } = {}) {
  const limits = getPlanUsageLimits(plan)
  return getUsageLimitStatusWithGrace({
    used,
    limit: limits.monthlyBookings,
    grace: limits.monthlyBookingsGrace
  })
}

export function canCreateRoom({ plan, used } = {}) {
  const limits = getPlanUsageLimits(plan)
  return getUsageLimitStatus({ used, limit: limits.rooms })
}

export function canCreateUser({ plan, used } = {}) {
  const limits = getPlanUsageLimits(plan)
  return getUsageLimitStatus({ used, limit: limits.users })
}

export function isBookingCreatedInUsageMonth(booking = {}, monthDate = new Date()) {
  const createdAt = new Date(booking?.created_at || 0)
  if (!Number.isFinite(createdAt.getTime())) return false
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1)
  return createdAt >= start && createdAt < end
}

export function isCountableBookingForUsage(booking = {}) {
  const status = String(booking?.status || '').trim().toLowerCase()
  if (!['confirmed', 'checked_in', 'checked_out'].includes(status)) return false
  if (booking?.is_exclusive_event === true) return false
  return true
}

export function isBookingInUsageMonth(booking = {}, monthDate = new Date()) {
  const checkIn = new Date(booking?.check_in || 0)
  if (!Number.isFinite(checkIn.getTime())) return false
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1)
  return checkIn >= start && checkIn < end
}

export function countMonthlyUsageBookings(bookings = [], monthDate = new Date()) {
  return (bookings || []).filter((booking) => (
    isCountableBookingForUsage(booking) && isBookingInUsageMonth(booking, monthDate)
  )).length
}

export function countMonthlyCreatedBookings(bookings = [], monthDate = new Date()) {
  return (bookings || []).filter((booking) => (
    isCountableBookingForUsage(booking) && isBookingCreatedInUsageMonth(booking, monthDate)
  )).length
}

function pickStricterUsageStatus(firstStatus, secondStatus) {
  const priority = { blocked: 5, grace: 4, critical: 3, warning: 2, ok: 1, unlimited: 0 }
  const firstRank = priority[firstStatus?.state] || 0
  const secondRank = priority[secondStatus?.state] || 0
  return secondRank > firstRank ? secondStatus : firstStatus
}

function resolveUsageValue(candidate, fallback = 0) {
  const value = Number(candidate)
  if (Number.isFinite(value)) return value
  const nextValue = Number(fallback)
  return Number.isFinite(nextValue) ? nextValue : 0
}

export function evaluateBookingCreationAllowance({
  plan,
  targetMonthUsed = 0,
  createdMonthUsed = 0
} = {}) {
  const targetMonthStatus = canCreateBooking({ plan, used: targetMonthUsed })
  const creationMonthStatus = canCreateBooking({ plan, used: createdMonthUsed })
  const combinedStatus = pickStricterUsageStatus(targetMonthStatus, creationMonthStatus)
  let blockReason = null
  if (targetMonthStatus.isBlocked) blockReason = 'target_month'
  else if (creationMonthStatus.isBlocked) blockReason = 'creation_month'

  return {
    plan: normalizeSubscriptionPlan(plan),
    targetMonthUsed,
    createdMonthUsed,
    targetMonthStatus,
    creationMonthStatus,
    combinedStatus,
    isBlocked: Boolean(blockReason),
    isInGrace: targetMonthStatus.isInGrace || creationMonthStatus.isInGrace,
    blockReason
  }
}

export function getPlanRecommendation({
  plan,
  bookingsUsage = null,
  roomsUsage = null,
  usersUsage = null,
  usage = {},
  limits = getPlanUsageLimits(plan)
} = {}) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  if (normalizedPlan === 'Enterprise') {
    return {
      label: 'Best fit / Enterprise',
      tone: 'good',
      recommendedPlan: 'Enterprise',
      reason: 'Optimal',
      strong: false,
      details: 'Enterprise hotel-grade operations are active for this property.',
      currentUsage: {
        bookings: resolveUsageValue(bookingsUsage, usage.monthlyBookings ?? usage.targetMonthBookings ?? 0),
        rooms: resolveUsageValue(roomsUsage, usage.rooms ?? 0),
        users: resolveUsageValue(usersUsage, usage.users ?? 0)
      }
    }
  }

  const bookingUsed = resolveUsageValue(bookingsUsage, usage.monthlyBookings ?? usage.targetMonthBookings ?? 0)
  const roomUsed = resolveUsageValue(roomsUsage, usage.rooms ?? 0)
  const userUsed = resolveUsageValue(usersUsage, usage.users ?? 0)

  const bookingStatus = getUsageLimitStatusWithGrace({
    used: bookingUsed,
    limit: limits.monthlyBookings,
    grace: limits.monthlyBookingsGrace
  })
  const roomStatus = getUsageLimitStatusWithGrace({ used: roomUsed, limit: limits.rooms, grace: 0 })
  const userStatus = getUsageLimitStatusWithGrace({ used: userUsed, limit: limits.users, grace: 0 })

  const nextPlan = getNextSubscriptionPlan(normalizedPlan)
  const metrics = [
    {
      key: 'bookings',
      label: 'High booking volume',
      used: bookingUsed,
      limit: limits.monthlyBookings,
      status: bookingStatus,
      ratio: isUnlimited(limits.monthlyBookings) || !limits.monthlyBookings ? 0 : bookingUsed / limits.monthlyBookings
    },
    {
      key: 'rooms',
      label: 'Room expansion',
      used: roomUsed,
      limit: limits.rooms,
      status: roomStatus,
      ratio: isUnlimited(limits.rooms) || !limits.rooms ? 0 : roomUsed / limits.rooms
    },
    {
      key: 'users',
      label: 'Staff growth',
      used: userUsed,
      limit: limits.users,
      status: userStatus,
      ratio: isUnlimited(limits.users) || !limits.users ? 0 : userUsed / limits.users
    }
  ]

  const strong = [bookingStatus, roomStatus, userStatus].some((status) => (
    status.isBlocked || status.isInGrace || status.isAbovePlan
  ))
  const anyPressure = metrics.some((metric) => metric.ratio >= 0.8)
  const pressuredMetrics = metrics.filter((metric) => metric.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio)
  const dominantMetric = pressuredMetrics[0] || [...metrics].sort((a, b) => b.ratio - a.ratio)[0]
  const reason = strong || anyPressure
    ? (strong && pressuredMetrics.length > 1
      ? 'Multiple limits near capacity'
      : dominantMetric?.label || 'Multiple limits near capacity')
    : 'Capacity still healthy'

  return {
    label: strong ? 'Upgrade strongly recommended' : anyPressure ? `Recommend ${nextPlan}` : `${normalizedPlan} still fits`,
    tone: strong ? 'urgent' : anyPressure ? 'warning' : 'good',
    recommendedPlan: anyPressure || strong ? nextPlan : normalizedPlan,
    reason,
    strong,
    details: strong
      ? `${normalizedPlan} is under pressure and new record creation may be interrupted soon.`
      : anyPressure
        ? `${normalizedPlan} usage is above 80% on at least one capacity metric.`
        : `${normalizedPlan} is still comfortably inside its current limits.`,
    currentUsage: {
      bookings: bookingUsed,
      rooms: roomUsed,
      users: userUsed
    },
    currentUsagePct: {
      bookings: isUnlimited(limits.monthlyBookings) || !limits.monthlyBookings ? 0 : Math.round((bookingUsed / limits.monthlyBookings) * 100),
      rooms: isUnlimited(limits.rooms) || !limits.rooms ? 0 : Math.round((roomUsed / limits.rooms) * 100),
      users: isUnlimited(limits.users) || !limits.users ? 0 : Math.round((userUsed / limits.users) * 100)
    },
    metrics
  }
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

export function buildUpgradeRequestMessage(lodge = {}, usage = {}, recommendation = {}, options = {}) {
  const lodgeName = lodge?.lodgeName || lodge?.lodge_name || lodge?.company_name || lodge?.name || 'Unknown lodge'
  const currentPlan = normalizeSubscriptionPlan(lodge?.currentPlan || lodge?.plan || recommendation?.currentPlan || usage?.currentPlan || 'Starter')
  const recommendedPlan = normalizeSubscriptionPlan(recommendation?.recommendedPlan || usage?.recommendedPlan || getNextSubscriptionPlan(currentPlan))
  const currentLimits = getPlanUsageLimits(currentPlan)
  const nextLimits = getPlanUsageLimits(recommendedPlan)
  const usageBookings = Number(usage?.bookings ?? usage?.monthlyBookings ?? usage?.bookingUsage ?? 0)
  const usageRooms = Number(usage?.rooms ?? 0)
  const usageUsers = Number(usage?.users ?? 0)
  const timestamp = new Date().toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
  const channel = String(options?.channel || 'email').toLowerCase()

  const formatUsage = (used, limit, grace = 0) => {
    if (isUnlimited(limit)) return 'Unlimited'
    const base = `${used} / ${limit}`
    return grace ? `${base} (+${grace} grace)` : base
  }

  const emailLines = [
    `Lodge: ${lodgeName}`,
    `Current plan: ${currentPlan}`,
    `Booking usage: ${formatUsage(usageBookings, currentLimits.monthlyBookings, currentLimits.monthlyBookingsGrace)}`,
    `Room usage: ${formatUsage(usageRooms, currentLimits.rooms)}`,
    `User usage: ${formatUsage(usageUsers, currentLimits.users)}`,
    `Recommended plan: ${recommendedPlan}`,
    `Timestamp: ${timestamp}`
  ]

  if (recommendation?.reason || recommendation?.details) {
    emailLines.push(`Reason: ${recommendation?.reason || recommendation?.details}`)
  }

  emailLines.push('')
  emailLines.push(`Why upgrade: ${nextLimits.bookings}, ${nextLimits.rooms}, ${nextLimits.users}.`)

  const whatsappLines = channel === 'whatsapp'
    ? [
        'Hi, I’d like to upgrade our Tsa Bonno HospitalityOS plan.',
        '',
        `Lodge: ${lodgeName}`,
        `Plan: ${currentPlan}`,
        `Usage: ${formatUsage(usageBookings, currentLimits.monthlyBookings, currentLimits.monthlyBookingsGrace)} bookings`,
        `Rooms: ${formatUsage(usageRooms, currentLimits.rooms)}`,
        `Users: ${formatUsage(usageUsers, currentLimits.users)}`,
        '',
        `We’d like to move to ${recommendedPlan}.`,
        '',
        'Thanks.'
      ]
    : [
        `Upgrade request for ${lodgeName}`,
        `Current plan: ${currentPlan} → ${recommendedPlan}`,
        `Bookings: ${formatUsage(usageBookings, currentLimits.monthlyBookings, currentLimits.monthlyBookingsGrace)}`,
        `Rooms: ${formatUsage(usageRooms, currentLimits.rooms)}`,
        `Users: ${formatUsage(usageUsers, currentLimits.users)}`,
        `Time: ${timestamp}`
      ]

  if (channel !== 'whatsapp' && recommendation?.reason) {
    whatsappLines.push(`Reason: ${recommendation.reason}`)
  }

  return {
    lodgeName,
    currentPlan,
    recommendedPlan,
    timestamp,
    emailSubject: `Upgrade Request – ${lodgeName} (${currentPlan} → ${recommendedPlan})`,
    emailBody: emailLines.join('\n'),
    whatsappText: whatsappLines.join('\n'),
    currentLimits,
    nextLimits,
    usage: {
      bookings: usageBookings,
      rooms: usageRooms,
      users: usageUsers
    }
  }
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
  const requestMessage = buildUpgradeRequestMessage(
    {
      lodgeName,
      currentPlan,
      plan: currentPlan
    },
    {
      recommendedPlan: normalizedRequestedPlan
    },
    {
      recommendedPlan: normalizedRequestedPlan
    }
  )
  const featureKey = inferFeatureKey(requestedFeatureKey || requestedFeature)
  const featureContext = getFeatureUpgradeContext(featureKey)
  const lines = [requestMessage.emailBody, '']

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
    lines.push('Commercial value: Exclusive Manager Mobile App access, a branded lodge URL, direct booking requests, WhatsApp contact, property policies, room amenities, POS, inventory, and a stronger online sales presence.')
  }

  if (notes?.trim()) {
    lines.push('')
    lines.push('Notes:')
    lines.push(notes.trim())
  }

  return lines.join('\n')
}
