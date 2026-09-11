import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'
import { isProductRouteAllowed } from '../src/shared/productIdentity.js'

const read = (file) => readFileSync(resolve(file), 'utf8')

const hub = read('src/renderer/src/components/LodgeFoodBeverageHub.jsx')
const workspace = read('src/renderer/src/components/restaurant/RestaurantWorkspace.jsx')
const floor = read('src/renderer/src/components/hospitality-pos/HposFloorPlan.jsx')
const pos = read('src/renderer/src/components/POS.jsx')
const menu = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
const financeOverview = read('src/renderer/src/components/restaurant/RestaurantFinanceOverview.jsx')
const restaurantStyles = read('src/renderer/src/styles/restaurant-workspaces.css')
const app = read('src/renderer/src/App.jsx')

function hubWorkspaceIds(source) {
  return [...source.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function workspaceDefinitionKeys(source) {
  const start = source.indexOf('const WORKSPACES = {')
  const end = source.indexOf('\n}\n\nconst WORKSPACE_PRESENTATION', start)
  const body = source.slice(start, end === -1 ? source.length : end)
  return [...body.matchAll(/^\s{2}([a-z][a-z0-9_-]*)\s*:\s*\{/gm)].map((match) => match[1])
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('every Lodge Food & Beverage card resolves to a real workspace definition', () => {
  const ids = hubWorkspaceIds(hub)
  const definitionKeys = new Set(workspaceDefinitionKeys(workspace))
  assert.ok(ids.length >= 6, 'the lodge hub should expose the expected operational workspace cards')

  // Progressive activation adds hub-only views (Today, More tools, and gated
  // advanced modules) that intentionally do not duplicate RestaurantWorkspace
  // definitions. They render dedicated F&B components and must never be
  // mistaken for unresolved restaurant cards.
  const HUB_ONLY_VIEWS = new Set(['today', 'more', 'room-service', 'meal-plans', 'food-safety', 'invoice-matching', 'demand-planning', 'fnb-reports'])
  const unresolved = ids.filter((id) => !definitionKeys.has(id) && !HUB_ONLY_VIEWS.has(id))
  const hasExplicitAlias = /\bclose\b[\s\S]{0,240}\bfinance\b|\bfinance\b[\s\S]{0,240}\bclose\b/.test(hub)
  assert.deepEqual(
    unresolved.filter((id) => !(id === 'close' && hasExplicitAlias)),
    [],
    'every hub id must match RestaurantWorkspace, the close -> finance alias, or a hub-only progressive view'
  )
})

test('cash and close is backed by a non-empty definition rather than rendering null', () => {
  const ids = hubWorkspaceIds(hub)
  const definitionKeys = new Set(workspaceDefinitionKeys(workspace))
  const hasCloseRoute = ids.includes('close') || ids.includes('finance')
  assert.equal(hasCloseRoute, true, 'the hub must keep a cash/close destination')
  assert.equal(definitionKeys.has('finance') || definitionKeys.has('close'), true, 'cash/close must have a workspace definition')
  if (ids.includes('close') && !definitionKeys.has('close')) {
    assert.match(hub, /\bclose\b[\s\S]{0,240}\bfinance\b|\bfinance\b[\s\S]{0,240}\bclose\b/, 'the close route must explicitly resolve to the finance definition')
  }
  assert.match(workspace, /(?:finance|close):\s*\{[\s\S]{0,1600}?tabs:\s*\[[\s\S]*?\]/, 'cash/close must contain at least one view')
})

test('floor handoff passes a table and POS consumes the navigation state', () => {
  assert.match(floor, /navigate\(posRoute,\s*\{\s*state:\s*\{[\s\S]*?tableName/, 'floor actions must carry the selected table into POS')
  assert.match(pos, /useLocation|location\.state/, 'POS must read router state for floor handoffs')
  assert.match(pos, /normalizePosRouteHandoff\(location\.state\)/, 'POS must normalize the floor route state')
  assert.match(pos, /routeHandoff\.tableName[\s\S]{0,180}setTableName\(routeHandoff\.tableName\)/, 'POS must apply the handed-off table')
})

test('Lodge reservation and recipe handoffs remain inside the Lodge Food & Beverage surface', () => {
  assert.match(hub, /RestaurantReservations/, 'the lodge floor must retain its reservation view')
  assert.doesNotMatch(hub, /navigate\(['"]\/hpos\/service['"]\)/, 'the lodge hub must not navigate to a restaurant-only reservation route')
  assert.match(floor, /reservationsRoute|\/food-beverage\/floor(?:\?tab=reservations)?/, 'floor reservation actions must accept a lodge-safe destination')

  assert.match(workspace, /context(?:Label)?|property-outlet/, 'the shared workspace must know when it is mounted from the lodge hub')
  assert.match(menu, /food-beverage|property-outlet|productionRoute|context/, 'recipe navigation must be context-aware')
  assert.doesNotMatch(menu, /navigate\(`\/restaurant\/menu-production/, 'recipe handoffs must not hard-code a restaurant-only route')
})

test('workspace cards and tabs are filtered by role capabilities as well as package features', () => {
  assert.match(hub, /useAccess|AccessContext/, 'the lodge hub must read the operator access snapshot')
  assert.match(hub, /canAccessCapability|allowedByRole|capabilit(?:y|ies)/, 'workspace cards must declare and evaluate capabilities')
  assert.match(hub, /\.filter\(/, 'inaccessible workspace cards must be removed before rendering')
  const workspaceList = hub.slice(hub.indexOf('const WORKSPACES'), hub.indexOf('\n])', hub.indexOf('const WORKSPACES')))
  const cardBlocks = [...workspaceList.matchAll(/\{\s*id:\s*['"][^'"]+['"][\s\S]*?\},?/g)].map((match) => match[0])
  assert.ok(cardBlocks.length >= 6, 'the lodge hub should keep capability metadata on each workspace card')
  assert.ok(cardBlocks.every((block) => /capabilit(?:y|ies|Any)\s*:/.test(block)), 'each workspace card must declare its access requirement')

  assert.match(workspace, /useAccess|AccessContext/, 'the shared workspace must read role access')
  assert.match(workspace, /canAccessCapability|allowedByRole|capabilit(?:y|ies)/, 'workspace tabs must declare and evaluate capabilities')
  assert.match(workspace, /tabs\.filter|filter\(\s*\(?\s*tab|accessibleTabs|visibleTabs/, 'inaccessible workspace tabs must be removed before rendering')
})

test('Lodge Food & Beverage points to canonical Inventory, Reports, and Expenses workflows', () => {
  for (const route of ['/inventory', '/reports', '/expenses']) {
    assert.match(
      `${hub}\n${workspace}\n${financeOverview}`,
      new RegExp(escapeRegExp(route)),
      `${route} must remain a canonical Lodge destination`
    )
  }

  assert.match(workspace, /isPropertyOutlet/, 'canonical destination selection must be scoped to Lodge context')
  assert.match(workspace, /(?:canonical|lodge|property)[\w-]*(?:Routes|Destinations|Links)|\/inventory[\s\S]{0,420}\/reports[\s\S]{0,420}\/expenses/i, 'the lodge context must define the canonical destination set')
  assert.match(workspace, /'finance:overview'[\s\S]{0,300}routeKey: 'reports'/, 'the Lodge finance overview must bridge to canonical Lodge reports')
})

test('Lodge context does not show Restaurant & Bar package copy', () => {
  const gateStart = workspace.indexOf('function FeatureGate')
  const gateEnd = workspace.indexOf('const TAB_GUIDANCE', gateStart)
  const gate = workspace.slice(gateStart, gateEnd === -1 ? workspace.length : gateEnd)
  assert.doesNotMatch(gate, /Restaurant\s*&\s*Bar plan/i, 'the Lodge feature gate must not present POS-product commercial copy')
  assert.match(workspace, /FeatureGate[^>]*context|isPropertyOutlet[\s\S]{0,700}FeatureGate/, 'the active Lodge context must reach the feature gate')
})

test('Food & Beverage stays within the Lodge product boundary', () => {
  const routeStart = app.indexOf('path="food-beverage/:workspace?"')
  const routeBlock = app.slice(routeStart, routeStart + 700)
  assert.match(routeBlock, /IS_LODGE_PRODUCT/, 'Food & Beverage must only mount for the Lodge product')
  assert.match(routeBlock, /Navigate to="\/"/, 'non-Lodge products must be redirected away from Food & Beverage')

  const roleAccess = { allowedByRole: { 'pos.view': true, 'inventory.view': true, 'reports.view': true, 'expenses.view': true } }
  const lodgeRoutes = new Set(getDesktopNavItems('lodge', roleAccess, 'lodge', 'Pro', [], null, 'lodge-camp').map((item) => item.to))
  const restaurantRoutes = new Set(getDesktopNavItems('restaurant', roleAccess, 'restaurant', 'Pro', [], null, 'hospitality-pos').map((item) => item.to))
  assert.equal(lodgeRoutes.has('/food-beverage/kitchen'), true, 'Lodge navigation should expose Food & Beverage')
  assert.equal(restaurantRoutes.has('/food-beverage/kitchen'), false, 'Restaurant POS navigation should retain its own surface')
  assert.equal(isProductRouteAllowed('/food-beverage/kitchen', 'lodge-camp'), true)
  assert.equal(isProductRouteAllowed('/food-beverage/kitchen', 'hotel'), false)
  assert.equal(isProductRouteAllowed('/food-beverage/kitchen', 'hospitality-pos'), false)
})

test('Food & Beverage uses a compact operator-first navigation hierarchy', () => {
  assert.match(hub, /Sell, serve, produce, restock, and close the outlet from one place/)
  assert.match(hub, /const QUICK_ACTIONS/)
  assert.match(hub, /New order/)
  assert.match(hub, /visibleQuickActions/)
  assert.match(hub, /sticky top-0/)
  assert.match(hub, /overflow-x-auto/)
  assert.match(hub, /aria-selected=\{floorTab === 'live'\}/)
  assert.match(workspace, /function LodgeWorkspaceGuide/)
  assert.match(workspace, /isPropertyOutlet && !activeTab\.isCanonicalBridge/)
  assert.match(workspace, /bg-slate-900 text-white shadow-sm/)
})

test('restaurant branding is adapted only inside the Lodge Food & Beverage shell', () => {
  assert.match(restaurantStyles, /Restaurant & Bar plum\/copper brand/)
  assert.match(restaurantStyles, /\.lodge-food-beverage-hub :is\(/)
  assert.match(restaurantStyles, /\.lodge-food-beverage-hub[\s\S]*background-color: #145c4b !important/)
  assert.match(restaurantStyles, /\.lodge-food-beverage-hub[\s\S]*background-color: #16735a !important/)
  assert.match(restaurantStyles, /\.lodge-food-beverage-hub[\s\S]*border-color: #cfe0d8 !important/)
  assert.doesNotMatch(restaurantStyles, /^:is\([\s\S]*background-color: #145c4b/m, 'the lodge palette must not be applied globally')
})
