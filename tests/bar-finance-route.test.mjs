import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isBarOnlyBlockedPath, getBarAddonFeatureForPath } from '../src/shared/barModeProfile.js'
import { getCommercialFeatureSet, isCommercialFeatureIncluded } from '../src/shared/commercialAccess.js'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

const LODGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function barEntitlement(features = {}, extra = {}) {
  return {
    product_id: 'hospitality-pos',
    lodge_id: LODGE,
    status: 'licensed',
    subscription_state: 'active',
    expired: false,
    commercial_package_key: 'bar_pos',
    enterprise_addons: [],
    offline_valid_until: future(),
    commercial_overrides: { features },
    ...extra
  }
}
const setOf = (productId, pkg, addons, entitlement) =>
  getCommercialFeatureSet(productId, pkg, addons, entitlement, entitlement?.lodge_id || null)

test('finance-close route exception requires the Accounting add-on in Bar mode', () => {
  assert.equal(getBarAddonFeatureForPath('/restaurant/finance-close'), 'restaurant_accounting')
  assert.equal(getBarAddonFeatureForPath('/restaurant/finance-close?tab=daily-close'), 'restaurant_accounting')
  // Base Bar (no add-on, no override) stays blocked; accounting add-on unblocks.
  assert.equal(isBarOnlyBlockedPath('/restaurant/finance-close', [...setOf('hospitality-pos', 'bar_pos', [], null)]), true)
  assert.equal(
    isBarOnlyBlockedPath('/restaurant/finance-close', [...setOf('hospitality-pos', 'bar_pos', ['bar_accounting_workforce'], null)]),
    false
  )
  // Force-on override unblocks without the add-on; force-off re-blocks with it.
  const forceOn = barEntitlement({ restaurant_accounting: true })
  assert.equal(isBarOnlyBlockedPath('/restaurant/finance-close', [...setOf('hospitality-pos', 'bar_pos', [], forceOn)]), false)
  const forceOff = barEntitlement({ restaurant_accounting: false }, { enterprise_addons: ['bar_accounting_workforce'] })
  assert.equal(
    isBarOnlyBlockedPath('/restaurant/finance-close', [...setOf('hospitality-pos', 'bar_pos', ['bar_accounting_workforce'], forceOff)]),
    true
  )
  // Route access never implies Accounting server readiness: the set decision
  // is a navigation boundary only.
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['bar_accounting_workforce'], null), true)
})

test('base Cash and close stays available without Accounting', () => {
  const app = read('src/renderer/src/App.jsx')
  const cashRoute = app.split('\n').find((line) => line.includes('path="hpos/cash"'))
  assert.ok(cashRoute, 'hpos/cash route exists')
  assert.doesNotMatch(cashRoute, /UpgradeWall|BarAddonFeatureRoute|RestaurantAccountingRoute/)
  // Blocklist never contains the base cash path.
  assert.equal(isBarOnlyBlockedPath('/hpos/cash', [...setOf('hospitality-pos', 'bar_pos', [], null)]), false)
})

