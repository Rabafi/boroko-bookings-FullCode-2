import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  canCreateUser,
  evaluateBookingCreationAllowance,
  getEffectiveUsageLimits,
  getPlanUsageLimits,
  getUsageLimitStatusWithGrace
} from '../src/shared/subscriptionPlans.js'

const subscriptionAccessPanelSource = readFileSync(
  new URL('../src/renderer/src/components/SubscriptionAccessPanel.jsx', import.meta.url),
  'utf8'
)

test('effective usage limits inherit package defaults when there are no overrides', () => {
  assert.deepEqual(getEffectiveUsageLimits({ plan: 'Starter' }), getPlanUsageLimits('Starter'))
})

test('an authoritative per-limit override can allow Starter to have three users', () => {
  assert.deepEqual(
    getEffectiveUsageLimits({ plan: 'Starter', effective_limits: { users: 3 } }),
    { ...getPlanUsageLimits('Starter'), users: 3 }
  )
})

test('effective limits accept server snake-case fields and preserve explicit unlimited values', () => {
  const limits = getEffectiveUsageLimits({
    subscription_plan: 'Standard',
    usage_limits: {
      monthly_bookings: 450,
      booking_grace: 8,
      rooms: null
    }
  })

  assert.equal(limits.monthlyBookings, 450)
  assert.equal(limits.monthlyBookingsGrace, 8)
  assert.equal(limits.rooms, null)
  assert.equal(limits.users, 5)
})

test('invalid override values fail closed to the package baseline', () => {
  const limits = getEffectiveUsageLimits({
    plan: 'Starter',
    effective_limits: { users: -1, rooms: 'not-a-number' }
  })
  assert.equal(limits.users, 2)
  assert.equal(limits.rooms, 6)
})

test('creation guards enforce the supplied effective limits instead of package defaults', () => {
  const limits = { ...getPlanUsageLimits('Starter'), users: 3, monthlyBookings: 130 }
  assert.equal(canCreateUser({ plan: 'Starter', used: 2, limits }).isBlocked, false)
  assert.equal(canCreateUser({ plan: 'Starter', used: 3, limits }).isBlocked, true)
  assert.equal(evaluateBookingCreationAllowance({
    plan: 'Starter',
    targetMonthUsed: 125,
    createdMonthUsed: 125,
    limits
  }).isBlocked, false)
})

test('healthy booking usage does not render a near-limit warning', () => {
  const status = getUsageLimitStatusWithGrace({ used: 5, limit: 600, grace: 10 })

  assert.equal(status.state, 'ok')
  assert.doesNotMatch(subscriptionAccessPanelSource, /bookingsUsageStatus\.state\s*!==\s*['"]normal['"]/) 
  assert.match(
    subscriptionAccessPanelSource,
    /\['warning', 'critical', 'grace', 'blocked'\]\.includes\(bookingsUsageStatus\.state\)/
  )
})
