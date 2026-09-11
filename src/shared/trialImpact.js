import {
  getCommercialAddonOffers,
  getCommercialOffers,
  COMMERCIAL_PRODUCT_IDS
} from './commercialEntitlements.js'
import { getModuleByKey, MODULE_CATALOG } from './moduleCatalog.js'
import { normalizePropertyTypeForProduct } from './productIdentity.js'
import {
  getFeatureRequiredPlan,
  getPlanUsageLimits,
  normalizeSubscriptionPlan,
  SUBSCRIPTION_PLAN_ORDER
} from './subscriptionPlans.js'

/**
 * Pure, presentation-ready preview of what a property would need to resolve
 * before a full-feature trial can become a paid package.
 *
 * This module deliberately does not read clocks, storage, auth state, or the
 * database. Callers must pass the current entitlement, selected package,
 * effective limits/features, and live usage explicitly.
 */

export const TRIAL_IMPACT_VERSION = 1

const PWA_FEATURE_KEY = 'pwa'
const CANONICAL_FEATURE_KEY = /^[a-z][a-z0-9_.-]{0,119}$/

const LIMIT_ALIASES = Object.freeze({
  users: ['users', 'userLimit', 'maxUsers', 'user_limit', 'max_users'],
  rooms: ['rooms', 'roomLimit', 'maxRooms', 'room_limit', 'max_rooms'],
  monthlyBookings: [
    'monthlyBookings',
    'monthlyBookingLimit',
    'bookingLimit',
    'bookings',
    'monthly_bookings',
    'checkInMonthBookings',
    'check_in_month_bookings'
  ],
  monthlyBookingsGrace: [
    'monthlyBookingsGrace',
    'monthlyBookingGrace',
    'bookingGrace',
    'graceBookings',
    'monthly_bookings_grace',
    'checkInMonthBookingsGrace',
    'check_in_month_bookings_grace'
  ]
})

const INACTIVE_TRIAL_STATUSES = new Set([
  'licensed',
  'active',
  'expired',
  'suspended',
  'paused',
  'cancelled',
  'inactive',
  'grace_period'
])

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeCount(value) {
  const number = finiteNumber(value)
  return number == null ? null : Math.max(0, Math.floor(number))
}

function firstFiniteCount(values = [], fallback = 0) {
  for (const value of values) {
    const number = nonNegativeCount(value)
    if (number != null) return number
  }
  return nonNegativeCount(fallback) ?? 0
}

function firstPresent(values = []) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function normaliseStatus(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** Return true only when the caller explicitly describes an active trial. */
export function isActiveTrialEntitlement(entitlement = {}) {
  const source = asObject(entitlement)
  if (source.expired === true || source.is_expired === true || source.trial_expired === true) return false

  const status = normaliseStatus(firstPresent([
    source.status,
    source.subscription_state,
    source.subscriptionState,
    source.state
  ]))
  if (INACTIVE_TRIAL_STATUSES.has(status)) return false
  if (status === 'trial') return true

  // These are explicit booleans, not inferred dates. This also supports the
  // compact entitlement object used by the Manager PWA.
  return source.trial === true || source.isTrial === true || source.is_trial === true
}

function resolveProductId(productId) {
  const raw = String(productId ?? '').trim()
  if (raw === COMMERCIAL_PRODUCT_IDS.HOTEL) return COMMERCIAL_PRODUCT_IDS.HOTEL
  if (raw === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS) return COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS
  if (raw === COMMERCIAL_PRODUCT_IDS.LODGE_CAMP) return COMMERCIAL_PRODUCT_IDS.LODGE_CAMP
  // Keep the shared engine deterministic for legacy callers that omit the
  // product, while never using a different product's catalogue.
  return COMMERCIAL_PRODUCT_IDS.LODGE_CAMP
}

function caseInsensitiveOffer(productId, key) {
  const rawKey = String(key ?? '').trim().toLowerCase()
  if (!rawKey) return null
  return getCommercialOffers(productId).find((offer) => (
    String(offer.commercialPackageKey || '').toLowerCase() === rawKey ||
    String(offer.displayName || '').toLowerCase() === rawKey ||
    String(offer.name || '').toLowerCase() === rawKey
  )) || null
}

function resolveOfferForPlan(productId, plan) {
  const normalizedPlan = normalizeSubscriptionPlan(plan)
  const matches = getCommercialOffers(productId).filter((offer) => offer.internalPlan === normalizedPlan)
  return matches.length === 1 ? matches[0] : null
}

function normaliseFeatureMap(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .map((entry) => {
        if (typeof entry === 'string') return [entry.trim(), true]
        const key = String(entry?.feature_name || entry?.featureName || entry?.key || '').trim()
        return key ? [key, entry?.enabled !== false] : null
      })
      .filter(Boolean))
  }

  const object = asObject(value)
  return Object.fromEntries(Object.entries(object)
    .map(([key, enabled]) => [String(key).trim(), enabled !== false])
    .filter(([key]) => Boolean(key)))
}

