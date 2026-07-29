import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'fs/promises'

// ── DataManagement ExportTab receives props ────────────────────────
test('DataManagement ExportTab accepts restaurantMode, EXPORT_PRESETS, EXPORT_SECTIONS as props', async () => {
  const src = await readFile('src/renderer/src/components/DataManagement.jsx', 'utf8')
  assert.ok(src.includes('function ExportTab({ restaurantMode, EXPORT_PRESETS, EXPORT_SECTIONS })'), 'ExportTab must accept props')
  assert.ok(src.includes('<ExportTab restaurantMode={restaurantMode} EXPORT_PRESETS={EXPORT_PRESETS} EXPORT_SECTIONS={EXPORT_SECTIONS} />'), 'Parent must pass props to ExportTab')
})

test('DataManagement ExportTab does not reference undefined variables', async () => {
  const src = await readFile('src/renderer/src/components/DataManagement.jsx', 'utf8')
  // ExportTab should only use props, not closure variables
  const exportTabMatch = src.match(/function ExportTab\(\{[^}]+\}\) \{([\s\S]*?)^\}/m)
  assert.ok(exportTabMatch, 'ExportTab function body must exist')
  const body = exportTabMatch[1]
  assert.ok(!body.includes('const restaurantMode'), 'ExportTab must not define its own restaurantMode')
  assert.ok(!body.includes('const EXPORT_PRESETS'), 'ExportTab must not define its own EXPORT_PRESETS')
  assert.ok(!body.includes('const EXPORT_SECTIONS'), 'ExportTab must not define its own EXPORT_SECTIONS')
})

// ── Cash Drawer uses declaredTotal camelCase ──────────────────────
test('RestaurantCashDrawer uses declaredTotal not declared_total', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  assert.ok(src.includes('Number(declaredTotal)'), 'Must use Number(declaredTotal)')
  assert.ok(!src.includes('Number(declared_total)'), 'Must NOT use Number(declared_total)')
})

test('RestaurantCashDrawer sends camelCase payload to openCashDrawerSession', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  assert.ok(src.includes('openingFloat:'), 'Must send openingFloat (camelCase)')
  assert.ok(!src.includes('opening_float:'), 'Must NOT send opening_float (snake_case)')
})

test('RestaurantCashDrawer sends camelCase payload to closeCashDrawerSession', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  assert.ok(src.includes('sessionId:'), 'Must send sessionId')
  assert.ok(src.includes('closingTotal:'), 'Must send closingTotal')
  assert.ok(src.includes('declaredTotal:'), 'Must send declaredTotal')
  assert.ok(!src.includes('session_id:'), 'Must NOT send session_id')
  assert.ok(!src.includes('closing_total:'), 'Must NOT send closing_total')
})

// ── Shifts sends shiftId ─────────────────────────────────────────
test('RestaurantShifts clockOutStaff sends shiftId not shift_id', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantShifts.jsx', 'utf8')
  assert.ok(src.includes('shiftId'), 'Must use shiftId')
  assert.ok(!src.includes('shift_id'), 'Must NOT use shift_id')
})

// ── Purchasing sends raw orderId ──────────────────────────────────
test('RestaurantPurchasing approvePurchaseOrder sends raw orderId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantPurchasing.jsx', 'utf8')
  assert.ok(src.includes('await window.api.pos.approvePurchaseOrder(orderId)'), 'Must send raw orderId')
  assert.ok(!src.includes('approvePurchaseOrder({'), 'Must NOT send object with order_id')
})

test('RestaurantPurchasing receivePurchaseOrder sends raw orderId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantPurchasing.jsx', 'utf8')
  assert.ok(src.includes('await window.api.pos.receivePurchaseOrder(orderId)'), 'Must send raw orderId')
  assert.ok(!src.includes('receivePurchaseOrder({'), 'Must NOT send object with order_id')
})

// ── Alerts sends raw alertId ──────────────────────────────────────
test('RestaurantAlerts resolveAlert sends raw alertId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantAlerts.jsx', 'utf8')
  assert.ok(src.includes('await window.api.pos.resolveAlert(alertId)'), 'Must send raw alertId')
  assert.ok(!src.includes('resolveAlert({'), 'Must NOT send object with alert_id')
})

