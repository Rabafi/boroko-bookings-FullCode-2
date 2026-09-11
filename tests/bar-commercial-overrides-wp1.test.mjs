import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getCommercialFeatureOverride,
  getCommercialFeatureSet,
  isCommercialEntitlementContextValid,
  isCommercialFeatureIncluded
} from '../src/shared/commercialAccess.js'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

const LODGE_A = '11111111-1111-4111-8111-111111111111'
const LODGE_B = '22222222-2222-4222-8222-222222222222'

function barEntitlement(features = {}, extra = {}) {
  return {
    product_id: 'hospitality-pos',
    lodge_id: LODGE_A,
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

test('base package and each catalog add-on grant only their own features', () => {
  // Base: tabs yes, accounting/vouchers/customer_accounts no.
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'tabs', [], null), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], null), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'vouchers', [], null), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'customer_accounts', [], null), false)
  // Each add-on.
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['bar_accounting_workforce'], null), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'recipes', ['bar_stock_purchasing_pro'], null), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'vouchers', ['bar_growth_multi_outlet'], null), true)
  // Supported combination: accounting + growth.
  assert.equal(
    isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'vouchers', ['bar_accounting_workforce', 'bar_growth_multi_outlet'], null),
    true
  )
  assert.equal(
    isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['bar_accounting_workforce', 'bar_growth_multi_outlet'], null),
    true
  )
  // Ineligible add-on for the package cannot manufacture a feature.
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['not-an-addon'], null), false)
})

test('force-on and force-off apply with and without the backing add-on', () => {
  const forceOnNoAddon = barEntitlement({ restaurant_accounting: true })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], forceOnNoAddon, LODGE_A), true)
  assert.equal(getCommercialFeatureSet('hospitality-pos', 'bar_pos', [], forceOnNoAddon, LODGE_A).has('restaurant_accounting'), true)

  const forceOffWithAddon = barEntitlement({ restaurant_accounting: false }, { enterprise_addons: ['bar_accounting_workforce'] })
  assert.equal(
    isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['bar_accounting_workforce'], forceOffWithAddon, LODGE_A),
    false
  )
  assert.equal(
    getCommercialFeatureSet('hospitality-pos', 'bar_pos', ['bar_accounting_workforce'], forceOffWithAddon, LODGE_A).has('restaurant_accounting'),
    false
  )

  const forceOnWithAddon = barEntitlement({ vouchers: true }, { enterprise_addons: ['bar_growth_multi_outlet'] })
  assert.equal(
    isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'vouchers', ['bar_growth_multi_outlet'], forceOnWithAddon, LODGE_A),
    true
  )
})

test('manager versus cashier, capability exception, and revoked operator', () => {
  const entitlement = barEntitlement({ restaurant_accounting: true })
  const manager = buildCapabilitySnapshot({
    role: 'manager', productId: 'hospitality-pos', commercialPackageKey: 'bar_pos',
    commercialAddonKeys: [], commercialEntitlement: entitlement, commercialLodgeId: LODGE_A
  })
  const cashier = buildCapabilitySnapshot({
    role: 'cashier', productId: 'hospitality-pos', commercialPackageKey: 'bar_pos',
    commercialAddonKeys: [], commercialEntitlement: entitlement, commercialLodgeId: LODGE_A
  })
  assert.equal(manager.capabilities['accounting.read'], true)
  assert.equal(cashier.capabilities['accounting.read'], false)

  // Explicit capability exceptions can grant a commercially included feature
  // to a role that lacks it, but a commercial force-off still defeats the
  // exception: commercial boundaries are never overridden by role grants.
  const cashierWithOverride = buildCapabilitySnapshot({
    role: 'cashier', productId: 'hospitality-pos', commercialPackageKey: 'bar_pos',
    commercialAddonKeys: [], commercialEntitlement: entitlement, commercialLodgeId: LODGE_A,
    capabilityOverrides: { 'accounting.read': true }
  })
  assert.equal(cashierWithOverride.capabilities['accounting.read'], true)

  const forceOff = barEntitlement({ restaurant_accounting: false }, { enterprise_addons: ['bar_accounting_workforce'] })
  const cashierOverriddenButCommerciallyBlocked = buildCapabilitySnapshot({
    role: 'cashier', productId: 'hospitality-pos', commercialPackageKey: 'bar_pos',
    commercialAddonKeys: ['bar_accounting_workforce'], commercialEntitlement: forceOff, commercialLodgeId: LODGE_A,
    capabilityOverrides: { 'accounting.read': true }
  })
  assert.equal(cashierOverriddenButCommerciallyBlocked.capabilities['accounting.read'], false)

  // A revoked operator context fails closed even with an override present.
  const revoked = barEntitlement({ restaurant_accounting: true }, { status: 'revoked', subscription_state: 'active' })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], revoked, LODGE_A), false)
})