function normaliseLimits(value) {
  const source = asObject(value)
  const output = {}
  for (const [canonicalKey, aliases] of Object.entries(LIMIT_ALIASES)) {
    const candidate = firstPresent(aliases.map((alias) => source[alias]))
    if (candidate === undefined) continue
    if (candidate === null || candidate === Infinity) output[canonicalKey] = null
    else {
      const numeric = nonNegativeCount(candidate)
      if (numeric != null) output[canonicalKey] = numeric
    }
  }
  return output
}

function packageActivationWasExplicitlyConfirmed(source = {}, topLevel = {}) {
  const values = [
    topLevel.paidPackageActivated,
    topLevel.targetPackageActivated,
    source.activated,
    source.isActivated,
    source.is_activated,
    source.paid,
    source.paidPackageActivated
  ]
  if (values.some((value) => value === true)) return true
  if (values.some((value) => value === false)) return false
  const status = normaliseStatus(source.status)
  return status === 'activated' || status === 'active' || status === 'licensed'
}

/**
 * Resolve a selected package without selecting a free/default package on the
 * caller's behalf. A plan-only selection is accepted only when that product
 * has one unambiguous commercial offer for that plan.
 */
export function resolveTrialImpactTargetPackage({
  productId,
  targetPackage = null,
  selectedTargetPackage = null,
  target_package = null,
  selected_target_package = null,
  effectiveFeatures = null,
  effective_features = null,
  effectiveLimits = null,
  effective_limits = null,
  limits = null,
  paidPackageActivated = undefined,
  targetPackageActivated = undefined
} = {}) {
  const resolvedProductId = resolveProductId(productId)
  const selected = selectedTargetPackage ?? selected_target_package ?? targetPackage ?? target_package
  if (selected === null || selected === undefined || selected === '') return null

  const source = typeof selected === 'string' ? { packageKey: selected } : asObject(selected)
  const key = source.commercialPackageKey || source.package_key || source.packageKey || source.key
  const planCandidate = source.internalPlan || source.plan || source.subscriptionPlan || source.subscription_plan
  const stringPlanCandidate = typeof selected === 'string' ? selected : null
  const offer = caseInsensitiveOffer(resolvedProductId, key)
    || caseInsensitiveOffer(resolvedProductId, selected)
    || resolveOfferForPlan(resolvedProductId, planCandidate || stringPlanCandidate)

  const normalizedPlan = normalizeSubscriptionPlan(planCandidate || offer?.internalPlan || 'Starter')
  const hasUsageLimits = source.hasUsageLimits !== false && offer?.hasUsageLimits !== false
  const basePlanLimits = hasUsageLimits ? getPlanUsageLimits(normalizedPlan) : {
    users: null,
    rooms: null,
    monthlyBookings: null,
    monthlyBookingsGrace: null
  }

  const packageFeatures = normaliseFeatureMap(firstPresent([
    source.effective_features,
    source.effectiveFeatures,
    source.features
  ]))
  const packageOverrides = normaliseFeatureMap(firstPresent([
    source.feature_overrides,
    source.featureOverrides,
    source.overrides?.features
  ]))
  const includedFeatures = asArray(firstPresent([
    source.includedFeatures,
    source.included_features,
    offer?.includedFeatures
  ])).map((feature) => String(feature).trim()).filter((feature) => CANONICAL_FEATURE_KEY.test(feature))
  const excludedFeatures = asArray(firstPresent([
    source.excludedFeatures,
    source.excluded_features,
    offer?.excludedFeatures
  ])).map((feature) => String(feature).trim()).filter((feature) => CANONICAL_FEATURE_KEY.test(feature))

  const packageLimitOverrides = {
    ...normaliseLimits(source.limits),
    ...normaliseLimits(source.effective_limits),
    ...normaliseLimits(source.effectiveLimits),
    ...normaliseLimits(source.overrides?.limits),
    ...normaliseLimits(effectiveLimits),
    ...normaliseLimits(effective_limits),
    ...normaliseLimits(limits)
  }
  const resolvedLimits = { ...basePlanLimits, ...packageLimitOverrides }
  const targetPlanIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizedPlan)
  const planBaseline = resolvedProductId === COMMERCIAL_PRODUCT_IDS.LODGE_CAMP
    ? Object.fromEntries([...productFeatureKeys(resolvedProductId)].map((feature) => {
        const required = getModuleByKey(feature)?.requiredPlan || getFeatureRequiredPlan(feature)
        return [feature, SUBSCRIPTION_PLAN_ORDER.indexOf(normalizeSubscriptionPlan(required)) <= targetPlanIndex]
      }))
    : {}
  const targetEffectiveFeatures = {
    ...planBaseline,
    ...Object.fromEntries(includedFeatures.map((feature) => [feature, true])),
    ...Object.fromEntries(excludedFeatures.map((feature) => [feature, false])),
    ...packageFeatures,
    ...packageOverrides,
    ...normaliseFeatureMap(effectiveFeatures ?? effective_features)
  }

  const activated = paidPackageActivated !== undefined
    ? paidPackageActivated === true
    : targetPackageActivated !== undefined
      ? targetPackageActivated === true
      : packageActivationWasExplicitlyConfirmed(source, {
        paidPackageActivated,
        targetPackageActivated
      })

  return {
    key: String(key || offer?.commercialPackageKey || normalizedPlan).trim(),
    commercialPackageKey: offer?.commercialPackageKey || (key ? String(key).trim() : null),
    name: source.displayName || source.name || offer?.displayName || offer?.name || normalizedPlan,
    displayName: source.displayName || source.name || offer?.displayName || offer?.name || normalizedPlan,
    plan: normalizedPlan,
    internalPlan: normalizedPlan,
    activated,
    hasUsageLimits,
    limits: resolvedLimits,
    effectiveLimits: resolvedLimits,
    effectiveFeatures: targetEffectiveFeatures,
    includedFeatures,
    excludedFeatures,
    offer
  }
}

