import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isFinancialSyncItem, pickNextReadySyncItemIndex } from '../src/shared/syncQueue.js'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function run() {
  const preload = await read('src/preload/index.js')
  assert.match(preload, /snapshot:\s*\(today\)\s*=>\s*ipcRenderer\.invoke\('reports:snapshot', today\)/)
  assert.match(preload, /financialValidationAlerts:\s*\(limit\)\s*=>\s*ipcRenderer\.invoke\('reports:financialValidationAlerts', limit\)/)
  assert.match(preload, /criticalErrors:\s*\(limit\)\s*=>\s*ipcRenderer\.invoke\('reports:criticalErrors', limit\)/)
  assert.match(preload, /saveSupportBundle:\s*\(limit\)\s*=>\s*ipcRenderer\.invoke\('reports:saveSupportBundle', limit\)/)

  const mainIndex = await read('src/main/index.js')
  const database = await read('src/main/database.js')
  assert.match(mainIndex, /ipcMain\.handle\('reports:snapshot'/)
  assert.match(mainIndex, /ipcMain\.handle\('reports:saveSupportBundle'/)
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
  assert.match(database, /import \{ isFinancialSyncItem, pickNextReadySyncItemIndex \} from '\.\.\/shared\/syncQueue\.js'/)
  assert.match(database, /Blocked: unresolved sync dependency cycle/)
  assert.match(database, /failedQueueIds\.has\(item\._depends_on\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('User', id, db\.getUserById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('Room', id, db\.getRoomById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('Inventory item', itemId, db\.getInventoryItemById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('Supply item', itemId, db\.getSupplyItemById\)/)
  assert.match(mainIndex, /assertResourceBelongsToCurrentLodge\('POS menu item', id, db\.getPosMenuItemById\)/)

  const panel = await read('src/renderer/src/components/SystemHealthPanel.jsx')
  assert.match(panel, /financialValidationAlerts\?\.\(8\)/)
  assert.match(panel, /criticalErrors\?\.\(8\)/)
  assert.match(panel, /Export Bundle/)
  assert.match(panel, /This device only — does not reflect PWA\/browser queue state/)
  assert.match(panel, /Validation Alerts/)
  assert.match(panel, /Critical Error Log/)
  assert.match(panel, /Dependency: \{item\.dependencyState \|\| 'unknown'\}/)
  assert.match(panel, /Cannot verify financial agreement — offline/)
  assert.match(panel, /Manual Clear Left Integrity Unproven/)
  assert.match(panel, /Server Mismatch Detected During Replay/)
  assert.match(panel, /Run Sync Now/)
  assert.match(panel, /integrity alert\(s\) were recorded because remote persistence is still unconfirmed/)

  assert.match(database, /'pos-orders':\s*\(\)\s*=>\s*supabase[\s\S]*?from\('pos_orders'\)/)
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

  const reports = await read('src/renderer/src/components/Reports.jsx')
  assert.match(reports, /bb_strict_finance_reports/)
  assert.match(reports, /Strict Finance Mode On/)
  assert.match(reports, /Strict finance mode is on, and the revenue report/)
  assert.match(reports, /Revenue source: server-authoritative/)
  assert.match(reports, /Profit and loss source:/)
  assert.match(reports, /Outlet profit and loss source:/)
  assert.match(reports, /Room profitability source:/)
  assert.match(reports, /POS sales source:/)
  assert.match(reports, /Inventory spend source:/)

  const appShell = await read('src/renderer/src/App.jsx')
  assert.match(appShell, /function FinancialHealthBanner\(/)
  assert.match(appShell, /criticalErrors\?\.\(3\)/)
  assert.match(appShell, /<FinancialHealthBanner \/>/)

  const resetSql = await read('supabase/migrations/20260426_test_reset_invoice_cleanup_fix.sql')
  assert.match(resetSql, /invoice_number = any\(v_invoice_numbers\)/)
  assert.match(resetSql, /delete from public\.invoices/)

  const reportsSql = await read('supabase/migrations/20260426_reporting_range_authority.sql')
  assert.match(reportsSql, /create or replace function public\.get_revenue_report/)
  assert.match(reportsSql, /create or replace function public\.get_profit_loss_summary/)
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

  console.log('production-guardrails: ok')
}

run().catch((error) => {
  console.error('production-guardrails: failed')
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
