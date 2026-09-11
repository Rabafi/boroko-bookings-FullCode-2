import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculatePostTrialImpact,
  calculateTrialToPaidImpact,
  getTrialImpactApplicableFeatureKeys,
  isActiveTrialEntitlement
} from '../src/shared/trialImpact.js'

const activeTrial = {
  status: 'trial',
  daysLeft: 7,
  effective_features: {
    reports: true,
    pwa: true,
    pos: true,
    inventory: true,
    hotel_mode: true
  }
}

test('Starter with three active users requires an explicit keep-and-suspend decision', () => {
  const result = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: { plan: 'Starter' },
    usage: { users: 3, rooms: 2, checkInMonthBookings: 10 }
  })

  assert.equal(result.trialImpactActive, true)
  assert.equal(result.impacts.users.status, 'needs_remediation')
  assert.equal(result.impacts.users.used, 3)
  assert.equal(result.impacts.users.limit, 2)
  assert.equal(result.impacts.users.overflow, 1)
  assert.equal(result.impacts.users.accountsToKeep, 2)
  assert.equal(result.impacts.users.accountsToSuspend, 1)
  assert.equal(result.impacts.users.requiresAccountSelection, true)
  assert.match(result.impacts.users.copy, /select the 2 accounts/i)
  assert.match(result.impacts.users.copy, /suspended, not deleted/i)
  assert.equal(result.impacts.users.deletionAllowed, false)
  assert.equal(result.remediation.blockActivation, true)
  assert.equal(result.access.outcome, 'access_pauses_until_remediation_and_activation')
  assert.equal(result.impactItems.find((item) => item.type === 'users'), result.impacts.users)
})

test('an effective Starter user override to three makes the same usage fit', () => {
  const result = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: { plan: 'Starter', effective_limits: { users: 3 }, activated: true },
    usage: { users: 3, rooms: 2, checkInMonthBookings: 10 }
  })

  assert.equal(result.targetPackage.effectiveLimits.users, 3)
  assert.equal(result.impacts.users.status, 'fits')
  assert.equal(result.impacts.users.fits, true)
  assert.equal(result.impacts.users.overflow, 0)
  assert.equal(result.remediation.blockActivation, false)
  assert.equal(result.access.outcome, 'continues_on_target_package')
})

test('a selected package is not an activated free fallback', () => {
  const noSelection = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    usage: { users: 3 }
  })
  assert.equal(noSelection.targetPackage, null)
  assert.equal(noSelection.access.outcome, 'access_pauses')
  assert.match(noSelection.access.message, /no automatic free fallback/i)
  assert.equal(noSelection.remediation.status, 'package_required')

  const selectedButNotActivated = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: 'Starter',
    usage: { users: 1 }
  })
  assert.equal(selectedButNotActivated.targetPackage.activated, false)
  assert.equal(selectedButNotActivated.access.outcome, 'access_pauses_until_activation')
})

test('licensed and expired entitlements produce no trial-specific impact output', () => {
  for (const trialEntitlement of [
    { status: 'licensed', plan: 'Starter', effective_features: { reports: false } },
    { status: 'expired', expired: true, effective_features: { reports: false } }
  ]) {
    const result = calculateTrialToPaidImpact({
      productId: 'lodge-camp',
      trialEntitlement,
      selectedTargetPackage: 'Starter',
      usage: { users: 99, rooms: 99, checkInMonthBookings: 999 }
    })
    assert.equal(result.trialImpactActive, false)
    assert.deepEqual(result.impactItems, [])
    assert.equal(result.impacts, null)
    assert.equal(result.access.outcome, 'not_applicable')
  }
  assert.equal(isActiveTrialEntitlement({ status: 'licensed' }), false)
  assert.equal(isActiveTrialEntitlement({ status: 'expired' }), false)
  assert.equal(isActiveTrialEntitlement({ status: 'trial', expired: false }), true)
})

