import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const phase4Sql = await readFile(new URL('../supabase/migrations/20260708160000_restaurant_phase4_growth.sql', import.meta.url), 'utf8')
const phase5Sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
const hardeningSql = await readFile(new URL('../supabase/migrations/20260708180000_restaurant_phase45_security_hardening.sql', import.meta.url), 'utf8')
const posJs = await readFile(new URL('../src/main/domains/pos.js', import.meta.url), 'utf8')
const mainIndex = await readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
const preload = await readFile(new URL('../src/preload/index.js', import.meta.url), 'utf8')
const databaseJs = await readFile(new URL('../src/main/database.js', import.meta.url), 'utf8')

// ── FIX 1: Role enforcement in RPCs ─────────────────────────

test('FIX 1: upsert_restaurant_customer has app_require_lodge_role', () => {
  assert.match(hardeningSql, /upsert_restaurant_customer[\s\S]*app_require_lodge_role/)
})

test('FIX 1: get_restaurant_customers has app_require_lodge_role', () => {
  assert.match(hardeningSql, /get_restaurant_customers[\s\S]*app_require_lodge_role/)
})

test('FIX 1: award_restaurant_loyalty has app_require_lodge_role', () => {
  assert.match(hardeningSql, /award_restaurant_loyalty[\s\S]*app_require_lodge_role/)
})

test('FIX 1: redeem_restaurant_loyalty has app_require_lodge_role', () => {
  assert.match(hardeningSql, /redeem_restaurant_loyalty[\s\S]*app_require_lodge_role/)
})

test('FIX 1: charge_restaurant_account has app_require_lodge_role', () => {
  assert.match(hardeningSql, /charge_restaurant_account[\s\S]*app_require_lodge_role/)
})

test('FIX 1: record_restaurant_delivery has app_require_lodge_role', () => {
  assert.match(hardeningSql, /record_restaurant_delivery[\s\S]*app_require_lodge_role/)
})

test('FIX 1: redeem_restaurant_voucher has app_require_lodge_role', () => {
  assert.match(hardeningSql, /redeem_restaurant_voucher[\s\S]*app_require_lodge_role/)
})

test('FIX 1: clock_in_staff has app_require_lodge_role', () => {
  assert.match(hardeningSql, /clock_in_staff[\s\S]*app_require_lodge_role/)
})

test('FIX 1: clock_out_staff has app_require_lodge_role', () => {
  assert.match(hardeningSql, /clock_out_staff[\s\S]*app_require_lodge_role/)
})

test('FIX 1: open_cash_drawer_session has app_require_lodge_role', () => {
  assert.match(hardeningSql, /open_cash_drawer_session[\s\S]*app_require_lodge_role/)
})

test('FIX 1: close_cash_drawer_session has app_require_lodge_role', () => {
  assert.match(hardeningSql, /close_cash_drawer_session[\s\S]*app_require_lodge_role/)
})

test('FIX 1: create_restaurant_supplier has app_require_lodge_role', () => {
  assert.match(hardeningSql, /create_restaurant_supplier[\s\S]*app_require_lodge_role/)
})

test('FIX 1: get_restaurant_suppliers has app_require_lodge_role', () => {
  assert.match(hardeningSql, /get_restaurant_suppliers[\s\S]*app_require_lodge_role/)
})

test('FIX 1: create_purchase_order has app_require_lodge_role', () => {
  assert.match(hardeningSql, /create_purchase_order[\s\S]*app_require_lodge_role/)
})

test('FIX 1: approve_purchase_order has app_require_lodge_role', () => {
  assert.match(hardeningSql, /approve_purchase_order[\s\S]*app_require_lodge_role/)
})

test('FIX 1: create_daily_checklist has app_require_lodge_role', () => {
  assert.match(hardeningSql, /create_daily_checklist[\s\S]*app_require_lodge_role/)
})

test('FIX 1: complete_checklist_item has app_require_lodge_role', () => {
  assert.match(hardeningSql, /complete_checklist_item[\s\S]*app_require_lodge_role/)
})

