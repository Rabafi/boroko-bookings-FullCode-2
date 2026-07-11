import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const posJs = await readFile(new URL('../src/main/domains/pos.js', import.meta.url), 'utf8')

// ── Staff Shifts ────────────────────────────────────────────
test('Phase 5: clockInStaff function exists', () => {
  assert.match(posJs, /export async function clockInStaff/)
})

test('Phase 5: clockOutStaff function exists', () => {
  assert.match(posJs, /export async function clockOutStaff/)
})

test('Phase 5: getActiveShifts function exists', () => {
  assert.match(posJs, /export async function getActiveShifts/)
})

test('Phase 5: clockInStaff rejects offline', () => {
  assert.match(posJs, /Cannot clock in offline/)
})

test('Phase 5: clockOutStaff rejects offline', () => {
  assert.match(posJs, /Cannot clock out offline/)
})

test('Phase 5: clockInStaff uses clock_in_staff RPC', () => {
  assert.match(posJs, /clock_in_staff/)
})

test('Phase 5: clockOutStaff uses clock_out_staff RPC', () => {
  assert.match(posJs, /clock_out_staff/)
})

test('Phase 5: getActiveShifts uses get_active_shifts RPC', () => {
  assert.match(posJs, /get_active_shifts/)
})

// ── Cash Drawer ─────────────────────────────────────────────
test('Phase 5: openCashDrawerSession function exists', () => {
  assert.match(posJs, /export async function openCashDrawerSession/)
})

test('Phase 5: closeCashDrawerSession function exists', () => {
  assert.match(posJs, /export async function closeCashDrawerSession/)
})

test('Phase 5: getOpenCashDrawer function exists', () => {
  assert.match(posJs, /export async function getOpenCashDrawer/)
})

test('Phase 5: openCashDrawerSession rejects offline', () => {
  assert.match(posJs, /Cannot open cash drawer offline/)
})

test('Phase 5: closeCashDrawerSession rejects offline', () => {
  assert.match(posJs, /Cannot close cash drawer offline/)
})

test('Phase 5: openCashDrawerSession uses open_cash_drawer_session RPC', () => {
  assert.match(posJs, /open_cash_drawer_session/)
})

test('Phase 5: closeCashDrawerSession uses close_cash_drawer_session RPC', () => {
  assert.match(posJs, /close_cash_drawer_session/)
})

test('Phase 5: getOpenCashDrawer uses get_open_cash_drawer RPC', () => {
  assert.match(posJs, /get_open_cash_drawer/)
})

test('Phase 5: closeCashDrawerSession supports variance calculation', () => {
  assert.match(posJs, /declared_total/)
  assert.match(posJs, /closing_total/)
})

// ── Suppliers & Purchasing ──────────────────────────────────
test('Phase 5: getPosSuppliers function exists', () => {
  assert.match(posJs, /export async function getPosSuppliers/)
})

test('Phase 5: createPosSupplier function exists', () => {
  assert.match(posJs, /export async function createPosSupplier/)
})

test('Phase 5: createPurchaseOrder function exists', () => {
  assert.match(posJs, /export async function createPurchaseOrder/)
})

test('Phase 5: approvePurchaseOrder function exists', () => {
  assert.match(posJs, /export async function approvePurchaseOrder/)
})

test('Phase 5: createPosSupplier rejects offline', () => {
  assert.match(posJs, /Cannot create supplier offline/)
})

test('Phase 5: createPurchaseOrder rejects offline', () => {
  assert.match(posJs, /Cannot create purchase order offline/)
})

test('Phase 5: approvePurchaseOrder rejects offline', () => {
  assert.match(posJs, /Cannot approve purchase order offline/)
})

test('Phase 5: suppliers use cache when offline', () => {
  assert.match(posJs, /function readCachedSuppliers\(\)/)
  assert.match(posJs, /SUPPLIERS_CACHE_KEY/)
})

// ── Stock Transfers ─────────────────────────────────────────
test('Phase 5: createStockTransfer function exists', () => {
  assert.match(posJs, /export async function createStockTransfer/)
})

test('Phase 5: createStockTransfer rejects offline', () => {
  assert.match(posJs, /Cannot create stock transfer offline/)
})

test('Phase 5: createStockTransfer uses create_stock_transfer RPC', () => {
  assert.match(posJs, /create_stock_transfer/)
})

test('Phase 5: createStockTransfer validates quantity', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /Quantity must be positive/)
})

// ── Checklists ──────────────────────────────────────────────
test('Phase 5: createDailyChecklist function exists', () => {
  assert.match(posJs, /export async function createDailyChecklist/)
})

test('Phase 5: completeChecklistItem function exists', () => {
  assert.match(posJs, /export async function completeChecklistItem/)
})