function productFeatureKeys(productId, propertyType = null) {
  const property = propertyType ? normalizePropertyTypeForProduct(propertyType) : null
  const keys = new Set()

  for (const offer of getCommercialOffers(productId)) {
    for (const key of [...(offer.includedFeatures || []), ...(offer.excludedFeatures || [])]) {
      if (CANONICAL_FEATURE_KEY.test(String(key || '').trim())) keys.add(String(key).trim())
    }
  }
  for (const addon of getCommercialAddonOffers(productId, propertyType)) {
    for (const key of addon.includedFeatures || []) {
      if (CANONICAL_FEATURE_KEY.test(String(key || '').trim())) keys.add(String(key).trim())
    }
  }

  // Lodge package access also has a legacy plan ladder. Add its route-level
  // feature aliases, but never pull Hotel/POS capabilities into LodgingOS.
  if (productId !== COMMERCIAL_PRODUCT_IDS.LODGE_CAMP) return keys
  for (const module of MODULE_CATALOG) {
    const moduleTypes = new Set((module.allowedPropertyTypes || []).map(normalizePropertyTypeForProduct))
    const relevantToProduct = property
      ? moduleTypes.has(property)
      : moduleTypes.has('lodge') || moduleTypes.has('camp') || moduleTypes.has('guest_house')
    if (!relevantToProduct) continue
    if (module.category === 'hotel' || module.visibility === 'hotel_only') continue
    const requiredIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizeSubscriptionPlan(module.requiredPlan))
    if (requiredIndex > SUBSCRIPTION_PLAN_ORDER.indexOf('Pro')) continue
    keys.add(module.key)
  }
  return keys
}

/** Exposed for UI catalogues that need the same product boundary as the engine. */
export function getTrialImpactApplicableFeatureKeys(productId, { propertyType = null } = {}) {
  return [...productFeatureKeys(resolveProductId(productId), propertyType)]
}