test('Bar expenses resolves to its own entitled page, not the broader Finance workspace', () => {
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  const app = read('src/renderer/src/App.jsx')
  assert.match(layout, /route: barOnly \? ['"]\/hpos\/expenses['"] : ['"]\/restaurant\/finance-close\?tab=expenses['"]/)
  const expensesRoute = app.split('\n').find((line) => line.includes('path="hpos/expenses"'))
  assert.ok(expensesRoute)
  // Single gate: the bar-only conditional wrapper is the only per-route gate.
  // It renders the UpgradeWall internally for bar-only; a second nested
  // UpgradeWall on the same line double-gated the same feature.
  assert.match(expensesRoute, /BarAddonFeatureRoute feature="expenses"/)
  assert.doesNotMatch(expensesRoute, /UpgradeWall feature="expenses"/)
  // /hpos/expenses is itself add-on gated at the path level.
  assert.equal(getBarAddonFeatureForPath('/hpos/expenses'), 'expenses')
  assert.equal(isBarOnlyBlockedPath('/hpos/expenses', [...setOf('hospitality-pos', 'bar_pos', [], null)]), true)
  assert.equal(
    isBarOnlyBlockedPath('/hpos/expenses', [...setOf('hospitality-pos', 'bar_pos', ['bar_accounting_workforce'], null)]),
    false
  )
})

test('finance tabs carry per-tab feature gates and never mount through a hidden label', () => {
  const workspace = read('src/renderer/src/components/restaurant/RestaurantWorkspace.jsx')
  // Per-tab commercial features (matrix anchors).
  assert.match(workspace, /\{ key: 'overview', label: 'Overview', feature: 'reports'/)
  assert.match(workspace, /\{ key: 'cashups', label: 'Cash-ups & Drawers', feature: 'pos'/)
  assert.match(workspace, /\{ key: 'expenses', label: 'Expenses', feature: 'expenses'/)
  assert.match(workspace, /\{ key: 'daily-close', label: 'Daily Close', feature: 'reports'/)
  // Unauthorized tabs render a gate, not the data component.
  assert.match(workspace, /function FeatureGate/)
  assert.match(workspace, /<FeatureGate feature=\{viewTab\?\.feature\}/)
  // Direct ?tab= selection resolves through the same visible set as nav;
  // denied selections render an explicit denial, never the child.
  assert.match(workspace, /resolveWorkspaceTab\(workspace, candidates, requestedTab, defaultTab, tabAccessContext\)/)
  assert.match(workspace, /WorkspaceTabDenied/)
  // Outlet scope survives tab switches, including URL-provided scope.
  assert.match(workspace, /effectiveOutletId/)
  // Empty tab list renders an explicit state, not a blank page.
  assert.match(workspace, /if \(!activeTab && !deniedTab\)/)
})

test('Finance route and palette enforce capability separately from commercial inclusion', () => {
  const app = read('src/renderer/src/App.jsx')
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  // Accounting pages keep their own role gate; a package cannot invent it.
  assert.match(app, /function RestaurantAccountingRoute/)
  assert.match(app, /capability = payroll \? 'accounting\.payroll_view' : 'accounting\.read'/)
  // Palette expenses entry requires the capability and resolves per mode.
  assert.match(layout, /canAccessCapability\(access, 'expenses\.view'\) && \{/)
  // Cashier lacks accounting.read even with a force-on override; manager keeps it.
  const entitlement = barEntitlement({ restaurant_accounting: true })
  const manager = buildCapabilitySnapshot({
    role: 'manager', productId: 'hospitality-pos', commercialPackageKey: 'bar_pos',
    commercialAddonKeys: [], commercialEntitlement: entitlement, commercialLodgeId: LODGE
  })
  const cashier = buildCapabilitySnapshot({
    role: 'cashier', productId: 'hospitality-pos', commercialPackageKey: 'bar_pos',
    commercialAddonKeys: [], commercialEntitlement: entitlement, commercialLodgeId: LODGE
  })
  assert.equal(manager.capabilities['accounting.read'], true)
  assert.equal(cashier.capabilities['accounting.read'], false)
  // Blocked Finance redirects to an always-reachable Till home (no loop).
  // Single source is the App.jsx guard (declarative <Navigate/> on the router
  // location); the HposLayout imperative navigate() double-redirect was
  // removed so the two never fight on the same navigation.
  assert.match(app, /function BarOnlyBlockedRedirect/)
  assert.match(app, /useLocation\(\)/)
  assert.doesNotMatch(app, /window\.location\.hash\.replace/)
  assert.doesNotMatch(layout, /if \(barOnly && isBarOnlyBlockedPath\(currentPath, barFeatures\)\)/)
})

test('restaurant floor, kitchen, and production stay excluded from Bar mode', () => {
  const allAddons = ['bar_accounting_workforce', 'bar_stock_purchasing_pro', 'bar_growth_multi_outlet']
  const features = [...setOf('hospitality-pos', 'bar_pos', allAddons, null)]
  // Pure restaurant service surfaces have no Bar add-on exception.
  for (const path of ['/hpos/floor', '/hpos/kitchen', '/restaurant/floor', '/restaurant/kitchen-workspace', '/restaurant/kitchen', '/restaurant/tables']) {
    assert.equal(isBarOnlyBlockedPath(path, features), true, `${path} stays blocked even with every add-on`)
  }
  // Stock Pro legitimately unlocks its own production depth (recipes), while
  // base Bar without it stays blocked.
  const base = [...setOf('hospitality-pos', 'bar_pos', [], null)]
  assert.equal(isBarOnlyBlockedPath('/restaurant/recipes', base), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/recipes', features), false)
})
