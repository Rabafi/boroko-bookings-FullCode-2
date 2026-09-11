import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

// Behavioral coverage for the F&B progressive activation plan.
// - Pure registry/sync logic is EXECUTED, not grepped.
// - SQL migrations are checked for fail-closed security invariants (exact
//   allow/deny patterns), since no live database is available in this suite.
// - UI wiring is checked for the presence of real operational contracts
//   (queues, selectors, outlet propagation) and the ABSENCE of the unsafe
//   patterns they replace (UUID pasting, client-authored financial truth).

import {
  FNB_CORE_MODULE_KEYS,
  FNB_OPTIONAL_MODULES,
  FNB_OPTIONAL_MODULE_KEYS,
  isFnbOptionalModuleKey,
  normalizeFnbPreferences,
  resolveFnbModuleDisplayState
} from '../src/shared/fnbModules.js'

import { FINANCIAL_SYNC_TABLES } from '../src/shared/syncQueue.js'

const read = (file) => readFileSync(resolve(file), 'utf8')
const exists = (file) => existsSync(resolve(file))

const prefMigration = read('supabase/migrations/20260904000000_fnb_module_preferences.sql')
const guestMigration = read('supabase/migrations/20260904010000_fnb_guest_service.sql')
const supplyMigration = read('supabase/migrations/20260904020000_fnb_supply_planning.sql')
const liveDriftRepair = read('supabase/migrations/20260906000000_fnb_live_function_drift_repair.sql')
const liveDriftRepairFollowup = read('supabase/migrations/20260906001000_fnb_live_function_drift_repair_followup.sql')
const liveDriftRepairFinal = read('supabase/migrations/20260907000000_fnb_live_function_drift_repair_final.sql')
const fnbDomain = read('src/main/domains/fnb.js')
const hub = read('src/renderer/src/components/LodgeFoodBeverageHub.jsx')
const workspace = read('src/renderer/src/components/restaurant/RestaurantWorkspace.jsx')
const styles = read('src/renderer/src/styles/restaurant-workspaces.css')
const inventory = read('src/renderer/src/components/Inventory.jsx')
const expenses = read('src/renderer/src/components/Expenses.jsx')
const reports = read('src/renderer/src/components/Reports.jsx')
const roomServiceUI = read('src/renderer/src/components/fnb/FnbRoomService.jsx')
const mealPlansUI = read('src/renderer/src/components/fnb/FnbMealPlans.jsx')
const foodSafetyUI = read('src/renderer/src/components/fnb/FnbFoodSafety.jsx')
const invoiceUI = read('src/renderer/src/components/fnb/FnbInvoiceMatching.jsx')
const demandUI = read('src/renderer/src/components/fnb/FnbDemandPlanning.jsx')
const consolidatedUI = read('src/renderer/src/components/fnb/FnbConsolidatedReport.jsx')
const todayUI = read('src/renderer/src/components/fnb/FnbTodayView.jsx')

// ── Module registry (executed) ──────────────────────────────────────────────

test('optional module allowlist matches the activation plan', () => {
  assert.deepEqual(
    [...FNB_OPTIONAL_MODULE_KEYS].sort(),
    ['demand-planning', 'fnb-reports', 'food-safety', 'invoice-matching', 'meal-plans', 'purchasing', 'recipes', 'reservations', 'room-service', 'settlement', 'team'].sort()
  )
  assert.ok(FNB_CORE_MODULE_KEYS.length >= 9)
  for (const def of FNB_OPTIONAL_MODULES) {
    assert.ok(def.benefit && def.benefit.length > 10, `${def.key} needs a benefit statement`)
    assert.ok(def.capability, `${def.key} needs a capability`)
    assert.ok(def.requiresEntitlement, `${def.key} needs an entitlement mapping`)
  }
})

test('preference defaults fail closed before the server responds', () => {
  const map = normalizeFnbPreferences([])
  for (const key of FNB_OPTIONAL_MODULE_KEYS) {
    const entry = map.get(key)
    assert.equal(entry.enabled, false, `${key} must not default on`)
    assert.equal(entry.entitled, false, `${key} must not claim entitlement without server proof`)
    assert.equal(entry.reason, 'entitlement_unverified')
    assert.equal(resolveFnbModuleDisplayState(entry).state, 'unverified', `${key} must render neutrally`)
  }
})