test('product, tenant, package, and unknown-package mismatches fail closed', () => {
  const entitlement = barEntitlement({ restaurant_accounting: true })
  // Product mismatch.
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], { ...entitlement, product_id: 'hotel' }, LODGE_A), false)
  // Tenant/session switch.
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], entitlement, LODGE_B), false)
  assert.equal(isCommercialEntitlementContextValid(entitlement, 'hospitality-pos', 'bar_pos', LODGE_B), false)
  assert.equal(isCommercialEntitlementContextValid(entitlement, 'hospitality-pos', 'bar_pos', LODGE_A), true)
  // A snapshot without tenant provenance is rejected whenever the caller
  // knows the expected lodge; only the trusted fetch/cache adapter may bind
  // or refresh it. Blank lodge identity is rejected the same way.
  const legacy = { ...entitlement }
  delete legacy.lodge_id
  assert.equal(isCommercialEntitlementContextValid(legacy, 'hospitality-pos', 'bar_pos', LODGE_A), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], legacy, LODGE_A), false)
  assert.equal(isCommercialEntitlementContextValid({ ...legacy, lodge_id: '  ' }, 'hospitality-pos', 'bar_pos', LODGE_A), false)
  // Without an expected lodge (logged-out callers), no tenant claim is made.
  assert.equal(isCommercialEntitlementContextValid(legacy, 'hospitality-pos', 'bar_pos'), true)
  // Package mismatch and unknown package.
  assert.equal(isCommercialEntitlementContextValid(entitlement, 'hospitality-pos', 'restaurant_service', LODGE_A), false)
  const unknownPackage = barEntitlement({ restaurant_accounting: true }, { commercial_package_key: 'not-a-package' })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'not-a-package', 'restaurant_accounting', [], unknownPackage, LODGE_A), false)
  assert.deepEqual([...getCommercialFeatureSet('hospitality-pos', 'not-a-package', [], unknownPackage, LODGE_A)], [])
})

test('trial, grace, expiry, malformed lease, and contradictions follow the server contract', () => {
  const trial = barEntitlement({}, { status: 'trial', subscription_state: 'trial' })
  assert.equal(isCommercialEntitlementContextValid(trial, 'hospitality-pos', 'bar_pos', LODGE_A), true)

  const grace = barEntitlement({}, { status: 'licensed', subscription_state: 'grace_period', expires_at: past() })
  assert.equal(isCommercialEntitlementContextValid(grace, 'hospitality-pos', 'bar_pos', LODGE_A), true)

  const expiredPast = barEntitlement({}, { status: 'licensed', subscription_state: 'active', expires_at: past() })
  assert.equal(isCommercialEntitlementContextValid(expiredPast, 'hospitality-pos', 'bar_pos', LODGE_A), false)

  const malformedLease = barEntitlement({}, { offline_valid_until: 'not-a-date' })
  assert.equal(isCommercialEntitlementContextValid(malformedLease, 'hospitality-pos', 'bar_pos', LODGE_A), false)

  const malformedExpiry = barEntitlement({}, { expires_at: 'not-a-date' })
  assert.equal(isCommercialEntitlementContextValid(malformedExpiry, 'hospitality-pos', 'bar_pos', LODGE_A), false)

  // Revoked/active contradiction: explicit denial beats the positive field.
  assert.equal(
    isCommercialEntitlementContextValid(barEntitlement({}, { status: 'revoked', subscription_state: 'active' }), 'hospitality-pos', 'bar_pos', LODGE_A),
    false
  )
  // Non-boolean overrides never grant.
  const malformed = barEntitlement({ restaurant_accounting: 'true' })
  assert.equal(getCommercialFeatureOverride(malformed, 'hospitality-pos', 'restaurant_accounting', 'bar_pos', LODGE_A), null)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], malformed, LODGE_A), false)
})

