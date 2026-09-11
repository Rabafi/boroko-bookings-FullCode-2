import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'

const root = resolve(process.cwd())
const read = (file) => readFileSync(resolve(root, file), 'utf8')
const presentation = read('src/renderer/src/components/shared/EntitlementPresentation.jsx')
const app = read('src/renderer/src/App.jsx')
const layout = read('src/renderer/src/components/Layout.jsx')
const subscription = read('src/renderer/src/components/SubscriptionAccessPanel.jsx')
const impactEngine = read('src/shared/trialImpact.js')

test('trial presentation is silent for paid entitlements and exposes target/countdown copy for trials', () => {
  assert.match(presentation, /String\(entitlement\?\.status[^\n]+=== 'trial'/)
  assert.match(presentation, /if \(!isTrialEntitlement\(entitlement\)\) return null/)
  assert.match(presentation, /data-testid="trial-feature-label"/)
  assert.match(presentation, /data-testid="trial-status-notice"/)
  assert.match(presentation, /Selected package|Selected after trial/)
  assert.match(presentation, /day\$\{days === 1 \? '' : 's'\} left in trial/)
})

test('post-trial preview is wired to selected package and live usage in Subscription & Access', () => {
  assert.match(presentation, /calculateTrialToPaidImpact/)
  assert.match(presentation, /impact\.impacts\?\.featureLoss\?\.lostFeatures/)
  assert.doesNotMatch(presentation, /getUsageLimitStatus/)
  assert.match(impactEngine, /No paid package is selected or activated\. Access pauses/)
  assert.match(subscription, /PostTrialImpactPreview/)
  assert.match(subscription, /status === 'trial'/)
  assert.match(subscription, /targetPlan=\{selectedCommercialPackage\?\.internalPlan\}/)
  assert.match(subscription, /usage=\{usageCounts\}/)
  assert.match(subscription, /TrialFeatureLabel/)
  assert.match(subscription, /requestedPackageKey[^\n]+useState\(null\)/)
})

test('plan-locked routes render a showcase without mounting the protected child', () => {
  assert.match(app, /function UpgradeWall\(\{ feature, children \}\)/)
  assert.match(app, /<UpgradeShowcase[\s\S]*module=\{catalogModule\}/)
  assert.match(presentation, /component intentionally accepts no children/i)
  assert.match(presentation, /data-lock-reason="plan"/)
})

test('role denials remain distinct from package locks', () => {
  assert.match(app, /data-testid="role-permission-denial"/)
  assert.match(app, /data-lock-reason="role"/)
  assert.match(app, /A package upgrade will not change role permissions/i)
})

test('lower paid packages keep relevant locked pages discoverable', () => {
  const access = {
    allowedByRole: {
      'reports.view': true,
      'reports.basic_view': true,
      'expenses.view': true,
      'staff.view': true
    }
  }
  const items = getDesktopNavItems('lodge', access, 'lodge', 'Starter', [], null, 'lodge-camp')
  const reports = items.find((item) => item.to === '/reports')
  const expenses = items.find((item) => item.to === '/expenses')
  assert.ok(reports, 'Reports should remain discoverable on Starter')
  assert.equal(reports.isLocked, true)
  assert.ok(expenses, 'Expenses should remain discoverable on Starter')
  assert.equal(expenses.isLocked, true)
  assert.match(layout, /isLocked \? \(\s*<NavLink/)
  assert.doesNotMatch(layout, /isLocked \? \(\s*<button/)
})
