import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('trial entitlement fallback preserves its company identity for the countdown', () => {
  const entitlements = fs.readFileSync(path.join(root, 'src/main/domains/entitlements.js'), 'utf8')

  assert.match(entitlements, /return buildTrialEntitlement\(cachedSettings\?\.trial_started_at \|\| null, targetLodgeId\);/)
  assert.match(entitlements, /return buildTrialEntitlement\(settings\?\.trial_started_at \|\| null, targetLodgeId\);/)
})

test('Bar header presents a persistent authoritative trial countdown and subscription link', () => {
  const layout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposLayout.jsx'), 'utf8')
  const nav = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposNav.jsx'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')

  assert.match(layout, /trialStatus=\{access\?\.entitlement\}/)
  assert.match(nav, /function TrialStatusIndicator\(\{ trialStatus, onOpenSubscription \}\)/)
  assert.match(nav, /trialStatus\?\.status !== 'trial'/)
  assert.match(nav, /trialStatus\?\.daysLeft \?\? trialStatus\?\.days_left/)
  assert.match(nav, /goTo\('\/settings\?tab=license'\)/)
  // Hospitality POS owns the persistent header badge, avoiding a second
  // dismissible global banner for the same fact.
  assert.match(app, /!IS_HPOS_PRODUCT && trialStatus\?\.status === 'trial'/)
})