test('RestaurantAlerts loads resolved history for its Active, Resolved, and All filters', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantAlerts.jsx', 'utf8')
  assert.ok(src.includes('getExceptionAlerts()'), 'Alert history view must load both active and resolved alerts')
})

test('Restaurant feedback records the canonical desktop actor', async () => {
  const sql = await readFile('supabase/migrations/20260716001000_restaurant_feedback_canonical_actor.sql', 'utf8')
  assert.ok(sql.includes('public.app_current_user_id()'), 'Feedback must use the desktop canonical actor')
  assert.ok(sql.includes('Your staff session could not be verified'), 'Feedback must provide a safe recovery message when actor context is unavailable')
})

test('Reservation deposits retain the canonical receiver and prevent duplicate payment references', async () => {
  const migration = await readFile('supabase/migrations/20260716010000_reservation_deposit_canonical_actor.sql', 'utf8')
  assert.ok(migration.includes('v_actor_id uuid := public.app_current_user_id()'), 'Deposit receiver must be the canonical desktop actor')
  assert.ok(migration.includes('received_by, idempotency_key'), 'Deposit insert must record the receiving staff member')
  assert.ok(migration.includes('restaurant_reservation_deposits_lodge_reference_unique'), 'Deposit references must be unique per business')
  assert.ok(migration.includes('This payment reference is already recorded'), 'Duplicate payment references must be rejected with actionable guidance')
})

test('Settlement reconciliation derives the expected total from the POS ledger and records the canonical actor', async () => {
  const migration = await readFile('supabase/migrations/20260716012000_authoritative_settlement_reconciliation.sql', 'utf8')
  const component = await readFile('src/renderer/src/components/restaurant/RestaurantCommercialControl.jsx', 'utf8')
  assert.ok(migration.includes('v_actor_id uuid := public.app_current_user_id()'), 'Settlement recorder must be the canonical desktop actor')
  assert.ok(migration.includes('jsonb_array_elements'), 'Settlement expected totals must be calculated from POS payment breakdowns')
  assert.ok(migration.includes('v_start date') && migration.includes('v_end date'), 'Settlement recording must preserve the reconciled date range')
  assert.ok(component.includes('getSettlementExpectedTotal(settlementStart, settlementEnd, settlement.channel)'), 'Settlement UI must load the server-derived expected total')
  assert.ok(component.includes('Expected POS total'), 'Settlement UI must show the derived expected total rather than an editable field')
})

test('Held reservation deposits are visible in an authorised manager ledger', async () => {
  const migration = await readFile('supabase/migrations/20260716011000_reservation_deposit_ledger_read.sql', 'utf8')
  const component = await readFile('src/renderer/src/components/restaurant/RestaurantCommercialControl.jsx', 'utf8')
  assert.ok(migration.includes('get_restaurant_reservation_deposits'), 'Server must provide an authorised deposit ledger read')
  assert.ok(component.includes('getReservationDeposits(90)'), 'Commercial control must load held deposits on return')
  assert.ok(component.includes('Held deposit ledger'), 'Commercial control must visibly show the held-deposit ledger')
})

test('A repeated reservation deposit clearly reports an idempotent duplicate', async () => {
  const component = await readFile('src/renderer/src/components/restaurant/RestaurantCommercialControl.jsx', 'utf8')
  assert.ok(component.includes('This deposit was already held'), 'Repeated deposits must tell the operator that no second payment was created')
  assert.ok(component.includes("result?.duplicate"), 'Deposit confirmation must distinguish a duplicate response from a new hold')
})

// ── Checklists sends camelCase payloads ───────────────────────────
test('RestaurantChecklists sends camelCase checklistType and itemId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantChecklists.jsx', 'utf8')
  assert.ok(src.includes('checklistType: newType'), 'Must send checklistType')
  assert.ok(!src.includes('checklist_type: newType'), 'Must NOT send checklist_type')
  assert.ok(src.includes('{ itemId }'), 'Must send { itemId }')
  assert.ok(!src.includes('{ item_id:'), 'Must NOT send { item_id: }')
})

