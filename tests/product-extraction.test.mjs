import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'
import { HOSPITALITY_MODES, getHospitalityMode, isBarOnlyMode } from '../src/shared/propertyTypes.js'
import { ECOSYSTEM_BRAND, PRODUCT_BRANDS } from '../src/shared/brandIdentity.js'
import {
  PRODUCT_DEFINITIONS,
  createProductMismatchError,
  getProductDefinition,
  getProductMismatchMessage,
  getRoutePrefix,
  isProductCompatiblePropertyType,
  isProductRouteAllowed
} from '../src/shared/productIdentity.js'

const root = process.cwd()
const products = [
  ['lodge-camp', 'com.boroko.bookings', 'Tsa Bonno LodgingOS', 'boroko-bookings-releases', 'Tsa-Bonno-LodgingOS-'],
  ['hotel', 'com.boroko.hotel', 'Tsa Bonno HotelOS', 'boroko-hotel-releases', 'Tsa-Bonno-HotelOS-'],
  ['hospitality-pos', 'com.boroko.hospitalitypos', 'Tsa Bonno Restaurant & Bar POS', 'boroko-hospitality-pos-releases', 'Tsa-Bonno-Restaurant-Bar-POS-']
]

test('each product app has the correct installer identity', () => {
  const appIds = new Set()
  for (const [id, appId, productName, releaseRepo, artifactPrefix] of products) {
    const appDir = path.join(root, 'apps', id)
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'product.json'), 'utf8'))
    const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
    const builder = JSON.parse(fs.readFileSync(path.join(appDir, 'electron-builder.json'), 'utf8'))
    assert.equal(manifest.id, id)
    assert.equal(builder.appId, appId)
    assert.equal(builder.productName, productName)
    assert.ok(builder.artifactName.startsWith(artifactPrefix))
    assert.equal(builder.nsis.shortcutName, productName)
    assert.equal(builder.nsis.uninstallDisplayName, productName)
    assert.equal(builder.publish?.repo, releaseRepo)
    assert.ok(packageJson.scripts.build.includes(`product-app.mjs ${id} build`))
    assert.ok(packageJson.scripts.dist.includes(`product-app.mjs ${id} dist`))
    assert.ok(packageJson.scripts['dist:publish'].includes(`product-app.mjs ${id} publish`))
    appIds.add(builder.appId)
  }
  assert.equal(appIds.size, products.length)
})

