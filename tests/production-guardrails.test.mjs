import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { isFinancialSyncItem, pickNextReadySyncItemIndex } from '../src/shared/syncQueue.js'

async function read(path) {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT' || !path.startsWith('supabase/migrations/')) throw error
    const fileName = path.split('/').pop()
    return readFile(new URL(`../supabase/migrations_archive/2026-05-26-pre-baseline/${fileName}`, import.meta.url), 'utf8')
  }
}

async function readTree(path) {
  const root = new URL(`../${path}/`, import.meta.url)
  const entries = await readdir(root, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    const childPath = `${path}/${entry.name}`
    if (entry.isDirectory()) {
      sources.push(...await readTree(childPath))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      sources.push(await read(childPath))
    }
  }
  return sources
}

async function readSqlTree(path) {
  const root = new URL(`../${path}/`, import.meta.url)
  const entries = await readdir(root, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    const childPath = `${path}/${entry.name}`
    if (entry.isDirectory()) {
      sources.push(...await readSqlTree(childPath))
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      sources.push({ path: childPath, source: await read(childPath) })
    }
  }
  return sources
}

async function run() {
  // ── Migration version uniqueness ───────────────────────────────────────────
  const migrationFiles = await readdir(new URL('../supabase/migrations/', import.meta.url))
  const versions = migrationFiles
    .filter(f => f.endsWith('.sql'))
    .map(f => f.match(/^(\d{14})/)?.[1])
    .filter(Boolean)
  const dupeVersions = versions.filter((v, i, a) => a.indexOf(v) !== i)
  assert.equal(dupeVersions.length, 0,
    `Duplicate migration version prefixes: ${dupeVersions.join(', ')}. ` +
    'Each migration must have a unique 14-digit UTC-timestamp prefix.')

  const preload = await read('src/preload/index.js')
  assert.match(preload, /const invoke = \(channel, \.\.\.args\) => ipcRenderer\.invoke\(channel, \.\.\.args\)/)
  assert.match(preload, /snapshot:\s*\(today\)\s*=>\s*(?:invoke|ipcRenderer\.invoke)\('reports:snapshot', today\)/)
  assert.match(preload, /financialValidationAlerts:\s*\(limit\)\s*=>\s*(?:invoke|ipcRenderer\.invoke)\('reports:financialValidationAlerts', limit\)/)
  assert.match(preload, /criticalErrors:\s*\(limit\)\s*=>\s*(?:invoke|ipcRenderer\.invoke)\('reports:criticalErrors', limit\)/)
  assert.match(preload, /saveSupportBundle:\s*\(limit\)\s*=>\s*(?:invoke|ipcRenderer\.invoke)\('reports:saveSupportBundle', limit\)/)

  const mainIndex = await read('src/main/index.js')
  const databaseFacade = await read('src/main/database.js')
  const database = [databaseFacade, ...(await readTree('src/main/domains'))].join('\n')
  const syncQueueSource = await read('src/shared/syncQueue.js')
  const surfaceIntelligence = await read('src/renderer/src/components/SurfaceIntelligence.jsx')
  const adminApi = await read('src/renderer/src/utils/adminApi.js')
  const legacyPosMain = await read('legacy-pos/src/main/index.js')
  assert.match(mainIndex, /ipcMain\.handle\('reports:snapshot'/)
  assert.match(mainIndex, /ipcMain\.handle\('reports:saveSupportBundle'/)
  assert.match(mainIndex, /function buildReportExportFilename\(/)
  assert.match(mainIndex, /function buildWorkbookMetaRows\(/)
  assert.match(database, /export async function getReportsSnapshot\(/)
  assert.match(database, /export async function getSupportBundle\(/)
  assert.match(database, /supabase\.rpc\('get_reports_snapshot'/)
  assert.match(database, /supabase\.rpc\('get_revenue_report'/)
  assert.match(database, /supabase\.rpc\('get_profit_loss_summary'/)
  assert.match(database, /supabase\.rpc\('get_outlet_profit_loss_summary'/)
  assert.match(database, /supabase\.rpc\('get_room_profitability_summary'/)
  assert.match(database, /supabase\.rpc\('get_pos_sales_summary'/)
  assert.match(database, /supabase\.rpc\('get_inventory_spend_summary'/)
  assert.match(database, /supabase\.rpc\('get_supply_spend_summary'/)
  assert.match(database, /function isStatementTimeoutError\(error\)/)
  assert.match(database, /financial\.reconciliation\.timeout/)
  assert.match(database, /buildFinancialVerificationUnavailable\(error, 'reconciliation'\)/)
  assert.match(database, /function refreshSettingsCacheInBackground\(/)
  assert.match(database, /const cachedSettings = getCachedSettings\(\)[\s\S]{0,120}return cachedSettings/)
  assert.match(database, /recordCriticalError\('reports\.revenue'/)
  assert.match(database, /recordCriticalError\('reports\.profit_loss'/)
  assert.match(database, /recordCriticalError\('reports\.outlet_profit_loss'/)
  assert.match(database, /recordCriticalError\('reports\.room_profitability'/)
  assert.match(database, /recordCriticalError\('reports\.pos_sales'/)
  assert.match(database, /recordCriticalError\('reports\.inventory_spend'/)
  assert.match(database, /recordCriticalError\('reports\.supply_spend'/)
  assert.match(database, /function isNonCriticalOperationalError\(scope, errorOrMessage = ''\)/)
  assert.match(database, /readCache\('booking-refund-requests'\)/)
  assert.match(database, /appendOperationJournalEntry\('refund_request_saved'/)
  assert.match(database, /pending_approval/)
  assert.match(database, /supabase\.rpc\('verify_refund_approver_pin'/)
  assert.match(database, /supabase\.rpc\('approve_booking_refund'/)
  assert.doesNotMatch(database, /queueOperation\('rpc',\s*'approve_booking_refund'/)
  assert.match(database, /if \(isNonCriticalOperationalError\(scope, message\)\) return null/)
  assert.match(database, /filter\(\(entry\) => !isNonCriticalOperationalError\(entry\?\.scope, entry\?\.message\)\)/)
  assert.doesNotMatch(database, /payment_status:\s*depositStatus/)
  assert.doesNotMatch(database, /amount_paid:\s*deposit\s*>\s*0\s*\?\s*deposit\s*:\s*0/)
  assert.doesNotMatch(database, /payment_status:\s*payStatus/)
  assert.match(database, /cached\[idx\]\s*=\s*\{\s*\.\.\.b,\s*amount_paid:\s*newPaid/)
  assert.match(database, /_pending_payment:\s*true,\s*\/\/ local estimate/)
  assert.match(database, /_pending_payment:\s*deposit\s*>\s*0/)
  assert.match(database, /_pending_payment:\s*true,\s*\/\/ local estimate/)
  assert.match(database, /export async function getUserById\(/)
  assert.match(database, /export async function getInventoryItemById\(/)
  assert.match(database, /export async function getSupplyItemById\(/)
  assert.match(database, /export async function getPosMenuItemById\(/)
  assert.match(database, /function getCachedActiveBookingForRoom\(roomId\)/)
  assert.match(database, /if \(!state\.isOnline\) return getCachedActiveBookingForRoom\(roomId\)/)
  assert.match(database, /let bookingId = cachedBooking\?\.id \|\| data\.booking_id \|\| null/)
  assert.match(database, /getActiveBookingForRoom\(data\.room_id\)/)
  assert.match(database, /FINANCIAL_SYNC_TABLES[\s\S]{0,120}isFinancialSyncItem[\s\S]{0,120}pickNextReadySyncItemIndex[\s\S]{0,120}shared\/syncQueue\.js/)
  assert.match(database, /Blocked: unresolved sync dependency cycle/)
  assert.match(syncQueueSource, /Array\.isArray\(item\?\._depends_on_all\)/)
  assert.match(syncQueueSource, /failedQueueIds\.has\(dependencyId\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('User', id, db\.getUserById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('Room', id, db\.getRoomById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('Inventory item', itemId, db\.getInventoryItemById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('Supply item', itemId, db\.getSupplyItemById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('POS menu item', id, db\.getPosMenuItemById\)/)

  const authLogin = await read('src/main/domains/authLogin.js')
  assert.match(authLogin, /supabase_auth_not_migrated/)
  assert.match(authLogin, /\['supabase_auth_unavailable', 'supabase_auth_not_migrated'\]\.includes\(supabaseAuth\.code\)/)
  assert.doesNotMatch(authLogin, /if \(supabaseAuth\.user \|\| supabaseAuth\.code !== 'supabase_auth_unavailable'\)/)

  const panel = await read('src/renderer/src/components/SystemHealthPanel.jsx')
  assert.match(panel, /financialValidationAlerts\?\.\(8\)/)
  assert.match(panel, /criticalErrors\?\.\(8\)/)
  assert.match(panel, /getSupportBundle\?\.\(25\)/)
  assert.match(panel, /Send Report/)
  assert.match(panel, /This device only — does not reflect PWA\/browser queue state/)
  assert.match(panel, /Validation Alerts/)
  assert.match(panel, /Critical Error Log/)
  assert.match(panel, /item\.dependencyLabel \|\| `Dependency: \$\{item\.dependencyState \|\| 'unknown'\}`/)
  assert.match(panel, /Cannot verify financial agreement — offline/)
  assert.match(panel, /Manual Clear Left Integrity Unproven/)
  assert.match(panel, /Server Mismatch Detected During Replay/)
  assert.match(panel, /Run Sync Now/)
  assert.match(panel, /integrity alert\(s\) were recorded because remote persistence is still unconfirmed/)
  assert.match(panel, /operatorSyncText/)
  const { sanitizeForOperator } = await import('../src/shared/operatorSyncText.js')
  assert.equal(
    sanitizeForOperator('Monthly booking creation limit reached for Starter plan'),
    'Booking could not sync because the monthly booking creation limit has been reached.'
  )
  assert.equal(
    sanitizeForOperator('Booking limit reached for the selected check-in month on Starter plan'),
    'Booking could not sync because the selected check-in month has reached the plan limit.'
  )
  assert.equal(
    sanitizeForOperator('Room creation could not sync because this lodge is above the current plan room limit after a downgrade.'),
    'Room creation could not sync because this property is above the current plan room limit after a downgrade. Upgrade or reduce rooms, then retry.'
  )
  assert.equal(
    sanitizeForOperator('Staff user creation could not sync because this lodge is above the current plan user limit after a downgrade.'),
    'Staff user creation could not sync because this property is above the current plan user limit after a downgrade. Upgrade or reduce staff users, then retry.'
  )

  assert.match(database, /'pos-orders':\s*\(\)\s*=>\s*(state\.)?supabase[\s\S]*?from\('pos_orders'\)/)
  assert.doesNotMatch(database, /from\('pos_orders'\)\.\s*select\('[^']*updated_at[^']*pos_order_items/)
  assert.match(database, /function markClearedSyncItemForManualReview\(/)
  assert.match(database, /_sync_state:\s*'manual_review_required'/)
  assert.match(database, /type:\s*isFinancial\s*\?\s*'financial_dead_letter_cleared'\s*:\s*'dead_letter_cleared'/)
  assert.match(database, /severity:\s*isFinancial\s*\?\s*'error'\s*:\s*'warn'/)
  assert.match(database, /const safeSeverity = fault\.severity === 'error' \? 'error' : 'warn'/)
  assert.match(database, /severity:\s*safeSeverity/)
  assert.match(database, /fault\.context && typeof fault\.context === 'object'/)
  assert.match(database, /function valuesEqualForDrift\(/)
  assert.match(database, /function isReplayContractProbeFailure\(/)
  assert.match(database, /contract mismatch/)
  assert.match(database, /probeRpc\('create_booking'/)
  assert.match(database, /probeRpc\('create_pos_order'/)
  assert.match(database, /probeRpc\('delete_booking_charge'/)
  assert.match(database, /function getOfflinePosInventoryReservation\(/)
  assert.match(database, /function applyOfflinePosInventoryReservation\(/)
  assert.match(database, /function buildQueuedPosInventoryUsage\(/)
  assert.match(database, /function applyQueuedPosInventoryReservations\(/)
  assert.match(database, /function mergeRemotePosOrdersWithLocalState\(/)
  assert.match(database, /POS voids require supervisor, manager, or admin PIN approval/)
  assert.match(database, /refreshCache\('pos-orders', 'inventory-items', 'inventory-purchases'\)\.catch\(\(\) => \{\}\)/)
  assert.match(database, /const inventoryReservations = getOfflinePosInventoryReservation\(items\)/)
  assert.match(database, /applyOfflinePosInventoryReservation\(inventoryReservations\)/)
  assert.match(database, /shouldRefreshInventory = true/)
  assert.match(database, /inventory_item_id:\s*item\.inventory_item_id\s*\|\|\s*null/)
  assert.match(database, /depletion_qty:\s*normalizePositiveQty\(item\.depletion_qty, 1\)/)
  assert.match(database, /queueOperation\('rpc', 'adjust_inventory_stock'/)
  assert.match(database, /export async function getInventoryMovements\(/)
  assert.match(database, /async function fetchInventoryItemsForRefresh\(\)[\s\S]*?from\('inventory_items'\)[\s\S]*?INVENTORY_ITEM_LEGACY_SELECT/)
  assert.match(database, /'inventory-items':\s*\(\)\s*=>\s*fetchInventoryItemsForRefresh\(\)/)
  assert.match(database, /'inventory-purchases':\s*\(\)\s*=>\s*(state\.)?supabase[\s\S]*?from\('inventory_purchases'\)/)
  assert.match(database, /refreshCache\(\s*'inventory-items',\s*'inventory-purchases',\s*'inventory-stocktakes'\s*\)[\s\S]{0,120}\.catch\(\(\) => refreshOfflinePosInventoryProjection\(\)\)/)
  assert.match(database, /async function _getInventoryItems\(options = \{\}\)\s*\{[\s\S]*?if \(state\.isOnline\)/)
  assert.match(database, /export function getInventoryItems\(options = \{\}\)\s*\{[\s\S]*?dedupePromise\(`getInventoryItems:\$\{exportAll \? 'export' : 'screen'\}`, \(\) => _getInventoryItems\(options\)\)/)
  assert.match(database, /getInventoryItems received empty live result; using cached inventory items instead/)
  assert.match(database, /export async function getInventoryPurchases\(itemId\)\s*\{[\s\S]*?getInventoryPurchases received empty live result; using cached purchases instead/)
  assert.match(database, /getInventoryPurchases falling back to cache:/)
  assert.match(database, /export async function getLowStockItems\(\)\s*\{[\s\S]*?getInventoryItems\(\)\.catch\(\(\) => readCache\('inventory-items'\)\)/)
  assert.match(database, /if \(name === 'outlets'\)[\s\S]{0,400}writeCache\(name, cachedRows, \{ source: 'cache' \}\)/)
  assert.match(database, /for \(const name of targetNames\)[\s\S]*refreshCacheStrict\(name\)/)
  assert.match(database, /const mergedLiveRows = mergeRemotePosOrdersWithLocalState\(data \|\| \[\], cachedOrders\)/)
  assert.match(mainIndex, /inventory:getItems failed:/)
  assert.match(mainIndex, /Could not load inventory items right now\./)
  assert.match(database, /function buildEventGroupId\(/)
  assert.match(database, /const eventIdempotencyKey = `event-booking:\$\{groupId\}`/)
  assert.match(database, /representativeRoom/)
  assert.match(database, /room_number:\s*'Full Lodge'/)
  assert.match(database, /export async function repairDuplicateEventBookings\(/)
  assert.match(mainIndex, /admin:repairDuplicateEventBookings/)
  assert.match(preload, /repairDuplicateEventBookings:\s*\(lodgeId\)\s*=>\s*(?:invoke|ipcRenderer\.invoke)\('admin:repairDuplicateEventBookings', lodgeId\)/)
  assert.doesNotMatch(database, /pricePerRoom/)
  assert.doesNotMatch(database, /depositPerRoom/)

  const eventSingletonSql = await read('supabase/migrations/20260521_event_booking_singleton_guard.sql')
  assert.match(eventSingletonSql, /guard_single_active_event_booking/)
  assert.match(eventSingletonSql, /trg_single_active_event_booking/)
  assert.match(eventSingletonSql, /An active exclusive event booking already exists/)
  const eventRepairSql = await read('supabase/migrations/20260522_repair_duplicate_event_bookings.sql')
  assert.match(eventRepairSql, /repair_duplicate_event_bookings/)
  assert.match(eventRepairSql, /delete from public\.invoices/)
  assert.match(eventRepairSql, /delete from public\.bookings/)
  assert.doesNotMatch(eventRepairSql, /where\s+lodge_id\s*=/i)
  const eventRepairAmbiguityFixSql = await read('supabase/migrations/20260523_fix_repair_duplicate_event_bookings_ambiguous_lodge_id.sql')
  assert.match(eventRepairAmbiguityFixSql, /repair_duplicate_event_bookings/)
  assert.match(eventRepairAmbiguityFixSql, /where p\.lodge_id = v_group\.lodge_id/)
  assert.match(eventRepairAmbiguityFixSql, /where b\.lodge_id = v_group\.lodge_id/)
  assert.doesNotMatch(eventRepairAmbiguityFixSql, /where\s+lodge_id\s*=/i)

  const reports = await read('src/renderer/src/components/Reports.jsx')
  assert.match(reports, /Report Export/)
  assert.match(reports, /Excel export bundles the report pack into separate sheets/)
  assert.match(reports, /Excel Workbook/)
  assert.match(reports, /reportSourceBadges/)
  assert.match(reports, /Data source/)
  assert.match(reports, /Offline data \(last synced:/)
  assert.match(reports, /Revenue/)
  assert.match(reports, /Room profit/)
  assert.match(reports, /P&L/)
  assert.match(reports, /Outlet P&L/)
  assert.match(reports, /POS/)
  assert.match(reports, /Costs/)
  assert.match(reports, /Maintenance Repairs/)
  assert.match(reports, /Running Cost/)
  assert.match(reports, /Stock & Maintenance Costs/)
  assert.doesNotMatch(reports, /bb_strict_finance_reports/)
  assert.doesNotMatch(reports, /Strict Finance Mode On/)

  const appShell = await read('src/renderer/src/App.jsx')
  assert.match(appShell, /function FinancialHealthBanner\(/)
  assert.match(appShell, /criticalErrors\?\.\(3\)/)
  assert.match(appShell, /const navigate = useNavigate\(\)/)
  assert.match(appShell, /navigate\('\/settings', \{ state: \{ activeTab: 'system' \} \}\)/)
  assert.doesNotMatch(appShell, /window\.location\.hash = '#\/settings'/)
  assert.match(appShell, /<FinancialHealthBanner \/>/)

  const layout = await read('src/renderer/src/components/Layout.jsx')
  assert.match(layout, /Clock/)
  assert.match(layout, /AlertCircle/)
  assert.match(layout, /from 'lucide-react'/)
  assert.match(layout, /!isPosRoute && <OfflineNotice tasks=\{currentOfflineTasks\} \/>/)

  const posUi = await read('src/renderer/src/components/POS.jsx')
  assert.match(posUi, /onClick=\{\(\) => openVoidModal\(o\)\}/)
  assert.doesNotMatch(posUi, /window\.api\.pos\.voidOrder\(o\.id\)/)
  assert.match(posUi, /Approve Offline Void/)
  assert.match(posUi, /Awaiting sync record/)
  assert.match(posUi, /inputMode="numeric"/)
  assert.match(posUi, /let selectedBookingId = null/)
  assert.match(posUi, /booking_id: customerType === 'room' \? selectedBookingId : null/)

  const resetSql = await read('supabase/migrations/20260426_test_reset_invoice_cleanup_fix.sql')
  assert.match(resetSql, /invoice_number = any\(v_invoice_numbers\)/)
  assert.match(resetSql, /delete from public\.invoices/)

  const reportsSql = await read('supabase/migrations/20260426_reporting_range_authority.sql')
  assert.match(reportsSql, /create or replace function public\.get_revenue_report/)
  assert.match(reportsSql, /create or replace function public\.get_profit_loss_summary/)
  const maintenanceReportsSql = await read('supabase/migrations/20260524_maintenance_cost_reporting.sql')
  assert.match(maintenanceReportsSql, /create or replace function public\.get_profit_loss_summary/)
  assert.match(maintenanceReportsSql, /maintenanceCosts/)
  assert.match(maintenanceReportsSql, /create or replace function public\.get_room_profitability_summary/)
  assert.match(maintenanceReportsSql, /running_cost/)
  assert.match(reportsSql, /grant execute on function public\.get_revenue_report\(uuid, date, date\)/)
  assert.match(reportsSql, /grant execute on function public\.get_profit_loss_summary\(uuid, date, date\)/)

  const detailReportsSql = await read('supabase/migrations/20260427_report_detail_authority.sql')
  assert.match(detailReportsSql, /create or replace function public\.get_outlet_profit_loss_summary/)
  assert.match(detailReportsSql, /create or replace function public\.get_room_profitability_summary/)
  assert.match(detailReportsSql, /grant execute on function public\.get_outlet_profit_loss_summary\(uuid, date, date\)/)
  assert.match(detailReportsSql, /grant execute on function public\.get_room_profitability_summary\(uuid, date, date\)/)

  const operationsReportsSql = await read('supabase/migrations/20260427_operations_report_authority.sql')
  assert.match(operationsReportsSql, /create or replace function public\.get_pos_sales_summary/)
  assert.match(operationsReportsSql, /create or replace function public\.get_inventory_spend_summary/)
  assert.match(operationsReportsSql, /create or replace function public\.get_supply_spend_summary/)
  assert.match(operationsReportsSql, /grant execute on function public\.get_pos_sales_summary\(uuid, date, date, text\)/)
  assert.match(operationsReportsSql, /grant execute on function public\.get_inventory_spend_summary\(uuid, date, date, text\)/)
  assert.match(operationsReportsSql, /grant execute on function public\.get_supply_spend_summary\(uuid, date, date\)/)

  const posReplaySql = await read('supabase/migrations/20260507_pos_offline_inventory_payload.sql')
  assert.match(posReplaySql, /create or replace function public\.create_pos_order\(payload jsonb\)/)
  assert.match(posReplaySql, /inventory_item_id/)
  assert.match(posReplaySql, /depletion_qty/)
  assert.match(posReplaySql, /name = v_item_name/)

  const posLaunchReadinessSql = await read('supabase/migrations/20260604120000_pos_inventory_launch_readiness.sql')
  assert.match(posLaunchReadinessSql, /create table if not exists public\.inventory_movements/)
  assert.match(posLaunchReadinessSql, /create table if not exists public\.pos_cashup_sessions/)
  assert.match(posLaunchReadinessSql, /create or replace function public\.upsert_pos_cashup/)
  assert.match(posLaunchReadinessSql, /public\._positive_depletion_qty/)
  assert.match(posLaunchReadinessSql, /inventory_item_id, depletion_qty/)

  const posVoidHardeningSql = await read('supabase/migrations/20260524_pos_void_pin_stock_hardening.sql')
  assert.match(posVoidHardeningSql, /alter table public\.pos_order_items/)
  assert.match(posVoidHardeningSql, /create or replace function public\.populate_pos_order_item_inventory_link\(\)/)
  assert.match(posVoidHardeningSql, /coalesce\(poi\.inventory_item_id, pmi\.inventory_item_id\) as inventory_item_id/)
  assert.match(posVoidHardeningSql, /create or replace function public\.void_pos_order/)
  assert.match(posVoidHardeningSql, /POS voids require supervisor, manager, or admin PIN approval/)
  assert.match(posVoidHardeningSql, /create or replace function public\.approve_pos_void_with_pin\(payload jsonb\)/)
  assert.match(posVoidHardeningSql, /'restored_stock', v_restored/)

  const bookingUsageHardeningSql = await read('supabase/migrations/20260429_booking_timestamp_hardening.sql')
  assert.match(bookingUsageHardeningSql, /new\.created_at := coalesce\(new\.created_at, now\(\)\)/)
  assert.match(bookingUsageHardeningSql, /alter table public\.bookings/)
  assert.match(bookingUsageHardeningSql, /alter column created_at set default now\(\)/)
  assert.match(bookingUsageHardeningSql, /Booking limit reached for the selected check-in month on % plan/)
  assert.match(bookingUsageHardeningSql, /Monthly booking creation limit reached for % plan/)
  const createdAtServerSourceSql = await read('supabase/migrations/20260430_booking_created_at_server_source.sql')
  assert.match(createdAtServerSourceSql, /new\.created_at := now\(\);/)
  assert.match(createdAtServerSourceSql, /alter table public\.bookings/)
  assert.match(createdAtServerSourceSql, /alter column created_at set default now\(\)/)
  assert.match(createdAtServerSourceSql, /Booking limit reached for the selected check-in month on % plan/)
  assert.match(createdAtServerSourceSql, /Monthly booking creation limit reached for % plan/)
  assert.doesNotMatch(createdAtServerSourceSql, /coalesce\(new\.created_at, now\(\)\)/)

  const sqlUsageHarness = await read('tests/sql-usage-limit-check.mjs')
  assert.match(sqlUsageHarness, /SQL_USAGE_TEST_LODGE_ID/)
  assert.match(sqlUsageHarness, /selected check-in month/)
  assert.match(sqlUsageHarness, /120 base \+ 2 grace bookings/)
  assert.doesNotMatch(sqlUsageHarness, /monthly booking creation limit/i)

  const adminCentral = await read('src/renderer/src/components/AdminCentral.jsx')
  const adminDomain = await read('src/main/domains/admin.js')
  const licensingWorkbench = await read('src/renderer/src/components/LicensingWorkbench.jsx')
  const bookingsUi = await read('src/renderer/src/components/Bookings.jsx')
  const roomsUi = await read('src/renderer/src/components/Rooms.jsx')
  const staffUi = await read('src/renderer/src/components/Staff.jsx')
  const maintenanceDomain = await read('src/main/domains/maintenance.js')
  const cacheRefreshDomain = await read('src/main/domains/cacheRefresh.js')
  const infrastructureDomain = await read('src/main/domains/infrastructure.js')
  const notificationInbox = await read('src/renderer/src/components/NotificationInbox.jsx')
  const fleetHealth = await read('src/renderer/src/components/FleetHealth.jsx')
  const releaseControl = await read('src/renderer/src/components/ReleaseControl.jsx')
  assert.match(adminCentral, /Needs Attention/)
  assert.match(adminCentral, /Near limit/)
  assert.match(adminCentral, /In grace/)
  assert.match(adminCentral, /Above plan/)
  assert.match(adminCentral, /Upgrade opportunities/)
  assert.match(adminCentral, /recommendedPlan/)
  assert.match(adminCentral, /Request Upgrade/)
  assert.match(adminCentral, /Peak usage this session/)
  assert.match(adminCentral, /currentBookingsUsagePercent/)
  assert.match(adminCentral, /peakBookingsUsagePercent/)
  assert.match(adminCentral, /lastBookingDate/)
  assert.match(adminCentral, /Last activity/)
  assert.match(adminCentral, /trackUpgradeIntent/)
  assert.match(adminDomain, /function licenseFromEntitlement\(/)
  assert.match(adminDomain, /fillMissingLicensesFromEntitlements\(db, normalized\)/)
  assert.match(adminDomain, /rpc\('get_lodge_entitlement'/)
  assert.match(adminDomain, /source_license_id/)
  assert.match(adminDomain, /getAdminEntitlement\(db, targetLodgeId\)/)
  assert.match(adminDomain, /COMPANY_SETTINGS_LEGACY_SELECT/)
  assert.match(adminDomain, /COMPANY_SETTINGS_MINIMAL_SELECT/)
  assert.match(adminDomain, /isSettingsColumnError/)
  assert.match(adminDomain, /message\.includes\('updated_at'\)/)
  assert.match(adminDomain, /async function loadCompanySettingsRows\(db\)/)
  assert.match(adminDomain, /select\('\*'\)\.limit\(1000\)/)
  assert.doesNotMatch(adminDomain, /eq\('setup_complete',\s*true\)/)
  assert.doesNotMatch(adminDomain, /company\.setup_complete !== false/)
  assert.match(adminDomain, /throw new Error\(lastError\?\.message \|\| 'Could not load Command Central companies\.'\)/)
  assert.match(adminDomain, /LICENSE_LEGACY_SELECT/)
  assert.match(adminDomain, /isLicenseSchemaCompatibilityError/)
  assert.match(adminDomain, /const LICENSE_LEGACY_SELECT = 'id, lodge_id, lodge_name, business_type, subscription_plan, payment_status, monthly_fee, currency, issued_at, expires_at, next_due_date, last_payment_date, notes, is_active';/)
  assert.match(adminDomain, /select\(LICENSE_LEGACY_SELECT\)/)
  assert.match(adminDomain, /function normalizeLicenseLodgeId\(value\)/)
  assert.match(adminDomain, /lodge_id: normalizeLicenseLodgeId\(license\.lodge_id\)/)
  assert.match(adminDomain, /computeSubscriptionState\(\{/)
  assert.match(adminDomain, /const subscriptionState = storedState && storedState !== 'expired' \? storedState : computedState/)
  assert.match(adminDomain, /export async function updateLicense\(id, updates\)/)
  assert.match(adminDomain, /rpc\('update_subscription_contract'/)
  assert.match(adminDomain, /p_license_id: id/)
  assert.match(adminDomain, /p_payload: update/)
  assert.match(adminDomain, /\['licensed', 'active'\]\.includes\(status\)/)
  assert.match(adminDomain, /\['licensed', 'active', 'trial', 'free', 'grace_period', 'overdue'\]\.includes\(subscriptionState\)/)
  assert.match(adminDomain, /entitlement\.source_license_id \|\| entitlement\.license_id \|\| entitlement\.id \|\| `entitlement:\$\{lodgeId\}`/)
  assert.match(maintenanceDomain, /MAINTENANCE_TICKET_LEGACY_SELECT/)
  assert.match(maintenanceDomain, /isMaintenanceTicketSchemaCompatibilityError/)
  assert.match(maintenanceDomain, /issue: ticket\.issue \|\| ticket\.title \|\| ''/)
  assert.match(cacheRefreshDomain, /fetchMaintenanceForRefresh/)
  assert.match(cacheRefreshDomain, /MAINTENANCE_TICKET_LEGACY_SELECT/)
  assert.match(cacheRefreshDomain, /issue: row\.issue \|\| row\.title \|\| ''/)
  assert.match(infrastructureDomain, /Back online - syncing changes\.\.\./)
  assert.doesNotMatch(infrastructureDomain, /Back online — syncing changes/)
  const authUsersDomain = await read('src/main/domains/authUsers.js')
  assert.match(authUsersDomain, /ensureSupabaseAuthStaffUserReady/)
  assert.match(authUsersDomain, /email_confirm:\s*true/)
  assert.match(authUsersDomain, /updateUserById\(authUserId,[\s\S]*?email_confirm:\s*true/)
  assert.match(authUsersDomain, /createUser\(\{[\s\S]*?email_confirm:\s*true/)
  assert.match(authUsersDomain, /auth_user_id:\s*null/)
  assert.match(authUsersDomain, /id:\s*result\.id,\s*auth_user_id:\s*null/)

  const authIdentityGuardrails = await read('supabase/migrations/20260619150000_auth_identity_link_guardrails.sql')
  assert.match(authIdentityGuardrails, /create trigger users_validate_auth_identity/i)
  assert.match(authIdentityGuardrails, /Supabase Auth identity email does not match the staff profile email/)
  assert.match(authIdentityGuardrails, /for update;/i)
  assert.match(authIdentityGuardrails, /u\.auth_user_id is distinct from v_auth_user_id/i)
  assert.match(authIdentityGuardrails, /lower\(btrim\(u\.email\)\) = v_email/i)
  assert.match(authIdentityGuardrails, /A stale local lodge selection must not strand a uniquely identified account/)
  assert.match(authLogin, /authenticatedLodgeId !== normalizeLodgeId\(state\.lodgeId\)[\s\S]*ensureReadyProfileForLodge/)
  const activeSqlMigrations = await readSqlTree('supabase/migrations')
  for (const migration of activeSqlMigrations) {
    assert.doesNotMatch(
      migration.source,
      /select\s+session_token\s*,\s*session_expires_at\s+from\s+public\.issue_app_session/i,
      `${migration.path} must qualify issue_app_session result columns`
    )
  }
  assert.match(adminDomain, /ensureSupabaseAuthStaffUserReady\(user,\s*password/)
  assert.match(adminCentral, /raw === 'active' \|\| raw === 'licensed'/)
  assert.match(adminCentral, /function lodgeKey\(value\)/)
  assert.match(adminCentral, /function getAssignedLicenseForLodge\(licenses, lodgeId\)/)
  assert.match(adminCentral, /function getAssignedPlanForLodge\(licenses, lodgeId\)/)
  assert.match(adminCentral, /const assignedPlan = getAssignedPlanForLodge\(licenses, company\?\.lodge_id\)/)
  assert.match(adminCentral, /const displayPlan = normalizePlanName\(assignedPlan \|\| rollup\.plan \|\| DEFAULT_PLAN\)/)
  assert.match(adminCentral, /label: `\$\{assignedPlan\} Licensed`/)
  assert.match(adminCentral, /getAssignedLicenseForLodge\(licenses, lodgeId\)/)
  assert.match(adminCentral, /Command Central data could not be fully loaded\./)
  assert.match(adminCentral, /setLoadError/)
  assert.match(adminCentral, /return null/)
  assert.match(adminCentral, /setCompanies\(Array\.isArray\(c\) \? c : \[\]\)/)
  assert.match(adminCentral, /setLicenses\(Array\.isArray\(l\) \? l : \[\]\)/)
  assert.doesNotMatch(mainIndex, /admin:getLicenses'[\s\S]{0,160}return \[\]/)
  assert.match(licensingWorkbench, /raw === 'active' \|\| raw === 'licensed'/)
  assert.match(licensingWorkbench, /function lodgeKey\(value\)/)
  assert.match(licensingWorkbench, /function buildAssignedLicenseMap\(licenses = \[\]\)/)
  assert.match(licensingWorkbench, /function shouldClearStaleExpiry\(license\)/)
  assert.match(licensingWorkbench, /duration: dur,[\s\S]{0,80}next_due_date: nextVal \|\| f\.next_due_date/)
  assert.doesNotMatch(licensingWorkbench, /duration: dur,[\s\S]{0,80}expires_at: nextVal/)
  assert.match(licensingWorkbench, /Clear expiry/)
  assert.match(licensingWorkbench, /activeLicenses\.get\(assignmentKey\(company\.lodge_id, getCompanyProductId\(company\)\)\)/)
  assert.match(licensingWorkbench, /result\?\.license\?\.license_key \|\| result\?\.license_key/)
  assert.match(licensingWorkbench, /This lodge already has an active assignment/)

  const dashboard = await read('src/renderer/src/components/Dashboard.jsx')
  assert.match(dashboard, /Operations Overview/)

  const upgradePrompt = await read('src/renderer/src/components/shared/UpgradePromptModal.jsx')
  assert.match(upgradePrompt, /UsageUpgradePrompt/)
  const upgradePromptImpl = await read('src/renderer/src/components/shared/UsageUpgradePrompt.jsx')
  assert.match(upgradePromptImpl, /Request Upgrade/)
  assert.match(upgradePromptImpl, /support@boroko\.io/)
  assert.match(upgradePromptImpl, /Request via WhatsApp/)
  assert.match(upgradePromptImpl, /formatPlanLimits\(currentPlan\)/)
  assert.match(upgradePromptImpl, /New \$\{blockedLabel\} are currently blocked until you upgrade\./)
  assert.match(upgradePromptImpl, /You’re using your grace allowance\. New \$\{blockedLabel\} will soon be blocked\./)
  const subscriptionPanel = await read('src/renderer/src/components/SubscriptionAccessPanel.jsx')
  assert.doesNotMatch(subscriptionPanel, /No usage counters or warning bars are shown for Pro/)
  const dashboardUsageCard = await read('src/renderer/src/components/shared/DashboardUsageCard.jsx')
  assert.doesNotMatch(dashboardUsageCard, /const isPro =/)
  assert.doesNotMatch(dashboardUsageCard, /Unlimited bookings/)
  assert.match(dashboardUsageCard, /Upgrade Plan/)
  assert.match(dashboardUsageCard, /New bookings are currently blocked until you upgrade\./)
  assert.match(dashboardUsageCard, /You’re using your grace allowance\./)
  const upgradeNudgeBanner = await read('src/renderer/src/components/shared/UpgradeNudgeBanner.jsx')
  const subscriptionHelpers = await read('src/shared/subscriptionPlans.js')
  assert.match(upgradeNudgeBanner, /getUpgradeNudgeCooldownState/)
  assert.match(upgradeNudgeBanner, /markUpgradeNudgeShown/)
  assert.match(subscriptionHelpers, /localStorage/)
  assert.match(upgradeNudgeBanner, /trackUpgradeIntent/)
  assert.match(upgradeNudgeBanner, /Upgrade Plan/)
  assert.doesNotMatch(adminCentral, /displayPlan === 'Pro' \? 'Unlimited'/)
  assert.doesNotMatch(bookingsUi, /disabled=\{bookingCreateBlocked\}/)
  assert.doesNotMatch(bookingsUi, /if \(bookingCreateBlocked\)/)
  assert.match(bookingsUi, /setShowUpgradePrompt\(true\)/)
  assert.match(bookingsUi, /usageSnapshot\?\.usage\?\.creationMonthBookings/)
  assert.match(bookingsUi, /usageSnapshot\?\.bookingAllowance\?\.creationMonthStatus/)
  assert.match(bookingsUi, /label="Check-ins this month"/)
  assert.match(bookingsUi, /Created this month:\s*\{creationMonthBookings\}/)
  assert.match(bookingsUi, /informational only/)
  assert.doesNotMatch(bookingsUi, /Created this month:[^\n]*\//)
  assert.match(bookingsUi, /currentCheckInMonthFull/)
  assert.match(bookingsUi, /another check-in month/)
  assert.match(bookingsUi, /Each check-in month has its own allowance; advance bookings count in their selected check-in month\./)
  assert.match(bookingsUi, /data-testid="booking-creation-usage"/)
  assert.match(roomsUi, /disabled=\{roomLimitStatus\.isBlocked\}/)
  assert.match(roomsUi, /setShowUpgradePrompt\(true\)/)
  assert.match(staffUi, /disabled=\{userLimitStatus\.isBlocked\}/)
  assert.match(staffUi, /setShowUpgradePrompt\(true\)/)
  assert.match(staffUi, /UsageLimitIndicator label="Users"/)
  assert.doesNotMatch(staffUi, /Unlimited access/)
  assert.doesNotMatch(roomsUi, /Unlimited access/)

  assert.equal(
    pickNextReadySyncItemIndex([
      { _queue_id: 'payment-1', _depends_on: 'booking-1' },
      { _queue_id: 'booking-1' }
    ]),
    1
  )
  assert.equal(
    pickNextReadySyncItemIndex([
      { _queue_id: 'charge-1', _depends_on: 'booking-1' },
      { _queue_id: 'other-1', _depends_on: 'missing-parent' }
    ], new Set(), new Set(['booking-1'])),
    0
  )
  assert.equal(isFinancialSyncItem({ table: 'update_booking_payment' }), true)
  assert.equal(isFinancialSyncItem({ table: 'maintenance:update' }), false)

  // Hardening phase: new patch helpers
  assert.match(database, /function patchCachedCustomerSyncState\(/)
  assert.match(database, /function patchCachedRoomSyncState\(/)
  assert.match(database, /function patchCachedUserSyncState\(/)
  assert.match(database, /function patchCachedQuotationSyncState\(/)

  // Hardening phase: unresolvedLocal in getSyncDetails
  assert.match(database, /unresolvedLocal/)

  // Hardening phase: new fault types
  assert.match(database, /quotation_drift/)
  assert.match(database, /pos_drift/)
  assert.match(database, /mark_quotation_sent/)

  // Hardening phase: shouldRefreshUsers flag in _runSyncQueue
  assert.match(database, /shouldRefreshUsers/)

  // Hardening phase: booking drift covers customer_id and room_id
  assert.match(database, /customer_id.*→ server|server.*customer_id/)
  assert.match(database, /room_id.*→ server|server.*room_id/)

  // Hardening phase: support bundle includes syncMeta
  assert.match(database, /syncMeta,\s*\n\s*healthFaults/)
  assert.match(panel, /localStateAcknowledged/)

  // Gap 1: clearSyncFailed / markClearedSyncItemForManualReview routes all entity types
  assert.match(database, /patchCachedCustomerSyncState\(customerId,\s*\{[\s\S]*?manual_review_required/)
  assert.match(database, /patchCachedRoomSyncState\(roomId,\s*\{[\s\S]*?manual_review_required/)
  assert.match(database, /patchCachedUserSyncState\(userId,\s*\{[\s\S]*?manual_review_required/)
  assert.match(database, /patchCachedQuotationSyncState\(quotationId,\s*\{[\s\S]*?manual_review_required/)

  // Gap 2: create_quotation offline path has _queue_id
  assert.match(database, /_queue_id:\s*`quotation-\$\{record\.id\}`/)

  // Gap 3: PWA queue health functions exist in runtime.js
  const runtime = await read('manager-pwa/src/lib/runtime.js')
  assert.match(runtime, /export function getPwaQueueHealth\(/)
  assert.match(runtime, /export function getUnresolvedLocalState\(/)

  // Gap 3: PWA control UI shows device-local scope warning
  const controlUi = await read('manager-pwa/src/pages/Control.jsx')
  assert.match(controlUi, /this device only/)

  // Sync-integrity phase: non-financial entity idempotency (20260428)
  const idempotencySql = await read('supabase/migrations/20260428_non_financial_entity_idempotency.sql')
  assert.match(idempotencySql, /idempotent/)
  assert.match(idempotencySql, /create_customer/)
  assert.match(idempotencySql, /create_room/)
  assert.match(idempotencySql, /create_user/)

  // Sync-integrity phase: update entity concurrency (20260429)
  const concurrencySql = await read('supabase/migrations/20260429_update_entity_concurrency.sql')
  assert.match(concurrencySql, /p_expected_updated_at/)
  assert.match(concurrencySql, /update_customer/)
  assert.match(concurrencySql, /update_room/)
  assert.match(concurrencySql, /update_quotation/)

  // Sync-integrity phase: device health reports table (20260430)
  const deviceHealthSql = await read('supabase/migrations/20260430_device_health_reports.sql')
  assert.match(deviceHealthSql, /device_health_reports/)
  const hybridUsageSql = await read('supabase/migrations/20260428_subscription_usage_limits_hybrid.sql')
  assert.match(hybridUsageSql, /coalesce\(new\.created_at, now\(\)\)/)
  assert.match(hybridUsageSql, /Booking limit reached for the selected check-in month on % plan/)
  assert.match(hybridUsageSql, /Monthly booking creation limit reached for % plan/)

  // Sync-integrity phase: database.js concurrency changes
  assert.match(database, /p_expected_updated_at.*expectedUpdatedAt|expectedUpdatedAt.*p_expected_updated_at/)
  assert.match(database, /export async function updateCustomer\(/)
  assert.match(database, /export async function updateRoom\(/)
  assert.match(database, /publishDeviceHealth/)
  assert.match(database, /export async function getDeviceHealthRollup\(/)

  // Sync-integrity phase: PWA health publishing
  assert.match(runtime, /export async function publishPwaHealth\(/)

  // Sync-integrity phase: customer_drift and room_drift fault types
  assert.match(database, /customer_drift/)
  assert.match(database, /room_drift/)

  // Sync-integrity phase: SystemHealthPanel includes customer_drift and room_drift
  assert.match(panel, /customer_drift/)
  assert.match(panel, /room_drift/)

  // ── Phase 0/1 hardening guardrails ──────────────────────────────────────────

  // 1. getTrialInfo() uses safe optional chaining for lodge_id
  assert.match(adminCentral, /getAssignedPlanForLodge\(licenses, company\?\.lodge_id\)/)

  // 2. Migrations use app_is_service_role() OR app_current_role() (not broken auth.jwt()->>'role' = 'super_admin')
  const auditSql = await read('supabase/migrations/20260614100000_admin_audit_log.sql')
  assert.match(auditSql, /app_is_service_role\(\)/)
  assert.match(auditSql, /app_current_role\(\) = 'super_admin'/)
  assert.doesNotMatch(auditSql, /auth\.jwt\(\)->>'role'\) != 'super_admin'/)

  const notifSql = await read('supabase/migrations/20260614110000_admin_notification_inbox.sql')
  assert.match(notifSql, /app_is_service_role\(\)/)
  assert.match(notifSql, /app_current_role\(\) = 'super_admin'/)

  const fleetSql = await read('supabase/migrations/20260614120000_fleet_health_dashboard.sql')
  assert.match(fleetSql, /app_is_service_role\(\)/)
  assert.match(fleetSql, /app_current_role\(\) = 'super_admin'/)

  const releaseSql = await read('supabase/migrations/20260614130000_release_control.sql')
  assert.match(releaseSql, /app_is_service_role\(\)/)
  assert.match(releaseSql, /app_current_role\(\) = 'super_admin'/)

  // 3. Notification RLS is not USING (true) WITH CHECK (true)
  assert.doesNotMatch(notifSql, /USING \(true\)/)
  assert.match(notifSql, /ENABLE ROW LEVEL SECURITY/)

  // 4. create_admin_notification has role enforcement
  assert.match(notifSql, /CREATE OR REPLACE FUNCTION public\.create_admin_notification/)
  assert.match(notifSql, /app_is_service_role\(\)/)

  // 5. Phase 1 UI components show error states (not silent empty catches)
  assert.match(notificationInbox, /setError/)
  assert.match(notificationInbox, /err\?\.message/)
  assert.match(fleetHealth, /setError/)
  assert.match(fleetHealth, /err\?\.message/)
  assert.match(releaseControl, /setError/)
  assert.match(releaseControl, /err\?\.message/)

  // 6. Fleet Health joins settings (not lodge) for lodge names
  assert.match(fleetSql, /LEFT JOIN public\.settings/)

  // 7. Release Control joins settings (not lodge) for lodge names
  assert.match(releaseSql, /LEFT JOIN public\.settings/)

  // 8. Fleet Health casts top_fault_types to jsonb
  assert.match(fleetSql, /to_jsonb\(dh\.top_fault_types\)/)

  // 9. Notification IPC bridge names match database exports
  assert.match(database, /markNotificationsRead/)
  assert.match(database, /cleanupNotifications/)

  // 10. PDF export escapes HTML
  assert.match(mainIndex, /escapeHtml\(c\.header\)/)
  assert.match(mainIndex, /escapeHtml\(String\(row\[c\.key\]/)

  // 11. Release Control label is honest
  assert.match(releaseControl, /Feature Release Viewer/)
  assert.match(adminCentral, /Releases/)

  // 12. Leads has pagination
  assert.match(adminCentral, /leadPage.*leadTotalPages.*paginatedLeads/)
  assert.match(adminCentral, /paginatedLeads\.map/)

  // 13. Notification Inbox has pagination
  assert.match(notificationInbox, /usePagination\(notifications\)/)

  // 14. Fleet Health has pagination or auto-refresh
  assert.match(fleetHealth, /setInterval/)

  // ── Master Plan G: Notification Automation ──
  const notificationAutomation = await read('src/renderer/src/components/NotificationAutomation.jsx')
  assert.match(notificationAutomation, /Notification Automation/)
  assert.match(notificationAutomation, /evaluateAllRules/)
  assert.match(notificationAutomation, /getNotificationRules/)
  assert.match(notificationAutomation, /getNotificationEvents/)
  assert.match(notificationAutomation, /markEventsDispatched/)

  const automationDomain = await read('src/main/domains/automation.js')
  assert.match(automationDomain, /getNotificationRules/)
  assert.match(automationDomain, /upsertNotificationRule/)
  assert.match(automationDomain, /evaluateRule/)
  assert.match(automationDomain, /evaluateAllRules/)
  assert.match(automationDomain, /getNotificationEvents/)
  assert.match(automationDomain, /getNotificationEventSummary/)
  assert.match(automationDomain, /markEventsDispatched/)
  assert.match(automationDomain, /app_get_notification_rules/)
  assert.match(automationDomain, /app_evaluate_notification_rule/)
  assert.match(automationDomain, /app_evaluate_all_notification_rules/)
  assert.match(automationDomain, /app_get_notification_events/)
  assert.match(automationDomain, /app_get_notification_event_summary/)
  assert.match(automationDomain, /app_mark_events_dispatched/)

  // ── Master Plan B: Accounting ──
  const accountingDashboard = await read('src/renderer/src/components/AccountingDashboard.jsx')
  assert.match(accountingDashboard, /Accounting Overview/)
  assert.match(accountingDashboard, /getMrrSummary/)
  assert.match(accountingDashboard, /getRevenueSummary/)
  assert.match(accountingDashboard, /getLodgeFinancialSummary/)

  const accountingDomain = await read('src/main/domains/accounting.js')
  assert.match(accountingDomain, /getMrrSummary/)
  assert.match(accountingDomain, /getRevenueSummary/)
  assert.match(accountingDomain, /getLodgeFinancialSummary/)
  assert.match(accountingDomain, /app_get_mrr_summary/)
  assert.match(accountingDomain, /app_get_revenue_summary/)
  assert.match(accountingDomain, /app_get_lodge_financial_summary/)

  // ── Master Plan J: Task Center ──
  const adminToday = await read('src/renderer/src/components/AdminToday.jsx')
  assert.match(adminToday, /Today's Admin Dashboard/)
  assert.match(adminToday, /getAdminToday/)
  assert.match(adminToday, /overdue_bookings/)
  assert.match(adminToday, /trials_ending/)
  assert.match(adminToday, /failed_devices/)
  assert.match(adminToday, /urgent_tickets/)
  assert.match(adminToday, /lead_followups/)

  // ── Master Plan E: Deep Fleet Health + Version Control ──
  const versionControl = await read('src/renderer/src/components/VersionControl.jsx')
  assert.match(versionControl, /Deep Fleet Health/)
  assert.match(versionControl, /getSyncQueueStatus/)
  assert.match(versionControl, /pushUpdateNotification/)
  assert.match(versionControl, /reconciliation_state/)
  assert.match(versionControl, /failed_queue_count/)

  // ── Master Plan H: Global Search ──
  const globalSearch = await read('src/renderer/src/components/GlobalSearch.jsx')
  assert.match(globalSearch, /Global Search/)
  assert.match(globalSearch, /globalSearch/)
  assert.match(globalSearch, /ticket/)
  assert.match(globalSearch, /lead/)
  assert.match(globalSearch, /device/)
  // GlobalSearch is generic — renders whatever types the RPC returns (lodge, license, ticket, lead, device)

  // ── Master Plan I: Bulk Actions ──
  const bulkActions = await read('src/renderer/src/components/BulkActions.jsx')
  assert.match(bulkActions, /bulkUpdateStatus/)
  assert.match(bulkActions, /bulkDelete/)
  assert.match(bulkActions, /bulkNotify/)
  assert.match(bulkActions, /Confirm/)
  // Bulk actions should NOT reference invoices
  assert.ok(!bulkActions.includes("'invoice'"), 'bulk actions must not reference invoice entity type')

  // ── Master Plan F: Release Rollout Control ──
  const releaseRollout = await read('src/renderer/src/components/ReleaseRollout.jsx')
  const safeLoad = await read('src/renderer/src/utils/safeLoad.js')
  const executiveCockpit = await read('src/renderer/src/components/ExecutiveCockpit.jsx')
  const client360 = await read('src/renderer/src/components/Client360.jsx')
  const systemHealth = await read('src/renderer/src/components/SystemHealth.jsx')
  assert.match(systemHealth, /CONCURRENCY = 3/)
  assert.match(systemHealth, /status: ms >= SLOW_MS \? 'slow' : 'healthy'/)
  assert.match(systemHealth, /Retry/)
  assert.match(systemHealth, /does not alter business data/)
  assert.match(releaseRollout, /Release Rollout Control/)
  assert.match(releaseRollout, /createRelease/)
  assert.match(releaseRollout, /updateRelease/)
  assert.match(releaseRollout, /getReleases/)
  assert.match(releaseRollout, /rollout_pct/)
  assert.match(releaseRollout, /rolling_out/)
  assert.match(client360, /getInvoicesByLodge/)
  assert.match(client360, /getLodgeFinancialSummary/)
  assert.match(client360, /total_collected/)
  assert.ok(!client360.includes("getInvoices?.({ lodge_id: lodgeId })"), 'Client 360 must not read financial totals from invoice metadata')
  assert.match(client360, /healthyDevices/)
  assert.match(client360, /Heartbeat:/)

  // ── IPC handlers for all new features ──
  assert.match(mainIndex, /admin:getNotificationRules/)
  assert.match(mainIndex, /admin:upsertNotificationRule/)
  assert.match(mainIndex, /admin:evaluateRule/)
  assert.match(mainIndex, /admin:evaluateAllRules/)
  assert.match(mainIndex, /admin:getNotificationEvents/)
  assert.match(mainIndex, /admin:getNotificationEventSummary/)
  assert.match(mainIndex, /admin:markEventsDispatched/)
  assert.match(mainIndex, /admin:getMrrSummary/)
  assert.match(mainIndex, /admin:getRevenueSummary/)
  assert.match(mainIndex, /admin:getLodgeFinancialSummary/)
  assert.match(mainIndex, /admin:getAdminToday/)
  assert.match(mainIndex, /admin:globalSearch/)
  assert.match(mainIndex, /admin:bulkUpdateStatus/)
  assert.match(mainIndex, /admin:bulkDelete/)
  assert.match(mainIndex, /admin:bulkNotify/)
  assert.match(mainIndex, /admin:pushUpdateNotification/)
  assert.match(mainIndex, /admin:getSyncQueueStatus/)
  assert.match(mainIndex, /admin:createRelease/)
  assert.match(mainIndex, /admin:updateRelease/)
  assert.match(mainIndex, /admin:checkUpdateAvailability/)
  assert.match(mainIndex, /admin:getReleases/)

  // ── Preload bridge for all new features ──
  assert.match(preload, /getNotificationRules/)
  assert.match(preload, /upsertNotificationRule/)
  assert.match(preload, /evaluateRule/)
  assert.match(preload, /evaluateAllRules/)
  assert.match(preload, /getNotificationEvents/)
  assert.match(preload, /getNotificationEventSummary/)
  assert.match(preload, /markEventsDispatched/)
  assert.match(preload, /getMrrSummary/)
  assert.match(preload, /getRevenueSummary/)
  assert.match(preload, /getLodgeFinancialSummary/)
  assert.match(preload, /getAdminToday/)
  assert.match(preload, /globalSearch/)
  assert.match(preload, /bulkUpdateStatus/)
  assert.match(preload, /bulkDelete/)
  assert.match(preload, /bulkNotify/)
  assert.match(preload, /pushUpdateNotification/)
  assert.match(preload, /getSyncQueueStatus/)
  assert.match(preload, /createRelease/)
  assert.match(preload, /updateRelease/)
  assert.match(preload, /checkUpdateAvailability/)
  assert.match(preload, /getReleases/)

  // ── Database facade exports ──
  assert.match(databaseFacade, /getMrrSummary/)
  assert.match(databaseFacade, /getRevenueSummary/)
  assert.match(databaseFacade, /getLodgeFinancialSummary/)
  assert.match(databaseFacade, /getNotificationRules/)
  assert.match(databaseFacade, /upsertNotificationRule/)
  assert.match(databaseFacade, /evaluateRule/)
  assert.match(databaseFacade, /evaluateAllRules/)
  assert.match(databaseFacade, /getNotificationEvents/)
  assert.match(databaseFacade, /getNotificationEventSummary/)
  assert.match(databaseFacade, /markEventsDispatched/)
  assert.match(databaseFacade, /getAdminToday/)
  assert.match(databaseFacade, /globalSearch/)
  assert.match(databaseFacade, /bulkUpdateStatus/)
  assert.match(databaseFacade, /bulkDelete/)
  assert.match(databaseFacade, /bulkNotify/)
  assert.match(databaseFacade, /pushUpdateNotification/)
  assert.match(databaseFacade, /getSyncQueueStatus/)
  assert.match(databaseFacade, /createRelease/)
  assert.match(databaseFacade, /updateRelease/)
  assert.match(databaseFacade, /checkUpdateAvailability/)
  assert.match(databaseFacade, /getReleases/)

  // ── Migrations: schema compatibility guardrails (P2.14) ──
  const migrationAutomation = await read('supabase/migrations/20260614150000_notification_automation.sql')
  const migrationAccounting = await read('supabase/migrations/20260614160000_accounting_taskcenter_search_bulk_releases.sql')
  const allNewMigrations = migrationAutomation + migrationAccounting

  // Must not reference non-existent tables
  assert.ok(!allNewMigrations.includes('public.lodge'), 'migrations must not reference public.lodge (does not exist)')
  assert.ok(!allNewMigrations.includes('public.companies'), 'migrations must not reference public.companies (does not exist)')
  assert.ok(!allNewMigrations.match(/public\.license[^s]/), 'migrations must use public.licenses (plural)')

  // Must use corrected role checks
  assert.match(migrationAutomation, /app_is_service_role/)
  assert.match(migrationAutomation, /app_current_role\(\)/)
  assert.ok(!migrationAutomation.includes("auth.jwt()->>'role' != 'super_admin'"), 'notification_automation must not use stale role check')
  assert.match(migrationAccounting, /app_is_service_role/)
  assert.match(migrationAccounting, /app_current_role\(\)/)
  assert.ok(!migrationAccounting.includes("auth.jwt()->>'role' != 'super_admin'"), 'accounting must not use stale role check')

  // Must not invent invoice financial columns
  assert.ok(!allNewMigrations.includes('invoices.amount_due'), 'migrations must not reference invoices.amount_due')
  assert.ok(!allNewMigrations.includes('invoices.amount_paid'), 'migrations must not reference invoices.amount_paid')
  assert.ok(!allNewMigrations.includes('invoices.payment_status'), 'migrations must not reference invoices.payment_status')

  // Must not reference activity_logs.performed_by
  assert.ok(!allNewMigrations.includes('activity_logs.performed_by'), 'migrations must not reference activity_logs.performed_by')

  // Must have REVOKE/GRANT on all new RPCs
  const rpcNames = ['app_get_mrr_summary', 'app_get_revenue_summary', 'app_get_lodge_financial_summary',
    'app_get_admin_today', 'app_global_search', 'app_bulk_update_status', 'app_bulk_delete', 'app_bulk_notify',
    'app_get_sync_queue_status', 'app_push_update_notification', 'app_create_release', 'app_update_release',
    'app_check_update_availability', 'app_get_releases',
    'app_upsert_notification_rule', 'app_get_notification_rules', 'app_evaluate_notification_rule',
    'app_evaluate_all_notification_rules', 'app_get_notification_events', 'app_get_notification_event_summary',
    'app_mark_events_dispatched']
  for (const rpc of rpcNames) {
    assert.ok(allNewMigrations.includes(`REVOKE ALL ON FUNCTION public.${rpc}`), `migration must have REVOKE for ${rpc}`)
    assert.ok(allNewMigrations.includes(`GRANT EXECUTE ON FUNCTION public.${rpc}`), `migration must have GRANT for ${rpc}`)
  }

  // ── P2.16: Financial guardrails — no direct financial mutations ──
  assert.ok(!allNewMigrations.includes("SET amount_paid"), 'migrations must not directly set amount_paid')
  assert.ok(!allNewMigrations.includes("SET payment_status"), 'migrations must not directly set payment_status')
  assert.ok(!allNewMigrations.includes("UPDATE public.invoices SET"), 'migrations must not directly update invoices')

  // ── P0: sql.row_count is invalid PL/pgSQL — must use GET DIAGNOSTICS ──
  assert.ok(!allNewMigrations.includes('sql.row_count'), 'migrations must not use sql.row_count (invalid PL/pgSQL); use GET DIAGNOSTICS ... = ROW_COUNT')

  // ── P0: Sales CRM migration must have role checks + REVOKE/GRANT ──
  const migrationSalesCrm = await read('supabase/migrations/20260614140000_sales_crm_pipeline.sql')
  assert.match(migrationSalesCrm, /app_is_service_role/, 'update_lead_crm must have DB-side role check')
  assert.match(migrationSalesCrm, /app_current_role\(\)/, 'update_lead_crm must have DB-side role check')
  assert.ok(migrationSalesCrm.includes('REVOKE ALL ON FUNCTION public.update_lead_crm'), 'update_lead_crm must have REVOKE')
  assert.ok(migrationSalesCrm.includes('REVOKE ALL ON FUNCTION public.get_sales_pipeline_summary'), 'get_sales_pipeline_summary must have REVOKE')
  assert.ok(migrationSalesCrm.includes('GRANT EXECUTE ON FUNCTION public.update_lead_crm'), 'update_lead_crm must have GRANT')
  assert.ok(migrationSalesCrm.includes('GRANT EXECUTE ON FUNCTION public.get_sales_pipeline_summary'), 'get_sales_pipeline_summary must have GRANT')

  // ── P1: Today IPC fallback must use overdue_bookings, not overdue_invoices ──
  assert.ok(!mainIndex.includes('overdue_invoices'), 'index.js must not contain stale overdue_invoices fallback')
  assert.ok(mainIndex.includes('overdue_bookings'), 'index.js getAdminToday fallback must use overdue_bookings')

  // ── Bulk lead delete must set both status AND stage to prevent ghost leads in pipeline ──
  assert.ok(allNewMigrations.includes("status = 'dropped', stage = 'lost'"), 'bulk lead delete must set both status and stage')
  // Leads component must filter out dropped/lost leads from active pipeline
  assert.match(adminCentral, /l\.status !== 'dropped'/, 'Leads must filter out dropped leads')
  assert.doesNotMatch(adminCentral, /l\.stage !== 'lost'/, 'Lost leads must remain visible in the sales pipeline')

  // ── AdminCentral nav includes all new sections ──
  assert.match(adminCentral, /Notifications/)
  assert.match(adminCentral, /Accounting/)
  assert.match(adminCentral, /Global Search/)
  assert.match(adminCentral, /Bulk Actions/)
  assert.match(adminCentral, /Fleet/)
  assert.match(adminCentral, /Releases/)
  assert.match(adminCentral, /Today/)

  // ── AdminCentral section rendering includes all new components ──
  assert.match(adminCentral, /<Notifications/)
  assert.match(adminCentral, /<AccountingDashboard/)
  assert.match(adminCentral, /<AdminToday/)
  assert.match(adminCentral, /<Fleet/)
  assert.match(adminCentral, /<GlobalSearch/)
  assert.match(adminCentral, /<BulkActions/)
  assert.match(adminCentral, /<Releases/)
  assert.match(adminCentral, /<SystemHealth/)
  assert.doesNotMatch(adminCentral, /const targets = visibleCompaniesBase\.filter\(\(company\) => !usageStatsByLodge/)
  assert.match(adminCentral, /Usage signals load when a company is opened/)
  assert.match(adminCentral, /return changed \? next : current/)
  assert.match(database, /CACHE_REFRESH_CONCURRENCY = 3/)

  // ── Command Central office workflow grouping + finance merge ──
  assert.match(adminCentral, /const NAV_GROUPS = \[/)
  assert.match(adminCentral, /Finance Office/)
  assert.match(adminCentral, /Surface Intelligence/)
  assert.match(adminCentral, /function FinanceOffice/)
  assert.match(adminCentral, /section === 'finance' \|\| section === 'bookkeeping' \|\| section === 'accounting'/)
  assert.doesNotMatch(adminCentral, /selectedBulkIds/)
  assert.doesNotMatch(adminCentral, /bulkEntityType/)

  // ── Runtime bridge hardening prevents stale preload from blanking tabs ──
  assert.match(adminApi, /unavailableAdminApiResult/)
  assert.match(accountingDashboard, /callAdminApi\('getLodgeFinancialSummary'/)
  assert.match(accountingDashboard, /Unavailable bridge/)
  assert.match(systemHealth, /getSurfaceIntelligence/)
  assert.match(bulkActions, /callAdminApi\(entityMeta\.fetchKey/)
  assert.match(globalSearch, /invoice:\s*'finance'/)
  assert.match(globalSearch, /lead:\s*'leads'/)

  // ── Cross-surface intelligence is wired end to end ──
  assert.match(preload, /getSurfaceIntelligence:\s*\(\)\s*=>\s*(?:invoke|ipcRenderer\.invoke)\('admin:getSurfaceIntelligence'\)/)
  assert.match(mainIndex, /admin:getSurfaceIntelligence/)
  assert.match(databaseFacade, /getSurfaceIntelligence/)
  assert.match(database, /export async function getSurfaceIntelligence\(/)
  assert.match(surfaceIntelligence, /Desktop, legacy POS, PWA, bookings, marketing, and support/)
  assert.match(surfaceIntelligence, /getSurfaceIntelligence/)

  const surfaceClientSql = await read('supabase/migrations/20260615121000_surface_intelligence_client_types.sql')
  assert.match(surfaceClientSql, /legacy_pos/)
  assert.match(surfaceClientSql, /bookings_site/)
  assert.match(surfaceClientSql, /marketing_site/)
  assert.match(surfaceClientSql, /idx_device_health_reports_client_type_reported/)

  // ── Legacy POS update checks and health reports participate in Command Central ──
  assert.match(legacyPosMain, /function gatePosUpdateCheck\(/)
  assert.match(legacyPosMain, /app_check_product_update_availability/)
  assert.match(legacyPosMain, /function publishLegacyPosDeviceHealth\(/)
  assert.match(legacyPosMain, /p_client_type:\s*'legacy_pos'/)
  assert.match(legacyPosMain, /HEALTH_REPORT_INTERVAL_MS/)

  // ── P0.1: Bulk Actions is now a full workbench (self-fetching) ──
  assert.match(bulkActions, /getSupportTickets|getMarketingLeads/)
  assert.match(bulkActions, /Select All/)
  assert.match(bulkActions, /Refresh/)
  assert.match(bulkActions, /export default function BulkActions\(\)/) // no props required

  // ── P0.2: Release Rollout uses 'retired' not 'rolled_back' ──
  assert.match(releaseRollout, /retired/)
  assert.doesNotMatch(releaseRollout, /rolled_back/)
  assert.match(releaseRollout, /Retire Release/)

  // ── P1.3: Auto-updater gated through RPC ──
  assert.match(mainIndex, /gateUpdateCheck/)
  assert.match(mainIndex, /checkUpdateAvailability/)
  assert.match(mainIndex, /if \(!res\?\.ok\)[\s\S]*throw new Error/)
  assert.match(mainIndex, /RPC gate check failed, allowing fallback/)
  assert.match(mainIndex, /getDesktopDeviceIdForUpdater/)

  // ── P1.4: Notification automation scheduler ──
  assert.match(mainIndex, /evaluateAllRules/)
  assert.match(mainIndex, /notification automation/)

  // ── P1.5: Normalized action return shapes ──
  assert.match(mainIndex, /ok: true, count:.*cleanupNotifications/)
  assert.match(mainIndex, /ok: true, count:.*expireOverdueFeatures/)
  assert.match(mainIndex, /ok: false, count: 0, error/)

  // ── P1.6: Partial load failure warnings ──
  assert.match(safeLoad, /safeLoadAll/)
  assert.match(safeLoad, /hasPartialFailures/)
  assert.match(safeLoad, /getFailureSummary/)
  assert.match(executiveCockpit, /loadWarnings/)
  assert.match(client360, /loadWarnings/)

  // ── P1.7: Global Search navigates on click ──
  assert.match(globalSearch, /onNavigate/)
  assert.match(globalSearch, /TYPE_NAV_MAP/)

  // ── P2.8: Accounting collections queue ──
  assert.match(accountingDashboard, /collections/)
  assert.match(accountingDashboard, /getCollectionsQueue/)
  assert.match(accountingDashboard, /getRevenueByMethod/)

  // ── P2.9: Fleet Health device drawer ──
  assert.match(versionControl, /DeviceDrawer/)
  assert.match(versionControl, /selectedDevice/)

  // ── P2.10: Sales CRM lead drawer ──
  assert.match(adminCentral, /LeadDrawer/)
  assert.match(adminCentral, /selectedLead/)
  assert.match(adminCentral, /Activity Timeline/)
  assert.match(adminCentral, /Quick Actions/)

  // ── P2.11: System Health page ──
  assert.match(systemHealth, /Command Central Diagnostics/)
  assert.match(systemHealth, /Run All/)

  // ── Accounting collections queue migration ──
  const collectionsMig = await read('supabase/migrations/20260615110000_accounting_collections_queue.sql')
  assert.match(collectionsMig, /app_get_collections_queue/)
  assert.match(collectionsMig, /app_get_revenue_by_method/)
  assert.match(collectionsMig, /REVOKE ALL/)
  assert.match(collectionsMig, /GRANT EXECUTE/)
  const collectionsGuestRepair = await read('supabase/migrations/20260619190000_fix_collections_queue_guest_name.sql')
  assert.match(collectionsGuestRepair, /LEFT JOIN public\.customers c/)
  assert.ok(!collectionsGuestRepair.includes('b.guest_name'), 'collections queue must resolve guest names from customers')

  // ── Notification idempotency index migration ──
  const idempMig = await read('supabase/migrations/20260615100000_notification_idempotency_index.sql')
  assert.match(idempMig, /idx_notification_events_idempotent/)

  // ── Room maintenance is atomic and visible across desktop and PWA ──
  const roomMaintenanceSql = await read('supabase/migrations/20260618190000_atomic_room_maintenance_flow.sql')
  const roomsDomain = await read('src/main/domains/rooms.js')
  const maintenanceFlowDomain = await read('src/main/domains/maintenance.js')
  const desktopRooms = await read('src/renderer/src/components/Rooms.jsx')
  const pwaRooms = await read('manager-pwa/src/pages/Rooms.jsx')
  assert.match(roomMaintenanceSql, /create or replace function public\.create_room\(payload jsonb\)[\s\S]*insert into public\.maintenance_tickets/)
  assert.match(roomMaintenanceSql, /app_reconcile_room_maintenance_status/)
  assert.match(roomMaintenanceSql, /b\.status = 'checked_in'/)
  assert.match(roomMaintenanceSql, /Resolve the open maintenance ticket before changing this room status/)
  assert.match(roomMaintenanceSql, /Automatically created to repair a missing maintenance record/)
  assert.match(roomsDomain, /maintenance_ticket_id:\s*maintenanceTicketId/)
  assert.match(roomsDomain, /queueOperation\('rpc', 'create_room'/)
  assert.doesNotMatch(maintenanceFlowDomain, /supabase\.rpc\('set_room_status'/)
  assert.match(maintenanceFlowDomain, /queueOperation\('rpc', 'create_maintenance_ticket'/)
  assert.match(desktopRooms, /Maintenance Issue/)
  assert.match(pwaRooms, /room\.status === 'maintenance'/)

  // ── Build script verification ──────────────────────────────────────────────
  const lodgeCampPkg = JSON.parse(await read('apps/lodge-camp/package.json'))
  const hotelPkg = JSON.parse(await read('apps/hotel/package.json'))
  const hospPosPkg = JSON.parse(await read('apps/hospitality-pos/package.json'))
  assert.ok(lodgeCampPkg.scripts?.build, 'apps/lodge-camp/package.json must have a build script')
  assert.ok(hotelPkg.scripts?.build, 'apps/hotel/package.json must have a build script')
  assert.ok(hospPosPkg.scripts?.build, 'apps/hospitality-pos/package.json must have a build script')
  assert.ok(existsSync(new URL('../scripts/product-app.mjs', import.meta.url)), 'scripts/product-app.mjs must exist')

  console.log('production-guardrails: ok')
}

run().catch((error) => {
  console.error('production-guardrails: failed')
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