// ── Preload exports exist ─────────────────────────────────────────
test('Preload exposes getPurchaseOrders, getShiftHistory, getCashDrawerSessions, getChecklists, getExceptionAlerts', async () => {
  const src = await readFile('src/preload/index.js', 'utf8')
  assert.ok(src.includes('getPurchaseOrders:'), 'getPurchaseOrders must be exposed')
  assert.ok(src.includes('getShiftHistory:'), 'getShiftHistory must be exposed')
  assert.ok(src.includes('getCashDrawerSessions:'), 'getCashDrawerSessions must be exposed')
  assert.ok(src.includes('getChecklists:'), 'getChecklists must be exposed')
  assert.ok(src.includes('getExceptionAlerts:'), 'getExceptionAlerts must be exposed')
})

// ── IPC handlers exist ────────────────────────────────────────────
test('IPC handlers exist for new pos routes', async () => {
  const src = await readFile('src/main/index.js', 'utf8')
  assert.ok(src.includes("pos:getPurchaseOrders"), 'pos:getPurchaseOrders handler must exist')
  assert.ok(src.includes("pos:getShiftHistory"), 'pos:getShiftHistory handler must exist')
  assert.ok(src.includes("pos:getCashDrawerSessions"), 'pos:getCashDrawerSessions handler must exist')
  assert.ok(src.includes("pos:getChecklists"), 'pos:getChecklists handler must exist')
  assert.ok(src.includes("pos:getExceptionAlerts"), 'pos:getExceptionAlerts handler must exist')
})

// ── Domain functions exist in pos.js ──────────────────────────────
test('pos.js exports getPosPurchaseOrders, getShiftHistory, getCashDrawerSessions, getChecklists, getExceptionAlerts', async () => {
  const src = await readFile('src/main/domains/pos.js', 'utf8')
  assert.ok(src.includes('export async function getPosPurchaseOrders('), 'getPosPurchaseOrders must exist')
  assert.ok(src.includes('export async function getShiftHistory('), 'getShiftHistory must exist')
  assert.ok(src.includes('export async function getCashDrawerSessions('), 'getCashDrawerSessions must exist')
  assert.ok(src.includes('export async function getChecklists('), 'getChecklists must exist')
  assert.ok(src.includes('export async function getExceptionAlerts('), 'getExceptionAlerts must exist')
})

// ── database.js re-exports exist ──────────────────────────────────
test('database.js re-exports new pos functions', async () => {
  const src = await readFile('src/main/database.js', 'utf8')
  assert.ok(src.includes('getPosPurchaseOrders'), 'getPosPurchaseOrders must be re-exported')
  assert.ok(src.includes('getShiftHistory'), 'getShiftHistory must be re-exported')
  assert.ok(src.includes('getCashDrawerSessions'), 'getCashDrawerSessions must be re-exported')
  assert.ok(src.includes('getChecklists'), 'getChecklists must be re-exported')
  assert.ok(src.includes('getExceptionAlerts'), 'getExceptionAlerts must be re-exported')
})

// ── Export function uses correct names ─────────────────────────────
test('Export function in index.js uses getShiftHistory not getShifts', async () => {
  const src = await readFile('src/main/index.js', 'utf8')
  assert.ok(src.includes('db.getShiftHistory'), 'Must use db.getShiftHistory')
  assert.ok(!src.includes('db.getShifts?.'), 'Must NOT use db.getShifts')
})

test('Export function passes date range to getPosPurchaseOrders', async () => {
  const src = await readFile('src/main/index.js', 'utf8')
  assert.ok(src.includes('db.getPosPurchaseOrders?.(normalized.startDate, normalized.endDate)'), 'Must pass dates to getPosPurchaseOrders')
})

// ── RestaurantKitchen updateTicketStatus uses positional args ──────
test('RestaurantKitchen updateTicketStatus sends (id, status) not object', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantKitchen.jsx', 'utf8')
  assert.ok(src.includes('updateTicketStatus(ticketId, newStatus)'), 'Must send positional args')
  assert.ok(!src.includes('updateTicketStatus({'), 'Must NOT send object')
})