function featureLabel(featureKey) {
  const module = getModuleByKey(featureKey)
  if (module) return { label: module.label, description: module.description, requiredPlan: module.requiredPlan || null }
  const label = String(featureKey || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
  return { label, description: '', requiredPlan: null }
}

function buildPreservationFields() {
  return {
    preservesData: true,
    dataDeleted: false,
    bookingsCancelled: false
  }
}

function notEvaluatedImpact(type, title, message) {
  return {
    type,
    title,
    status: 'not_evaluated',
    fits: null,
    copy: message,
    ...buildPreservationFields()
  }
}

function resolveUsage(input = {}, users = null) {
  const usage = asObject(input)
  const userSource = asObject(users)
  let userRecords = null
  if (Array.isArray(users)) userRecords = users
  else if (Array.isArray(userSource.records)) userRecords = userSource.records
  else if (Array.isArray(userSource.users)) userRecords = userSource.users
  else if (Array.isArray(usage.users)) userRecords = usage.users
  else if (Array.isArray(usage.userRecords)) userRecords = usage.userRecords
  const activeUserCount = userRecords
    ? userRecords.filter((user) => {
      const status = normaliseStatus(user?.status)
      return user?.active !== false && user?.is_active !== false && !['disabled', 'suspended', 'inactive', 'revoked'].includes(status)
    }).length
    : null
  const userCount = firstFiniteCount([
    usage.activeUsers,
    usage.active_users,
    typeof usage.users === 'number' ? usage.users : null,
    userSource.active,
    userSource.activeCount,
    userSource.active_count,
    userSource.count,
    usage.userCount,
    usage.user_count,
    activeUserCount
  ])

  const roomCount = firstFiniteCount([
    usage.activeRooms,
    usage.active_rooms,
    typeof usage.rooms === 'number' ? usage.rooms : null,
    usage.roomCount,
    usage.room_count
  ])

  const bookingObject = asObject(usage.bookings)
  const checkInMonthBookings = firstFiniteCount([
    usage.checkInMonthBookings,
    usage.check_in_month_bookings,
    usage.targetMonthBookings,
    usage.target_month_bookings,
    bookingObject.checkInMonth,
    bookingObject.check_in_month,
    typeof usage.monthlyBookings === 'number' ? usage.monthlyBookings : null,
    typeof usage.bookings === 'number' ? usage.bookings : null,
    usage.bookingCount,
    usage.booking_count
  ])

  return {
    users: userCount,
    rooms: roomCount,
    checkInMonthBookings,
    usersProvided: userRecords !== null || firstPresent([
      usage.activeUsers, usage.active_users, typeof usage.users === 'number' ? usage.users : null,
      usage.userCount, usage.user_count, userSource.active, userSource.activeCount,
      userSource.active_count, userSource.count
    ]) !== undefined,
    roomsProvided: firstPresent([
      usage.activeRooms, usage.active_rooms, typeof usage.rooms === 'number' ? usage.rooms : null,
      usage.roomCount, usage.room_count
    ]) !== undefined,
    checkInMonthBookingsProvided: firstPresent([
      usage.checkInMonthBookings,
      usage.check_in_month_bookings,
      usage.targetMonthBookings,
      usage.target_month_bookings,
      bookingObject.checkInMonth,
      bookingObject.check_in_month,
      typeof usage.monthlyBookings === 'number' ? usage.monthlyBookings : null,
      typeof usage.bookings === 'number' ? usage.bookings : null
    ]) !== undefined
  }
}

function buildUserImpact(target, usage, users) {
  if (!target) return notEvaluatedImpact('users', 'Active users', 'Select a paid package to preview active-user capacity.')
  const limit = target.effectiveLimits.users
  const used = usage.users
  if (limit === null || limit === undefined) {
    return {
      type: 'users',
      title: 'Active users',
      status: 'fits',
      fits: true,
      used,
      limit: null,
      overflow: 0,
      accountsToKeep: null,
      copy: `${target.displayName} has no active-user limit. Your ${used} active user${used === 1 ? '' : 's'} fit.`,
      action: null,
      userIds: Array.isArray(users) ? users.map((user) => user?.id || user?.user_id).filter(Boolean) : [],
      ...buildPreservationFields()
    }
  }

  const overflow = Math.max(0, used - limit)
  if (overflow === 0) {
    return {
      type: 'users',
      title: 'Active users',
      status: 'fits',
      fits: true,
      used,
      limit,
      overflow,
      accountsToKeep: limit,
      copy: `${target.displayName} supports ${limit} active user${limit === 1 ? '' : 's'}. You currently have ${used}; this fits without suspending anyone.`,
      action: null,
      ...buildPreservationFields()
    }
  }

  return {
    type: 'users',
    title: 'Active users',
    status: 'needs_remediation',
    fits: false,
    used,
    limit,
    overflow,
    accountsToKeep: limit,
    accountsToSuspend: overflow,
    copy: `${target.displayName} supports ${limit} active users. You currently have ${used}. Before ${target.displayName} can be activated, select the ${limit} accounts that should remain active; the remaining ${overflow} account${overflow === 1 ? '' : 's'} will be suspended, not deleted.`,
    action: 'select_accounts_to_keep_and_suspend_overflow',
    requiresAccountSelection: true,
    suspensionRequired: true,
    deletionAllowed: false,
    ...buildPreservationFields()
  }
}

function buildRoomImpact(target, usage) {
  if (!target) return notEvaluatedImpact('rooms', 'Rooms', 'Select a paid package to preview room capacity.')
  const limit = target.effectiveLimits.rooms
  const used = usage.rooms
  if (limit === null || limit === undefined) {
    return {
      type: 'rooms',
      title: 'Rooms',
      status: 'fits',
      fits: true,
      used,
      limit: null,
      overflow: 0,
      copy: `${target.displayName} has no room limit. Existing rooms remain available.`,
      action: null,
      ...buildPreservationFields()
    }
  }
  const overflow = Math.max(0, used - limit)
  return {
    type: 'rooms',
    title: 'Rooms',
    status: overflow > 0 ? 'above_limit' : 'fits',
    fits: overflow === 0,
    used,
    limit,
    overflow,
    copy: overflow > 0
      ? `${target.displayName} supports ${limit} rooms and you have ${used}. Existing rooms and their operational history remain in place; new room creation is restricted until the count is resolved. No rooms will be deleted and no bookings will be cancelled.`
      : `${target.displayName} supports ${limit} rooms. You currently have ${used}; this fits.`,
    action: overflow > 0 ? 'restrict_new_room_creation' : null,
    existingRoomsPreserved: true,
    newCreationRestricted: overflow > 0,
    ...buildPreservationFields()
  }
}

function buildBookingImpact(target, usage) {
  if (!target) return notEvaluatedImpact('check_in_month_bookings', 'Check-in-month bookings', 'Select a paid package to preview check-in-month booking capacity.')
  const limit = target.effectiveLimits.monthlyBookings
  const grace = target.effectiveLimits.monthlyBookingsGrace ?? 0
  const used = usage.checkInMonthBookings
  if (limit === null || limit === undefined) {
    return {
      type: 'check_in_month_bookings',
      title: 'Check-in-month bookings',
      status: 'fits',
      fits: true,
      used,
      baseLimit: null,
      grace: null,
      effectiveLimit: null,
      inGrace: false,
      overflow: 0,
      copy: `${target.displayName} has no check-in-month booking cap. Existing bookings remain safe.`,
      action: null,
      ...buildPreservationFields()
    }
  }

  const effectiveLimit = limit + grace
  const aboveBase = used > limit
  const inGrace = aboveBase && used <= effectiveLimit
  const overflow = Math.max(0, used - effectiveLimit)
  const status = overflow > 0 ? 'above_limit' : inGrace ? 'in_grace' : used === limit ? 'at_limit' : 'fits'
  const copy = overflow > 0
    ? `${target.displayName} allows ${limit} check-in-month bookings plus ${grace} grace booking${grace === 1 ? '' : 's'}. You currently have ${used}. Existing bookings remain in place; new check-ins in this month are restricted until you upgrade or use a future month. No bookings will be cancelled.`
    : inGrace
      ? `You have ${used} check-in-month bookings against ${limit} base bookings and ${grace} grace booking${grace === 1 ? '' : 's'}. Existing bookings remain in place while the grace allowance is used.`
      : used === limit
        ? `You are at ${target.displayName}'s ${limit}-booking check-in-month limit. The ${grace} grace booking${grace === 1 ? '' : 's'} remain available; existing bookings will not be cancelled.`
        : `${target.displayName} allows ${limit} check-in-month bookings plus ${grace} grace booking${grace === 1 ? '' : 's'}. You currently have ${used}; this fits.`

  return {
    type: 'check_in_month_bookings',
    title: 'Check-in-month bookings',
    status,
    fits: overflow === 0,
    used,
    baseLimit: limit,
    limit,
    grace,
    effectiveLimit,
    inGrace,
    aboveBase,
    overflow,
    copy,
    action: overflow > 0 ? 'restrict_new_check_ins_in_usage_month' : null,
    existingBookingsPreserved: true,
    newCheckInsRestricted: overflow > 0,
    ...buildPreservationFields()
  }
}

function buildFeatureImpact(productId, target, trialEntitlement, propertyType = null) {
  if (!target) return notEvaluatedImpact('feature_loss', 'Features', 'Select a paid package to preview which features would be locked after the trial.')
  const keys = productFeatureKeys(productId, propertyType)
  const trialFeatures = normaliseFeatureMap(firstPresent([
    trialEntitlement?.effective_features,
    trialEntitlement?.effectiveFeatures,
    trialEntitlement?.features
  ]))
  const trialFeatureMap = Object.fromEntries([...keys].map((key) => [key, trialFeatures[key] !== false]))
  const targetFeatureMap = target.effectiveFeatures
  const lostFeatures = [...keys]
    .filter((key) => trialFeatureMap[key] === true && targetFeatureMap[key] !== true)
    .map((key) => {
      const metadata = featureLabel(key)
      return {
        type: 'feature',
        featureKey: key,
        key,
        label: metadata.label,
        description: metadata.description,
        requiredPlan: metadata.requiredPlan,
        status: 'locked_after_trial',
        action: 'upgrade_or_retain_target_package_limit',
        ...buildPreservationFields()
      }
    })

  return {
    type: 'feature_loss',
    title: 'Features',
    status: lostFeatures.length > 0 ? 'features_lost' : 'fits',
    fits: lostFeatures.length === 0,
    count: lostFeatures.length,
    lostFeatures,
    lockedFeatures: lostFeatures,
    copy: lostFeatures.length > 0
      ? `${lostFeatures.length} ${lostFeatures.length === 1 ? 'feature would' : 'features would'} be locked after the trial on ${target.displayName}. Existing data remains protected.`
      : `All applicable ${productId} features in the trial are included in ${target.displayName}.`,
    ...buildPreservationFields()
  }
}

function countActivePwaSessions(value) {
  if (typeof value === 'number') return { provided: true, count: nonNegativeCount(value) ?? 0, records: null }
  if (Array.isArray(value)) {
    const records = value.filter((session) => {
      const status = normaliseStatus(session?.status)
      return session?.revoked !== true && session?.revoked_at == null && !['revoked', 'inactive', 'expired'].includes(status)
    })
    return { provided: true, count: records.length, records }
  }
  if (value && typeof value === 'object') {
    const count = firstPresent([value.active, value.activeCount, value.active_count, value.count, value.total])
    if (count !== undefined) return { provided: true, count: nonNegativeCount(count) ?? 0, records: null }
  }
  return { provided: false, count: null, records: null }
}

function buildPwaImpact(target, activePwaSessions) {
  const sessions = countActivePwaSessions(activePwaSessions)
  if (!target) return notEvaluatedImpact('pwa_session_loss', 'Manager Mobile App sessions', 'Select a paid package to preview Manager Mobile App access.')
  const pwaEnabled = target.effectiveFeatures[PWA_FEATURE_KEY] === true
  if (pwaEnabled) {
    return {
      type: 'pwa_session_loss',
      title: 'Manager Mobile App sessions',
      status: 'fits',
      fits: true,
      pwaEnabled: true,
      activeSessions: sessions.count,
      sessionsProvided: sessions.provided,
      sessionsToRevoke: 0,
      copy: 'Manager Mobile App access remains included in this package.',
      action: null,
      ...buildPreservationFields()
    }
  }
  if (!sessions.provided) {
    return {
      type: 'pwa_session_loss',
      title: 'Manager Mobile App sessions',
      status: 'not_provided',
      fits: null,
      pwaEnabled: false,
      activeSessions: null,
      sessionsProvided: false,
      sessionsToRevoke: null,
      copy: 'Manager Mobile App is not included in this package. Active session count was not supplied, so session revocation must be checked before activation.',
      action: 'verify_and_revoke_pwa_sessions_before_activation',
      ...buildPreservationFields()
    }
  }
  return {
    type: 'pwa_session_loss',
    title: 'Manager Mobile App sessions',
    status: sessions.count > 0 ? 'sessions_to_revoke' : 'fits',
    fits: sessions.count === 0,
    pwaEnabled: false,
    activeSessions: sessions.count,
    sessionsProvided: true,
    sessionsToRevoke: sessions.count,
    copy: sessions.count > 0
      ? `${target.displayName} does not include Manager Mobile App. ${sessions.count} active session${sessions.count === 1 ? '' : 's'} will be revoked when the package takes effect; mobile data and lodge data are not deleted.`
      : `${target.displayName} does not include Manager Mobile App, and there are no active sessions to revoke.`,
    action: sessions.count > 0 ? 'revoke_pwa_sessions_on_activation' : null,
    sessionsRevokedNotDeleted: true,
    ...buildPreservationFields()
  }
}

function normaliseQueueCounts(value) {
  if (typeof value === 'number') {
    const pending = nonNegativeCount(value) ?? 0
    return { provided: true, pending, failed: 0, unresolved: 0, total: pending }
  }
  if (Array.isArray(value)) {
    const pending = value.filter((entry) => !['failed', 'resolved', 'completed'].includes(normaliseStatus(entry?.status))).length
    const failed = value.filter((entry) => normaliseStatus(entry?.status) === 'failed').length
    return { provided: true, pending, failed, unresolved: pending, total: value.length }
  }
  const source = asObject(value)
  const pending = firstFiniteCount([source.pending, source.pendingCount, source.pending_count, source.queued, source.count], 0)
  const failed = firstFiniteCount([source.failed, source.failedCount, source.failed_count], 0)
  const unresolved = firstFiniteCount([source.unresolved, source.unresolvedCount, source.unresolved_local_count], pending)
  const hasAnyField = [
    source.pending, source.pendingCount, source.pending_count, source.queued, source.count,
    source.failed, source.failedCount, source.failed_count,
    source.unresolved, source.unresolvedCount, source.unresolved_local_count
  ].some((value) => value !== undefined)
  return {
    provided: hasAnyField,
    pending,
    failed,
    unresolved,
    total: pending + failed
  }
}

function buildOfflineQueueImpact(offlineQueueCounts) {
  const queue = normaliseQueueCounts(offlineQueueCounts)
  if (!queue.provided) {
    return {
      type: 'offline_queue',
      title: 'Offline operations',
      status: 'not_provided',
      fits: null,
      countsProvided: false,
      pending: null,
      failed: null,
      unresolved: null,
      total: null,
      copy: 'Offline queue counts were not supplied. Pending work must be checked before a package transition.',
      action: 'verify_offline_queue_before_activation',
      ...buildPreservationFields()
    }
  }
  const requiresReview = queue.pending > 0 || queue.failed > 0 || queue.unresolved > 0
  return {
    type: 'offline_queue',
    title: 'Offline operations',
    status: requiresReview ? 'review_required' : 'clear',
    fits: !requiresReview,
    countsProvided: true,
    pending: queue.pending,
    failed: queue.failed,
    unresolved: queue.unresolved,
    total: queue.total,
    copy: requiresReview
      ? `${queue.pending} pending, ${queue.failed} failed, and ${queue.unresolved} unresolved offline operation${queue.unresolved === 1 ? '' : 's'} need review before the package changes. Queued work must be replayed or recovered; it will never be silently discarded.`
      : 'No pending, failed, or unresolved offline operations were supplied.',
    action: requiresReview ? 'review_replay_or_recover_offline_operations' : null,
    queuedWorkPreserved: true,
    discardAllowed: false,
    ...buildPreservationFields()
  }
}

function buildRemediation(target, impacts, selected) {
  const required = []
  if (!selected) {
    required.push({
      code: 'select_paid_package',
      action: 'select_paid_package',
      title: 'Select a paid package',
      copy: 'No paid package is selected or activated. Access pauses when the trial expires; there is no automatic free fallback.'
    })
  }
  if (impacts.users.status === 'needs_remediation') {
    required.push({
      code: 'users_over_limit',
      action: impacts.users.action,
      title: 'Choose active accounts',
      copy: impacts.users.copy,
      blocking: true
    })
  }
  if (impacts.pwaSessions.status === 'sessions_to_revoke' || impacts.pwaSessions.status === 'not_provided') {
    required.push({
      code: 'pwa_sessions',
      action: impacts.pwaSessions.action,
      title: 'Resolve Manager Mobile App sessions',
      copy: impacts.pwaSessions.copy,
      blocking: impacts.pwaSessions.status === 'sessions_to_revoke'
    })
  }
  if (impacts.offlineQueue.status === 'review_required' || impacts.offlineQueue.status === 'not_provided') {
    required.push({
      code: 'offline_queue',
      action: impacts.offlineQueue.action,
      title: 'Review offline operations',
      copy: impacts.offlineQueue.copy,
      blocking: false
    })
  }

  const operationalNotes = []
  if (impacts.rooms.status === 'above_limit') operationalNotes.push({ code: 'rooms_above_limit', action: impacts.rooms.action, copy: impacts.rooms.copy })
  if (impacts.checkInMonthBookings.status === 'above_limit') operationalNotes.push({ code: 'bookings_above_limit', action: impacts.checkInMonthBookings.action, copy: impacts.checkInMonthBookings.copy })
  if (impacts.featureLoss.count > 0) operationalNotes.push({ code: 'features_locked', action: 'show_feature_upgrade_guidance', copy: impacts.featureLoss.copy })

  const blockingItems = required.filter((item) => item.blocking === true)
  const status = !target
    ? 'package_required'
    : blockingItems.length > 0
      ? 'needs_remediation'
      : 'ready'
  return {
    type: 'remediation',
    status,
    readyForActivation: status === 'ready',
    blockActivation: blockingItems.length > 0 || !target,
    required,
    operationalNotes,
    blockingItems,
    copy: !target
      ? 'Choose and activate a paid package before the trial expires. Without one, access pauses; the system does not silently switch the property to a free package.'
      : blockingItems.length > 0
        ? `${blockingItems.length} action${blockingItems.length === 1 ? '' : 's'} must be completed before ${target.displayName} can be activated.`
        : 'This package can be activated with the supplied usage snapshot. Existing operational and financial data remains protected.',
    ...buildPreservationFields()
  }
}

function inactiveResult(productId, entitlement) {
  const status = normaliseStatus(firstPresent([
    entitlement?.status,
    entitlement?.subscription_state,
    entitlement?.subscriptionState,
    entitlement?.state
  ])) || (entitlement?.expired === true ? 'expired' : 'inactive')
  return {
    version: TRIAL_IMPACT_VERSION,
    productId,
    trialImpactActive: false,
    active: false,
    trial: { active: false, status, expired: entitlement?.expired === true },
    targetPackage: null,
    access: { outcome: 'not_applicable', message: 'Trial-only impact guidance is hidden outside an active trial.' },
    impactItems: [],
    impacts: null,
    remediation: null,
    message: 'Trial-only impact guidance is hidden outside an active trial.'
  }
}

/**
 * Calculate all known post-trial effects for the explicitly selected package.
 * The return value is serialisable and safe to pass to a renderer or PWA.
 */
export function calculateTrialToPaidImpact({
  productId = null,
  product_id = null,
  trialEntitlement = {},
  trial_entitlement = null,
  selectedTargetPackage = null,
  selected_target_package = null,
  targetPackage = null,
  target_package = null,
  effectiveFeatures = null,
  effective_features = null,
  effectiveLimits = null,
  effective_limits = null,
  limits = null,
  paidPackageActivated = undefined,
  targetPackageActivated = undefined,
  usage = {},
  users = null,
  propertyType = null,
  property_type = null,
  activePwaSessions = undefined,
  active_pwa_sessions = undefined,
  offlineQueueCounts = undefined,
  offline_queue_counts = undefined
} = {}) {
  const resolvedProductId = resolveProductId(productId ?? product_id)
  const entitlement = trialEntitlement ?? trial_entitlement ?? {}
  if (!isActiveTrialEntitlement(entitlement)) return inactiveResult(resolvedProductId, entitlement)

  const selected = selectedTargetPackage ?? selected_target_package ?? targetPackage ?? target_package
  const target = resolveTrialImpactTargetPackage({
    productId: resolvedProductId,
    selectedTargetPackage: selected,
    effectiveFeatures,
    effective_features,
    effectiveLimits,
    effective_limits,
    limits,
    paidPackageActivated,
    targetPackageActivated
  })
  const usageSnapshot = resolveUsage(usage, users)
  const queueInput = offlineQueueCounts !== undefined
    ? offlineQueueCounts
    : offline_queue_counts !== undefined
      ? offline_queue_counts
      : usage?.offlineQueueCounts ?? usage?.offline_queue_counts ?? usage?.offlineQueue
  const sessionInput = activePwaSessions !== undefined
    ? activePwaSessions
    : active_pwa_sessions !== undefined
      ? active_pwa_sessions
      : usage?.activePwaSessions ?? usage?.active_pwa_sessions ?? usage?.pwaSessions

  const impacts = {
    users: buildUserImpact(target, usageSnapshot, Array.isArray(users) ? users : null),
    rooms: buildRoomImpact(target, usageSnapshot),
    checkInMonthBookings: buildBookingImpact(target, usageSnapshot),
    featureLoss: buildFeatureImpact(resolvedProductId, target, entitlement, propertyType ?? property_type),
    pwaSessions: buildPwaImpact(target, sessionInput),
    offlineQueue: buildOfflineQueueImpact(queueInput)
  }
  const remediation = buildRemediation(target, impacts, selected !== null && selected !== undefined && selected !== '')
  // Keep canonical names above while exposing terminology used by the desktop
  // and PWA surfaces as aliases. All aliases point to the same immutable-by-
  // convention result objects, so consumers cannot observe divergent rules.
  impacts.checkInMonth = impacts.checkInMonthBookings
  impacts.features = impacts.featureLoss
  impacts.pwaSessionLoss = impacts.pwaSessions
  impacts.remediation = remediation
  const activated = target?.activated === true
  const access = !target
    ? {
      outcome: 'access_pauses',
      selected: false,
      activated: false,
      message: 'No paid package is selected or activated. Access pauses when the trial expires; there is no automatic free fallback.'
    }
    : !activated
      ? {
        outcome: remediation.blockActivation ? 'access_pauses_until_remediation_and_activation' : 'access_pauses_until_activation',
        selected: true,
        activated: false,
        message: `The selected ${target.displayName} package is not activated yet. Access pauses after the trial until payment approval, activation, and any required remediation are complete.`
      }
      : remediation.blockActivation
        ? {
          outcome: 'access_pauses_until_remediation',
          selected: true,
          activated: true,
          message: `${target.displayName} is selected but cannot take effect until the required remediation is complete.`
        }
        : {
          outcome: 'continues_on_target_package',
          selected: true,
          activated: true,
          message: `Access continues on the activated ${target.displayName} package.`
        }

  const impactItems = [
    impacts.users,
    impacts.rooms,
    impacts.checkInMonthBookings,
    impacts.featureLoss,
    impacts.pwaSessions,
    impacts.offlineQueue,
    remediation
  ]

  return {
    version: TRIAL_IMPACT_VERSION,
    productId: resolvedProductId,
    trialImpactActive: true,
    active: true,
    trial: {
      active: true,
      status: 'trial',
      daysLeft: entitlement?.daysLeft ?? entitlement?.days_left ?? null,
      expiresAt: entitlement?.trial_ends_at || entitlement?.trialEndsAt || entitlement?.expires_at || null
    },
    targetPackage: target ? {
      key: target.key,
      commercialPackageKey: target.commercialPackageKey,
      name: target.name,
      displayName: target.displayName,
      plan: target.plan,
      activated: target.activated,
      effectiveLimits: target.effectiveLimits,
      effectiveFeatures: target.effectiveFeatures
    } : null,
    usage: usageSnapshot,
    access,
    impacts,
    users: impacts.users,
    rooms: impacts.rooms,
    checkInMonthBookings: impacts.checkInMonthBookings,
    featureLoss: impacts.featureLoss,
    pwaSessionLoss: impacts.pwaSessions,
    offlineQueue: impacts.offlineQueue,
    impactItems,
    remediation,
    preservesData: true,
    dataDeleted: false,
    bookingsCancelled: false
  }
}

// Short aliases keep UI integration readable and preserve room for callers
// that use “post-trial” rather than “trial-to-paid” terminology.
export const calculatePostTrialImpact = calculateTrialToPaidImpact
export const calculateTrialImpact = calculateTrialToPaidImpact
