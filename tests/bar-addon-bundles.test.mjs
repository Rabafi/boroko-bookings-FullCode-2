import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { BAR_POS_ADDON_CATALOG, getCommercialAddonOffers, getCommercialEntitlementKeys } from '../src/shared/commercialEntitlements.js'
import { getCommercialFeatureSet, isCommercialFeatureIncluded } from '../src/shared/commercialAccess.js'
import { buildCommercialOfferSnapshot } from '../src/shared/commercialPackages.js'

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('Bar POS sells exactly three complete annual add-on bundles', () => {
  assert.deepEqual(BAR_POS_ADDON_CATALOG.map((addon) => addon.addonKey), [
    'bar_stock_purchasing_pro',
    'bar_accounting_workforce',
    'bar_growth_multi_outlet'
  ])
  assert.deepEqual(BAR_POS_ADDON_CATALOG.map((addon) => addon.annualPriceBwp), [3000, 6000, 5000])
  assert.equal(getCommercialAddonOffers('hospitality-pos', 'restaurant').length, 3)
})

test('Bar POS Base documents counter essentials while keeping add-on depth isolated', () => {
  const baseFeatures = new Set(getCommercialEntitlementKeys({
    productId: 'hospitality-pos',
    commercialPackageKey: 'bar_pos'
  }))
  for (const feature of ['modifiers', 'tabs', 'receipts']) assert.equal(baseFeatures.has(feature), true, `${feature} belongs to Bar POS Base`)
  for (const feature of ['purchasing', 'payroll', 'owner_mobile_view']) assert.equal(baseFeatures.has(feature), false, `${feature} remains add-on-only`)

  const sql = read('supabase/migrations/20260820100000_bar_base_catalog_feature_alignment.sql')
  for (const feature of ['modifiers', 'tabs', 'receipts']) assert.match(sql, new RegExp(`\\"${feature}\\"`))
  assert.match(sql, /commercial_package_key = 'bar_pos'/)
  assert.doesNotMatch(sql, /bar_stock_purchasing_pro|bar_accounting_workforce|bar_growth_multi_outlet/)
})

test('bar add-ons extend Bar POS but never leak into restaurant packages', () => {
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'purchasing'), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'purchasing', ['bar_stock_purchasing_pro']), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'payroll', ['bar_accounting_workforce']), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'customer_accounts', ['bar_growth_multi_outlet']), true)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'restaurant_service', 'payroll', ['bar_accounting_workforce']), false)
  assert.ok(getCommercialFeatureSet('hospitality-pos', 'bar_pos', BAR_POS_ADDON_CATALOG.map((addon) => addon.addonKey)).has('stock_transfers'))
})

test('bar commercial snapshot contains the selected bundle features and annual totals', () => {
  const snapshot = buildCommercialOfferSnapshot({
    productId: 'hospitality-pos',
    commercialPackageKey: 'bar_pos',
    addonKeys: ['bar_stock_purchasing_pro', 'bar_accounting_workforce'],
    operatingProfile: 'bar_only',
    propertyType: 'restaurant'
  })
  assert.equal(snapshot.lines.length, 3)
  assert.equal(snapshot.totals.recurring_annual, 13500)
  assert.ok(snapshot.included_features.includes('purchasing'))
  assert.ok(snapshot.included_features.includes('payroll'))
})

test('authoritative migration mirrors bar prices, eligibility and entitlement union', () => {
  const sql = read('supabase/migrations/20260723010000_bar_product_bundles.sql')
  for (const contract of [
    'bar_stock_purchasing_pro', 'bar_accounting_workforce', 'bar_growth_multi_outlet',
    "array['bar_only']", 'v_included_features', 'commercial_package_entitlements',
    'calculate_commercial_quote'
  ]) assert.match(sql, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('Accounting & Workforce surfaces roster and controlled tip payouts', () => {
  const workspace = read('src/renderer/src/components/restaurant/RestaurantWorkspace.jsx')
  const roster = read('src/renderer/src/components/restaurant/BarWorkforceSchedule.jsx')
  assert.match(workspace, /key: 'roster'/)
  assert.match(workspace, /key: 'tips'/)
  assert.match(roster, /staffScheduling\.upsertSchedule/)
  assert.match(roster, /Shift end time must be later/)
  assert.match(roster, /Cashier/)
  assert.match(roster, /Bartender/)
  assert.match(roster, /Bar supervisor/)
})

test('Manager PWA removes restaurant floor and kitchen from bar mode', () => {
  const shell = read('manager-pwa/src/lib/productShell.js')
  const more = read('manager-pwa/src/pages/More.jsx')
  const dashboard = read('manager-pwa/src/pages/Dashboard.jsx')
  assert.match(shell, /barOnly && \['\/restaurant\/floor', '\/restaurant\/kitchen-workspace'\]\.includes\(path\)/)
  assert.match(shell, /owner_mobile_view/)
  assert.match(more, /isBarHospitalityMode/)
  assert.match(more, /isRestaurant && !barOnly.*\/restaurant\/floor/)
  assert.match(more, /isRestaurant && !barOnly.*\/restaurant\/kitchen-workspace/)
  assert.match(dashboard, /barOnly \? '\/restaurant\/service' : '\/restaurant\/floor'/)
})
