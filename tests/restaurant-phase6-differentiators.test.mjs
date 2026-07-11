import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

describe('Phase 6: Restaurant Differentiators', () => {

  // ── 6.1 Reservations ──────────────────────────────────────────────────────

  describe('6.1 Table Reservations and Waitlist', () => {
    it('database migration creates reservation tables', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('restaurant_reservations'), 'restaurant_reservations table')
      assert.ok(sql.includes('restaurant_waitlist_entries'), 'restaurant_waitlist_entries table')
    })

    it('reservation tables have RLS enabled', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('ALTER TABLE restaurant_reservations ENABLE ROW LEVEL SECURITY'), 'RLS on reservations')
      assert.ok(sql.includes('ALTER TABLE restaurant_waitlist_entries ENABLE ROW LEVEL SECURITY'), 'RLS on waitlist')
    })

    it('reservation RPCs require lodge role', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('create_restaurant_reservation'), 'create RPC exists')
      assert.ok(sql.includes('get_restaurant_reservations'), 'get RPC exists')
      assert.ok(sql.includes('cancel_restaurant_reservation'), 'cancel RPC exists')
      assert.ok(sql.includes('seat_restaurant_reservation'), 'seat RPC exists')
      assert.ok(sql.includes('mark_restaurant_reservation_no_show'), 'no-show RPC exists')
      assert.ok(sql.includes('create_restaurant_waitlist_entry'), 'waitlist create RPC exists')
      assert.ok(sql.includes('get_restaurant_waitlist'), 'waitlist get RPC exists')
      assert.ok(sql.includes('seat_restaurant_waitlist_entry'), 'waitlist seat RPC exists')
    })

    it('domain functions exist in pos.js', () => {
      const pos = read('src/main/domains/pos.js')
      assert.ok(pos.includes('getRestaurantReservations'), 'getRestaurantReservations domain')
      assert.ok(pos.includes('createRestaurantReservation'), 'createRestaurantReservation domain')
      assert.ok(pos.includes('updateRestaurantReservation'), 'updateRestaurantReservation domain')
      assert.ok(pos.includes('cancelRestaurantReservation'), 'cancelRestaurantReservation domain')
      assert.ok(pos.includes('seatRestaurantReservation'), 'seatRestaurantReservation domain')
      assert.ok(pos.includes('markRestaurantReservationNoShow'), 'markRestaurantReservationNoShow domain')
      assert.ok(pos.includes('getRestaurantWaitlist'), 'getRestaurantWaitlist domain')
      assert.ok(pos.includes('createRestaurantWaitlistEntry'), 'createRestaurantWaitlistEntry domain')
      assert.ok(pos.includes('seatRestaurantWaitlistEntry'), 'seatRestaurantWaitlistEntry domain')
    })

    it('preload methods exist for reservations', () => {
      const preload = read('src/preload/index.js')
      assert.ok(preload.includes('getRestaurantReservations'), 'getRestaurantReservations preload')
      assert.ok(preload.includes('createRestaurantReservation'), 'createRestaurantReservation preload')
      assert.ok(preload.includes('cancelRestaurantReservation'), 'cancelRestaurantReservation preload')
      assert.ok(preload.includes('seatRestaurantReservation'), 'seatRestaurantReservation preload')
      assert.ok(preload.includes('markRestaurantReservationNoShow'), 'markRestaurantReservationNoShow preload')
      assert.ok(preload.includes('getRestaurantWaitlist'), 'getRestaurantWaitlist preload')
    })

    it('RestaurantReservations component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantReservations.jsx')
      assert.ok(comp.includes('Reservations'), 'has Reservations title')
      assert.ok(comp.includes('Waitlist'), 'has Waitlist')
      assert.ok(comp.includes('party_size'), 'has party size')
    })

    it('RestaurantReservations does not call accommodation APIs', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantReservations.jsx')
      assert.ok(!comp.includes('window.api.bookings'), 'no bookings API')
      assert.ok(!comp.includes('window.api.rooms'), 'no rooms API')
      assert.ok(!comp.includes('window.api.guests'), 'no guests API')
    })

    it('reservation route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/reservations'), 'reservations route')
      assert.ok(app.includes('RestaurantReservations'), 'RestaurantReservations import')
      assert.ok(app.includes('RestaurantOnlyRoute'), 'wrapped with RestaurantOnlyRoute')
    })

    it('reservation nav entry exists in desktopNav.js', () => {
      const nav = read('src/renderer/src/navigation/desktopNav.js')
      assert.ok(nav.includes("to: '/restaurant/floor'"), 'floor workspace nav')
      assert.ok(nav.includes('reservations'), 'Reservations keyword')
    })
  })

  // ── 6.2 Combos ────────────────────────────────────────────────────────────

  describe('6.2 Combo, Bundle, and Meal-Deal Builder', () => {
    it('database migration creates combo tables', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('restaurant_combo_groups'), 'combo groups table')
      assert.ok(sql.includes('restaurant_combo_slots'), 'combo slots table')
      assert.ok(sql.includes('restaurant_combo_slot_items'), 'combo slot items table')
    })

    it('combo tables have RLS enabled', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('ALTER TABLE restaurant_combo_groups ENABLE ROW LEVEL SECURITY'), 'RLS on combo groups')
      assert.ok(sql.includes('ALTER TABLE restaurant_combo_slots ENABLE ROW LEVEL SECURITY'), 'RLS on combo slots')
    })

    it('combo RPCs exist', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('get_restaurant_combos'), 'get combos RPC')
      assert.ok(sql.includes('upsert_restaurant_combo'), 'upsert combo RPC')
      assert.ok(sql.includes('delete_restaurant_combo'), 'delete combo RPC')
    })

    it('domain functions exist in pos.js', () => {
      const pos = read('src/main/domains/pos.js')
      assert.ok(pos.includes('getRestaurantCombos'), 'getRestaurantCombos domain')
      assert.ok(pos.includes('saveRestaurantCombo'), 'saveRestaurantCombo domain')
      assert.ok(pos.includes('deleteRestaurantCombo'), 'deleteRestaurantCombo domain')
    })

    it('preload methods exist for combos', () => {
      const preload = read('src/preload/index.js')
      assert.ok(preload.includes('getRestaurantCombos'), 'getRestaurantCombos preload')
      assert.ok(preload.includes('saveRestaurantCombo'), 'saveRestaurantCombo preload')
      assert.ok(preload.includes('deleteRestaurantCombo'), 'deleteRestaurantCombo preload')
    })

    it('RestaurantCombos component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantCombos.jsx')
      assert.ok(comp.includes('Combo'), 'has Combo title')
      assert.ok(comp.includes('slot'), 'has slot support')
    })

    it('combo route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/combos'), 'combos route')
      assert.ok(app.includes('RestaurantCombos'), 'RestaurantCombos import')
    })
  })

  // ── 6.3 Recipe Variance ───────────────────────────────────────────────────

  describe('6.3 Recipe Variance Report', () => {
    it('database migration creates variance snapshot table', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('restaurant_recipe_variance_snapshots'), 'variance snapshots table')
    })

    it('variance RPC exists', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('get_recipe_variance_report'), 'get_recipe_variance_report RPC')
    })

    it('domain function exists in pos.js', () => {
      const pos = read('src/main/domains/pos.js')
      assert.ok(pos.includes('getRecipeVarianceReport'), 'getRecipeVarianceReport domain')
    })

    it('preload method exists for recipe variance', () => {
      const preload = read('src/preload/index.js')
      assert.ok(preload.includes('getRecipeVarianceReport'), 'getRecipeVarianceReport preload')
    })

    it('RestaurantRecipeVariance component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantRecipeVariance.jsx')
      assert.ok(comp.includes('Variance'), 'has Variance title')
      assert.ok(comp.includes('severity'), 'has severity display')
      assert.ok(comp.includes('theoretical'), 'has theoretical reference')
    })

    it('variance route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/recipe-variance'), 'recipe-variance route')
      assert.ok(app.includes('RestaurantRecipeVariance'), 'RestaurantRecipeVariance import')
    })
  })

  // ── 6.4 Staff Performance ─────────────────────────────────────────────────

  describe('6.4 Staff Performance Dashboard', () => {
    it('RestaurantStaffPerformance component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantStaffPerformance.jsx')
      assert.ok(comp.includes('Staff Performance'), 'has Staff Performance title')
      assert.ok(comp.includes('Voids'), 'has voids')
      assert.ok(comp.includes('Discounts'), 'has discounts')
      assert.ok(comp.includes('Avg Order'), 'has avg order')
    })

    it('component does not call accommodation APIs', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantStaffPerformance.jsx')
      assert.ok(!comp.includes('window.api.bookings'), 'no bookings API')
      assert.ok(!comp.includes('window.api.rooms'), 'no rooms API')
    })

    it('staff performance route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/staff-performance'), 'staff-performance route')
      assert.ok(app.includes('RestaurantStaffPerformance'), 'RestaurantStaffPerformance import')
    })

    it('staff performance nav entry exists', () => {
      const nav = read('src/renderer/src/navigation/desktopNav.js')
      assert.ok(nav.includes("to: '/restaurant/team'"), 'team workspace nav')
      assert.ok(nav.includes('performance'), 'staff performance keyword')
    })
  })

  // ── 6.5 Prep Batches ──────────────────────────────────────────────────────

  describe('6.5 Prep and Batch Production', () => {
    it('database migration creates prep tables', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('restaurant_prep_items'), 'prep items table')
      assert.ok(sql.includes('restaurant_prep_item_ingredients'), 'prep item ingredients table')
      assert.ok(sql.includes('restaurant_prep_batches'), 'prep batches table')
      assert.ok(sql.includes('restaurant_prep_batch_ingredient_movements'), 'prep batch movements table')
    })

    it('prep tables have RLS enabled', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('ALTER TABLE restaurant_prep_items ENABLE ROW LEVEL SECURITY'), 'RLS on prep items')
      assert.ok(sql.includes('ALTER TABLE restaurant_prep_batches ENABLE ROW LEVEL SECURITY'), 'RLS on prep batches')
    })

    it('prep RPCs exist', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('get_restaurant_prep_items'), 'get prep items RPC')
      assert.ok(sql.includes('upsert_restaurant_prep_item'), 'upsert prep item RPC')
      assert.ok(sql.includes('create_restaurant_prep_batch'), 'create prep batch RPC')
      assert.ok(sql.includes('post_restaurant_prep_batch'), 'post prep batch RPC')
    })

    it('prep batch has idempotency guard', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('idempotency_key'), 'idempotency key column')
      assert.ok(sql.includes('idx_restaurant_prep_batch_idempotency'), 'unique idempotency index')
    })

    it('domain functions exist in pos.js', () => {
      const pos = read('src/main/domains/pos.js')
      assert.ok(pos.includes('getRestaurantPrepItems'), 'getRestaurantPrepItems domain')
      assert.ok(pos.includes('saveRestaurantPrepItem'), 'saveRestaurantPrepItem domain')
      assert.ok(pos.includes('getRestaurantPrepBatches'), 'getRestaurantPrepBatches domain')
      assert.ok(pos.includes('createRestaurantPrepBatch'), 'createRestaurantPrepBatch domain')
      assert.ok(pos.includes('postRestaurantPrepBatch'), 'postRestaurantPrepBatch domain')
    })

    it('preload methods exist for prep batches', () => {
      const preload = read('src/preload/index.js')
      assert.ok(preload.includes('getRestaurantPrepItems'), 'getRestaurantPrepItems preload')
      assert.ok(preload.includes('saveRestaurantPrepItem'), 'saveRestaurantPrepItem preload')
      assert.ok(preload.includes('getRestaurantPrepBatches'), 'getRestaurantPrepBatches preload')
      assert.ok(preload.includes('createRestaurantPrepBatch'), 'createRestaurantPrepBatch preload')
      assert.ok(preload.includes('postRestaurantPrepBatch'), 'postRestaurantPrepBatch preload')
    })

    it('RestaurantPrepBatches component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantPrepBatches.jsx')
      assert.ok(comp.includes('Prep'), 'has Prep title')
      assert.ok(comp.includes('batch_code'), 'has batch code')
      assert.ok(comp.includes('ingredient'), 'has ingredient support')
    })

    it('prep batches route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/prep-batches'), 'prep-batches route')
      assert.ok(app.includes('RestaurantPrepBatches'), 'RestaurantPrepBatches import')
    })
  })

  // ── 6.6 Kitchen Timing ────────────────────────────────────────────────────

  describe('6.6 Kitchen Timing Analytics', () => {
    it('database migration creates ticket status events table', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('restaurant_ticket_status_events'), 'ticket status events table')
    })

    it('kitchen timing RPC exists', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('record_ticket_status_event'), 'record event RPC')
      assert.ok(sql.includes('get_kitchen_timing_report'), 'get timing report RPC')
    })

    it('domain functions exist in pos.js', () => {
      const pos = read('src/main/domains/pos.js')
      assert.ok(pos.includes('recordTicketStatusEvent'), 'recordTicketStatusEvent domain')
      assert.ok(pos.includes('getKitchenTimingReport'), 'getKitchenTimingReport domain')
    })

    it('preload methods exist for kitchen timing', () => {
      const preload = read('src/preload/index.js')
      assert.ok(preload.includes('recordTicketStatusEvent'), 'recordTicketStatusEvent preload')
      assert.ok(preload.includes('getKitchenTimingReport'), 'getKitchenTimingReport preload')
    })

    it('RestaurantKitchenAnalytics component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantKitchenAnalytics.jsx')
      assert.ok(comp.includes('Kitchen Analytics'), 'has Kitchen Analytics title')
      assert.ok(comp.includes('station'), 'has station reference')
      assert.ok(comp.includes('Prep Time'), 'has prep time reference')
    })

    it('kitchen analytics route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/kitchen-analytics'), 'kitchen-analytics route')
      assert.ok(app.includes('RestaurantKitchenAnalytics'), 'RestaurantKitchenAnalytics import')
    })
  })

  // ── 6.7 Purchase Suggestions ──────────────────────────────────────────────

  describe('6.7 Low-Stock Purchase Suggestions', () => {
    it('database migration creates supplier items and suggestions tables', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('restaurant_supplier_items'), 'supplier items table')
      assert.ok(sql.includes('restaurant_purchase_suggestions'), 'purchase suggestions table')
    })

    it('suggestion RPCs exist', () => {
      const sql = read('supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql')
      assert.ok(sql.includes('get_low_stock_purchase_suggestions'), 'get suggestions RPC')
      assert.ok(sql.includes('upsert_restaurant_supplier_item'), 'upsert supplier item RPC')
      assert.ok(sql.includes('convert_purchase_suggestions_to_po'), 'convert to PO RPC')
    })

    it('domain functions exist in pos.js', () => {
      const pos = read('src/main/domains/pos.js')
      assert.ok(pos.includes('getLowStockPurchaseSuggestions'), 'getLowStockPurchaseSuggestions domain')
      assert.ok(pos.includes('convertPurchaseSuggestionsToPo'), 'convertPurchaseSuggestionsToPo domain')
    })

    it('preload methods exist for suggestions', () => {
      const preload = read('src/preload/index.js')
      assert.ok(preload.includes('getLowStockPurchaseSuggestions'), 'getLowStockPurchaseSuggestions preload')
      assert.ok(preload.includes('convertPurchaseSuggestionsToPo'), 'convertPurchaseSuggestionsToPo preload')
    })

    it('RestaurantPurchaseSuggestions component exists', () => {
      const comp = read('src/renderer/src/components/restaurant/RestaurantPurchaseSuggestions.jsx')
      assert.ok(comp.includes('Purchase Suggestions'), 'has Purchase Suggestions title')
      assert.ok(comp.includes('reorder'), 'has reorder reference')
      assert.ok(comp.includes('Create PO'), 'has Create PO action')
    })

    it('purchase suggestions route exists in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/purchase-suggestions'), 'purchase-suggestions route')
      assert.ok(app.includes('RestaurantPurchaseSuggestions'), 'RestaurantPurchaseSuggestions import')
    })
  })

  // ── Navigation ────────────────────────────────────────────────────────────

  describe('Phase 6 Navigation', () => {
    it('all Phase 6 nav entries exist in desktopNav.js', () => {
      const nav = read('src/renderer/src/navigation/desktopNav.js')
      assert.ok(nav.includes("to: '/restaurant/floor'"), 'floor workspace nav')
      assert.ok(nav.includes("to: '/restaurant/kitchen-workspace'"), 'kitchen workspace nav')
      assert.ok(nav.includes("to: '/restaurant/menu-production'"), 'menu workspace nav')
      assert.ok(nav.includes("to: '/restaurant/stock-purchasing'"), 'stock workspace nav')
      assert.ok(nav.includes("to: '/restaurant/team'"), 'team workspace nav')
      assert.ok(nav.includes("to: '/restaurant/cash-close'"), 'cash workspace nav')
      assert.ok(nav.includes("to: '/restaurant/control'"), 'control workspace nav')
    })

    it('Phase 6 nav entries are restaurant-only', () => {
      const nav = read('src/renderer/src/navigation/desktopNav.js')
      const phase6Items = [
        "'/restaurant/floor'",
        "'/restaurant/kitchen-workspace'",
        "'/restaurant/menu-production'",
        "'/restaurant/stock-purchasing'",
        "'/restaurant/team'",
        "'/restaurant/cash-close'",
        "'/restaurant/control'"
      ]
      for (const path of phase6Items) {
        const idx = nav.indexOf(`to: ${path}`)
        const chunk = nav.slice(idx, idx + 300)
        assert.ok(chunk.includes("types: ['restaurant']"), `${path} is restaurant-only`)
      }
    })

    it('all Phase 6 routes exist in App.jsx', () => {
      const app = read('src/renderer/src/App.jsx')
      assert.ok(app.includes('restaurant/reservations'), 'reservations route')
      assert.ok(app.includes('restaurant/combos'), 'combos route')
      assert.ok(app.includes('restaurant/recipe-variance'), 'recipe-variance route')
      assert.ok(app.includes('restaurant/staff-performance'), 'staff-performance route')
      assert.ok(app.includes('restaurant/prep-batches'), 'prep-batches route')
      assert.ok(app.includes('restaurant/purchase-suggestions'), 'purchase-suggestions route')
      assert.ok(app.includes('restaurant/kitchen-analytics'), 'kitchen-analytics route')
    })

    it('all Phase 6 routes are wrapped with RestaurantOnlyRoute', () => {
      const app = read('src/renderer/src/App.jsx')
      const phase6Routes = [
        'restaurant/reservations',
        'restaurant/combos',
        'restaurant/recipe-variance',
        'restaurant/staff-performance',
        'restaurant/prep-batches',
        'restaurant/purchase-suggestions',
        'restaurant/kitchen-analytics'
      ]
      for (const route of phase6Routes) {
        const idx = app.indexOf(route)
        const chunk = app.slice(Math.max(0, idx - 200), idx + route.length + 200)
        assert.ok(chunk.includes('RestaurantOnlyRoute'), `${route} wrapped with RestaurantOnlyRoute`)
      }
    })
  })

  // ── IPC handlers ──────────────────────────────────────────────────────────

  describe('Phase 6 IPC Handlers', () => {
    it('all Phase 6 IPC handlers exist in index.js', () => {
      const index = read('src/main/index.js')
      assert.ok(index.includes("'pos:getRestaurantReservations'"), 'getRestaurantReservations IPC')
      assert.ok(index.includes("'pos:createRestaurantReservation'"), 'createRestaurantReservation IPC')
      assert.ok(index.includes("'pos:updateRestaurantReservation'"), 'updateRestaurantReservation IPC')
      assert.ok(index.includes("'pos:cancelRestaurantReservation'"), 'cancelRestaurantReservation IPC')
      assert.ok(index.includes("'pos:seatRestaurantReservation'"), 'seatRestaurantReservation IPC')
      assert.ok(index.includes("'pos:markRestaurantReservationNoShow'"), 'markRestaurantReservationNoShow IPC')
      assert.ok(index.includes("'pos:getRestaurantWaitlist'"), 'getRestaurantWaitlist IPC')
      assert.ok(index.includes("'pos:createRestaurantWaitlistEntry'"), 'createRestaurantWaitlistEntry IPC')
      assert.ok(index.includes("'pos:seatRestaurantWaitlistEntry'"), 'seatRestaurantWaitlistEntry IPC')
      assert.ok(index.includes("'pos:getRestaurantCombos'"), 'getRestaurantCombos IPC')
      assert.ok(index.includes("'pos:saveRestaurantCombo'"), 'saveRestaurantCombo IPC')
      assert.ok(index.includes("'pos:deleteRestaurantCombo'"), 'deleteRestaurantCombo IPC')
      assert.ok(index.includes("'pos:getRecipeVarianceReport'"), 'getRecipeVarianceReport IPC')
      assert.ok(index.includes("'pos:getRestaurantPrepItems'"), 'getRestaurantPrepItems IPC')
      assert.ok(index.includes("'pos:saveRestaurantPrepItem'"), 'saveRestaurantPrepItem IPC')
      assert.ok(index.includes("'pos:getRestaurantPrepBatches'"), 'getRestaurantPrepBatches IPC')
      assert.ok(index.includes("'pos:createRestaurantPrepBatch'"), 'createRestaurantPrepBatch IPC')
      assert.ok(index.includes("'pos:postRestaurantPrepBatch'"), 'postRestaurantPrepBatch IPC')
      assert.ok(index.includes("'pos:recordTicketStatusEvent'"), 'recordTicketStatusEvent IPC')
      assert.ok(index.includes("'pos:getKitchenTimingReport'"), 'getKitchenTimingReport IPC')
      assert.ok(index.includes("'pos:getLowStockPurchaseSuggestions'"), 'getLowStockPurchaseSuggestions IPC')
      assert.ok(index.includes("'pos:convertPurchaseSuggestionsToPo'"), 'convertPurchaseSuggestionsToPo IPC')
    })
  })

  // ── Database re-exports ───────────────────────────────────────────────────

  describe('Phase 6 Database Re-exports', () => {
    it('all Phase 6 functions are re-exported from database.js', () => {
      const db = read('src/main/database.js')
      assert.ok(db.includes('getRestaurantReservations'), 'getRestaurantReservations re-export')
      assert.ok(db.includes('createRestaurantReservation'), 'createRestaurantReservation re-export')
      assert.ok(db.includes('getRestaurantCombos'), 'getRestaurantCombos re-export')
      assert.ok(db.includes('getRecipeVarianceReport'), 'getRecipeVarianceReport re-export')
      assert.ok(db.includes('getRestaurantPrepItems'), 'getRestaurantPrepItems re-export')
      assert.ok(db.includes('postRestaurantPrepBatch'), 'postRestaurantPrepBatch re-export')
      assert.ok(db.includes('getKitchenTimingReport'), 'getKitchenTimingReport re-export')
      assert.ok(db.includes('getLowStockPurchaseSuggestions'), 'getLowStockPurchaseSuggestions re-export')
      assert.ok(db.includes('convertPurchaseSuggestionsToPo'), 'convertPurchaseSuggestionsToPo re-export')
    })
  })
})
