import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTillEntitlements } from '../src/shared/tillEntitlements.js'
import { resolveReadinessState } from '../src/shared/tillBasketRecovery.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

const BASE = {
  productId: 'hospitality-pos',
  packageKey: 'bar_pos',
  addonKeys: [],
  entitlement: {
    product_id: 'hospitality-pos',
    commercial_package_key: 'bar_pos',
    enterprise_addons: [],
    lodge_id: 'lodge-1',
    status: 'active',
    subscription_state: 'active',
  },
  lodgeId: 'lodge-1',
  barOnly: true,
};

test('F7: base Bar grants selling only; Growth unlocks accounts and promos', () => {
  const base = getTillEntitlements(BASE)
  assert.equal(base.canAccounts, false)
  assert.equal(base.canPromos, false)
  assert.equal(base.canVouchers, false)
  assert.equal(base.canTips, false)
  assert.equal(base.canRecipes, false)
  const growth = getTillEntitlements({
    ...BASE,
    addonKeys: ['bar_growth_multi_outlet'],
    entitlement: { ...BASE.entitlement, enterprise_addons: ['bar_growth_multi_outlet'] },
  })
  assert.equal(growth.canAccounts, true)
  assert.equal(growth.canPromos, true)
  assert.equal(growth.canVouchers, true)
  // Stock Pro and Accounting add-ons unlock their own capabilities only.
  const pro = getTillEntitlements({
    ...BASE,
    addonKeys: ['bar_stock_purchasing_pro'],
    entitlement: { ...BASE.entitlement, enterprise_addons: ['bar_stock_purchasing_pro'] },
  })
  assert.equal(pro.canRecipes, true)
  assert.equal(pro.canAccounts, false)
  const workforce = getTillEntitlements({
    ...BASE,
    addonKeys: ['bar_accounting_workforce'],
    entitlement: { ...BASE.entitlement, enterprise_addons: ['bar_accounting_workforce'] },
  })
  assert.equal(workforce.canTips, true)
  assert.equal(workforce.canPromos, false)
})

test('F7: explicit server denials and unknown contexts fail closed', () => {
  const denied = getTillEntitlements({
    ...BASE,
    addonKeys: ['bar_growth_multi_outlet'],
    entitlement: {
      ...BASE.entitlement,
      enterprise_addons: ['bar_growth_multi_outlet'],
      commercial_overrides: { features: { customer_accounts: false } },
    },
  })
  assert.equal(denied.canAccounts, false)
  assert.equal(denied.canPromos, true)
  const unknown = getTillEntitlements({ ...BASE, entitlement: null, lodgeId: null })
  assert.equal(unknown.canAccounts, false)
  assert.equal(unknown.canPromos, false)
  // Restaurant service keeps established ungated behavior.
  const restaurant = getTillEntitlements({ ...BASE, barOnly: false })
  assert.deepEqual(
    [restaurant.canAccounts, restaurant.canPromos, restaurant.canVouchers, restaurant.canTips, restaurant.canRecipes],
    [true, true, true, true, true],
  )
})

test('F7: cached readiness is approved stale data, never a silent ready', () => {
  const rows = [{ menu_item_id: 'm1', readiness: 'direct' }]
  const fresh = resolveReadinessState({ success: true, rows }, null)
  assert.equal(fresh.status, 'ready')
  assert.equal(fresh.map.get('m1'), 'direct')
  const stale = resolveReadinessState(
    { success: false, error: 'offline' },
    { at: Date.now() - 1000, rows },
  )
  assert.equal(stale.status, 'stale')
  assert.equal(stale.map.get('m1'), 'direct')
  const expired = resolveReadinessState(
    { success: false },
    { at: Date.now() - 25 * 60 * 60 * 1000, rows },
  )
  assert.equal(expired.status, 'failed')
  const none = resolveReadinessState({ success: false }, null)
  assert.equal(none.status, 'failed')
  assert.equal(none.map.size, 0)
})

test('F7: Till gates customer/promotion reads, controls and submissions', () => {
  const source = terminal()
  assert.match(source, /getTillEntitlements\(/)
  // Reads gated.
  assert.match(source, /tillEntitlements\.canAccounts \? \(window\.api\?\.pos\?\.getCustomers/)
  assert.match(source, /tillEntitlements\.canPromos \? \(window\.api\?\.pos\?\.getPromotions/)
  // Controls gated.
  assert.match(source, /tillEntitlements\.canAccounts && \(/)
  assert.match(source, /eligiblePromotions\.length > 0 && tillEntitlements\.canPromos/)
  // Submissions fail closed with package messaging.
  assert.match(source, /Customer account charging is not included in the current Bar POS package/)
  assert.match(source, /Promotions are not included in the current Bar POS package/)
  // Stale cache is labeled; failure without cache blocks selling.
  assert.match(source, /Stock status from/)
  assert.match(source, /refresh when online/)
  assert.match(source, /selling is paused/)
})
