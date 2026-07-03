import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeQueuedSyncItemForReplay } from '../src/main/domains/syncShared.js'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

function functionSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  assert.ok(start >= 0, `${startMarker} was not found`)
  assert.ok(end > start, `${endMarker || 'end of file'} was not found after ${startMarker}`)
  return source.slice(start, end)
}

async function run() {
  const bookings = await read('src/main/domains/bookings.js')
  const inventory = await read('src/main/domains/inventory.js')
  const inventoryUi = await read('src/renderer/src/components/Inventory.jsx')
  const preload = await read('src/preload/index.js')
  const mainIndex = await read('src/main/index.js')
  const infrastructure = await read('src/main/domains/infrastructure.js')
  const syncCache = await read('src/main/domains/syncCache.js')
  const meshQueueMerge = await read('src/main/domains/mesh/meshQueueMerge.js')
  const pool = await read('src/main/domains/pool.js')
  const pwaApi = await read('manager-pwa/src/lib/api.js')
  const integritySql = await read('supabase/migrations/20260618120000_idempotent_inventory_adjustments.sql')
  const mutationAuditSql = await read('supabase/migrations/20260618130000_financial_mutation_idempotency_and_booking_audit.sql')
  const overloadFixSql = await read('supabase/migrations/20260618131000_remove_ambiguous_booking_rpc_defaults.sql')
  const baselineSql = await read('supabase/migrations/20260526101632_baseline_20260526_remote_schema.sql')
  const paymentSql = await read('supabase/migrations/20260612193000_legacy_pos_database_contract.sql')
  const poolMeshSql = await read('supabase/migrations/20260618211000_pool_day_use_mesh_contract.sql')
  const retainedFeeReportingSql = await read('supabase/migrations/20260619120000_fix_refund_retained_fee_reporting.sql')
  const clientUpdateGateSql = await read('supabase/migrations/20260619133000_client_safe_update_gate.sql')
  const reports = await read('src/main/domains/reports.js')
  const packageJson = JSON.parse(await read('package.json'))

  const createBooking = functionSection(
    bookings,
    'export async function createBooking(data)',
    'export async function updateBooking(id, data)'
  )
  assert.match(createBooking, /p_deposit_amount:\s*deposit/)
  assert.doesNotMatch(createBooking, /await updateBookingPayment\(/)
  assert.match(createBooking, /_financial_estimate:\s*deposit > 0/)

  const quotationConversion = functionSection(
    bookings,
    'export async function convertQuotationToBooking(',
    null
  )
  assert.match(quotationConversion, /p_deposit_amount:\s*deposit/)
  assert.doesNotMatch(quotationConversion, /await updateBookingPayment\(/)
  assert.match(quotationConversion, /_financial_estimate:\s*deposit > 0/)

  assert.match(inventory, /const adjustmentId = operationId \|\| randomUUID\(\)/)
  assert.match(inventory, /p_adjustment_id:\s*adjustmentId/)
  assert.match(inventory, /_queue_id:\s*`inventory-adjust-\$\{adjustmentId\}`/)
  assert.match(inventoryUi, /setAdjustOperationId\(crypto\.randomUUID\(\)\)/)
  assert.match(inventoryUi, /setOpeningOperationId\(crypto\.randomUUID\(\)\)/)
  assert.match(inventoryUi, /adjustOperationId/)
  assert.match(inventoryUi, /openingOperationId/)
  assert.match(preload, /adjustStock: \(itemId, delta, notes, managerPin, adjustmentId\)/)
  assert.match(mainIndex, /inventory:adjustStock'[\s\S]*managerPin, adjustmentId[\s\S]*adjustInventoryStock\(itemId, delta, notes, adjustmentId\)/)

  const upgradedQueueItem = normalizeQueuedSyncItemForReplay({
    type: 'rpc',
    table: 'adjust_inventory_stock',
    _queue_id: 'inventory-adjust-11111111-1111-4111-8111-111111111111',
    data: {
      p_item_id: '22222222-2222-4222-8222-222222222222',
      p_lodge_id: '33333333-3333-4333-8333-333333333333',
      p_delta: 2
    }
  })
  assert.equal(upgradedQueueItem.data.p_adjustment_id, '11111111-1111-4111-8111-111111111111')

  const upgradedBookingMutation = normalizeQueuedSyncItemForReplay({
    type: 'rpc',
    table: 'update_booking_status',
    _queue_id: 'op-11111111-1111-4111-8111-111111111111',
    data: {
      p_id: '22222222-2222-4222-8222-222222222222',
      p_lodge_id: '33333333-3333-4333-8333-333333333333',
      p_status: 'checked_in'
    }
  })
  assert.equal(
    upgradedBookingMutation.data.p_idempotency_key,
    'sync:update_booking_status:op-11111111-1111-4111-8111-111111111111'
  )

  assert.match(meshQueueMerge, /adjust_inventory_stock missing adjustment id/)
  assert.match(meshQueueMerge, /update_pool_day_use/)
  assert.match(pool, /rpc\('update_pool_day_use'/)
  assert.doesNotMatch(
    functionSection(pool, 'async function updatePoolDayUseEntryFields(', '// ─── POOL / DAY USE'),
    /\.from\('pool_day_use'\)[\s\S]*\.update\(/,
    'day-use settlement must not directly update financial rows'
  )
  assert.match(poolMeshSql, /for update/)
  assert.match(poolMeshSql, /pool_day_use_operation_receipts/)
  assert.match(poolMeshSql, /'idempotent', true/)
  assert.match(integritySql, /inventory_movements_adjustment_idempotency_uidx/)
  assert.match(integritySql, /where reference_type = 'inventory_adjustment' and reference_id is not null/)
  assert.match(integritySql, /for update/)
  assert.match(integritySql, /'idempotent', true/)
  assert.match(integritySql, /p_adjustment_id/)
  assert.match(integritySql, /drop function if exists public\.update_booking_payment\(uuid, uuid, numeric, text\)/)
  assert.match(mutationAuditSql, /create table if not exists public\.financial_operation_idempotency/)
  assert.match(mutationAuditSql, /pg_advisory_xact_lock/)
  assert.match(mutationAuditSql, /create or replace function public\.update_booking\([\s\S]*p_idempotency_key text/)
  assert.match(mutationAuditSql, /create or replace function public\.update_booking_status\([\s\S]*p_idempotency_key text/)
  assert.match(mutationAuditSql, /create or replace function public\.add_booking_charge\([\s\S]*p_idempotency_key text/)
  assert.match(mutationAuditSql, /create or replace function public\.approve_booking_refund\([\s\S]*p_idempotency_key text/)
  assert.match(mutationAuditSql, /'booking_total_edited'/)
  assert.match(mutationAuditSql, /'booking_status_changed'/)
  assert.doesNotMatch(
    overloadFixSql,
    /p_expected_updated_at timestamptz default/,
    'booking concurrency overloads must not retain ambiguous defaults'
  )
  assert.match(overloadFixSql, /create or replace function public\.update_booking_status/)
  assert.match(bookings, /p_idempotency_key:\s*idempotencyKey/)
  assert.match(bookings, /p_idempotency_key:\s*createOperationIdempotencyKey\(`booking:refund:/)
  assert.match(bookings, /rpc\('add_booking_charge'[\s\S]*p_idempotency_key:\s*idempotencyKey/)

  assert.match(infrastructure, /shouldRefreshBookingsAfterFailure = true/)
  assert.match(infrastructure, /\|\| shouldRefreshBookingsAfterFailure\) refreshTargets\.push\('bookings', 'booking-charges'\)/)
  assert.match(syncCache, /\['failed', 'sync_failed', 'manual_review_required'\]\.includes\(patch\._sync_state\)/)

  assert.doesNotMatch(pwaApi, /async function executeCreateBooking\(/)
  assert.doesNotMatch(pwaApi, /async function executeUpdateBookingStatus\(/)
  assert.doesNotMatch(pwaApi, /async function executeUpdateBookingPayment\(/)
  assert.doesNotMatch(pwaApi, /function rejectFrontDeskOnlyAction\(/)
  assert.match(pwaApi, /p_item_id:\s*payload\.id/)
  assert.match(pwaApi, /p_adjustment_id:\s*payload\.adjustment_id \|\| crypto\.randomUUID\(\)/)

  assert.match(baselineSql, /ADD CONSTRAINT no_overlapping_bookings EXCLUDE USING gist/)
  assert.match(baselineSql, /insert into public\.invoice_sequences[\s\S]*on conflict \(lodge_id, year\)[\s\S]*do update/)
  assert.match(baselineSql, /CREATE UNIQUE INDEX invoices_lodge_id_invoice_number_key/)
  assert.match(paymentSql, /from public\.bookings[\s\S]*for update/)
  assert.match(retainedFeeReportingSql, /from public\.refund_approval_log/)
  assert.match(retainedFeeReportingSql, /sum\(greatest\(coalesce\(r\.retained_amount, 0\), 0\)\)/)
  assert.doesNotMatch(
    retainedFeeReportingSql,
    /cb\.id is not null[\s\S]*pw\.amount > 0/,
    'retained fee reporting must not reinterpret original cancelled-booking payments as fees'
  )
  assert.doesNotMatch(
    reports,
    /cancelledBookingIds\.has\(payment\.booking_id\)[\s\S]*retained \+= amount/,
    'desktop fallback must not count the original payment as a retained fee'
  )
  assert.doesNotMatch(
    pwaApi,
    /cancelledBookingIds\.has\(payment\.booking_id\)[\s\S]*retained \+= amount/,
    'PWA fallback must not count the original payment as a retained fee'
  )
  assert.match(clientUpdateGateSql, /grant execute on function public\.app_check_update_availability\(text, text\)[\s\S]*to anon, authenticated, service_role/)
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, false)
  assert.equal(packageJson.build.nsis.perMachine, false)
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false)

  // ── Customer Credit & Reschedule integrity ──────────────────────────────
  const customerCreditSql = await read('supabase/migrations/20260620100000_customer_credit_and_booking_reschedule.sql')
  const customerCreditJs = await read('src/main/domains/customerCredit.js')

  // Customer credit ledger must use idempotency keys
  assert.match(customerCreditSql, /customer_credit_ledger_lodge_idempotency_uidx/, 'Customer credit must have idempotency unique index')
  assert.match(customerCreditJs, /p_idempotency_key/, 'Customer credit RPC calls must include idempotency keys')

  // Customer credit must not have direct table mutations in Electron
  assert.doesNotMatch(customerCreditJs, /\.from\('customer_credit_ledger'\)\.insert/, 'Must not insert directly into customer_credit_ledger')
  assert.doesNotMatch(customerCreditJs, /\.from\('customer_credit_ledger'\)\.update/, 'Must not update customer_credit_ledger directly')

  // Reschedule must use RPC
  assert.match(bookings, /\.rpc\('reschedule_booking'/, 'Reschedule must use RPC')
  assert.doesNotMatch(
    bookings,
    /rescheduleBooking[\s\S]*?\.from\('bookings'\)[\s\S]*?\.update\(/,
    'Reschedule must not directly update bookings table'
  )

  // Customer credit allocation must be atomic (single RPC call)
  assert.match(customerCreditJs, /\.rpc\('apply_customer_credit_to_booking'/, 'Credit allocation must use atomic RPC')

  console.log('financial-integrity-regression: ok')
}

run().catch((error) => {
  console.error('financial-integrity-regression: failed')
  console.error(error?.stack || error)
  process.exitCode = 1
})