test('FIX 1: record_exception_alert has app_require_lodge_role', () => {
  assert.match(hardeningSql, /record_exception_alert[\s\S]*app_require_lodge_role/)
})

test('FIX 1: resolve_exception_alert has app_require_lodge_role', () => {
  assert.match(hardeningSql, /resolve_exception_alert[\s\S]*app_require_lodge_role/)
})

test('FIX 1: generate_owner_digest has app_require_lodge_role', () => {
  assert.match(hardeningSql, /generate_owner_digest[\s\S]*app_require_lodge_role/)
})

test('FIX 1: get_active_alerts has app_require_lodge_role', () => {
  assert.match(hardeningSql, /get_active_alerts[\s\S]*app_require_lodge_role/)
})

test('FIX 1: get_active_shifts has app_require_lodge_role', () => {
  assert.match(hardeningSql, /get_active_shifts[\s\S]*app_require_lodge_role/)
})

test('FIX 1: get_open_cash_drawer has app_require_lodge_role', () => {
  assert.match(hardeningSql, /get_open_cash_drawer[\s\S]*app_require_lodge_role/)
})

// ── FIX 2: Child-table RLS uses parent-join ─────────────────

test('FIX 2: purchase_order_items RLS uses parent join, not lodge_id column', () => {
  assert.match(hardeningSql, /restaurant_purchase_order_items_lodge_scope_select[\s\S]*exists[\s\S]*select 1 from public\.restaurant_purchase_orders po[\s\S]*where po\.id = purchase_order_id/)
})

test('FIX 2: checklist_items RLS uses parent join, not lodge_id column', () => {
  assert.match(hardeningSql, /restaurant_checklist_items_lodge_scope_select[\s\S]*exists[\s\S]*select 1 from public\.restaurant_checklists c[\s\S]*where c\.id = checklist_id/)
})

test('FIX 2: purchase_order_items INSERT policy uses parent join', () => {
  assert.match(hardeningSql, /restaurant_purchase_order_items_lodge_scope_insert[\s\S]*exists[\s\S]*select 1 from public\.restaurant_purchase_orders po[\s\S]*where po\.id = purchase_order_id/)
})

test('FIX 2: checklist_items INSERT policy uses parent join', () => {
  assert.match(hardeningSql, /restaurant_checklist_items_lodge_scope_insert[\s\S]*exists[\s\S]*select 1 from public\.restaurant_checklists c[\s\S]*where c\.id = checklist_id/)
})

// ── FIX 3: Owner digest uses inventory_items ────────────────

test('FIX 3: generate_owner_digest references inventory_items, not inventory', () => {
  assert.match(hardeningSql, /select count\(\*\) from public\.inventory_items i[\s\S]*where i\.lodge_id = p_lodge_id/)
})

test('FIX 3: generate_owner_digest does NOT reference bare public.inventory', () => {
  // Find the generate_owner_digest function body and check it uses inventory_items
  const fnBody = hardeningSql.slice(hardeningSql.indexOf('generate_owner_digest'))
  assert.match(fnBody, /public\.inventory_items/)
  // Should NOT have bare public.inventory (without _items suffix) in the low_stock_items subquery
  const lowStockSection = fnBody.slice(0, fnBody.indexOf('open_checklists'))
  assert.doesNotMatch(lowStockSection, /from public\.inventory\b(?!_items)/)
})

// ── FIX 4: Real business logic ──────────────────────────────

test('FIX 4: receive_purchase_order function exists in SQL', () => {
  assert.match(hardeningSql, /create or replace function public\.receive_purchase_order/)
})

test('FIX 4: receive_purchase_order uses app_require_lodge_role', () => {
  assert.match(hardeningSql, /receive_purchase_order[\s\S]*app_require_lodge_role/)
})

test('FIX 4: receive_purchase_order updates inventory_items stock', () => {
  assert.match(hardeningSql, /receive_purchase_order[\s\S]*update public\.inventory_items[\s\S]*current_stock/)
})

