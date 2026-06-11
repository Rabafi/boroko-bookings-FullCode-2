import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
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

async function run() {
  const preload = await read('src/preload/index.js')
  assert.match(preload, /snapshot:\s*\(today\)\s*=>\s*ipcRenderer\.invoke\('reports:snapshot', today\)/)
  assert.match(preload, /financialValidationAlerts:\s*\(limit\)\s*=>\s*ipcRenderer\.invoke\('reports:financialValidationAlerts', limit\)/)
  assert.match(preload, /criticalErrors:\s*\(limit\)\s*=>\s*ipcRenderer\.invoke\('reports:criticalErrors', limit\)/)
  assert.match(preload, /saveSupportBundle:\s*\(limit\)\s*=>\s*ipcRenderer\.invoke\('reports:saveSupportBundle', limit\)/)

  const mainIndex = await read('src/main/index.js')
  const databaseFacade = await read('src/main/database.js')
  const database = [databaseFacade, ...(await readTree('src/main/domains'))].join('\n')
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
  assert.match(database, /recordCriticalError\('reports\.revenue'/)
  assert.match(database, /recordCriticalError\('reports\.profit_loss'/)
  assert.match(database, /recordCriticalError\('reports\.outlet_profit_loss'/)
  assert.match(database, /recordCriticalError\('reports\.room_profitability'/)
  assert.match(database, /recordCriticalError\('reports\.pos_sales'/)
  assert.match(database, /recordCriticalError\('reports\.inventory_spend'/)
  assert.match(database, /recordCriticalError\('reports\.supply_spend'/)
  assert.match(database, /function isNonCriticalOperationalError\(scope, errorOrMessage = ''\)/)
  assert.match(database, /scope === 'booking\.refund'[\s\S]{0,140}Refund approvals require an internet connection/)
  assert.match(database, /if \(isNonCriticalOperationalError\(scope, message\)\) return null/)
  assert.match(database, /filter\(\(entry\) => !isNonCriticalOperationalError\(entry\?\.scope, entry\?\.message\)\)/)
  assert.doesNotMatch(database, /payment_status:\s*depositStatus/)
  assert.doesNotMatch(database, /amount_paid:\s*deposit\s*>\s*0\s*\?\s*deposit\s*:\s*0/)
  assert.doesNotMatch(database, /payment_status:\s*payStatus/)
  assert.doesNotMatch(database, /cached\[idx\]\s*=\s*\{\s*\.\.\.b,\s*amount_paid:/)
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
  assert.match(database, /failedQueueIds\.has\(item\._depends_on\)/)
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
  const sanitizeMatch = panel.match(/function sanitizeForOperator\(raw\) \{[\s\S]*?\n\}/)
  assert.ok(sanitizeMatch, 'sanitizeForOperator helper missing')
  const sanitizeForOperator = new Function(`${sanitizeMatch[0]}; return sanitizeForOperator;`)()
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
    'Room creation could not sync because this lodge is above the current plan room limit after a downgrade. Upgrade or reduce rooms, then retry.'
  )
  assert.equal(
    sanitizeForOperator('Staff user creation could not sync because this lodge is above the current plan user limit after a downgrade.'),
    'Staff user creation could not sync because this lodge is above the current plan user limit after a downgrade. Upgrade or reduce staff users, then retry.'
  )

  assert.match(database, /'pos-orders':\s*\(\)\s*=>\s*(state\.)?supabase[\s\S]*?from\('pos_orders'\)/)
  assert.match(database, /function markClearedSyncItemForManualReview\(/)
  assert.match(database, /_sync_state:\s*'manual_review_required'/)
  assert.match(database, /type:\s*isFinancial\s*\?\s*'financial_dead_letter_cleared'\s*:\s*'dead_letter_cleared'/)
  assert.match(database, /severity:\s*isFinancial\s*\?\s*'error'\s*:\s*'warn'/)
  assert.match(database, /severity:\s*fault\.severity\s*\|\|\s*'warn'/)
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
  assert.match(database, /refreshCache\(\s*'inventory-items',\s*'inventory-purchases'\s*\)\.catch\(\(\) => \{\}\)/)
  assert.match(database, /async function _getInventoryItems\(\)\s*\{[\s\S]*?if \(state\.isOnline\)/)
  assert.match(database, /export function getInventoryItems\(\)\s*\{[\s\S]*?dedupePromise\('getInventoryItems', _getInventoryItems\)/)
  assert.match(database, /getInventoryItems received empty live result; using cached inventory items instead/)
  assert.match(database, /export async function getInventoryPurchases\(itemId\)\s*\{[\s\S]*?getInventoryPurchases received empty live result; using cached purchases instead/)
  assert.match(database, /getInventoryPurchases falling back to cache:/)
  assert.match(database, /export async function getLowStockItems\(\)\s*\{[\s\S]*?getInventoryItems\(\)\.catch\(\(\) => readCache\('inventory-items'\)\)/)
  assert.match(database, /const mergedLiveRows = mergeRemotePosOrdersWithLocalState\(data \|\| \[\], cachedOrders\)/)
  assert.match(mainIndex, /inventory:getItems failed:/)
  assert.match(mainIndex, /Could not load inventory items right now\./)
  assert.match(database, /function buildEventGroupId\(/)
  assert.match(database, /const eventIdempotencyKey = `event-booking:\$\{groupId\}`/)
  assert.match(database, /representativeRoom/)
  assert.match(database, /room_number:\s*'Full Lodge'/)
  assert.match(database, /export async function repairDuplicateEventBookings\(/)
  assert.match(mainIndex, /admin:repairDuplicateEventBookings/)
  assert.match(preload, /repairDuplicateEventBookings:\s*\(lodgeId\)\s*=>\s*ipcRenderer\.invoke\('admin:repairDuplicateEventBookings', lodgeId\)/)
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
  assert.match(sqlUsageHarness, /monthly booking creation limit/)

  const adminCentral = await read('src/renderer/src/components/AdminCentral.jsx')
  const bookingsUi = await read('src/renderer/src/components/Bookings.jsx')
  const roomsUi = await read('src/renderer/src/components/Rooms.jsx')
  const staffUi = await read('src/renderer/src/components/Staff.jsx')
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
  assert.match(subscriptionPanel, /Unlimited access/)
  const dashboardUsageCard = await read('src/renderer/src/components/shared/DashboardUsageCard.jsx')
  assert.match(dashboardUsageCard, /Unlimited access/)
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
  assert.match(bookingsUi, /disabled=\{bookingCreateBlocked\}/)
  assert.match(bookingsUi, /setShowUpgradePrompt\(true\)/)
  assert.match(roomsUi, /disabled=\{roomLimitStatus\.isBlocked\}/)
  assert.match(roomsUi, /setShowUpgradePrompt\(true\)/)
  assert.match(staffUi, /disabled=\{userLimitStatus\.isBlocked\}/)
  assert.match(staffUi, /setShowUpgradePrompt\(true\)/)
  assert.match(staffUi, /Unlimited access/)

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

  console.log('production-guardrails: ok')
}

run().catch((error) => {
  console.error('production-guardrails: failed')
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