test('conflicting normalized aliases fail closed consistently across set and single checks', () => {
  const conflict = barEntitlement({ restaurant_service: true, tables: false })
  assert.equal(getCommercialFeatureOverride(conflict, 'hospitality-pos', 'tables', 'bar_pos', LODGE_A), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'tables', [], conflict, LODGE_A), false)
  assert.equal(getCommercialFeatureSet('hospitality-pos', 'bar_pos', [], conflict, LODGE_A).has('tables'), false)

  const agreement = barEntitlement({ restaurant_service: true, tables: true })
  assert.equal(getCommercialFeatureOverride(agreement, 'hospitality-pos', 'tables', 'bar_pos', LODGE_A), true)
  assert.equal(getCommercialFeatureSet('hospitality-pos', 'bar_pos', [], agreement, LODGE_A).has('tables'), true)
})

test('offline cache returning to a server snapshot that revokes the feature denies access', () => {
  const cachedGrant = barEntitlement({ restaurant_accounting: true })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], cachedGrant, LODGE_A), true)
  const serverRevocation = barEntitlement({ restaurant_accounting: false })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], serverRevocation, LODGE_A), false)
  const serverSnapshotNoOverride = barEntitlement({})
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], serverSnapshotNoOverride, LODGE_A), false)
  const expiredLease = barEntitlement({ restaurant_accounting: true }, { offline_valid_until: past() })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], expiredLease, LODGE_A), false)
})

test('route, palette, refresh, IPC, and domain callers share the entitlement boundary', () => {
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  const app = read('src/renderer/src/App.jsx')
  const main = read('src/main/index.js')
  const domain = read('src/main/domains/pos.js')
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const panel = read('src/renderer/src/components/SubscriptionAccessPanel.jsx')

  // Till voucher/tip gating consumes the shared entitlement, not bare strings.
  assert.match(terminal, /isCommercialFeatureIncluded\(\s*commercialProductId,\s*commercialPackageKey,\s*featureKey,\s*commercialAddonKeys,\s*access\?\.\entitlement/)
  // Domain guards pass the fetched entitlement object.
  assert.match(domain, /isCommercialFeatureIncluded\(productId, packageKey, 'vouchers', addonKeys, entitlement/)
  assert.match(domain, /isCommercialFeatureIncluded\(productId, packageKey, 'tips_payouts', addonKeys, entitlement/)
  // Main process threads the entitlement plus the active lodge binding.
  assert.match(main, /commercialEntitlement: entitlement/)
  assert.match(main, /commercialLodgeId: currentLodgeId/)
  assert.match(main, /expectedLodgeId/)
  // Renderer route walls and capability snapshot share the same context.
  assert.match(app, /commercialEntitlement: trialStatus/)
  assert.match(app, /commercialLodgeId: trialStatus\?\.\lodge_id/)
  assert.match(layout, /getCommercialFeatureSet\(\s*access\?\.\entitlement\?\.\product_id/)
  assert.match(panel, /isCommercialFeatureIncluded\([\s\S]{0,240}commercialEntitlement[\s\S]{0,80}\)/)
  // Bar Expenses stays on its own entitled page in bar mode.
  assert.match(layout, /route: barOnly \? ['"]\/hpos\/expenses['"] : ['"]\/restaurant\/finance-close\?tab=expenses['"]/)
})