test('FIX 4: receive_purchase_order records stock_movements', () => {
  assert.match(hardeningSql, /receive_purchase_order[\s\S]*insert into public\.stock_movements/)
})

test('FIX 4: receive_purchase_order is idempotent (status check)', () => {
  assert.match(hardeningSql, /receive_purchase_order[\s\S]*status = 'received'[\s\S]*duplicate/)
})

test('FIX 4: receivePurchaseOrder exists in pos.js', () => {
  assert.match(posJs, /export async function receivePurchaseOrder/)
})

test('FIX 4: receivePurchaseOrder uses receive_purchase_order RPC', () => {
  assert.match(posJs, /receive_purchase_order/)
})

test('FIX 4: receivePurchaseOrder rejects offline', () => {
  assert.match(posJs, /Cannot receive purchase order offline/)
})

test('FIX 4: receivePurchaseOrder wired in preload', () => {
  assert.match(preload, /receivePurchaseOrder/)
})

test('FIX 4: receivePurchaseOrder wired in main IPC', () => {
  assert.match(mainIndex, /pos:receivePurchaseOrder/)
})

test('FIX 4: receivePurchaseOrder exported from database.js', () => {
  assert.match(databaseJs, /receivePurchaseOrder/)
})

test('FIX 4: create_stock_transfer verifies item exists before logging', () => {
  assert.match(hardeningSql, /create_stock_transfer[\s\S]*Inventory item not found/)
})

test('FIX 4: create_stock_transfer records stock_movements as log-only transfer', () => {
  assert.match(hardeningSql, /create_stock_transfer[\s\S]*insert into public\.stock_movements/)
  assert.match(hardeningSql, /create_stock_transfer[\s\S]*'transfer'/)
})

test('FIX 4: create_stock_transfer marks status as completed and returns stock_before', () => {
  assert.match(hardeningSql, /create_stock_transfer[\s\S]*status.*completed/)
  assert.match(hardeningSql, /create_stock_transfer[\s\S]*stock_before/)
})

// ── FIX 5: Recipe depletion deduplication proof ─────────────

test('FIX 5: Phase 3 SQL has unique index on recipe stock movements', async () => {
  const phase3Sql = await readFile(new URL('../supabase/migrations/20260708140000_restaurant_phase3_recipes.sql', import.meta.url), 'utf8')
  assert.match(phase3Sql, /restaurant_recipe_stock_movements_dedup_idx/)
  assert.match(phase3Sql, /unique index/)
})

test('FIX 5: Phase 3 record_recipe_stock_depletion checks existing count before insert', async () => {
  const phase3Sql = await readFile(new URL('../supabase/migrations/20260708140000_restaurant_phase3_recipes.sql', import.meta.url), 'utf8')
  assert.match(phase3Sql, /v_existing_count/)
  assert.match(phase3Sql, /v_skipped_count/)
})

test('FIX 5: Phase 3 test proves duplicate depletion is skipped', async () => {
  const testFile = await readFile(new URL('../tests/restaurant-operations-foundation.test.mjs', import.meta.url), 'utf8')
  assert.match(testFile, /duplicate.*depletion|idempotent.*recipe|recipe.*idempotent/)
})

test('FIX 5: recordRecipeStockDepletion is synchronous (await, not .catch)', () => {
  assert.match(posJs, /export async function recordRecipeStockDepletion[\s\S]*await state\.supabase\.rpc\('record_recipe_stock_depletion'/)
  // Should NOT have .catch(() => {}) as a fire-and-forget pattern
  const fnBody = posJs.slice(posJs.indexOf('export async function recordRecipeStockDepletion'))
  const fnEnd = fnBody.indexOf('\nexport ')
  const fn = fnBody.slice(0, fnEnd > 0 ? fnEnd : 2000)
  assert.doesNotMatch(fn, /\.catch\(\(\) => \{\}\)/)
})