test('Restaurant reservation seating uses the deployed JSON RPC contract', async () => {
  const source = await readFile('src/main/domains/pos.js', 'utf8')
  const migration = await readFile('supabase/migrations/20260716009000_reservation_capacity_and_combined_tables.sql', 'utf8')
  assert.ok(source.includes("rpc('seat_restaurant_reservation', {\n      payload:"), 'Reservation seating must call the JSON payload RPC signature')
  assert.ok(migration.includes("status = 'seated'"), 'Reservation seating must persist the seated state')
  assert.ok(migration.includes('FROM public.pos_tables'), 'Reservation seating must validate the same POS floor table catalogue shown to the operator')
  assert.ok(migration.includes('FOR UPDATE;'), 'Reservation seating must lock records against concurrent table assignment')
  assert.ok(migration.includes("r.status = 'seated'"), 'Reservation seating must reject an occupied table')
  assert.ok(migration.includes('v_total_seats < v_reservation.party_size'), 'Reservation seating must reject a table selection without enough seats')
  assert.ok(migration.includes('restaurant_reservation_table_assignments'), 'Reservation seating must retain every table in a combined-table assignment')
  assert.ok(migration.includes('get_restaurant_floor_occupancy'), 'The Floor view must receive seated reservation occupancy')
})

// ── Checklists item field names match SQL schema ──────────────────
test('RestaurantChecklists uses is_completed and item_label field names', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantChecklists.jsx', 'utf8')
  assert.ok(src.includes('is_completed'), 'Must use is_completed (matches SQL)')
  assert.ok(src.includes('item_label'), 'Must use item_label (matches SQL)')
  assert.ok(src.includes('({ label: l.trim() })'), 'Checklist creation must send the label field required by the RPC')
})

test('Staff guest feedback has a least-privilege IPC path from My Shift', async () => {
  const [shift, preload, main] = await Promise.all([
    readFile('src/renderer/src/components/hospitality-pos/HposMyShift.jsx', 'utf8'),
    readFile('src/preload/index.js', 'utf8'),
    readFile('src/main/index.js', 'utf8'),
  ])
  assert.ok(shift.includes('submitStaffFeedback'), 'My Shift must submit staff feedback')
  assert.ok(preload.includes('submitStaffFeedback:'), 'Preload must expose staff feedback submission')
  assert.ok(main.includes("pos:submitStaffFeedback"), 'Main process must register staff feedback submission')
  assert.ok(main.includes("requireCapability('pos.view')"), 'Staff feedback must use POS view access, not manager-only access')
})

test('Manager feedback follow-up queue is server-authorised and visible in commercial control', async () => {
  const [migration, control, preload, main, domain] = await Promise.all([
    readFile('supabase/migrations/20260716003000_restaurant_feedback_manager_queue.sql', 'utf8'),
    readFile('src/renderer/src/components/restaurant/RestaurantCommercialControl.jsx', 'utf8'),
    readFile('src/preload/index.js', 'utf8'),
    readFile('src/main/index.js', 'utf8'),
    readFile('src/main/domains/pos.js', 'utf8'),
  ])
  assert.ok(migration.includes('get_restaurant_feedback'), 'Feedback queue requires an authoritative read RPC')
  assert.ok(migration.includes("array['manager', 'admin', 'super_admin']"), 'Feedback queue must be manager-restricted server-side')
  assert.ok(control.includes('Manager follow-up queue'), 'Commercial Control must show manager feedback follow-up')
  assert.ok(preload.includes('getFeedback:'), 'Preload must expose the manager feedback queue')
  assert.ok(main.includes("pos:getFeedback"), 'Main process must register the feedback queue')
  assert.ok(domain.includes('getRestaurantFeedback'), 'POS domain must retrieve the feedback queue')
})

