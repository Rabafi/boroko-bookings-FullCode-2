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

test('Starter booking grace allows #51 and #52, blocks #53', () => {
  assert.equal(getPlanUsageLimits('Starter').monthlyBookings, 50)
  assert.equal(getPlanUsageLimits('Starter').monthlyBookingsGrace, 2)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 50 }).isInGrace, false)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 51 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 52 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Starter', used: 53 }).isBlocked, true)
})

test('Standard booking grace allows #201-#205, blocks #206', () => {
  assert.equal(getPlanUsageLimits('Standard').monthlyBookings, 200)
  assert.equal(getPlanUsageLimits('Standard').monthlyBookingsGrace, 5)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 201 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 205 }).isInGrace, true)
  assert.equal(canCreateBooking({ plan: 'Standard', used: 206 }).isBlocked, true)
})

test('Pro plan is unlimited', () => {
  const status = canCreateBooking({ plan: 'Pro', used: 999999 })
  assert.equal(status.state, 'unlimited')
  assert.equal(status.isBlocked, false)
})

test('active trial resolves to Pro unlimited usage limits at the entitlement boundary', () => {
  assert.equal(normalizeEntitlementPlan('Trial'), 'Pro')
  assert.equal(getPlanUsageLimits('Trial').rooms, null)
  assert.equal(canCreateBooking({ plan: 'Trial', used: 999999 }).isBlocked, false)
  assert.equal(canCreateRoom({ plan: 'Trial', used: 999999 }).isBlocked, false)
  assert.equal(canCreateUser({ plan: 'Trial', used: 999999 }).isBlocked, false)
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

test('booking creation month counts created_at and blocks the stricter bucket first', () => {
  const month = new Date('2026-04-20T00:00:00Z')
  const rows = [
    { id: 'a', status: 'confirmed', check_in: '2026-07-02', created_at: '2026-04-02' },
    { id: 'b', status: 'confirmed', check_in: '2026-07-03', created_at: '2026-04-03' },
    { id: 'c', status: 'confirmed', check_in: '2026-07-04', created_at: '2026-05-04' },
    { id: 'd', status: 'cancelled', check_in: '2026-07-05', created_at: '2026-04-05' },
    { id: 'e', status: 'confirmed', check_in: '2026-07-06', created_at: '2026-04-06', is_exclusive_event: true }
  ]

  assert.equal(countMonthlyCreatedBookings(rows, month), 2)

  const creationBlocked = evaluateBookingCreationAllowance({ plan: 'Starter', targetMonthUsed: 10, createdMonthUsed: 52 })
  assert.equal(creationBlocked.isBlocked, true)
  assert.equal(creationBlocked.blockReason, 'creation_month')
  assert.equal(creationBlocked.targetMonthStatus.isBlocked, false)
  assert.equal(creationBlocked.creationMonthStatus.isBlocked, true)

  const targetBlocked = evaluateBookingCreationAllowance({ plan: 'Starter', targetMonthUsed: 52, createdMonthUsed: 10 })
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
    bookingsUsage: 41,
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

test('plan recommendation marks Pro as the best fit', () => {
  const proRec = getPlanRecommendation({
    plan: 'Pro',
    bookingsUsage: 999,
    roomsUsage: 999,
    usersUsage: 999
  })
  assert.equal(proRec.recommendedPlan, 'Pro')
  assert.equal(proRec.reason, 'Optimal')
  assert.equal(proRec.label, 'Best fit / unlimited')
})

test('plan limit text stays readable across tiers', () => {
  const starter = formatPlanLimits('Starter')
  const pro = formatPlanLimits('Pro')

  assert.equal(starter.bookings, '50 bookings per month')
  assert.equal(starter.grace, '+2 grace bookings')
  assert.equal(starter.rooms, '6 rooms')
  assert.equal(starter.users, '2 users')
  assert.match(starter.resetCopy, /1st of each month/i)
  assert.match(starter.bookingExplanation, /confirmed, checked_in, or checked_out/i)
  assert.match(starter.graceExplanation, /small grace allowance/i)

  assert.equal(pro.bookings, 'Unlimited bookings')
  assert.equal(pro.rooms, 'Unlimited rooms')
  assert.equal(pro.users, 'Unlimited users')
})

test('upgrade request message includes lodge context and timestamps', () => {
  const request = buildUpgradeRequestMessage(
    { lodgeName: 'Sunset Inn', currentPlan: 'Starter' },
    { bookings: 52, rooms: 6, users: 2 },
    { recommendedPlan: 'Standard', reason: 'High booking volume' }
  )

  assert.match(request.emailSubject, /Sunset Inn/)
  assert.match(request.emailSubject, /Starter → Standard/)
  assert.match(request.emailBody, /Lodge: Sunset Inn/)
  assert.match(request.emailBody, /Current plan: Starter/)
  assert.match(request.emailBody, /Booking usage: 52 \/ 50/)
  assert.match(request.emailBody, /Room usage: 6 \/ 6/)
  assert.match(request.emailBody, /User usage: 2 \/ 2/)
  assert.match(request.emailBody, /Recommended plan: Standard/)
  assert.match(request.emailBody, /Timestamp:/)
  assert.match(request.whatsappText, /Upgrade request for Sunset Inn/)
  assert.match(request.whatsappText, /Current plan: Starter → Standard/)
  assert.match(request.whatsappText, /Bookings: 52 \/ 50/)
})

test('usage state classification stays consistent across badges and sorting', () => {
  assert.equal(getUsageStateKey({ state: 'warning' }), 'near_limit')
  assert.equal(getUsageStateKey({ state: 'critical' }), 'critical')
  assert.equal(getUsageStateKey({ state: 'grace' }), 'in_grace')
  assert.equal(getUsageStateKey({ state: 'blocked' }), 'blocked')
  assert.equal(getUsageStateKey({ state: 'blocked', isAbovePlan: true }), 'above_plan')
  assert.equal(getUsageStateKey({ state: 'unlimited' }), 'pro')

  assert.ok(getUsagePriorityScore({ state: 'blocked' }) > getUsagePriorityScore({ state: 'grace' }))
  assert.ok(getUsagePriorityScore({ state: 'grace' }) > getUsagePriorityScore({ state: 'critical' }))
  assert.ok(getUsagePriorityScore({ state: 'critical' }) > getUsagePriorityScore({ state: 'warning' }))
  assert.ok(getUsagePriorityScore({ state: 'warning' }) > getUsagePriorityScore({ state: 'ok' }))
})
