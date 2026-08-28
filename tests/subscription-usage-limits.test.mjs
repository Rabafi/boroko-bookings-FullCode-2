import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MONTHLY_USAGE_RESET_COPY,
  canCreateBooking,
  canCreateRoom,
  canCreateUser,
  buildUpgradeRequestMessage,
  countMonthlyCreatedBookings,
  countMonthlyUsageBookings,
  evaluateBookingCreationAllowance,
  formatPlanLimits,
  getPlanUsageLimits,
  getPlanRecommendation,
  getUsageLimitStatus,
  getUsagePriorityScore,
  getUsageStateKey,
  isCountableBookingForUsage
} from '../src/shared/subscriptionPlans.js'
import { normalizePlanName as normalizeEntitlementPlan } from '../src/main/domains/subscriptionState.js'

test('Starter permits bookings through #122 and then blocks additional check-ins', () => {
  assert.equal(getPlanUsageLimits('Starter').monthlyBookings, 120)
  assert.equal(getPlanUsageLimits('Starter').monthlyBookingsGrace, 2)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 120 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 121 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 121 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 122 }).isBlocked, true)
})

test('Standard permits bookings through #405 and then blocks additional check-ins', () => {
  assert.equal(getPlanUsageLimits('Standard').monthlyBookings, 400)
  assert.equal(getPlanUsageLimits('Standard').monthlyBookingsGrace, 5)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 400 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 404 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 404 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 405 }).isBlocked, true)
})

