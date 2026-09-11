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

function barEntitlement(features = {}, extra = {}) {
  return {
    product_id: 'hospitality-pos',
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

test('explicit Bar overrides force features on and off across inclusion, sets, and capabilities', () => {
  const entitlement = barEntitlement({ restaurant_accounting: true, reports: false })

  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], entitlement), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'reports', [], entitlement), false)

  const features = getCommercialFeatureSet('hospitality-pos', 'bar_pos', [], entitlement)
  assert.equal(features.has('restaurant_accounting'), true)
  assert.equal(features.has('reports'), false)

  const access = buildCapabilitySnapshot({
    role: 'manager',
    productId: 'hospitality-pos',
    commercialPackageKey: 'bar_pos',
    features: { restaurant_accounting: false, reports: true },
    commercialEntitlement: entitlement
  })
  assert.equal(access.capabilities['accounting.read'], true)
  assert.equal(access.capabilities['reports.view'], false)
  assert.equal(access.blockedByFeature['reports.view'], 'commercial:reports')
})

test('package, addon, and role boundaries remain in force around overrides', () => {
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting'), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['bar_accounting_workforce']), true)

  const forceOff = barEntitlement(
    { restaurant_accounting: false },
    { enterprise_addons: ['bar_accounting_workforce'] }
  )
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', ['bar_accounting_workforce'], forceOff), false)

  const manager = buildCapabilitySnapshot({
    role: 'manager',
    productId: 'hospitality-pos',
    commercialPackageKey: 'bar_pos',
    commercialEntitlement: barEntitlement({ restaurant_accounting: true })
  })
  const cashier = buildCapabilitySnapshot({
    role: 'cashier',
    productId: 'hospitality-pos',
    commercialPackageKey: 'bar_pos',
    commercialEntitlement: barEntitlement({ restaurant_accounting: true })
  })
  assert.equal(manager.capabilities['accounting.read'], true)
  assert.equal(cashier.allowedByRole['accounting.read'], false)
  assert.equal(cashier.capabilities['accounting.read'], false)
})

test('unknown, missing, cross-product, expired, and contradictory contexts fail closed', () => {
  const unknownPackage = barEntitlement({ restaurant_accounting: true }, { commercial_package_key: 'not-a-package' })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'not-a-package', 'restaurant_accounting', [], unknownPackage), false)
  assert.deepEqual([...getCommercialFeatureSet('hospitality-pos', 'not-a-package', [], unknownPackage)], [])

  const wrongProduct = barEntitlement({ restaurant_accounting: true }, { product_id: 'hotel' })
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], wrongProduct), false)
  assert.deepEqual([...getCommercialFeatureSet('hospitality-pos', 'bar_pos', [], wrongProduct)], [])

  assert.equal(isCommercialFeatureIncluded('hospitality-pos', null, 'restaurant_accounting', [], barEntitlement({ restaurant_accounting: true })), false)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement({}, { expired: true }), 'hospitality-pos', 'bar_pos'), false)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement({}, { status: 'expired', subscription_state: 'active' }), 'hospitality-pos', 'bar_pos'), false)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement({}, { status: 'revoked', subscription_state: 'active' }), 'hospitality-pos', 'bar_pos'), false)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement({}, { status: 'licensed', subscription_state: 'suspended' }), 'hospitality-pos', 'bar_pos'), false)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement({}, { status: undefined, subscription_state: undefined }), 'hospitality-pos', 'bar_pos'), false)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement({}, { offline_valid_until: new Date(Date.now() - 1000).toISOString() }), 'hospitality-pos', 'bar_pos'), false)
})

test('generic Pro/effective flags and malformed override maps never grant a Bar feature', () => {
  const generic = barEntitlement({}, { effective_features: { restaurant_accounting: true } })
  assert.equal(getCommercialFeatureOverride(generic, 'hospitality-pos', 'restaurant_accounting', 'bar_pos'), null)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], generic), false)

  const noStatus = barEntitlement({ restaurant_accounting: true }, { status: undefined, subscription_state: undefined })
  assert.equal(getCommercialFeatureOverride(noStatus, 'hospitality-pos', 'restaurant_accounting', 'bar_pos'), null)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], noStatus), false)

  const malformed = barEntitlement({ restaurant_accounting: 'true', reports: 1 })
  assert.equal(getCommercialFeatureOverride(malformed, 'hospitality-pos', 'restaurant_accounting', 'bar_pos'), null)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], malformed), false)
})

test('Bar route and main/domain callers use the shared entitlement boundary', () => {
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  const main = read('src/main/index.js')
  const domain = read('src/main/domains/pos.js')
  const panel = read('src/renderer/src/components/SubscriptionAccessPanel.jsx')

  assert.match(layout, /route: barOnly \? ['"]\/hpos\/expenses['"] : ['"]\/restaurant\/finance-close\?tab=expenses['"]/) 
  assert.match(main, /commercialEntitlement:\s*entitlement/)
  assert.match(domain, /isCommercialFeatureIncluded\(productId, packageKey, 'vouchers', addonKeys, entitlement[^)]*\)/)
  assert.match(domain, /isCommercialFeatureIncluded\(productId, packageKey, 'tips_payouts', addonKeys, entitlement[^)]*\)/)
  assert.match(panel, /isCommercialFeatureIncluded\([\s\S]{0,240}commercialEntitlement[\s\S]{0,80}\)/)
})
