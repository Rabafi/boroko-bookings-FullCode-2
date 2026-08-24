/**
 * Bar Mode Phases 0–3: curation, vocabulary, service defaults, shell filtering.
 * Exercises shipped helpers and structural source contracts — no re-implementation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HOSPITALITY_MODES,
  isBarOnlyMode,
  getHospitalityMode,
  buildOperatingProfile,
  getExplicitHospitalityMode,
  mergeOperatingProfileWithLockedHospitalityMode,
  resolveLockedPropertyType
} from '../src/shared/propertyTypes.js'
import { getUiVocabulary } from '../src/shared/uiVocabulary.js'
import {
  BAR_ADDON_PATH_FEATURES,
  BAR_ONLY_BLOCKED_PATH_PREFIXES,
  BAR_PACK_SIZES,
  getBarModeProfile,
  getDefaultHposServiceMode,
  getHposDockItems,
  getHposMoreItems,
  getHposServiceModes,
  getRestaurantDashboardShortcuts,
  isBarOnlyBlockedPath,
  normalizeAppPath,
  resolvePosServicePayload
} from '../src/shared/barModeProfile.js'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const barSettings = {
  property_type: 'restaurant',
  business_type: 'restaurant',
  operating_profile: { hospitality_mode: 'bar_only' }
}
const restaurantSettings = {
  property_type: 'restaurant',
  business_type: 'restaurant',
  operating_profile: { hospitality_mode: 'restaurant_bar' }
}

test('bar mode profile centralizes visibility and service defaults', () => {
  const bar = getBarModeProfile(barSettings)
  const rest = getBarModeProfile(restaurantSettings)

  assert.equal(bar.barOnly, true)
  assert.equal(bar.defaultServiceMode, 'counter')
  assert.deepEqual(bar.serviceModes.map((m) => m.id), ['counter', 'tab'])
  assert.ok(bar.dockItems.every((item) => !/floor|kitchen/i.test(item.route + item.label)))
  assert.ok(bar.dockItems.some((item) => item.route === '/hpos/pos'))
  assert.ok(bar.dockItems.some((item) => item.route === '/hpos/menu' && /product/i.test(item.label)))
  assert.ok(bar.moreItems.some((item) => item.route === '/pos/bar-display'))
  assert.ok(!bar.moreItems.filter((item) => !item.feature).some((item) => /kitchen|recipe|reservation|floor/i.test(item.route + item.label)))
  assert.ok(bar.moreItems.some((item) => item.route === '/restaurant/menu-production' && item.feature === 'recipes'))
  assert.match(bar.searchPlaceholder, /drink|barcode/i)
  assert.match(bar.productListLabel, /drink|product/i)

  assert.equal(rest.barOnly, false)
  assert.equal(rest.defaultServiceMode, 'table')
  assert.deepEqual(rest.serviceModes.map((m) => m.id), ['table', 'takeaway', 'delivery'])
  assert.ok(rest.dockItems.some((item) => item.route === '/hpos/floor'))
  assert.ok(rest.dockItems.some((item) => item.route === '/hpos/kitchen'))
  assert.ok(rest.moreItems.some((item) => item.route === '/restaurant/menu-production'))
  assert.ok(!rest.moreItems.some((item) => item.route === '/restaurant/recipes'))
})

test('isBarOnlyBlockedPath covers HPOS kitchen/floor and restaurant production paths', () => {
  assert.equal(isBarOnlyBlockedPath('/hpos/floor'), true)
  assert.equal(isBarOnlyBlockedPath('/hpos/kitchen'), true)
  assert.equal(isBarOnlyBlockedPath('/hpos/kitchen/tickets'), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/recipes'), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/purchasing'), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/purchase-suggestions'), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/lots-expiry'), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/staff-performance'), true)
  assert.equal(isBarOnlyBlockedPath('/restaurant/purchasing', ['purchasing']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/purchase-suggestions', ['purchase_suggestions']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/lots-expiry', ['lots_expiry']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/staff-performance', ['staff_performance']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/floor'), true)
  assert.equal(isBarOnlyBlockedPath('/pos/kitchen-display'), true)
  // Allowed bar/HPOS paths
  assert.equal(isBarOnlyBlockedPath('/hpos/pos'), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/menu'), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/stock'), false)
  assert.equal(isBarOnlyBlockedPath('/pos/bar-display'), false)
  assert.equal(isBarOnlyBlockedPath('#/hpos/floor'), true)
  assert.equal(normalizeAppPath('#/hpos/pos?x=1'), '/hpos/pos')
  assert.ok(BAR_ONLY_BLOCKED_PATH_PREFIXES.includes('/hpos/floor'))
  assert.ok(BAR_ONLY_BLOCKED_PATH_PREFIXES.includes('/hpos/kitchen'))
  for (const [addonPath, feature] of Object.entries(BAR_ADDON_PATH_FEATURES)) {
    assert.equal(isBarOnlyBlockedPath(addonPath), true, `${addonPath} must fail closed without ${feature}`)
    assert.equal(isBarOnlyBlockedPath(addonPath, [feature]), false, `${addonPath} must open with ${feature}`)
  }
})

test('resolvePosServicePayload maps counter and named tabs without inventing a second ledger', () => {
  const counter = resolvePosServicePayload('counter')
  assert.equal(counter.service_mode, 'counter')
  assert.equal(counter.requiresTableOrTab, false)
  assert.equal(counter.openSession, false)
  assert.equal(counter.table_name, null)

  const tab = resolvePosServicePayload('tab', { tabName: 'Thabo' })
  assert.equal(tab.service_mode, 'table')
  assert.equal(tab.table_name, 'Thabo')
  assert.equal(tab.tab_name, 'Thabo')
  assert.equal(tab.requiresTableOrTab, true)
  assert.equal(tab.openSession, true)

  const table = resolvePosServicePayload('table', { tableName: 'T4' })
  assert.equal(table.table_name, 'T4')
  assert.equal(table.openSession, true)
})

test('ui vocabulary is bar-native in bar_only and restaurant-native otherwise', () => {
  const barVocab = getUiVocabulary({
    productId: 'hospitality-pos',
    propertyType: 'restaurant',
    settings: barSettings
  })
  assert.equal(barVocab.noun, 'bar')
  assert.equal(barVocab.nounTitle, 'Bar')
  assert.match(barVocab.workspaceLabel, /bar/i)
  assert.match(barVocab.productsLabel, /drink|product/i)
  assert.doesNotMatch(barVocab.workspaceLabel, /restaurant/i)

  const restVocab = getUiVocabulary({
    productId: 'hospitality-pos',
    propertyType: 'restaurant',
    settings: restaurantSettings
  })
  assert.equal(restVocab.noun, 'restaurant')
  assert.match(restVocab.workspaceLabel, /restaurant/i)
})

test('Login uses bar language when active settings are bar_only', () => {
  const login = fs.readFileSync(path.join(root, 'src/renderer/src/components/Login.jsx'), 'utf8')
  assert.match(login, /isBarOnlyMode/)
  assert.match(login, /getUiVocabulary/)
  assert.match(login, /BUILD_PRODUCT\.name/)
  assert.match(login, /Bar operations/)
  assert.match(login, /sell drinks/)
})

test('Bar board / prep display always exposes exit back to sell POS', () => {
  const displays = fs.readFileSync(path.join(root, 'src/renderer/src/components/POSDisplays.jsx'), 'utf8')
  assert.match(displays, /useDisplayExitPath/)
  assert.match(displays, /Back to sell/)
  assert.match(displays, /Escape/)
  assert.match(displays, /navigate\(exitPath,\s*\{\s*replace:\s*true\s*\}\)/)
  assert.match(displays, /\/hpos\/pos/)
  assert.match(displays, /exitLabel/)
})

test('HPOS manager navigation exposes Settings, System Health, and Data without a second POS', () => {
  const profile = fs.readFileSync(path.join(root, 'src/shared/barModeProfile.js'), 'utf8')
  assert.match(profile, /route: '\/settings'/)
  assert.match(profile, /route: '\/hpos\/system-health'/)
  assert.match(profile, /route: '\/settings\?tab=license'/)
  assert.match(profile, /route: '\/data-management'/)
  assert.match(profile, /label: 'System Health'/)
  assert.doesNotMatch(profile, /label: 'Advanced POS'/)
  assert.match(profile, /label: 'Subscription'/)
  assert.doesNotMatch(profile, /label: 'Document templates'/)

  const nav = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposNav.jsx'), 'utf8')
  assert.match(nav, /System Health/)
  assert.match(nav, /hpos\/system-health/)
  assert.match(nav, /Data & backup/)
  assert.doesNotMatch(nav, /Advanced POS/)
  assert.match(nav, /goTo\('\/settings'\)/)

  const settings = fs.readFileSync(path.join(root, 'src/renderer/src/components/Settings.jsx'), 'utf8')
  assert.match(settings, /System Health/)
  assert.match(settings, /SystemHealthPanel/)
  assert.match(settings, /searchParams\.get\('tab'\)/)
  assert.match(settings, /POS dock stays free for selling/)

  const health = fs.readFileSync(path.join(root, 'src/renderer/src/components/SystemHealthPanel.jsx'), 'utf8')
  assert.match(health, /isRestaurantOnly/)
  assert.match(health, /SYNC_OP_LABEL_RESTAURANT/)
  assert.match(health, /restaurantMode/)
  assert.match(health, /Void sale|POS sale/)

  const hub = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposManageHub.jsx'), 'utf8')
  assert.match(hub, /getHposMoreItems/)
  assert.match(hub, /canAccessCapability/)
  assert.match(hub, /Manager workspace/)
})

test('bar Manage exposes Staff accounts once, under Devices & administration', () => {
  const hub = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposManageHub.jsx'), 'utf8')
  const runGroup = hub.slice(hub.indexOf("id: 'run'"), hub.indexOf("id: 'oversight'"))
  const adminGroup = hub.slice(hub.indexOf("id: 'admin'"), hub.indexOf('];', hub.indexOf("id: 'admin'")))

  assert.doesNotMatch(runGroup, /'\/staff'/)
  assert.match(adminGroup, /'\/staff'/)
})

test('desktop nav hides restaurant-only and shows bar products/board in bar_only', () => {
  const access = {
    allowedByRole: {
      'pos.view': true,
      'pos.manage': true,
      'pos.cashup': true,
      'inventory.view': true,
      'staff.view': true,
      'reports.view': true
    }
  }
  const barItems = getDesktopNavItems('restaurant', access, 'restaurant', 'Pro', [], { hospitality_mode: 'bar_only' })
  const barRoutes = new Set(barItems.map((item) => item.to))
  assert.equal(barRoutes.has('/restaurant/floor'), false)
  assert.equal(barRoutes.has('/restaurant/kitchen-workspace'), false)
  assert.equal(barRoutes.has('/restaurant/menu-production'), false)
  assert.equal(barRoutes.has('/hpos/menu'), true)
  assert.equal(barRoutes.has('/pos/bar-display'), true)
  assert.equal(barRoutes.has('/restaurant/cash-close'), true)
  assert.equal(barRoutes.has('/restaurant/stock-purchasing'), true)

  const restItems = getDesktopNavItems('restaurant', access, 'restaurant', 'Pro', [], { hospitality_mode: 'restaurant_bar' })
  const restRoutes = new Set(restItems.map((item) => item.to))
  assert.equal(restRoutes.has('/restaurant/floor'), true)
  assert.equal(restRoutes.has('/restaurant/kitchen-workspace'), true)
  assert.equal(restRoutes.has('/restaurant/menu-production'), true)
  assert.equal(restRoutes.has('/hpos/menu'), false)
  assert.equal(restRoutes.has('/pos/bar-display'), false)
})

test('dashboard shortcuts for bar_only exclude kitchen/floor and include sell/products/bar board', () => {
  const bar = getRestaurantDashboardShortcuts(barSettings)
  const labels = bar.map((s) => s.label + s.to).join(' ')
  assert.ok(bar.some((s) => s.to === '/hpos/pos'))
  assert.ok(bar.some((s) => s.to === '/hpos/menu'))
  assert.ok(bar.some((s) => s.to === '/pos/bar-display'))
  assert.ok(!/floor|kitchen|menu-production/i.test(labels))

  const rest = getRestaurantDashboardShortcuts(restaurantSettings)
  assert.ok(rest.some((s) => s.to === '/restaurant/floor'))
  assert.ok(rest.some((s) => s.to === '/restaurant/kitchen-workspace'))
})

test('buildOperatingProfile can persist hospitality_mode', () => {
  const profile = buildOperatingProfile('restaurant', 'Pro', [], { hospitalityMode: 'bar_only' })
  assert.equal(profile.hospitality_mode, HOSPITALITY_MODES.BAR_ONLY)
  assert.equal(isBarOnlyMode({ operating_profile: profile }), true)
  assert.equal(getHospitalityMode({ operating_profile: profile }), 'bar_only')
})

test('property_type is locked after setup (Settings cannot reclassify product)', () => {
  assert.equal(
    resolveLockedPropertyType({ property_type: 'hotel' }, { setup_complete: true, property_type: 'lodge' }),
    'lodge'
  )
  assert.equal(
    resolveLockedPropertyType({ property_type: 'restaurant' }, { setup_complete: true, property_type: 'camp' }),
    'camp'
  )
  // First setup / incomplete may accept the incoming type.
  assert.equal(
    resolveLockedPropertyType({ property_type: 'hotel' }, { setup_complete: false }),
    'hotel'
  )
  assert.equal(
    resolveLockedPropertyType({ property_type: 'restaurant' }, {}),
    'restaurant'
  )

  const settingsDomain = fs.readFileSync(path.join(root, 'src/main/domains/settings.js'), 'utf8')
  assert.match(settingsDomain, /resolveLockedPropertyType/)
  const settingsUi = fs.readFileSync(path.join(root, 'src/renderer/src/components/Settings.jsx'), 'utf8')
  assert.match(settingsUi, /Product identity \(locked\)/)
  assert.doesNotMatch(settingsUi, /option value="hotel"/)
  assert.doesNotMatch(settingsUi, /option value="restaurant"/)
  assert.doesNotMatch(settingsUi, /Hotel-grade modules and Enterprise features will be visible/)
})

test('hospitality_mode is locked after first set (no in-app product switch)', () => {
  assert.equal(getExplicitHospitalityMode({ hospitality_mode: 'bar_only' }), HOSPITALITY_MODES.BAR_ONLY)
  assert.equal(getExplicitHospitalityMode({}), null)
  assert.equal(getExplicitHospitalityMode({ operating_profile: {} }), null)

  const firstSet = mergeOperatingProfileWithLockedHospitalityMode(
    { hospitality_mode: 'bar_only', pos_outlets: true },
    {}
  )
  assert.equal(firstSet.hospitality_mode, HOSPITALITY_MODES.BAR_ONLY)

  const blockedSwitch = mergeOperatingProfileWithLockedHospitalityMode(
    { hospitality_mode: 'restaurant_bar', something: 1 },
    { hospitality_mode: 'bar_only', pos_outlets: true }
  )
  assert.equal(blockedSwitch.hospitality_mode, HOSPITALITY_MODES.BAR_ONLY)
  assert.equal(blockedSwitch.something, 1)
  assert.equal(blockedSwitch.pos_outlets, true)

  const blockedOtherWay = mergeOperatingProfileWithLockedHospitalityMode(
    { hospitality_mode: 'bar_only' },
    { hospitality_mode: 'restaurant_bar' }
  )
  assert.equal(blockedOtherWay.hospitality_mode, HOSPITALITY_MODES.RESTAURANT_BAR)

  // Settings UI must not offer a selling-mode switch.
  const settingsUi = fs.readFileSync(path.join(root, 'src/renderer/src/components/Settings.jsx'), 'utf8')
  assert.doesNotMatch(settingsUi, /Selling mode/)
  assert.doesNotMatch(settingsUi, /You can switch later/)
  assert.match(settingsUi, /Product identity \(locked\)/)
  assert.match(settingsUi, /cannot be switched/)

  // Setup must not promise free mode upgrades, and must offer Bar registration.
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  assert.doesNotMatch(setup, /upgrade from Bar Only later/i)
  assert.match(setup, /cannot be changed later|different pricing/i)
  assert.match(setup, /label: 'Bar'/)
  assert.match(setup, /buildHospitalityOperatingProfile/)

  // Main process enforces lock on save / profile update.
  const settingsDomain = fs.readFileSync(path.join(root, 'src/main/domains/settings.js'), 'utf8')
  assert.match(settingsDomain, /mergeOperatingProfileWithLockedHospitalityMode/)

  // HPOS shell must not import getDesktopNavItems (caused login recovery crashes).
  const hposLayout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposLayout.jsx'), 'utf8')
  assert.doesNotMatch(hposLayout, /getDesktopNavItems/)
  assert.match(hposLayout, /getHposDockItems/)
})

test('pack sizes contract for bar product templates', () => {
  assert.deepEqual([...BAR_PACK_SIZES], [6, 12, 24])
  assert.equal(getDefaultHposServiceMode(true), 'counter')
  assert.equal(getDefaultHposServiceMode(false), 'table')
  assert.equal(getHposServiceModes(true).length, 2)
  assert.equal(getHposDockItems(true).length < getHposDockItems(false).length, true)
  assert.ok(getHposMoreItems(true).some((i) => i.route === '/pos/bar-display'))
})

test('bar mode resolves every supported settings and session shape', () => {
  assert.equal(isBarOnlyMode({ operating_profile: { hospitality_mode: 'bar_only' } }), true)
  assert.equal(isBarOnlyMode({ operating_profile: '{"hospitality_mode":"bar_only"}' }), true)
  assert.equal(isBarOnlyMode({ hospitality_mode: 'bar_only', operating_profile: {} }), true)
  assert.equal(isBarOnlyMode({ operating_mode: 'bar_only' }), true)
  assert.equal(isBarOnlyMode({ commercial_package_key: 'bar_pos' }), true)
  assert.equal(isBarOnlyMode({ commercial_package_key: 'bar_pos', operating_profile: { hospitality_mode: 'restaurant_bar' } }), true)
  assert.equal(isBarOnlyMode({ commercial_package_key: 'restaurant_control' }), false)
})

test('App RestaurantGuard uses shared isBarOnlyBlockedPath for HPOS paths', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
  assert.match(app, /isBarOnlyBlockedPath/)
  assert.match(app, /from ['"].*barModeProfile['"]/)
  assert.doesNotMatch(app, /BAR_ONLY_EXCLUDED_ROUTE_SEGMENTS/)
})

test('kitchen-display route is wired with BarOnlyBlockedRedirect (not only helper list)', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
  // Guard component must exist and call the shared blocker.
  assert.match(app, /function BarOnlyBlockedRedirect/)
  assert.match(app, /barOnlyMode && isBarOnlyBlockedPath\(location, enabledFeatures\)/)
  // RestaurantGuard must compose the shared redirect (not a divergent path list).
  assert.match(app, /return <BarOnlyBlockedRedirect>\{children\}<\/BarOnlyBlockedRedirect>/)

  // Sibling kitchen-display route must wrap PrepDisplay with BarOnlyBlockedRedirect.
  // bar-display must remain reachable (no BarOnlyBlockedRedirect wrapper).
  const kitchenRouteIdx = app.indexOf('path="/pos/kitchen-display"')
  const barRouteIdx = app.indexOf('path="/pos/bar-display"')
  assert.ok(kitchenRouteIdx > 0, 'kitchen-display route must exist')
  assert.ok(barRouteIdx > kitchenRouteIdx, 'bar-display must follow kitchen-display')

  const kitchenBlock = app.slice(kitchenRouteIdx, barRouteIdx)
  assert.match(kitchenBlock, /BarOnlyBlockedRedirect/)
  assert.match(kitchenBlock, /PrepDisplay\s+station=["']kitchen["']/)

  const barBlock = app.slice(barRouteIdx, app.indexOf('path="*"', barRouteIdx))
  assert.match(barBlock, /PrepDisplay\s+station=["']bar["']/)
  assert.doesNotMatch(barBlock, /BarOnlyBlockedRedirect/)

  // Fail closed: helper must still list kitchen-display so the redirect triggers.
  assert.equal(isBarOnlyBlockedPath('/pos/kitchen-display'), true)
  assert.equal(isBarOnlyBlockedPath('/pos/bar-display'), false)
})

test('HPOS layout and dock filter by bar mode profile', () => {
  const layout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposLayout.jsx'), 'utf8')
  const dock = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposDock.jsx'), 'utf8')
  const terminal = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposTerminal.jsx'), 'utf8')
  const menu = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposMenu.jsx'), 'utf8')

  assert.match(layout, /getHposDockItems/)
  assert.match(layout, /hpos-primary-rail/)
  assert.match(layout, /canAccessCapability/)
  assert.match(layout, /isBarOnlyBlockedPath/)
  assert.match(layout, /isBarOnlyMode/)
  assert.match(dock, /getHposDockItems/)
  assert.match(dock, /getHposMoreItems/)

  assert.doesNotMatch(terminal, /import POS from ['"]\.\.\/POS['"]/)
  assert.match(terminal, /getDefaultHposServiceMode/)
  assert.match(terminal, /getHposServiceModes/)
  assert.match(terminal, /resolvePosServicePayload/)
  assert.match(terminal, /serviceMode === ["']tab["']/)
  assert.match(terminal, /tryAddBySearch|barcode/)

  assert.match(menu, /setBarPackTemplate/)
  assert.match(menu, /BAR_PACK_SIZES/)
  assert.match(menu, /barcode/)
  assert.match(menu, /Drinks & products|productListLabel|getBarModeProfile/)
})

test('no separate bar-pos product app was reintroduced', () => {
  assert.equal(fs.existsSync(path.join(root, 'bar-pos')), false)
  assert.equal(fs.existsSync(path.join(root, 'apps/bar-pos')), false)
  const product = JSON.parse(fs.readFileSync(path.join(root, 'apps/hospitality-pos/product.json'), 'utf8'))
  assert.ok(product.modes.includes('bar_only'))
  assert.ok(product.modes.includes('restaurant_bar'))
})

test('bar-only manager surfaces use bar language and skip restaurant operations', () => {
  const control = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposBusinessControl.jsx'), 'utf8')
  const manage = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposManageHub.jsx'), 'utf8')
  const reports = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposReports.jsx'), 'utf8')
  const team = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposTeam.jsx'), 'utf8')
  const layout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hospitality-pos/HposLayout.jsx'), 'utf8')

  assert.match(control, /barOnly \? Promise\.resolve\(\[\]\) : window\.api\?\.pos\?\.getRecipes/)
  assert.match(control, /barOnly[\s\S]{0,80}Promise\.resolve\(\[\]\)[\s\S]{0,80}getRestaurantReservations/)
  assert.match(control, /Drink margin/)
  assert.match(control, /Product margin and sales contribution/)
  assert.match(control, /Schedule the next bar shift/)
  assert.match(manage, /const BAR_META/)
  assert.match(manage, /Create bar stock, receive simple deliveries, count bottles/)
  assert.match(reports, /Bar sales & control report/)
  assert.match(reports, /Counter & tab mix/)
  assert.match(team, /!barOnly && <option value="waiter">Waiter<\/option>/)
  assert.match(team, /!barOnly && <option value="kitchen">Chef<\/option>/)
  assert.match(layout, /barOnly[\s\S]{0,80}Promise\.resolve\(\[\]\)[\s\S]{0,100}getTickets/)
  assert.match(layout, /Bar sales & control reports/)
})