test('Pro plan has capped usage limits', () => {
  const limits = getPlanUsageLimits('Pro')
  assert.equal(limits.monthlyBookings, 600)
  assert.equal(limits.monthlyBookingsGrace, 10)
  assert.equal(limits.rooms, 30)
  assert.equal(limits.users, 10)
  assert.equal(canCreateBooking({ plan: 'Pro', used: 600 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Pro', used: 609 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Pro', used: 609 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Pro', used: 610 }).isBlocked, true)
})

test('active trial resolves to Pro usage limits at the entitlement boundary', () => {
  assert.equal(normalizeEntitlementPlan('Trial'), 'Pro')
  assert.equal(getPlanUsageLimits('Trial').rooms, 30)
  assert.equal(canCreateBooking({ plan: 'Trial', used: 600 }).isBlocked, false)
  assert.equal(canCreateBooking({ plan: 'Trial', used: 610 }).isBlocked, true)
  assert.equal(canCreateRoom({ plan: 'Trial', used: 30 }).isBlocked, true)
  assert.equal(canCreateUser({ plan: 'Trial', used: 10 }).isBlocked, true)
})

test('room and user limits enforce starter thresholds', () => {
  assert.equal(canCreateRoom({ plan: 'Starter', used: 6 }).isBlocked, true)
  assert.equal(canCreateRoom({ plan: 'Starter', used: 5 }).isBlocked, false)
  assert.equal(canCreateUser({ plan: 'Starter', used: 2 }).isBlocked, true)
  assert.equal(canCreateUser({ plan: 'Starter', used: 1 }).isBlocked, false)
  assert.equal(canCreateRoom({ plan: 'Standard', used: 20 }).isBlocked, true)
  assert.equal(canCreateUser({ plan: 'Standard', used: 5 }).isBlocked, true)
})

test('usage warning states at 80 and 95 percent before grace', () => {
  assert.equal(getUsageLimitStatus({ used: 8, limit: 10 }).state, 'warning')
  assert.equal(getUsageLimitStatus({ used: 95, limit: 100 }).state, 'critical')
  assert.equal(getUsageLimitStatus({ used: 100, limit: 100 }).state, 'blocked')
})

test('booking usage month uses check_in month, not created_at', () => {
  const month = new Date('2026-04-20T00:00:00Z')
  const rows = [
    { id: 'a', status: 'confirmed', check_in: '2026-04-02', created_at: '2026-03-30' },
    { id: 'b', status: 'confirmed', check_in: '2026-05-02', created_at: '2026-04-01' },
    { id: 'c', status: 'cancelled', check_in: '2026-04-05', created_at: '2026-04-05' },
    { id: 'd', status: 'quotation', check_in: '2026-04-06', created_at: '2026-04-06' },
    { id: 'e', status: 'checked_in', check_in: '2026-04-07', created_at: '2026-04-07' },
    { id: 'f', status: 'checked_out', check_in: '2026-04-08', created_at: '2026-04-08' },
    { id: 'g', status: 'confirmed', check_in: '2026-04-09', is_exclusive_event: true }
  ]
  assert.equal(countMonthlyUsageBookings(rows, month), 3)
  assert.equal(isCountableBookingForUsage(rows[0]), true)
  assert.equal(isCountableBookingForUsage(rows[2]), false)
  assert.equal(isCountableBookingForUsage(rows[6]), false)
})

test('booking creation month remains informational while check-in month enforces the cap', () => {
  const month = new Date('2026-04-20T00:00:00Z')
  const rows = [
    { id: 'a', status: 'confirmed', check_in: '2026-07-02', created_at: '2026-04-02' },
    { id: 'b', status: 'confirmed', check_in: '2026-07-03', created_at: '2026-04-03' },
    { id: 'c', status: 'confirmed', check_in: '2026-07-04', created_at: '2026-05-04' },
    { id: 'd', status: 'cancelled', check_in: '2026-07-05', created_at: '2026-04-05' },
    { id: 'e', status: 'confirmed', check_in: '2026-07-06', created_at: '2026-04-06', is_exclusive_event: true }
  ]

  assert.equal(countMonthlyCreatedBookings(rows, month), 2)

  const creationOnlyAtLimit = evaluateBookingCreationAllowance({ plan: 'Starter', targetMonthUsed: 10, createdMonthUsed: 122 })
  assert.equal(creationOnlyAtLimit.isBlocked, false)
  assert.equal(creationOnlyAtLimit.blockReason, null)
  assert.equal(creationOnlyAtLimit.targetMonthStatus.isBlocked, false)
  assert.equal(creationOnlyAtLimit.creationMonthStatus.isBlocked, false)
  assert.equal(creationOnlyAtLimit.creationMonthStatus.enforced, false)
  assert.equal(creationOnlyAtLimit.creationMonthStatus.benchmarkState, 'blocked')
  assert.equal(creationOnlyAtLimit.combinedStatus, creationOnlyAtLimit.targetMonthStatus)

  const targetBlocked = evaluateBookingCreationAllowance({ plan: 'Starter', targetMonthUsed: 122, createdMonthUsed: 10 })
  assert.equal(targetBlocked.isBlocked, true)
  assert.equal(targetBlocked.blockReason, 'target_month')
  assert.equal(targetBlocked.targetMonthStatus.isBlocked, true)
  assert.equal(targetBlocked.creationMonthStatus.isBlocked, false)
})

test('monthly usage reset copy is explicit', () => {
  assert.match(MONTHLY_USAGE_RESET_COPY, /1st of each month/i)
})

test('plan recommendation points to the next tier when a single metric crosses 80 percent', () => {
  const starterRec = getPlanRecommendation({
    plan: 'Starter',
    bookingsUsage: 97,
    roomsUsage: 3,
    usersUsage: 1
  })
  assert.equal(starterRec.recommendedPlan, 'Standard')
  assert.equal(starterRec.reason, 'High booking volume')

  const standardRec = getPlanRecommendation({
    plan: 'Standard',
    bookingsUsage: 120,
    roomsUsage: 17,
    usersUsage: 4
  })
  assert.equal(standardRec.recommendedPlan, 'Pro')
  assert.equal(standardRec.reason, 'Room expansion')
})

test('plan recommendation marks Enterprise as the best fit', () => {
  const enterpriseRec = getPlanRecommendation({
    plan: 'Enterprise',
    bookingsUsage: 999,
    roomsUsage: 999,
    usersUsage: 999
  })
  assert.equal(enterpriseRec.recommendedPlan, 'Enterprise')
  assert.equal(enterpriseRec.reason, 'Optimal')
  assert.equal(enterpriseRec.label, 'Best fit / Enterprise')
})

test('plan limit text stays readable across tiers', () => {
  const starter = formatPlanLimits('Starter')
  const pro = formatPlanLimits('Pro')
  const enterprise = formatPlanLimits('Enterprise')

  assert.equal(starter.bookings, '120 bookings per month')
  assert.equal(starter.grace, '+2 grace bookings')
  assert.equal(starter.rooms, '6 rooms')
  assert.equal(starter.users, '2 users')
  assert.match(starter.resetCopy, /1st of each month/i)
  assert.match(starter.bookingExplanation, /confirmed, checked_in, or checked_out/i)
  assert.match(starter.graceExplanation, /small grace allowance/i)

  assert.equal(pro.bookings, '600 bookings per month')
  assert.equal(pro.grace, '+10 grace bookings')
  assert.equal(pro.rooms, '30 rooms')
  assert.equal(pro.users, '10 users')

  assert.equal(enterprise.bookings, '2000 bookings per month')
  assert.equal(enterprise.grace, '+50 grace bookings')
  assert.equal(enterprise.rooms, '100 rooms')
  assert.equal(enterprise.users, '25 users')
})

test('upgrade request message includes lodge context and timestamps', () => {
  const request = buildUpgradeRequestMessage(
    { lodgeName: 'Sunset Inn', currentPlan: 'Starter' },
    { bookings: 122, rooms: 6, users: 2 },
    { recommendedPlan: 'Standard', reason: 'High booking volume' }
  )

  assert.match(request.emailSubject, /Sunset Inn/)
  assert.match(request.emailSubject, /Starter → Standard/)
  assert.match(request.emailBody, /Lodge: Sunset Inn/)
  assert.match(request.emailBody, /Current plan: Starter/)
  assert.match(request.emailBody, /Booking usage: 122 \/ 120/)
  assert.match(request.emailBody, /Room usage: 6 \/ 6/)
  assert.match(request.emailBody, /User usage: 2 \/ 2/)
  assert.match(request.emailBody, /Recommended plan: Standard/)
  assert.match(request.emailBody, /Timestamp:/)
  assert.match(request.whatsappText, /Upgrade request for Sunset Inn/)
  assert.match(request.whatsappText, /Current plan: Starter → Standard/)
  assert.match(request.whatsappText, /Bookings: 122 \/ 120/)
})

test('usage state classification stays consistent across badges and sorting', () => {
  assert.equal(getUsageStateKey({ state: 'warning' }), 'near_limit')
  assert.equal(getUsageStateKey({ state: 'critical' }), 'critical')
  assert.equal(getUsageStateKey({ state: 'grace' }), 'in_grace')
  assert.equal(getUsageStateKey({ state: 'blocked' }), 'blocked')
  assert.equal(getUsageStateKey({ state: 'blocked', isAbovePlan: true }), 'above_plan')
  assert.equal(getUsageStateKey({ state: 'unlimited' }), 'enterprise')

  assert.ok(getUsagePriorityScore({ state: 'blocked' }) > getUsagePriorityScore({ state: 'grace' }))
  assert.ok(getUsagePriorityScore({ state: 'grace' }) > getUsagePriorityScore({ state: 'critical' }))
  assert.ok(getUsagePriorityScore({ state: 'critical' }) > getUsagePriorityScore({ state: 'warning' }))
  assert.ok(getUsagePriorityScore({ state: 'warning' }) > getUsagePriorityScore({ state: 'ok' }))
})
