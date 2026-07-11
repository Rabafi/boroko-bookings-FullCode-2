import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ── Restaurant component files exist ─────────────────────────────────────────

const RESTAURANT_COMPONENTS = [
  'src/renderer/src/components/restaurant/RestaurantTables.jsx',
  'src/renderer/src/components/restaurant/RestaurantKitchen.jsx',
  'src/renderer/src/components/restaurant/RestaurantMenu.jsx',
  'src/renderer/src/components/restaurant/RestaurantRecipes.jsx',
  'src/renderer/src/components/restaurant/RestaurantStock.jsx',
  'src/renderer/src/components/restaurant/RestaurantPurchasing.jsx',
  'src/renderer/src/components/restaurant/RestaurantShifts.jsx',
  'src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx',
  'src/renderer/src/components/restaurant/RestaurantDailyClose.jsx',
  'src/renderer/src/components/restaurant/RestaurantCustomers.jsx',
  'src/renderer/src/components/restaurant/RestaurantChecklists.jsx',
  'src/renderer/src/components/restaurant/RestaurantAlerts.jsx',
  'src/renderer/src/components/restaurant/RestaurantOwnerDigest.jsx'
]

for (const file of RESTAURANT_COMPONENTS) {
  const name = path.basename(file, '.jsx')
  test(`${name} file exists`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} not found`)
  })
}

// ── Each component uses correct APIs ─────────────────────────────────────────

test('RestaurantTables uses getTablesWithStatus', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantTables.jsx')
  assert.match(src, /getTablesWithStatus/)
})

test('RestaurantKitchen uses getTickets and updateTicketStatus', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantKitchen.jsx')
  assert.match(src, /getTickets/)
  assert.match(src, /updateTicketStatus/)
})

test('RestaurantMenu uses getModifierGroups', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantMenu.jsx')
  assert.match(src, /getModifierGroups/)
})

test('RestaurantRecipes uses getRecipes', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantRecipes.jsx')
  assert.match(src, /getRecipes/)
})

test('RestaurantStock uses inventory APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantStock.jsx')
  assert.match(src, /getItems/)
  assert.match(src, /getLowStock/)
})

test('RestaurantPurchasing uses supplier and PO APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantPurchasing.jsx')
  assert.match(src, /getSuppliers/)
  assert.match(src, /approvePurchaseOrder/)
  assert.match(src, /receivePurchaseOrder/)
})

test('RestaurantShifts uses clock-in/out APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantShifts.jsx')
  assert.match(src, /getActiveShifts/)
  assert.match(src, /clockInStaff/)
  assert.match(src, /clockOutStaff/)
})

test('RestaurantCashDrawer uses cash drawer APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx')
  assert.match(src, /getOpenCashDrawer/)
  assert.match(src, /openCashDrawerSession/)
  assert.match(src, /closeCashDrawerSession/)
})

test('RestaurantDailyClose uses multiple status APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantDailyClose.jsx')
  assert.match(src, /getTables/)
  assert.match(src, /getTickets/)
  assert.match(src, /getOpenCashDrawer/)
  assert.match(src, /getActiveShifts/)
  assert.match(src, /getActiveAlerts/)
  assert.match(src, /generateOwnerDigest/)
})

test('RestaurantCustomers uses customer and loyalty APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantCustomers.jsx')
  assert.match(src, /getCustomers/)
})

test('RestaurantChecklists uses checklist APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantChecklists.jsx')
  assert.match(src, /createChecklist/)
  assert.match(src, /completeChecklistItem/)
})

test('RestaurantAlerts uses alert APIs', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantAlerts.jsx')
  assert.match(src, /getActiveAlerts/)
  assert.match(src, /resolveAlert/)
})

test('RestaurantOwnerDigest uses generateOwnerDigest', () => {
  const src = read('src/renderer/src/components/restaurant/RestaurantOwnerDigest.jsx')
  assert.match(src, /generateOwnerDigest/)
})

// ── No restaurant component calls accommodation APIs ─────────────────────────

const ACCOMMODATION_APIS = [
  'window.api.bookings',
  'window.api.rooms',
  'window.api.guests',
  'window.api.housekeeping',
  'window.api.conference',
  'window.api.dayuse'
]

for (const file of RESTAURANT_COMPONENTS) {
  const name = path.basename(file, '.jsx')
  for (const api of ACCOMMODATION_APIS) {
    test(`${name} does not call ${api}`, () => {
      const src = read(file)
      assert.ok(!src.includes(api), `${name} should not reference ${api}`)
    })
  }
}

// ── App.jsx has restaurant routes ────────────────────────────────────────────

test('App.jsx has RestaurantOnlyRoute guard', () => {
  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /function RestaurantOnlyRoute/)
})

test('App.jsx has all restaurant routes', () => {
  const app = read('src/renderer/src/App.jsx')
  const routes = [
    'restaurant/tables',
    'restaurant/kitchen',
    'restaurant/menu',
    'restaurant/recipes',
    'restaurant/stock',
    'restaurant/purchasing',
    'restaurant/shifts',
    'restaurant/cash-drawer',
    'restaurant/daily-close',
    'restaurant/customers',
    'restaurant/checklists',
    'restaurant/alerts',
    'restaurant/owner-digest'
  ]
  for (const route of routes) {
    assert.match(app, new RegExp(route), `Missing route: ${route}`)
  }
})

test('App.jsx wraps restaurant routes with RestaurantOnlyRoute', () => {
  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /path="restaurant\/tables"[\s\S]*RestaurantOnlyRoute/)
})

// ── Navigation has restaurant-specific items ─────────────────────────────────

test('desktopNav.js has restaurant-only nav items', () => {
  const nav = read('src/renderer/src/navigation/desktopNav.js')
  const restaurantRoutes = [
    '/restaurant/floor',
    '/restaurant/kitchen-workspace',
    '/restaurant/menu-production',
    '/restaurant/stock-purchasing',
    '/restaurant/team',
    '/restaurant/cash-close',
    '/restaurant/customers',
    '/restaurant/control'
  ]
  for (const route of restaurantRoutes) {
    assert.match(nav, new RegExp(route.replace('/', '\\/')), `Missing nav entry for ${route}`)
  }
})

test('desktopNav.js restaurant items have types: restaurant', () => {
  const nav = read('src/renderer/src/navigation/desktopNav.js')
  assert.match(nav, /to: '\/restaurant\/floor'[\s\S]*types: \['restaurant'\]/)
  assert.match(nav, /to: '\/restaurant\/kitchen-workspace'[\s\S]*types: \['restaurant'\]/)
  assert.match(nav, /to: '\/restaurant\/cash-close'[\s\S]*types: \['restaurant'\]/)
})

test('Night Audit is lodge-only in restaurant mode', () => {
  const nav = read('src/renderer/src/navigation/desktopNav.js')
  assert.match(nav, /to: '\/audit'[\s\S]*types: \['lodge'\]/)
})

// ── Dashboard does not load accommodation data ───────────────────────────────

test('Dashboard.jsx does not call accommodation APIs in restaurant mode', () => {
  const src = read('src/renderer/src/components/Dashboard.jsx')
  assert.match(src, /restaurantMode/)
  assert.ok(!src.includes('getBookings') || src.includes('restaurantMode'), 'Dashboard should guard accommodation calls')
})