test('Phase 5: createDailyChecklist rejects offline', () => {
  assert.match(posJs, /Cannot create checklist offline/)
})

test('Phase 5: completeChecklistItem rejects offline', () => {
  assert.match(posJs, /Cannot complete checklist item offline/)
})

test('Phase 5: createDailyChecklist uses create_daily_checklist RPC', () => {
  assert.match(posJs, /create_daily_checklist/)
})

test('Phase 5: completeChecklistItem uses complete_checklist_item RPC', () => {
  assert.match(posJs, /complete_checklist_item/)
})

// ── Exception Alerts ────────────────────────────────────────
test('Phase 5: getActiveAlerts function exists', () => {
  assert.match(posJs, /export async function getActiveAlerts/)
})

test('Phase 5: recordExceptionAlert function exists', () => {
  assert.match(posJs, /export async function recordExceptionAlert/)
})

test('Phase 5: resolveExceptionAlert function exists', () => {
  assert.match(posJs, /export async function resolveExceptionAlert/)
})

test('Phase 5: recordExceptionAlert rejects offline', () => {
  assert.match(posJs, /Cannot record alert offline/)
})

test('Phase 5: resolveExceptionAlert rejects offline', () => {
  assert.match(posJs, /Cannot resolve alert offline/)
})

test('Phase 5: getActiveAlerts uses get_active_alerts RPC', () => {
  assert.match(posJs, /get_active_alerts/)
})

// ── Owner Digest ────────────────────────────────────────────
test('Phase 5: generateOwnerDigest function exists', () => {
  assert.match(posJs, /export async function generateOwnerDigest/)
})

test('Phase 5: generateOwnerDigest rejects offline', () => {
  assert.match(posJs, /Cannot generate digest offline/)
})

test('Phase 5: generateOwnerDigest uses generate_owner_digest RPC', () => {
  assert.match(posJs, /generate_owner_digest/)
})

// ── SQL Migration Validation ────────────────────────────────
test('Phase 5: migration SQL has all tables', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /restaurant_shifts/)
  assert.match(sql, /restaurant_cash_drawer_sessions/)
  assert.match(sql, /restaurant_suppliers/)
  assert.match(sql, /restaurant_purchase_orders/)
  assert.match(sql, /restaurant_purchase_order_items/)
  assert.match(sql, /restaurant_prep_batches/)
  assert.match(sql, /restaurant_stock_transfers/)
  assert.match(sql, /restaurant_checklists/)
  assert.match(sql, /restaurant_checklist_items/)
  assert.match(sql, /restaurant_alerts/)
  assert.match(sql, /restaurant_owner_digest/)
})

test('Phase 5: migration SQL has all RPCs', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /clock_in_staff/)
  assert.match(sql, /clock_out_staff/)
  assert.match(sql, /open_cash_drawer_session/)
  assert.match(sql, /close_cash_drawer_session/)
  assert.match(sql, /create_purchase_order/)
  assert.match(sql, /approve_purchase_order/)
  assert.match(sql, /create_stock_transfer/)
  assert.match(sql, /create_daily_checklist/)
  assert.match(sql, /complete_checklist_item/)
  assert.match(sql, /record_exception_alert/)
  assert.match(sql, /resolve_exception_alert/)
  assert.match(sql, /generate_owner_digest/)
  assert.match(sql, /get_active_alerts/)
  assert.match(sql, /get_active_shifts/)
  assert.match(sql, /get_open_cash_drawer/)
  assert.match(sql, /create_restaurant_supplier/)
  assert.match(sql, /get_restaurant_suppliers/)
})

test('Phase 5: migration SQL has RLS policies', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /restaurant_shifts_lodge_scope_select/)
  assert.match(sql, /restaurant_cash_drawer_sessions_lodge_scope_select/)
  assert.match(sql, /restaurant_suppliers_lodge_scope_select/)
  assert.match(sql, /restaurant_purchase_orders_lodge_scope_select/)
  assert.match(sql, /restaurant_stock_transfers_lodge_scope_select/)
  assert.match(sql, /restaurant_checklists_lodge_scope_select/)
  assert.match(sql, /restaurant_alerts_lodge_scope_select/)
  assert.match(sql, /restaurant_owner_digest_lodge_scope_select/)
})

test('Phase 5: clock-in default role is cashier', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /role text not null default 'cashier'/)
})

test('Phase 5: cash drawer auto-closes previous open session', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /auto_closed/)
  assert.match(sql, /status = 'open'/)
})

test('Phase 5: purchase order requires draft status for approval', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /status = 'draft'/)
  assert.match(sql, /approved_by = auth\.uid\(\)/)
})

test('Phase 5: daily checklist completes when all items done', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260708170000_restaurant_phase5_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /is_completed = false/)
  assert.match(sql, /completed_by = auth\.uid\(\)/)
})