test('server rows resolve without inferring entitlement from the toggle', () => {
  const map = normalizeFnbPreferences([
    { module_key: 'recipes', enabled: true, entitled: true, can_manage: true, version: 3 },
    // Stale cache trap: enabled toggle but entitlement gone → masked off.
    { module_key: 'purchasing', enabled: true, entitled: false, can_manage: true, version: 2, reason: 'not_entitled' }
  ])
  assert.equal(map.get('recipes').enabled, true)
  assert.equal(map.get('recipes').version, 3)
  assert.equal(resolveFnbModuleDisplayState(map.get('recipes')).state, 'enabled')
  assert.equal(map.get('purchasing').enabled, false, 'lapsed entitlement must mask the toggle')
  assert.equal(resolveFnbModuleDisplayState(map.get('purchasing')).state, 'request_access')
  assert.equal(
    resolveFnbModuleDisplayState({ enabled: false, entitled: true, canManage: false }).state,
    'ask_admin'
  )
  assert.equal(
    resolveFnbModuleDisplayState({ enabled: false, entitled: true, canManage: true }).state,
    'disabled'
  )
  assert.equal(isFnbOptionalModuleKey('room-service'), true)
  assert.equal(isFnbOptionalModuleKey('today'), false)
})

test('offline financial queue items include every F&B money/stock RPC', () => {
  for (const rpc of [
    'create_fnb_room_service_order',
    'create_fnb_meal_entitlement',
    'redeem_fnb_meal',
    'create_fnb_temperature_log',
    'capture_fnb_supplier_invoice'
  ]) {
    assert.ok(FINANCIAL_SYNC_TABLES.has(rpc), `${rpc} must be sync-risk classified`)
  }
})

// ── Phase 1: fail-closed entitlements ───────────────────────────────────────

test('entitlement resolution fails closed and previously enabled modules hide on lapse', () => {
  assert.match(prefMigration, /create or replace function public\._fnb_entitlement_state/)
  // No fail-open: an exception handler must never return true.
  assert.doesNotMatch(
    prefMigration,
    /exception when others then[\s\S]{0,300}return true/,
    'no entitlement path may fail open'
  )
  assert.match(prefMigration, /return 'unverified'/)
  assert.match(prefMigration, /create or replace function public\._fnb_require_module/)
  assert.match(prefMigration, /ENTITLEMENT_UNVERIFIED/)
  assert.match(prefMigration, /MODULE_DISABLED/)
  // set_ rejects unverified activation explicitly.
  assert.match(prefMigration, /'code', 'ENTITLEMENT_UNVERIFIED'/)
  assert.match(prefMigration, /_fnb_entitlement_state\(v_lodge, v_key\) = 'unverified'/)
  // get_ reports unverified rows as disabled+unentitled, never enabled.
  assert.match(prefMigration, /'reason', 'entitlement_unverified'/)
})

test('server capability and outlet enforcement exist as shared helpers', () => {
  assert.match(prefMigration, /create or replace function public\._fnb_has_capability/)
  assert.match(prefMigration, /capability_overrides/)
  assert.match(prefMigration, /create or replace function public\._fnb_require_outlet/)
  assert.match(prefMigration, /allowed_outlet_ids/)
  assert.match(prefMigration, /OUTLET_SCOPE_DENIED/)
})

// ── Phase 3: room service on the canonical POS contract ─────────────────────