test('Restaurant setup readiness is evidence-based and guides all 20 stages', async () => {
  const [migration, screen, preload, main, domain] = await Promise.all([
    readFile('supabase/migrations/20260716005000_restaurant_financial_setup_readiness.sql', 'utf8'),
    readFile('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx', 'utf8'),
    readFile('src/preload/index.js', 'utf8'),
    readFile('src/main/index.js', 'utf8'),
    readFile('src/main/domains/pos.js', 'utf8'),
  ])
  assert.ok(migration.includes("'detected'"), 'Setup readiness must return detected evidence, not self-attested completion')
  assert.ok(migration.includes('pos_cashup_submissions'), 'Readiness must prove manager-approved cash-up')
  assert.ok(migration.includes('restaurant_cash_drawer_sessions'), 'Readiness must prove a drawer close')
  assert.ok(migration.includes('restaurant_owner_digest'), 'Readiness must prove end-of-day reporting')
  assert.ok(migration.includes('restaurant_setup_evidence'), 'Readiness must prove a protected data export')
  assert.ok(migration.includes("array['manager', 'admin', 'super_admin']"), 'Setup progress must be manager-restricted server-side')
  assert.ok(screen.includes('go_live_review'), 'Readiness screen must include the go-live review stage')
  assert.equal((screen.match(/\['[a-z_]+',/g) || []).length, 20, 'Readiness screen must contain exactly 20 setup stages')
  assert.ok(screen.includes('<strong>How:</strong>'), 'Each stage must tell the manager how to complete it')
  assert.ok(!screen.includes('Confirm'), 'Managers must not self-attest readiness with a Confirm button')
  assert.ok(preload.includes('getSetupProgress:'), 'Preload must expose setup progress')
  assert.ok(main.includes("pos:setSetupStage"), 'Main process must register setup updates')
  assert.ok(domain.includes('setRestaurantSetupStage'), 'POS domain must use the authoritative setup RPC')
})

test('Successful protected data exports automatically create setup readiness evidence', async () => {
  const [migration, index, domain] = await Promise.all([
    readFile('supabase/migrations/20260716005000_restaurant_financial_setup_readiness.sql', 'utf8'),
    readFile('src/main/index.js', 'utf8'),
    readFile('src/main/domains/pos.js', 'utf8'),
  ])
  assert.ok(migration.includes('record_restaurant_setup_evidence'), 'Database must own setup evidence recording')
  assert.ok(index.includes("evidence_key: 'data_export'"), 'A successful data export must record data-export evidence')
  assert.ok(index.includes('Export succeeded but setup evidence could not be recorded'), 'Export success must remain truthful if evidence recording fails')
  assert.ok(domain.includes('recordRestaurantSetupEvidence'), 'POS domain must call the authoritative evidence RPC')
})

test('Setup board retires automatically once all evidence-based stages are detected', async () => {
  const [manage, readiness] = await Promise.all([
    readFile('src/renderer/src/components/hospitality-pos/HposManageHub.jsx', 'utf8'),
    readFile('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx', 'utf8'),
  ])
  assert.ok(manage.includes('stages.length === 20 && stages.every'), 'Manage must hide setup only after all 20 stages are detected')
  assert.ok(manage.includes('!setupComplete'), 'Manage must not render the readiness link after completion')
  assert.ok(readiness.includes("navigate('/hpos/manage', { replace: true })"), 'Completed readiness route must retire itself')
})

test('Bar-only setup does not require restaurant tables or food recipes', async () => {
  const migration = await readFile('supabase/migrations/20260716006000_restaurant_setup_readiness_bar_mode.sql', 'utf8')
  assert.ok(migration.includes("v_bar_only or exists(select 1 from public.restaurant_tables"), 'Bar-only mode must bypass table setup')
  assert.ok(migration.includes("v_bar_only or exists(select 1 from public.restaurant_recipes"), 'Bar-only mode must bypass food recipe setup')
  assert.ok(migration.includes("status = 'approved'"), 'Financial controls must remain required for bar-only mode')
})

test('Restaurant workspace provides history back and forward controls outside the Till', async () => {
  const src = await readFile('src/renderer/src/components/hospitality-pos/HposLayout.jsx', 'utf8')
  assert.ok(src.includes('hpos-history-nav'), 'HPOS layout must render page-history controls')
  assert.ok(src.includes('window.history.back()'), 'Back control must use browser history')
  assert.ok(src.includes('window.history.forward()'), 'Forward control must use browser history')
  assert.ok(src.includes('disabled={!historyAvailability.canGoBack}'), 'Back must be disabled when no prior page exists')
  assert.ok(src.includes('disabled={!historyAvailability.canGoForward}'), 'Forward must be disabled when no next page exists')
  assert.ok(src.includes('!isTillRoute && ('), 'History controls must stay out of the Till workspace')
})

// ── No references to undefined declared_total variable ─────────────
test('RestaurantCashDrawer has no reference to undefined declared_total variable', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  // Check for standalone declared_total (not as property key in object)
  const lines = src.split('\n')
  const badLines = lines.filter(l => l.trim().startsWith('declared_total') && !l.includes("'declared_total'") && !l.includes('"declared_total"'))
  assert.equal(badLines.length, 0, `Found lines with undefined declared_total: ${badLines.join('; ')}`)
})
