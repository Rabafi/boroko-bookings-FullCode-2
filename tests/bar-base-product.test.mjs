import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BAR_BASE_SETUP_STAGE_KEYS,
  getBarModeProfile,
  getHposDockItems,
  getHposMoreItems,
  isBarOnlyBlockedPath
} from '../src/shared/barModeProfile.js'
import { buildCapabilitySnapshot, canAccessCapability } from '../src/shared/accessControl.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const barSettings = {
  property_type: 'restaurant',
  operating_profile: { hospitality_mode: 'bar_only' }
}

test('base Bar POS navigation keeps selling simple and includes essential staff and audit controls', () => {
  const routes = getHposDockItems(barSettings).map((item) => item.route)
  assert.deepEqual(routes, [
    '/hpos/pos',
    '/hpos/checks',
    '/hpos/menu',
    '/hpos/stock',
    '/hpos/cash',
    '/hpos/reports'
  ])

  const manageRoutes = getHposMoreItems(barSettings).filter((item) => !item.feature).map((item) => item.route)
  for (const route of ['/hpos/menu', '/hpos/stock', '/hpos/cash', '/hpos/reports', '/staff', '/hpos/team', '/hpos/control', '/hpos/system-health?tab=audit']) {
    assert.ok(manageRoutes.includes(route))
  }
  for (const route of [
    '/hpos/customers',
    '/hpos/business-control',
    '/restaurant/inventory',
    '/restaurant/finance-close',
    '/restaurant/payroll'
  ]) {
    assert.ok(!manageRoutes.includes(route), `${route} must not appear in base Bar POS`)
  }
})

test('add-on workspaces fail closed while base staff shifts remain available', () => {
  for (const route of [
    '/hpos/customers',
    '/hpos/business-control',
    '/restaurant/inventory',
    '/restaurant/finance-close',
    '/restaurant/team-workspace',
    '/restaurant/general-ledger',
    '/restaurant/payroll'
  ]) {
    assert.equal(isBarOnlyBlockedPath(route), true, route)
  }
  assert.equal(isBarOnlyBlockedPath('/hpos/team'), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/control'), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/inventory', ['inventory_advanced']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/general-ledger', ['restaurant_accounting']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/team-workspace', ['workforce_management']), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/customers', ['customer_accounts']), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/reports'), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/cash'), false)
})

test('bar managers can maintain base stock without enabling the advanced inventory add-on', () => {
  const access = buildCapabilitySnapshot({
    role: 'manager',
    features: { inventory: true },
    commercialPackageKey: 'bar_pos'
  })
  assert.equal(canAccessCapability(access, 'inventory.view'), true)
  assert.equal(canAccessCapability(access, 'inventory.manage'), true)

  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  assert.match(stock, /inventory\.createItem/)
  assert.match(stock, /inventory\.adjustStock/)
  assert.match(stock, /crypto\.randomUUID\(\)/)
  assert.match(stock, /Physical count/)
  assert.doesNotMatch(stock, /navigate\(['"]\/restaurant\/inventory/)
})

test('bar setup and products stay focused on a ten-stage drinks-and-simple-food launch', () => {
  assert.equal(BAR_BASE_SETUP_STAGE_KEYS.length, 10)
  const readiness = read('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx')
  assert.match(readiness, /const BAR_STAGES/)
  assert.match(readiness, /barOnly \? BAR_STAGES : STAGES/)
  assert.match(readiness, /safe first sale/)

  const products = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  assert.ok(getBarModeProfile(barSettings).defaultProductCategories.includes('Simple Food'))
  assert.match(products, /prepared[- ]portion/i)
  assert.match(products, /!barOnly &&/)
  assert.match(products, /stock_method === ["']recipe["']/)
})

test('bar product stock links support measured pours and fail closed around recipe add-on access', () => {
  const products = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  const posDomain = read('src/main/domains/pos.js')
  assert.match(products, /depletion_qty: ["']1["']/)
  assert.match(products, /Stock units consumed per sale/)
  assert.match(products, /step=["']any["']/)
  assert.match(products, /Number\.isFinite\(depletionQty\).*depletionQty <= 0/)
  assert.match(products, /depletion_qty: isDirect \? depletionQty : null/)
  assert.match(products, /getCommercialFeatureSet/)
  assert.match(products, /recipesEnabled = !barOnly \|\| commercialFeatures\.has\(["']recipes["']\)/)
  assert.match(posDomain, /depletion_qty: data\.inventory_item_id \? normalizePositiveQty\(data\.depletion_qty, 1\) : null/)
})

test('base bar sales and day close reuse authoritative shared reporting without table or kitchen blockers', () => {
  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /path="hpos\/reports"/)
  assert.match(app, /<HposReports \/>/)

  const close = read('src/renderer/src/components/restaurant/RestaurantDailyClose.jsx')
  assert.match(close, /barOnly \? Promise\.resolve\(\[\]\)/)
  assert.match(close, /!barOnly &&/)

  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(terminal, /barOnly \? ['"]bartender or cashier['"]/)
  assert.match(terminal, /serving bartender/)
  assert.match(terminal, /paymentBreakdown/)
  assert.match(terminal, /Split payment/)
})