test('room-service creation goes through canonical POS tables at server prices', () => {
  assert.match(guestMigration, /_fnb_require_module\(v_lodge, 'room-service'\)/)
  assert.match(guestMigration, /_fnb_has_capability\(v_lodge, v_user, 'pos\.manage'\)/)
  assert.match(guestMigration, /_fnb_require_outlet\(v_lodge, v_user, v_outlet\)/)
  assert.match(guestMigration, /BOOKING_SCOPE_DENIED/)
  assert.match(guestMigration, /BOOKING_NOT_ACTIVE/)
  assert.match(guestMigration, /ROOM_SCOPE_DENIED/)
  assert.match(guestMigration, /BOOKING_ROOM_MISMATCH/)
  // Menu resolution at server prices; free text rejected.
  assert.match(guestMigration, /from public\.pos_menu_items/)
  assert.match(guestMigration, /Free-text items are not accepted/)
  assert.match(guestMigration, /MENU_ITEM_UNAVAILABLE/)
  assert.match(guestMigration, /MENU_ITEM_OUTLET_MISMATCH/)
  // Canonical writes sharing one operation key.
  assert.match(guestMigration, /insert into public\.pos_orders/)
  assert.match(guestMigration, /insert into public\.pos_order_items/)
  assert.match(guestMigration, /insert into public\.pos_prep_tickets/)
  assert.match(guestMigration, /pos_orders_lodge_idempotency_uidx/)
  assert.match(guestMigration, /SHIFT_NOT_OPEN/)
  assert.match(guestMigration, /IDEMPOTENCY_CONFLICT/)
  // No client price or folio flag is ever trusted.
  assert.doesNotMatch(guestMigration, /p_payload->>'folio_posted'/, 'folio_posted must be server-derived')
  assert.doesNotMatch(guestMigration, /p_payload->>'unit_price'/, 'prices must come from the menu')
})

test('room-service transitions enforce capability, outlet, runner, and server folio posting', () => {
  assert.match(guestMigration, /pos\.void/)
  assert.match(guestMigration, /Cancelling a room-service order needs void permission/)
  assert.match(guestMigration, /RUNNER_UNKNOWN/)
  assert.match(guestMigration, /insert into public\.booking_charges/)
  assert.match(guestMigration, /No booking is linked, so no folio charge was posted/)
})

test('meal redemption enforces window, outlet, and server-derived effects only', () => {
  assert.match(guestMigration, /_fnb_require_module\(v_ent\.lodge_id, 'meal-plans'\)/)
  assert.match(guestMigration, /PLAN_NOT_ACTIVE/)
  assert.match(guestMigration, /PLAN_EXPIRED/)
  assert.match(guestMigration, /_fnb_require_outlet\(v_ent\.lodge_id, v_user, v_outlet\)/)
  assert.match(guestMigration, /IDEMPOTENCY_CONFLICT/)
  // Client inventory/folio claims are stored as false/null only.
  assert.doesNotMatch(guestMigration, /\(p_payload->>'inventory_consumed'\)/, 'inventory effects must not come from the client')
  assert.doesNotMatch(guestMigration, /p_payload->>'folio_reference'/, 'folio references must not come from the client')
})

