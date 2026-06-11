import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildUpgradeRequestMessage,
  getUpgradeNudgeCooldownState,
  markUpgradeNudgeShown,
  getEarlyUpgradePromptState,
  getUsageStatePresentation,
  trackUpgradeIntent
} from '../src/shared/subscriptionPlans.js'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('early upgrade trigger fires at 80 percent and stays off below threshold', () => {
  const prompt = getEarlyUpgradePromptState({
    plan: 'Starter',
    bookingsUsage: 40,
    roomsUsage: 4,
    usersUsage: 1
  })
  const below = getEarlyUpgradePromptState({
    plan: 'Starter',
    bookingsUsage: 39,
    roomsUsage: 4,
    usersUsage: 1
  })
  const pro = getEarlyUpgradePromptState({
    plan: 'Pro',
    bookingsUsage: 999,
    roomsUsage: 999,
    usersUsage: 999
  })

  assert.equal(prompt.shouldPrompt, true)
  assert.equal(below.shouldPrompt, false)
  assert.equal(pro.shouldPrompt, false)
})

test('whatsapp upgrade message stays shorter than email and keeps lodge context', () => {
  const whatsapp = buildUpgradeRequestMessage(
    { lodgeName: 'Sunset Inn', currentPlan: 'Starter' },
    { bookings: 52, rooms: 6, users: 2 },
    { recommendedPlan: 'Standard', reason: 'High booking volume' },
    { channel: 'whatsapp' }
  )
  const email = buildUpgradeRequestMessage(
    { lodgeName: 'Sunset Inn', currentPlan: 'Starter' },
    { bookings: 52, rooms: 6, users: 2 },
    { recommendedPlan: 'Standard', reason: 'High booking volume' }
  )

  assert.ok(whatsapp.whatsappText.length < email.emailBody.length)
  assert.match(whatsapp.whatsappText, /Sunset Inn/)
  assert.match(whatsapp.whatsappText, /Starter/)
  assert.match(whatsapp.whatsappText, /Standard/)
})

test('usage state presentation stays consistent for shared badges', () => {
  assert.equal(getUsageStatePresentation({ state: 'ok' }).label, 'Normal')
  assert.equal(getUsageStatePresentation({ state: 'warning' }).label, 'Near limit')
  assert.equal(getUsageStatePresentation({ state: 'critical' }).label, 'Critical')
  assert.equal(getUsageStatePresentation({ state: 'grace' }).label, 'In grace')
  assert.equal(getUsageStatePresentation({ state: 'blocked' }).label, 'Blocked')
  assert.equal(getUsageStatePresentation({ state: 'blocked', isAbovePlan: true }).label, 'Above plan')
})

test('DashboardUsageCard source keeps pro users unlimited and exposes the upgrade CTA', async () => {
  const source = await read('src/renderer/src/components/shared/DashboardUsageCard.jsx')
  assert.match(source, /Unlimited access/)
  assert.match(source, /Full access enabled/)
  assert.match(source, /Usage resets on the 1st of each month/)
  assert.match(source, /New bookings are currently blocked until you upgrade\./)
  assert.match(source, /You’re using your grace allowance\. New bookings will soon be blocked\./)
  assert.match(source, /Upgrade Plan/)
  assert.match(source, /Without usage counters or warning bars are shown for Pro|Unlimited bookings/)
})

test('Upgrade nudge banner uses local storage cooldown and the shared CTA text', async () => {
  const source = await read('src/renderer/src/components/shared/UpgradeNudgeBanner.jsx')
  const helpers = await read('src/shared/subscriptionPlans.js')
  assert.match(source, /getUpgradeNudgeCooldownState/)
  assert.match(source, /markUpgradeNudgeShown/)
  assert.match(helpers, /localStorage/)
  assert.match(helpers, /nextAllowedAt/)
  assert.match(source, /Upgrade Plan/)
})

test('upgrade cooldown persistence and intent tracking use local storage safely', () => {
  const storage = new Map()
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null
    },
    setItem(key, value) {
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
    clear() {
      storage.clear()
    }
  }
  const previousWindow = globalThis.window
  globalThis.window = { localStorage }

  try {
    const now = 1_700_000_000_000
    const key = 'boroko:test-upgrade-nudge'
    assert.equal(getUpgradeNudgeCooldownState(key, now).allowed, true)
    markUpgradeNudgeShown(key, now, 24 * 60 * 60 * 1000)
    assert.equal(getUpgradeNudgeCooldownState(key, now + 1000).allowed, false)
    assert.equal(getUpgradeNudgeCooldownState(key, now + 24 * 60 * 60 * 1000 + 1).allowed, true)

    const event = trackUpgradeIntent({
      lodgeId: 'l-1',
      lodgeName: 'Sunset Inn',
      plan: 'Starter',
      usage: { bookings: 52, rooms: 6, users: 2 },
      recommendation: { recommendedPlan: 'Standard' },
      trigger: 'dashboard'
    })

    assert.equal(event.lodgeId, 'l-1')
    assert.equal(event.recommendedPlan, 'Standard')
    assert.equal(event.trigger, 'dashboard')
    const logged = JSON.parse(localStorage.getItem('boroko:upgrade-intent-log'))
    assert.equal(logged[0].lodgeName, 'Sunset Inn')
    assert.equal(logged[0].usage.bookings, 52)
    assert.equal(logged[0].trigger, 'dashboard')
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})