test('product build configuration is injected into all Electron runtimes', () => {
  const config = fs.readFileSync(path.join(root, 'electron.vite.config.js'), 'utf8')
  const identity = fs.readFileSync(path.join(root, 'src/shared/productIdentity.js'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  assert.match(config, /__TSA_BONNO_PRODUCT__/)
  assert.match(identity, /hospitality-pos/)
  assert.match(main, /app:getProduct/)
  assert.match(setup, /PRODUCT_PROPERTY_TYPES\.map/)
})

test('product shell contract exposes brand nouns and route allowlists', () => {
  const lodge = getProductDefinition('lodge-camp')
  const hotel = getProductDefinition('hotel')
  const pos = getProductDefinition('hospitality-pos')

  assert.equal(ECOSYSTEM_BRAND.name, 'Tsa Bonno HospitalityOS')
  assert.equal(lodge.brandName, 'Tsa Bonno LodgingOS')
  assert.equal(lodge.brandName, PRODUCT_BRANDS['lodge-camp'].name)
  assert.equal(lodge.businessNoun, 'lodge')
  assert.equal(hotel.businessNoun, 'hotel')
  assert.equal(hotel.brandName, 'Tsa Bonno HotelOS')
  assert.equal(pos.brandName, 'Tsa Bonno Restaurant & Bar POS')
  // Product-level noun stays mode-neutral; Login uses bar/restaurant from hospitality_mode.
  assert.equal(pos.businessNoun, 'business')
  assert.match(pos.chooserTitle, /Restaurant or Bar/i)
  assert.match(pos.loginTagline, /POS sales|cash-up/i)
  assert.ok(Array.isArray(hotel.allowedRoutePrefixes))
  assert.ok(Array.isArray(pos.allowedRoutePrefixes))
  assert.equal(PRODUCT_DEFINITIONS.hotel.theme.id, 'hotel')
  assert.equal(PRODUCT_DEFINITIONS.hotel.theme.accent, 'ops-copper')
})

test('hotel product has an independent shell not shared with lodge Layout', () => {
  const hotelLayout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/HotelLayout.jsx'), 'utf8')
  const hotelHome = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/HotelHome.jsx'), 'utf8')
  const hotelCss = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/hotelTheme.css'), 'utf8')
  const hotelNav = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/hotelNav.js'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
  const lodgeLayout = fs.readFileSync(path.join(root, 'src/renderer/src/components/Layout.jsx'), 'utf8')

  assert.match(hotelLayout, /ht-shell/)
  assert.match(hotelLayout, /ht-sidebar/)
  assert.match(hotelLayout, /HOTEL_MORE_ITEMS/)
  assert.match(hotelLayout, /ht-nav-more/)
  assert.doesNotMatch(hotelLayout, /ht-command-strip/)
  assert.doesNotMatch(hotelLayout, /HOTEL_SHIFT_COMMANDS/)
  assert.match(hotelLayout, /dataset\.product = 'hotel'/)
  assert.match(hotelHome, /ht-home-grid|ht-kpi-row/)
  assert.match(hotelCss, /\[data-product="hotel"\]/)
  assert.match(hotelNav, /HOTEL_RAIL/)
  assert.match(hotelNav, /HOTEL_NAV_GROUPS/)
  assert.match(app, /IS_HOTEL_PRODUCT/)
  assert.match(app, /HotelLayout/)
  assert.match(app, /HotelHome/)
  // Lodge Layout must remain the green lodge shell, not hotel chrome.
  assert.match(lodgeLayout, /from-green-900|from-emerald|#0f3d2c|emerald/)
  assert.doesNotMatch(lodgeLayout, /ht-shell/)
})

test('product route allowlist blocks cross-product modules', () => {
  assert.equal(getRoutePrefix('/night-audit-enterprise'), 'night-audit-enterprise')
  assert.equal(getRoutePrefix('/hpos/floor'), 'hpos')
  assert.equal(getRoutePrefix('/'), '')

  // Restaurant product cannot open hotel enterprise surfaces.
  assert.equal(isProductRouteAllowed('/night-audit-enterprise', 'hospitality-pos'), false)
  assert.equal(isProductRouteAllowed('/bookings', 'hospitality-pos'), false)
  assert.equal(isProductRouteAllowed('/hpos/floor', 'hospitality-pos'), true)
  assert.equal(isProductRouteAllowed('/pos', 'hospitality-pos'), true)
  assert.equal(isProductRouteAllowed('/settings', 'hospitality-pos'), true)

  // Hotel product cannot open pure HPOS shell routes.
  assert.equal(isProductRouteAllowed('/hpos', 'hotel'), false)
  assert.equal(isProductRouteAllowed('/restaurant/floor', 'hotel'), false)
  assert.equal(isProductRouteAllowed('/bookings', 'hotel'), true)
  assert.equal(isProductRouteAllowed('/night-audit-enterprise', 'hotel'), true)

  // Lodge product keeps accommodation routes (live product).
  assert.equal(isProductRouteAllowed('/bookings', 'lodge-camp'), true)
  assert.equal(isProductRouteAllowed('/rooms', 'lodge-camp'), true)
  assert.equal(isProductRouteAllowed('/food-beverage/kitchen', 'lodge-camp'), true)
  assert.equal(isProductRouteAllowed('/food-beverage/kitchen', 'hotel'), false)
  assert.equal(isProductRouteAllowed('/food-beverage/kitchen', 'hospitality-pos'), false)
})

test('Lodge product exposes restaurant-grade food and beverage controls without changing its shell', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
  const hub = fs.readFileSync(path.join(root, 'src/renderer/src/components/LodgeFoodBeverageHub.jsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(root, 'src/renderer/src/components/restaurant/RestaurantWorkspace.jsx'), 'utf8')
  const access = { allowedByRole: { 'pos.view': true } }
  const lodgeRoutes = new Set(getDesktopNavItems('lodge', access, 'lodge', 'Pro').map((item) => item.to))
  const hotelRoutes = new Set(getDesktopNavItems('hotel', access, 'hotel', 'Pro').map((item) => item.to))

  assert.match(app, /food-beverage\/:workspace\?/)
  assert.match(hub, /RestaurantWorkspace/)
  assert.match(hub, /Recipes & costing/)
  assert.match(hub, /Cash & close/)
  assert.match(hub, /Tables & service/)
  assert.match(hub, /HposFloorPlan posRoute="\/pos"/)
  assert.match(hub, /RestaurantReservations/)
  assert.match(workspace, /context === 'property-outlet'/)
  assert.equal(lodgeRoutes.has('/food-beverage/kitchen'), true)
  assert.equal(hotelRoutes.has('/food-beverage/kitchen'), false)
})

test('Lodge product nav never shows locked hotel enterprise features (including motel)', () => {
  const access = { allowedByRole: new Proxy({}, { get: () => true }) }
  const hotelishLabels = [
    'Folios',
    'Room Moves',
    'Night Audit (Enterprise)',
    'Front Desk',
    'Check-in / Out',
    'Hotel Dashboard',
    'Corporate Accounts',
    'Rate Plans',
    'Channel Manager',
    'Multi-Outlet POS',
    'Group Operations'
  ]

  for (const propertyType of ['lodge', 'camp', 'guest_house', 'bnb', 'motel']) {
    for (const plan of ['Starter', 'Standard', 'Pro', 'Enterprise']) {
      const items = getDesktopNavItems('lodge', access, propertyType, plan, [], null, 'lodge-camp')
      const lockedHotel = items.filter((item) => item.isLocked && (
        item.group === 'Hotel' || hotelishLabels.includes(item.label)
      ))
      assert.equal(
        lockedHotel.length,
        0,
        `lodge-camp product must not show locked hotel nav for ${propertyType}+${plan}: ${lockedHotel.map((i) => i.label).join(', ')}`
      )
      for (const label of ['Folios', 'Room Moves', 'Night Audit (Enterprise)', 'Front Desk', 'Check-in / Out']) {
        assert.equal(
          items.some((item) => item.label === label),
          false,
          `lodge-camp product must hide hotel-only "${label}" for ${propertyType}+${plan}`
        )
      }
    }
  }

  // Without product scoping, motel still exposes locked hotel items (legacy property-type path).
  const legacyMotel = getDesktopNavItems('lodge', access, 'motel', 'Pro', [])
  assert.ok(
    legacyMotel.some((item) => item.isLocked && item.group === 'Hotel'),
    'property-type motel path without productId still exposes locked Hotel items for catalog tests'
  )

  const layout = fs.readFileSync(path.join(root, 'src/renderer/src/components/Layout.jsx'), 'utf8')
  assert.match(layout, /IS_LODGE_PRODUCT/)
  assert.match(layout, /BUILD_PRODUCT\.id/)
  assert.match(layout, /getDesktopNavItems\(/)
})

test('product identity prevents a saved restaurant profile from opening in hotel or lodge builds', () => {
  const authLogin = fs.readFileSync(path.join(root, 'src/main/domains/authLogin.js'), 'utf8')
  const authSession = fs.readFileSync(path.join(root, 'src/main/domains/authSession.js'), 'utf8')
  const authUsers = fs.readFileSync(path.join(root, 'src/main/domains/authUsers.js'), 'utf8')
  const login = fs.readFileSync(path.join(root, 'src/renderer/src/components/Login.jsx'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
  const membershipMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260711201000_product_membership_login.sql'), 'utf8')
  assert.equal(isProductCompatiblePropertyType('hotel', 'restaurant'), false)
  assert.equal(isProductCompatiblePropertyType('lodge-camp', 'restaurant'), false)
  assert.equal(isProductCompatiblePropertyType('hospitality-pos', 'restaurant'), true)
  assert.equal(isProductCompatiblePropertyType('hotel', 'hotel'), true)
  assert.equal(isProductCompatiblePropertyType('lodge-camp', 'camp'), true)
  assert.match(authLogin, /assertAuthenticatedLodgeMatchesCurrentProduct/)
  assert.match(authLogin, /assertOfflineSessionMatchesCurrentProduct/)
  assert.match(authLogin, /list_desktop_product_memberships/)
  assert.match(authSession, /assertCachedSettingsMatchCurrentProduct/)
  assert.match(authSession, /product_profile_mismatch/)
  assert.match(app, /ProductShellGuard/)
  assert.match(login, /company_selection_required/)
  assert.match(login, /Which company are you working in\?/)
  // Product membership boundary lives in resolve_product_family (motel -> lodge-camp).
  const pwaMembershipMigration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260712200000_manager_pwa_product_memberships.sql'),
    'utf8'
  )
  assert.match(membershipMigration, /list_desktop_product_memberships/)
  assert.match(pwaMembershipMigration, /list_desktop_product_memberships/)
  assert.match(pwaMembershipMigration, /resolve_product_family/)
  assert.match(pwaMembershipMigration, /when 'motel' then 'lodge-camp'/)
  assert.match(pwaMembershipMigration, /when 'restaurant' then 'hospitality-pos'/)
  assert.doesNotMatch(authUsers, /Each admin email can only be registered to one lodge/)
  const mismatch = createProductMismatchError('hospitality-pos', 'hotel')
  assert.equal(mismatch.code, 'product_profile_mismatch')
  assert.match(getProductMismatchMessage('hotel', 'restaurant'), /Restaurant & Bar POS/)
})

test('Hospitality POS persists Bar Only as an explicit operating mode', () => {
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  assert.equal(getHospitalityMode({ operating_profile: {} }), HOSPITALITY_MODES.RESTAURANT_BAR)
  assert.equal(isBarOnlyMode({ operating_profile: { hospitality_mode: 'bar_only' } }), true)
  assert.match(setup, /hospitality_mode: IS_HOSPITALITY_POS_PRODUCT \? hospitalityMode : null/)
  // Step 1 must offer an explicit Bar registration path (not restaurant-only).
  assert.match(setup, /label: 'Bar'/)
  assert.match(setup, /HOSPITALITY_MODES\.BAR_ONLY/)
  assert.match(setup, /buildHospitalityOperatingProfile/)
  // Mode is a priced product choice — no free switch after setup.
  assert.doesNotMatch(setup, /upgrade from Bar Only later/i)
  assert.match(setup, /cannot be changed later|different pricing/i)
})

test('hotel setup uses hotel copper chrome and hotel nouns, not lodge green copy', () => {
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  const chrome = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/hotelChrome.js'), 'utf8')
  const login = fs.readFileSync(path.join(root, 'src/renderer/src/components/Login.jsx'), 'utf8')
  const welcome = fs.readFileSync(path.join(root, 'src/renderer/src/components/Welcome.jsx'), 'utf8')
  const chooser = fs.readFileSync(path.join(root, 'src/renderer/src/components/LodgeChooser.jsx'), 'utf8')
  assert.match(setup, /IS_HOTEL_PRODUCT/)
  assert.match(setup, /Set up your hotel/)
  assert.match(setup, /Hotel name \*/)
  assert.match(setup, /hotel chooser/)
  assert.match(setup, /reservations@yourhotel\.com/)
  assert.match(setup, /HOTEL_CHROME/)
  assert.match(setup, /HOTEL_OPERATING_QUESTIONS/)
  // Shared ops-first tokens used by onboarding surfaces.
  assert.match(chrome, /#b8734a/)
  assert.match(chrome, /#f0ebe4|#f7f3ed/)
  assert.match(chrome, /Front desk · Operations/)
  assert.match(login, /HOTEL_CHROME/)
  assert.match(welcome, /HOTEL_CHROME/)
  assert.match(chooser, /HOTEL_CHROME/)
  // Lodge green remains only in the lodge theme branch.
  assert.match(setup, /from-green-900 via-green-800 to-green-700/)
})

test('hotel shell uses ops-first tokens (Lodge layout + hotel copper palette)', () => {
  const css = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/hotelTheme.css'), 'utf8')
  const layout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/HotelLayout.jsx'), 'utf8')
  const home = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/HotelHome.jsx'), 'utf8')
  assert.match(css, /Ops-first/)
  assert.match(css, /#f0ebe4|#f7f3ed|#f3ebe0/)
  assert.match(css, /#b8734a/)
  assert.match(css, /ht-sidebar/)
  assert.doesNotMatch(css, /Cormorant Garamond/)
  assert.doesNotMatch(css, /Editorial Boutique/)
  assert.match(layout, /ht-sidebar/)
  assert.match(layout, /ht-main-col/)
  assert.doesNotMatch(layout, /Property Atelier/)
  assert.doesNotMatch(layout, /ht-frame/)
  assert.match(home, /ht-kpi-row/)
  assert.match(home, /ht-home-grid/)
  assert.match(home, /Arrivals|front-desk|Front-desk|occupancy/i)
  assert.doesNotMatch(home, /harmony|Atelier Notes|ht-greeting/)
})

test('Electron window captions use complete product names instead of property acronyms', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')
  const hotelLayout = fs.readFileSync(path.join(root, 'src/renderer/src/components/hotel/HotelLayout.jsx'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'src/renderer/src/index.css'), 'utf8')
  assert.match(app, /document\.title = BUILD_PRODUCT\.name/)
  assert.match(app, /titlebar\.textContent = BUILD_PRODUCT\.name/)
  assert.match(hotelLayout, /document\.title = HOTEL_BRAND_NAME/)
  assert.match(main, /titleBarStyle: 'hidden'/)
  assert.match(main, /titleBarOverlay:/)
  assert.match(main, /PRODUCT_TITLE_BAR_COLORS\[BUILD_PRODUCT_ID\]/)
  assert.match(css, /\.app-window-titlebar/)
  assert.match(css, /html\[data-product="hotel"\] \.app-window-titlebar/)
  assert.match(css, /html\[data-product="hospitality-pos"\] \.app-window-titlebar/)
  assert.match(css, /-webkit-app-region: drag/)
  const hposCss = fs.readFileSync(path.join(root, 'src/renderer/src/styles/hospitality-pos.css'), 'utf8')
  assert.match(hposCss, /html\.has-app-window-titlebar \.hpos-app-shell\s*\{[^}]*height: calc\(100dvh - 36px\)/s)
  assert.doesNotMatch(hotelLayout, /settings\?\.lodge_name\s*\?\s*`\$\{settings\.lodge_name\}/)
})

test('Bar Only hides restaurant-only navigation while preserving core POS operations', () => {
  const access = { allowedByRole: { 'pos.view': true, 'pos.manage': true, 'pos.cashup': true, 'inventory.view': true, 'staff.view': true, 'reports.view': true } }
  const items = getDesktopNavItems('restaurant', access, 'restaurant', 'Pro', [], { hospitality_mode: 'bar_only' })
  const routes = new Set(items.map((item) => item.to))
  assert.equal(routes.has('/pos'), true)
  assert.equal(routes.has('/restaurant/stock-purchasing'), true)
  assert.equal(routes.has('/restaurant/cash-close'), true)
  assert.equal(routes.has('/restaurant/floor'), false)
  assert.equal(routes.has('/restaurant/kitchen-workspace'), false)
  assert.equal(routes.has('/restaurant/menu-production'), false)
})

test('all product company choosers use a neutral Sign In action', () => {
  const chooser = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'LodgeChooser.jsx'), 'utf8')
  assert.doesNotMatch(chooser, /Command Central Sign In/)
  assert.match(chooser, />\s*Sign In\s*</)
})

test('marketing download script maps products to isolated release feeds', () => {
  const script = fs.readFileSync(path.join(root, 'marketing-site/script.js'), 'utf8')
  assert.match(script, /boroko-bookings-releases/)
  assert.match(script, /boroko-hotel-releases/)
  assert.match(script, /boroko-hospitality-pos-releases/)
  assert.match(script, /detectProductId/)
  assert.match(script, /data-product/)
})