test('reporting reads use real columns and NULL (never zero) for unavailable money', () => {
  assert.doesNotMatch(guestMigration, /grand_total/, 'pos_orders has no grand_total column')
  assert.doesNotMatch(guestMigration, /purchased_at/, 'inventory_purchases uses date, not purchased_at')
  assert.doesNotMatch(guestMigration, /expense_date/, 'expenses uses date, not expense_date')
  assert.match(guestMigration, /inventory_purchases\.total_cost|total_cost/)
  assert.match(guestMigration, /purchase_cost_complete/)
  assert.match(guestMigration, /expense_complete/)
  assert.match(guestMigration, /v_cost numeric := null/)
  assert.match(guestMigration, /v_expense_total numeric := null/)
  // Today low-stock must not reference the nonexistent is_active column.
  assert.doesNotMatch(guestMigration, /inventory_items where lodge_id = \$1 and coalesce\(is_active/, 'inventory_items has no is_active column')
})

test('forward drift repair removes the three retired live F&B column references', () => {
  assert.match(liveDriftRepair, /fnb_module_disable_blockers\(uuid,text\)/)
  assert.match(liveDriftRepair, /get_fnb_consolidated_report\(uuid,date,date,uuid\)/)
  assert.match(liveDriftRepair, /get_fnb_demand_recommendations\(uuid,date,uuid\)/)
  assert.match(liveDriftRepair, /Expected stale cash-up status fragment was not found/)
  assert.match(liveDriftRepair, /Expected stale POS grand_total fragment was not found/)
  assert.match(liveDriftRepair, /Expected stale rooms\.deleted fragment was not found/)
  assert.match(liveDriftRepair, /sum\(total\)::numeric/)
})

test('follow-up drift repair removes stale purchase-date and events probes', () => {
  assert.match(liveDriftRepairFollowup, /Expected stale inventory purchased_at fragment was not found/)
  assert.match(liveDriftRepairFollowup, /Expected stale public\.events fragment was not found/)
  assert.match(liveDriftRepairFollowup, /select sum\(total_cost\)::numeric/)
  assert.match(liveDriftRepairFollowup, /select 0::integer/)
})

test('final drift repair uses real expense and conference booking columns', () => {
  assert.match(liveDriftRepairFinal, /Expected stale expenses total\/expense_date fragment was not found/)
  assert.match(liveDriftRepairFinal, /select sum\(amount\)::numeric/)
  assert.match(liveDriftRepairFinal, /booking_date = \$2/)
  assert.match(liveDriftRepairFinal, /Expected stale conference booking date-range fragment was not found/)
})

test('room-service and meal read queues exist for retained history', () => {
  assert.match(guestMigration, /get_fnb_room_service_queue/)
  assert.match(guestMigration, /get_fnb_meal_entitlements/)
})

// ── Phase 4: real three-way matching + immutable food safety ────────────────

test('invoice capture matches PO records, not typed numbers', () => {
  assert.match(supplyMigration, /_fnb_require_module\(v_lodge, 'invoice-matching'\)/)
  assert.match(supplyMigration, /SUPPLIER_REQUIRED|supplier_id/)
  assert.match(supplyMigration, /PURCHASE_ORDER_REQUIRED|purchase_order_id/)
  assert.match(supplyMigration, /from public\.restaurant_suppliers/)
  assert.match(supplyMigration, /from public\.restaurant_purchase_orders/)
  assert.match(supplyMigration, /SUPPLIER_MISMATCH/)
  assert.match(supplyMigration, /from public\.restaurant_purchase_order_items/)
  assert.match(supplyMigration, /unit_cost <> invoiced_unit_cost/)
  assert.match(supplyMigration, /IDEMPOTENCY_CONFLICT/)
})

test('accounting handoff posts one canonical expense', () => {
  assert.match(supplyMigration, /insert into public\.expenses/)
  assert.match(supplyMigration, /already_handed_off/)
  assert.match(supplyMigration, /expense_id/)
})

test('food safety requires templates and closes with outlet scope', () => {
  assert.match(supplyMigration, /_fnb_require_module\(v_lodge, 'food-safety'\)/)
  assert.match(supplyMigration, /TEMPLATE_REQUIRED/)
  assert.match(supplyMigration, /TEMPLATE_UNKNOWN/)
  assert.match(supplyMigration, /create_fnb_food_safety_template/)
  assert.match(supplyMigration, /_fnb_require_outlet\(v_row\.lodge_id, v_user, v_row\.outlet_id\)/)
  assert.match(supplyMigration, /get_fnb_food_safety_templates/)
  assert.match(supplyMigration, /get_fnb_corrective_queue/)
  assert.match(supplyMigration, /get_fnb_supplier_invoices/)
})

test('demand planning uses real columns and guards approvals', () => {
  assert.doesNotMatch(supplyMigration, /from public\.rooms where lodge_id = \$1 and coalesce\(deleted/, 'rooms has no deleted column')
  assert.doesNotMatch(supplyMigration, /from public\.inventory_items where lodge_id[^;]*coalesce\(is_active/, 'inventory_items has no is_active column')
  assert.match(supplyMigration, /from public\.rooms where lodge_id/)
  assert.match(supplyMigration, /_fnb_require_module\(v_lodge, 'demand-planning'\)/)
  assert.match(supplyMigration, /_fnb_can_manage\(v_lodge, v_user\)/)
  assert.match(supplyMigration, /IDEMPOTENCY_CONFLICT/)
})

// ── Desktop: scoped caches, dedupe, stripped client truth ───────────────────

test('desktop F&B caches are scoped and client financial flags are stripped', () => {
  assert.match(fnbDomain, /fnb-today:\$\{lodgeId\}:\$\{outletId/)
  assert.match(fnbDomain, /fnb-consolidated-report:\$\{lodgeId\}:\$\{start\}:\$\{end\}/)
  assert.match(fnbDomain, /fnb-demand-recommendations:\$\{lodgeId\}:\$\{date\}/)
  assert.match(fnbDomain, /getFnbToday:\$\{lodgeIdArg/)
  assert.match(fnbDomain, /inventory_consumed: _stripInventory/)
  assert.match(fnbDomain, /folio_posted: _stripFolio/)
  assert.match(fnbDomain, /getFnbRoomServiceQueue/)
  assert.match(fnbDomain, /getFnbMealEntitlements/)
  assert.match(fnbDomain, /getFnbFoodSafetyTemplates/)
  assert.match(fnbDomain, /getFnbCorrectiveQueue/)
  assert.match(fnbDomain, /getFnbSupplierInvoices/)
  assert.match(fnbDomain, /createFnbFoodSafetyTemplate/)
})

// ── UI: usable workflows, outlet context, no invented truth ─────────────────

test('room-service UI selects menu items and works the server queue', () => {
  assert.ok(exists('src/renderer/src/components/fnb/FnbRoomService.jsx'))
  assert.match(roomServiceUI, /getRoomServiceQueue/)
  assert.match(roomServiceUI, /getMenuItems/)
  assert.match(roomServiceUI, /menu_item_id/)
  assert.doesNotMatch(roomServiceUI, /Paste the order ID/, 'operators must not paste UUIDs')
  assert.doesNotMatch(roomServiceUI, /folio_posted/, 'folio state must be server-derived')
  assert.match(roomServiceUI, /outlet_id: outletId/)
})

test('meal-plan UI works from the entitlement list without invented effects', () => {
  assert.match(mealPlansUI, /getMealEntitlements/)
  assert.doesNotMatch(mealPlansUI, /inventory_consumed/, 'no client inventory claims')
  assert.doesNotMatch(mealPlansUI, /folio_reference/, 'no client folio references')
  assert.match(mealPlansUI, /remaining_covers/)
})

test('food-safety UI always evaluates against a template and works the queue', () => {
  assert.match(foodSafetyUI, /getFoodSafetyTemplates/)
  assert.match(foodSafetyUI, /getCorrectiveQueue/)
  assert.match(foodSafetyUI, /template_id/)
  assert.match(foodSafetyUI, /createFoodSafetyTemplate/)
})

test('invoice UI matches against supplier purchase orders with a decision queue', () => {
  assert.match(invoiceUI, /getSuppliers/)
  assert.match(invoiceUI, /getPurchaseOrders/)
  assert.match(invoiceUI, /getSupplierInvoices/)
  assert.match(invoiceUI, /supplier_id/)
  assert.match(invoiceUI, /purchase_order_id/)
  assert.match(invoiceUI, /inventory_item_id/)
  assert.doesNotMatch(invoiceUI, /ordered N \| received N/, 'ordered figures must come from the PO, not typed text')
})

test('hub, workspace, and Today preserve outlet context', () => {
  assert.match(hub, /Checking module access/)
  assert.match(hub, /outlet=/)
  assert.match(todayUI, /outlet=/)
  assert.match(workspace, /outlet=\$\{encodeURIComponent\(outletId\)\}/)
  assert.match(inventory, /Back to F/)
  assert.match(expenses, /Back to F/)
  assert.match(reports, /Back to F/)
})

test('consolidated report labels uncertified money Unavailable', () => {
  assert.match(consolidatedUI, /complete === false/)
  assert.match(consolidatedUI, /Unavailable/)
  assert.match(consolidatedUI, /purchase_cost_complete/)
  assert.match(consolidatedUI, /expense_complete/)
})

test('lodge adapter covers warm tokens and scopes form layout to .fnb-field', () => {
  assert.match(styles, /\.lodge-food-beverage-hub \.fnb-field/)
  assert.doesNotMatch(styles, /\.lodge-food-beverage-hub label \{/, 'blanket label rules break flex controls')
  assert.match(styles, /#fffdfb/)
  assert.match(styles, /#795f68/)
  assert.match(styles, /#d8c0b9/)
})