test('rooms and check-in-month booking grace never delete rooms or cancel bookings', () => {
  const result = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: 'Starter',
    usage: { users: 1, rooms: 7, checkInMonthBookings: 123 }
  })

  assert.equal(result.impacts.rooms.status, 'above_limit')
  assert.equal(result.impacts.rooms.limit, 6)
  assert.equal(result.impacts.rooms.overflow, 1)
  assert.equal(result.impacts.rooms.existingRoomsPreserved, true)
  assert.equal(result.impacts.rooms.newCreationRestricted, true)
  assert.match(result.impacts.rooms.copy, /no rooms will be deleted/i)

  assert.equal(result.impacts.checkInMonthBookings.status, 'above_limit')
  assert.equal(result.impacts.checkInMonthBookings.baseLimit, 120)
  assert.equal(result.impacts.checkInMonthBookings.grace, 2)
  assert.equal(result.impacts.checkInMonthBookings.effectiveLimit, 122)
  assert.equal(result.impacts.checkInMonthBookings.overflow, 1)
  assert.equal(result.impacts.checkInMonthBookings.newCheckInsRestricted, true)
  assert.match(result.impacts.checkInMonthBookings.copy, /no bookings will be cancelled/i)
  assert.equal(result.bookingsCancelled, false)
})

test('feature loss is product-separated and respects effective feature overrides', () => {
  const lodgeKeys = getTrialImpactApplicableFeatureKeys('lodge-camp')
  const hotelKeys = getTrialImpactApplicableFeatureKeys('hotel')
  const posKeys = getTrialImpactApplicableFeatureKeys('hospitality-pos')
  assert.equal(lodgeKeys.includes('hotel_mode'), false)
  assert.equal(hotelKeys.includes('hotel_mode'), true)
  assert.equal(posKeys.includes('hotel_mode'), false)
  assert.equal(lodgeKeys.includes('No LodgingOS upgrade ladder'), false)
  assert.equal(lodgeKeys.includes('custom_website'), false)

  const lodge = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: { plan: 'Starter', effective_features: { reports: false, pwa: true } },
    usage: { users: 1 }
  })
  const lostKeys = lodge.impacts.featureLoss.lostFeatures.map((feature) => feature.featureKey)
  assert.equal(lostKeys.includes('reports'), true)
  assert.equal(lostKeys.includes('hotel_mode'), false)
  assert.equal(lostKeys.includes('pwa'), false)

  const overridden = calculateTrialToPaidImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: { plan: 'Starter', effective_features: { reports: true, pwa: true } },
    usage: { users: 1 }
  })
  assert.equal(overridden.impacts.featureLoss.lostFeatures.some((feature) => feature.featureKey === 'reports'), false)
})

test('PWA sessions and offline queues are surfaced as recoverable remediation', () => {
  const result = calculatePostTrialImpact({
    productId: 'lodge-camp',
    trialEntitlement: activeTrial,
    selectedTargetPackage: 'Starter',
    activePwaSessions: [{ id: 'pwa-1' }, { id: 'pwa-2', revoked_at: '2026-08-01T00:00:00Z' }],
    offlineQueueCounts: { pending: 2, failed: 1, unresolved: 2 },
    usage: { users: 1 }
  })

  assert.equal(result.impacts.pwaSessions.activeSessions, 1)
  assert.equal(result.impacts.pwaSessions.sessionsToRevoke, 1)
  assert.equal(result.impacts.pwaSessions.status, 'sessions_to_revoke')
  assert.match(result.impacts.pwaSessions.copy, /revoked/i)
  assert.equal(result.impacts.offlineQueue.status, 'review_required')
  assert.equal(result.impacts.offlineQueue.pending, 2)
  assert.equal(result.impacts.offlineQueue.failed, 1)
  assert.equal(result.impacts.offlineQueue.unresolved, 2)
  assert.match(result.impacts.offlineQueue.copy, /never be silently discarded/i)
  assert.equal(result.impacts.offlineQueue.discardAllowed, false)
})
