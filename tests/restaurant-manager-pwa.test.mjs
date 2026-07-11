import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

describe('Phase 5: Manager PWA Restaurant Owner Experience', () => {

  describe('5.1 Restaurant Owner page exists', () => {
    it('RestaurantOwner.jsx page file exists', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.length > 100, 'RestaurantOwner page exists')
    })

    it('page shows restaurant-only guard', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('restaurantMode'), 'has restaurantMode check')
      assert.ok(content.includes('restaurant properties only'), 'shows non-restaurant message')
    })

    it('page shows POS sales KPI', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('POS Sales'), 'shows POS Sales KPI')
    })

    it('page shows orders count', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('Orders'), 'shows Orders KPI')
    })

    it('page shows outstanding balance', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('Outstanding'), 'shows Outstanding KPI')
    })

    it('page shows low stock count', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('Low Stock'), 'shows Low Stock KPI')
    })

    it('page shows payment mix', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('Payment Mix'), 'shows Payment Mix section')
    })

    it('page uses Supabase RPCs, not desktop window.api', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(!content.includes('window.api'), 'does not use window.api')
      assert.ok(content.includes('getManagerPosSnapshot'), 'uses PWA API function')
    })

    it('page has stale data indicator', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(content.includes('DataFreshness') || content.includes('lastUpdated'), 'has data freshness')
    })
  })

  describe('5.2 Route and lazy import wired', () => {
    it('RestaurantOwner is lazy-imported in App.jsx', () => {
      const app = read('manager-pwa/src/App.jsx')
      assert.ok(app.includes("import('./pages/RestaurantOwner')"), 'lazy import exists')
    })

    it('restaurant-owner route exists in App.jsx', () => {
      const app = read('manager-pwa/src/App.jsx')
      assert.ok(app.includes('/restaurant-owner'), 'route exists')
    })

    it('route renders RestaurantOwner component', () => {
      const app = read('manager-pwa/src/App.jsx')
      assert.ok(app.includes('<RestaurantOwner />'), 'renders RestaurantOwner')
    })
  })

  describe('5.3 Dashboard quick link', () => {
    it('Dashboard has Owner View quick link for restaurant mode', () => {
      const dash = read('manager-pwa/src/pages/Dashboard.jsx')
      assert.ok(dash.includes('/restaurant-owner'), 'links to restaurant-owner')
      assert.ok(dash.includes('Owner View'), 'labeled Owner View')
    })

    it('Owner View link is gated on restaurantMode', () => {
      const dash = read('manager-pwa/src/pages/Dashboard.jsx')
      const idx = dash.indexOf('/restaurant-owner')
      const context = dash.slice(Math.max(0, idx - 200), idx)
      assert.ok(context.includes('restaurantMode'), 'gated on restaurantMode')
    })

    it('Utensils icon is imported', () => {
      const dash = read('manager-pwa/src/pages/Dashboard.jsx')
      assert.ok(dash.includes('Utensils'), 'Utensils icon imported')
    })
  })

  describe('5.4 Module catalog entry', () => {
    it('restaurant_owner module exists in moduleCatalog.js', () => {
      const catalog = read('src/shared/moduleCatalog.js')
      assert.ok(catalog.includes("key: 'restaurant_owner'"), 'module key exists')
    })

    it('restaurant_owner module is restaurant-only', () => {
      const catalog = read('src/shared/moduleCatalog.js')
      const idx = catalog.indexOf("'restaurant_owner'")
      const chunk = catalog.slice(idx, idx + 500)
      assert.ok(chunk.includes("'restaurant'"), 'restaurant-only allowedPropertyTypes')
    })

    it('restaurant_owner module is Pro plan', () => {
      const catalog = read('src/shared/moduleCatalog.js')
      const idx = catalog.indexOf("'restaurant_owner'")
      const chunk = catalog.slice(idx, idx + 500)
      assert.ok(chunk.includes("requiredPlan: 'Pro'"), 'requires Pro plan')
    })

    it('restaurant_owner module does not expose accommodation routes', () => {
      const catalog = read('src/shared/moduleCatalog.js')
      const idx = catalog.indexOf("'restaurant_owner'")
      const chunk = catalog.slice(idx, idx + 500)
      assert.ok(!chunk.includes('/bookings'), 'no bookings route')
      assert.ok(!chunk.includes('/rooms'), 'no rooms route')
    })
  })

  describe('5.5 No accommodation terminology for restaurant users', () => {
    it('RestaurantOwner page has no hotel/lodge terminology', () => {
      const content = read('manager-pwa/src/pages/RestaurantOwner.jsx')
      assert.ok(!content.includes('Room'), 'no Room reference')
      assert.ok(!content.includes('Booking'), 'no Booking reference')
      assert.ok(!content.includes('Check-in'), 'no Check-in reference')
      assert.ok(!content.includes('Check-out'), 'no Check-out reference')
      assert.ok(!content.includes('Guest'), 'no Guest reference')
    })
  })
})
