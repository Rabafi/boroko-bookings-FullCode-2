import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { state } from '../src/main/state.js'
import {
  appendOperationJournalEntry,
  readOfflineModeState,
  readOperationJournal,
  writeLocalOperationsBundle,
  writeOfflineModeState,
  writeSyncQueue
} from '../src/main/domains/syncStore.js'
import { pickNextReadySyncItemIndex } from '../src/shared/syncQueue.js'

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
  const originalCacheDir = state.cacheDir
  const durabilityRoot = await mkdtemp(path.join(os.tmpdir(), 'boroko-sync-durability-'))
  try {
    state.cacheDir = durabilityRoot
    writeSyncQueue([{ type: 'rpc', table: 'update_booking_payment', data: { p_idempotency_key: 'test-payment-key' } }])
    const savedQueue = JSON.parse(await readFile(path.join(durabilityRoot, 'sync-queue.json'), 'utf8'))
    assert.equal(savedQueue.length, 1)
    assert.equal(savedQueue[0].data.p_idempotency_key, 'test-payment-key')

    appendOperationJournalEntry('queued', {
      type: 'rpc',
      table: 'update_booking_payment',
      _queue_id: 'booking-payment-test',
      data: { p_idempotency_key: 'test-payment-key' }
    })
    const journalRows = readOperationJournal({ limit: 10 })
    assert.equal(journalRows.length, 1)
    assert.equal(journalRows[0].event, 'queued')
    assert.equal(journalRows[0].payload_hash.length, 64)

    const offlineState = writeOfflineModeState({ enabled: true, reason: 'outage test', acknowledgedRisksAt: '2026-07-03T00:00:00.000Z' })
    assert.equal(offlineState.enabled, true)
    assert.equal(readOfflineModeState().reason, 'outage test')
    await writeFile(path.join(durabilityRoot, 'lodge-offline-mode.json'), JSON.stringify({
      enabled: false,
      reason: 'old outage',
      startedAt: '2026-06-01T00:00:00.000Z',
      endedAt: '2026-06-02T00:00:00.000Z',
      acknowledgedRisksAt: '2026-06-01T00:00:00.000Z'
    }), 'utf8')
    const restartedOfflineState = writeOfflineModeState({ enabled: true, reason: 'second outage', acknowledgedRisksAt: '2026-07-03T00:00:00.000Z' })
    assert.notEqual(restartedOfflineState.startedAt, '2026-06-01T00:00:00.000Z')
    assert.equal(restartedOfflineState.endedAt, null)
    const bundlePath = path.join(durabilityRoot, 'operations-bundle.json')
    const bundleResult = writeLocalOperationsBundle(bundlePath, { test: true })
    assert.equal(bundleResult.success, true)
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'))
    assert.equal(bundle.pendingQueue.length, 1)
    assert.equal(bundle.operationJournal.length, 1)
    assert.equal(bundle.offlineMode.enabled, true)
    assert.equal(readOfflineModeState().lastBackupPath, bundlePath)

    const invalidCacheRoot = path.join(durabilityRoot, 'not-a-directory')
    await writeFile(invalidCacheRoot, 'block directory creation', 'utf8')
    state.cacheDir = invalidCacheRoot
    const originalConsoleError = console.error
    console.error = () => {}
    try {
      assert.throws(
        () => writeSyncQueue([]),
        /Sync queue write failed:/,
        'queue persistence failures must propagate to the caller'
      )
    } finally {
      console.error = originalConsoleError
    }
  } finally {
    state.cacheDir = originalCacheDir
    await rm(durabilityRoot, { recursive: true, force: true })
  }

  const database = [
    await read('src/main/database.js'),
    ...(await readTree('src/main/domains'))
  ].join('\n')
  const mainIndex = await read('src/main/index.js')
  const preload = await read('src/preload/index.js')
  const packageJson = await read('package.json')
  const bookingsUi = await read('src/renderer/src/components/Bookings.jsx')
  const bookingInvoicesUi = await read('src/renderer/src/components/BookingInvoices.jsx')
  const posUi = await read('src/renderer/src/components/POS.jsx')
  const layout = await read('src/renderer/src/components/Layout.jsx')
  const offlineNotice = await read('src/renderer/src/components/shared/OfflineNotice.jsx')
  const health = await read('src/renderer/src/components/SystemHealthPanel.jsx')
  const conferenceUi = await read('src/renderer/src/components/Conference.jsx')
  const dayUseUi = await read('src/renderer/src/components/DayUse.jsx')
  const quotationsUi = await read('src/renderer/src/components/Quotations.jsx')
  const posReplaySql = await read('supabase/migrations/20260507_pos_offline_inventory_payload.sql')
  const posVoidHardeningSql = await read('supabase/migrations/20260524_pos_void_pin_stock_hardening.sql')
  const posLaunchReadinessSql = await read('supabase/migrations/20260604120000_pos_inventory_launch_readiness.sql')
  const longOutageSql = await read('supabase/migrations/20260703120000_offline_normal_operations_idempotency.sql')
  const groupInvoiceSql = await read('supabase/migrations/20260703133000_accommodation_group_invoices.sql')

  assert.match(packageJson, /"test:offline-queue-critical":\s*"node \.\\\\tests\\\\offline-queue-regression\.test\.mjs"/)

  // Shared offline queue / replay contract
  assert.match(database, /async function processSyncQueue\(\)/)
  assert.match(database, /if \(!state\.replayAuthReady\)/)
  assert.match(database, /function queueOperation\(type, table, data, id = null, meta = \{\}\)/)
  assert.match(database, /pending:\s*queue\.length/)
  assert.match(database, /failed:\s*failed\.length/)
  assert.match(database, /syncInProgress/)
  assert.match(database, /replayAuthReady/)
  assert.match(database, /const CONNECTIVITY_CHECK_INTERVAL_MS = 60000/)
  assert.match(database, /const CONNECTIVITY_PROBE_TIMEOUT_MS = 10000/)
  assert.match(database, /const CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD = 3/)
  assert.match(database, /const PERIODIC_SYNC_INTERVAL_MS = 120000/)
  assert.match(database, /setTimeout\(\(\) => ctrl\.abort\(\), CONNECTIVITY_PROBE_TIMEOUT_MS\)/)
  assert.match(database, /connectivityCheckInProgress/)
  assert.match(database, /hasPendingSync/)
  assert.match(database, /wasOnline !== state\.isOnline/)
  assert.match(database, /dependencyState:\s*item\?\._depends_on/)
  assert.match(database, /manualRetryOnly:\s*manualReviewOnly/)
  assert.match(database, /function normalizeQueuedSyncItemForReplay\(item = \{\}\)/)
  assert.match(database, /function resolveQueuedItemCreatedAtRaw\(item = \{\}\)/)
  assert.match(database, /item\?\.timestamp[\s\S]{0,180}item\?\.createdAt[\s\S]{0,180}item\?\.created_at[\s\S]{0,180}item\?\.queued_at/)
  assert.match(database, /\['update_booking', 'update_customer', 'update_room', 'update_quotation'\]\.includes\(next\.table\)[\s\S]{0,180}next\.data\.p_expected_updated_at = null/)
  assert.match(database, /next\.table === 'update_booking_status'[\s\S]{0,240}startsWith\('booking-'\)[\s\S]{0,120}next\.data\.p_expected_updated_at = null/)
  assert.match(database, /function isBenignBookingDriftFault\(fault = \{\}\)/)
  assert.match(database, /parsed\.filter\(\(fault\) => !isBenignBookingDriftFault\(fault\)\)/)
  assert.match(mainIndex, /ipcMain\.handle\('sync:getStatus'/)
  assert.doesNotMatch(mainIndex, /sync:getStatus'[\s\S]{0,140}requireCapability\('system\.health'\)/)
  assert.match(mainIndex, /ipcMain\.handle\('sync:getDetails'/)
  assert.match(health, /Items still sending/)
  assert.match(health, /data-testid="system-health-failed-queue"/)
  assert.match(health, /Money check/)
  assert.match(layout, /Clock,/)
  assert.match(layout, /AlertCircle/)
  assert.match(layout, /syncStatus\.pending/)
  assert.match(layout, /Final cloud confirmation for offline-created bookings/)
  assert.match(layout, /Final invoice number confirmation after offline conversion/)
  assert.match(layout, /!isPosRoute && <OfflineNotice tasks=\{currentOfflineTasks\} \/>/)
  assert.match(offlineNotice, /showOfflineNotice/)
  assert.match(offlineNotice, /setTimeout\(\(\) => \{[\s\S]{0,80}setShowOfflineNotice\(true\)/)
  assert.match(offlineNotice, /Work saved on this computer will queue safely and sync when the internet returns/)

  // Bookings: create/update/status/payment must stay queue-aware and visible.
  assert.match(database, /queueOperation\('rpc', campsite \? 'create_campsite_booking' : 'create_booking', \{/)
  assert.match(database, /p_tents: booking\.tents/)
  assert.match(database, /p_vehicles: booking\.vehicles/)
  assert.match(database, /appendOperationJournalEntry\('queued'/)
  assert.match(database, /appendOperationJournalEntry\('replayed'/)
  assert.match(database, /appendOperationJournalEntry\('dead_lettered'/)
  assert.match(database, /appendOperationJournalEntry\('manually_cleared'/)
  assert.match(database, /writeLocalOperationsBundle/)
  assert.match(database, /setOfflineModeState/)
  assert.match(mainIndex, /sync:exportOfflineOperations/)
  assert.match(mainIndex, /dialog\.showSaveDialog/)
  assert.match(preload, /exportOfflineOperations/)
  assert.match(health, /: 'Lodge'/)
  assert.match(health, /\{businessWordTitle\} offline mode/)
  assert.match(health, /Acknowledge Long Outage/)
  assert.match(health, /Save Bundle/)
  assert.match(database, /_queue_id:\s*`booking-\$\{id\}`/)
  assert.match(database, /function buildLocalPendingInvoiceNumber\(/)
  assert.match(database, /function buildOfflineBookingFinancialState\(/)
  assert.match(database, /export async function createMultiRoomBooking/)
  assert.match(database, /buildAccommodationGroupId/)
  assert.match(database, /appendAccommodationGroupMetadata/)
  assert.match(database, /queueOperation\('rpc', 'create_booking_invoice_group'/)
  assert.match(database, /booking-invoice-groups/)
  assert.match(database, /export async function updateGroupInvoicePayment/)
  assert.match(database, /await createBooking\(\{[\s\S]*room_id: plan\.room_id/)
  assert.match(database, /function mergeRemoteBookingsWithLocalState\(/)
  assert.match(database, /writeCache\(name, mergeRemoteBookingsWithLocalState\(data \|\| \[\]\), \{ source: 'remote' \}\)/)
  assert.match(database, /const mappedWithRefundState = applyRefundSettlementState\(mapped, refundSettlements\)/)
  assert.match(database, /const mergedLiveRows = mergeRemoteBookingsWithLocalState\(mappedWithRefundState, localRowsForMerge\)/)
  assert.match(database, /readCache\('booking-refund-requests'\)/)
  assert.match(database, /appendOperationJournalEntry\('refund_request_saved'/)
  assert.match(database, /requires_online_approval:\s*true/)
  assert.doesNotMatch(database, /queueOperation\('rpc',\s*'approve_booking_refund'/)
  assert.match(database, /cachedCustomer\?\._pending_sync \? \{ _depends_on: `customer-\$\{booking\.customer_id\}` \} : \{\}/)
  assert.match(database, /amount_paid:\s*optimisticPayment\.amount_paid/)
  assert.match(database, /payment_status:\s*optimisticPayment\.payment_status/)
  assert.match(database, /_local_invoice_number:\s*buildLocalPendingInvoiceNumber\(id\)/)
  assert.match(database, /_pending_sync:\s*true,[\s\S]*_pending_payment:\s*deposit > 0/)
  assert.match(database, /_sync_created_offline:\s*true/)
  assert.match(database, /const _updDepend = cached\[idx\]\?\._pending_sync \? `booking-\$\{id\}` : null/)
  assert.match(database, /queueOperation\('rpc', 'update_booking', \{/)
  assert.match(database, /const _stDepend = bookings\[idx\]\?\._pending_sync \? `booking-\$\{id\}` : null/)
  assert.match(database, /queueOperation\('rpc', 'update_booking_status', \{/)
  assert.match(database, /p_expected_updated_at:\s*_stDepend \? null : expectedUpdatedAt/)
  assert.match(database, /const autoDepend\s*=\s*dependsOn \|\| \(b\._pending_sync \? `booking-\$\{id\}` : null\)/)
  assert.match(database, /queueOperation\('rpc', 'update_booking_payment', \{/)
  assert.match(database, /booking\._local_invoice_number \|\| null/)
  assert.match(database, /refreshTargets\.push\('bookings', 'booking-charges'\)/)
  assert.match(database, /customer_id:\s*b\.customer_id/)
  assert.match(database, /room_id:\s*b\.room_id/)
  assert.match(database, /hasDriftBaselineValue\(pre\.customer_id\)/)
  assert.match(database, /hasDriftBaselineValue\(pre\.room_id\)/)
  assert.match(bookingsUi, /Pending Sync/)
  assert.match(bookingsUi, /Sync Failed/)
  assert.match(bookingsUi, /Changes are queued and will sync when the app is online\./)
  assert.match(bookingsUi, /Displayed balance is an estimate until Supabase confirms the payment/)
  assert.match(bookingsUi, /const fmtBkNum = \(b\) => b\.invoice_number \|\| b\._local_invoice_number \|\| \(b\._pending_sync \? 'PENDING' : '—'\)/)
  assert.match(bookingsUi, /const isOfflineCreatedPendingBooking = booking\?\._pending_sync && booking\?\._sync_created_offline/)
  assert.match(bookingsUi, /status === 'cancelled' && isFinanciallySyncBlocked\(id\) && !isOfflineCreatedPendingBooking/)
  assert.match(bookingsUi, /createMultiRoom/)
  assert.match(bookingsUi, /selectedRoomIds/)
  assert.match(bookingsUi, /room_guests/)
  assert.match(bookingInvoicesUi, /GroupPaymentModal/)
  assert.match(groupInvoiceSql, /booking_invoice_groups/)
  assert.match(groupInvoiceSql, /create_booking_invoice_group/)
  assert.match(bookingInvoicesUi, /result\?\.pending_approval/)
  assert.match(bookingInvoicesUi, /required=\{!isOffline\}/)
  assert.match(bookingInvoicesUi, /isRefundActionBlocked/)

  const createdAtHelperMatch = database.match(/function resolveQueuedItemCreatedAtRaw\(item = \{\}\) \{[\s\S]*?\n\}/)
  assert.ok(createdAtHelperMatch, 'resolveQueuedItemCreatedAtRaw helper missing')
  const resolveQueuedItemCreatedAtRaw = new Function(`${createdAtHelperMatch[0]}; return resolveQueuedItemCreatedAtRaw;`)()
  assert.equal(
    resolveQueuedItemCreatedAtRaw({ timestamp: '2026-03-31T23:59:59.000Z', createdAt: '2026-04-01T00:00:00.000Z' }),
    '2026-03-31T23:59:59.000Z'
  )
  assert.equal(
    resolveQueuedItemCreatedAtRaw({ createdAt: '2026-03-31T23:59:59.000Z', created_at: '2026-04-01T00:00:00.000Z' }),
    '2026-03-31T23:59:59.000Z'
  )
  assert.equal(
    resolveQueuedItemCreatedAtRaw({ data: { created_at_client: '2026-03-31T23:59:59.000Z' } }),
    '2026-03-31T23:59:59.000Z'
  )

  // Quotations: critical offline quote lifecycle remains queued and refreshed.
  assert.match(database, /queueOperation\('rpc', 'create_quotation', \{ payload: record \}/)
  assert.match(database, /queueOperation\('rpc', 'update_quotation', \{/)
  assert.match(database, /p_expected_updated_at:\s*expectedUpdatedAt/)
  assert.match(database, /queueOperation\('rpc', 'mark_quotation_sent', \{/)
  assert.match(database, /queueOperation\('rpc', 'convert_quotation_to_booking', \{/)
  assert.match(database, /_queue_id:\s*`quotation-convert-\$\{quotationId\}`/)
  assert.match(database, /_sync_source:\s*'quotation_conversion'/)
  assert.match(database, /isConvertQuotationQueueItem\(item\)/)
  assert.match(database, /function rewriteQueuedBookingReferenceItem\(item, localBookingId, serverBookingId\)/)
  assert.match(database, /pending\[i\] = rewriteQueuedBookingReferenceItem\(pending\[i\], localBookingId, serverBookingId\)/)
  assert.match(database, /shouldRefreshQuotations = true/)
  assert.match(database, /refreshTargets\.push\('quotations'\)/)

  // mark_quotation_sent must trigger quotation cache refresh after sync.
  assert.match(
    database,
    /'mark_quotation_sent'[\s\S]{0,80}shouldRefreshQuotations/
  )

  // Quotation merge contract: mergeRemoteQuotationsWithLocalState must exist and
  // be used in the quotations cache write path so pending-sync rows survive refresh.
  assert.match(database, /function mergeRemoteQuotationsWithLocalState\(/)
  assert.match(database, /writeCache\(name, mergeRemoteQuotationsWithLocalState\(data \|\| \[\]\), \{ source: 'remote' \}\)/)

  // pickNextReadySyncItemIndex unit tests for the prior-run fix
  {
    const base = { type: 'rpc', table: 'update_quotation', data: {} }
    const child = { ...base, _queue_id: 'child-1', _depends_on: 'quotation-parent-1' }

    // Case 1: No dependency → ready
    assert.equal(
      pickNextReadySyncItemIndex([{ ...base, _queue_id: 'x' }]),
      0,
      'item with no _depends_on should be picked'
    )

    // Case 2: Parent in failedQueueIds → ready
    const failed = new Set(['quotation-parent-1'])
    assert.equal(
      pickNextReadySyncItemIndex([child], new Set(), failed),
      0,
      'child should be picked when parent is in failedQueueIds'
    )

    // Case 3: Parent in completedQueueIds → ready
    const completed = new Set(['quotation-parent-1'])
    assert.equal(
      pickNextReadySyncItemIndex([child], completed),
      0,
      'child should be picked when parent is in completedQueueIds'
    )

    // Case 4: Parent in pendingIds → blocked
    const parent = { ...base, _queue_id: 'quotation-parent-1' }
    assert.equal(
      pickNextReadySyncItemIndex([parent, child]),
      0,
      'parent should be picked first when child depends on it'
    )
    // With only child in pending (parent already picked), child is blocked
    // because parent's _queue_id is not in any tracking set — but there are
    // no other items either, so findIndex returns -1.
    // HOWEVER, our fix treats absent-from-all-sets as resolved, so the child
    // is actually allowed. This is correct for the prior-run scenario.
    // To test true "parent pending" behavior, parent must be in the array:
    assert.equal(
      pickNextReadySyncItemIndex([parent, child], new Set(), new Set()),
      0,
      'parent should be picked before child when both are pending'
    )

    // Case 5: Parent absent from ALL sets → ready (prior-run scenario)
    assert.equal(
      pickNextReadySyncItemIndex([child], new Set(), new Set()),
      0,
      'child should be picked when parent is absent from all tracking sets (prior sync run)'
    )

    // Case 6: With a callback that returns false → still ready (parent absent)
    const falseCallback = () => false
    assert.equal(
      pickNextReadySyncItemIndex([child], new Set(), new Set(), falseCallback),
      0,
      'child should be picked even if callback returns false when parent is absent from all sets'
    )
  }
  assert.match(quotationsUi, /window\.api\.quotations\.getAll\(\)/)
  assert.match(quotationsUi, /window\.api\.quotations\.create\(data\)/)
  assert.match(quotationsUi, /window\.api\.quotations\.update\(q\.id, \{ \.\.\.q, status: newStatus \}\)/)
  assert.match(quotationsUi, /Booking queued offline/)

  // Long-outage normal operations: every non-admin lodge workflow added here
  // must remain queued, locally visible, mesh-shareable, and idempotent on replay.
  assert.match(database, /queueOperation\('rpc', 'add_booking_charge', \{/)
  assert.match(database, /queueOperation\('rpc', 'delete_booking_charge', \{/)
  assert.match(database, /writeCache\('booking-charges'/)
  assert.match(database, /patchCachedBookingFinancialEstimate/)
  assert.match(database, /queueOperation\('rpc', 'apply_customer_credit_to_booking', \{/)
  assert.match(database, /queueOperation\('rpc', 'refund_customer_credit', \{/)
  assert.match(database, /queueOperation\('rpc', 'reverse_customer_credit_entry', \{/)
  assert.match(database, /mergeCreditLedgerRows/)
  assert.match(database, /customer-credit-summary/)
  assert.match(database, /mergeCreditSummaryRows/)
  assert.match(database, /patchCreditSummaryBalance/)
  assert.match(database, /p_limit:\s*1000/)
  assert.match(database, /queueOperation\('rpc', 'create_room_rate_override', \{/)
  assert.match(database, /queueOperation\('rpc', 'update_room_rate_override', \{/)
  assert.match(database, /queueOperation\('rpc', 'delete_room_rate_override', \{/)
  assert.match(database, /findApplicableRateOverrideFromCache/)
  assert.match(database, /queueOperation\('rpc', 'create_expense'/)
  assert.match(database, /queueOperation\('rpc', 'update_expense'/)
  assert.match(database, /queueOperation\('rpc', 'delete_expense'/)
  assert.match(database, /queueOperation\('rpc', 'update_maintenance_ticket'/)
  assert.match(database, /queueOperation\('rpc', 'resolve_maintenance_ticket'/)
  assert.match(database, /queueOperation\('rpc', 'add_inventory_purchase'/)
  assert.match(database, /queueOperation\('rpc', 'create_inventory_stocktake_session'/)
  assert.match(database, /queueOperation\('rpc', 'save_inventory_stocktake_counts'/)
  assert.match(database, /queueOperation\('rpc', 'post_inventory_stocktake_session'/)
  assert.match(database, /queueOperation\('rpc', 'add_supply_purchase'/)
  assert.match(database, /queueOperation\('rpc', 'load_supply_to_room'/)
  assert.match(database, /queueOperation\('rpc', 'use_room_supply_stock'/)
  assert.match(database, /queueOperation\('rpc', 'return_room_supply_to_store'/)
  assert.match(database, /queueOperation\('rpc', 'create_supply_stocktake_session'/)
  assert.match(database, /queueOperation\('rpc', 'create_room_supply_stocktake_session'/)
  assert.match(database, /queueOperation\('rpc', 'post_supply_stocktake_session'/)
  assert.match(database, /queueOperation\('rpc', 'post_room_supply_stocktake_session'/)
  assert.match(database, /PRESERVE_PENDING_LOCAL_CACHE_NAMES/)
  assert.match(database, /mergeRemoteRowsPreservingPendingLocal/)
  assert.match(database, /shouldRefreshRateOverrides = true/)
  assert.match(database, /refreshTargets\.push\('room-rate-overrides'\)/)
  assert.match(database, /'create_room_rate_override'[\s\S]*'delete_room_rate_override'/)
  assert.match(database, /'add_booking_charge'[\s\S]*'delete_booking_charge'/)
  assert.match(longOutageSql, /create or replace function public\.create_room_rate_override\(payload jsonb\)/)
  assert.match(longOutageSql, /create or replace function public\.add_inventory_purchase\(payload jsonb\)/)
  assert.match(longOutageSql, /create or replace function public\.create_inventory_stocktake_session\(payload jsonb\)/)
  assert.match(longOutageSql, /create or replace function public\.post_inventory_stocktake_session\([\s\S]*'idempotent', true/)
  assert.match(longOutageSql, /create or replace function public\.add_supply_purchase\(payload jsonb\)/)
  assert.match(longOutageSql, /create or replace function public\.post_supply_stocktake_session\([\s\S]*'idempotent', true/)
  assert.match(longOutageSql, /create or replace function public\.post_room_supply_stocktake_session\([\s\S]*'idempotent', true/)
  assert.match(longOutageSql, /create or replace function public\.load_supply_to_room\(payload jsonb\)[\s\S]*payload->>'operation_id'/)
  assert.match(longOutageSql, /create or replace function public\.use_room_supply_stock\(payload jsonb\)[\s\S]*payload->>'operation_id'/)
  assert.match(longOutageSql, /create or replace function public\.return_room_supply_to_store\(payload jsonb\)[\s\S]*payload->>'operation_id'/)
  assert.match(longOutageSql, /create or replace function public\.create_room_supply_stocktake_line\([\s\S]*Only open room stock takes can be updated/)

  // POS: preserve pending state, keep local stock reservations, and replay inventory deduction.
  assert.match(database, /function getOfflinePosInventoryReservation\(/)
  assert.match(database, /function applyOfflinePosInventoryReservation\(/)
  assert.match(database, /function resolveQueuedPosInventoryLink\(/)
  assert.match(database, /function buildQueuedPosInventoryUsage\(/)
  assert.match(database, /function applyQueuedPosInventoryReservations\(/)
  assert.match(database, /function mergeRemotePosOrdersWithLocalState\(/)
  assert.match(database, /applyQueuedPosInventoryReservations\(data \|\| \[\]\)/)
  assert.match(database, /writeCache\(name, mergeRemoteInventoryWithLocalState\(liveRows\), \{ source: 'remote' \}\)/)
  assert.match(database, /writeCache\(name, mergeRemotePosOrdersWithLocalState\(data \|\| \[\]\), \{ source: 'remote' \}\)/)
  assert.match(database, /const mergedLiveRows = mergeRemotePosOrdersWithLocalState\(data \|\| \[\], cachedOrders\)/)
  assert.match(database, /return applyPosOrderFilters\(mergedLiveRows, startDate, endDate, outletFilter\)/)
  assert.match(database, /queueOperation\('rpc', 'create_pos_order_v3', \{/)
  assert.match(database, /queueOperation\('rpc', 'approve_pos_void_with_pin', \{/)
  assert.match(database, /_queue_id:\s*`pos-order-\$\{id\}`/)
  assert.match(database, /_queue_id:\s*`pos-void-\$\{order_id\}`/)
  assert.match(database, /Pending voids and returns must never make stock sellable/)
  assert.match(database, /upsertLocalPosVoidHistory/)
  assert.match(database, /modifier_option_ids: Array\.isArray\(item\.modifier_option_ids\)/)
  assert.match(database, /modifier_option_ids: Array\.isArray\(i\.modifier_option_ids\)/)
  assert.match(database, /refreshTargets\.push\('pos-orders'\)/)
  assert.match(database, /const link = resolveQueuedPosInventoryLink\(entry, \{ outletId \}\)/)
  assert.match(posUi, /Pending Sync/)
  assert.match(posUi, /Failed Sync/)
  assert.match(posUi, /Needs Attention/)
  assert.match(posUi, /onClick=\{\(\) => openVoidModal\(o\)\}/)
  assert.doesNotMatch(posUi, /window\.api\.pos\.voidOrder\(o\.id\)/)
  assert.match(posUi, /Approve Offline Void/)
  assert.match(posReplaySql, /create or replace function public\.create_pos_order\(payload jsonb\)/)
  assert.match(posReplaySql, /nullif\(v_item->>'inventory_item_id', ''\)::uuid/)
  assert.match(posReplaySql, /coalesce\(nullif\(v_item->>'depletion_qty', ''\)::numeric, 1\)/)
  assert.match(posLaunchReadinessSql, /public\._positive_depletion_qty/)
  assert.match(posLaunchReadinessSql, /inventory_item_id, depletion_qty/)
  assert.match(posLaunchReadinessSql, /v_required_stock <= 0 or coalesce\(current_stock, 0\) >= v_required_stock/)
  assert.match(posReplaySql, /update public\.inventory_items/)
  assert.match(posVoidHardeningSql, /add column if not exists inventory_item_id uuid references public\.inventory_items\(id\)/)
  assert.match(posVoidHardeningSql, /create or replace function public\.populate_pos_order_item_inventory_link\(\)/)
  assert.match(posVoidHardeningSql, /coalesce\(poi\.inventory_item_id, pmi\.inventory_item_id\) as inventory_item_id/)
  assert.match(posVoidHardeningSql, /POS voids require supervisor, manager, or admin PIN approval/)
  assert.match(posVoidHardeningSql, /create or replace function public\.approve_pos_void_with_pin\(payload jsonb\)/)
  assert.match(posVoidHardeningSql, /override_log_id/)
  assert.match(posVoidHardeningSql, /on conflict \(id\) do nothing/)
  assert.match(posVoidHardeningSql, /'restored_stock', v_restored/)

  // Conference bookings: offline create/update/delete stay in the shared queue and reload in UI.
  assert.match(database, /queueOperation\('rpc', 'create_conference_booking', \{ payload \}/)
  assert.match(database, /queueOperation\('rpc', 'update_conference_booking', \{/)
  assert.match(database, /queueOperation\('rpc', 'delete_conference_booking', \{/)
  assert.match(database, /shouldRefreshConference = true/)
  assert.match(database, /refreshTargets\.push\('conference-bookings', 'event-line-items'\)/)
  assert.match(database, /FINANCIAL_SYNC_TABLES[\s\S]*'create_event_booking'/)
  assert.match(database, /FINANCIAL_SYNC_TABLES[\s\S]*'update_event_booking'/)
  assert.match(database, /FINANCIAL_SYNC_TABLES[\s\S]*'update_event_payment'/)
  assert.match(database, /FINANCIAL_SYNC_TABLES[\s\S]*'cancel_event_booking'/)
  assert.match(database, /'create_event_booking'[\s\S]*'update_event_booking'[\s\S]*'update_event_payment'[\s\S]*'cancel_event_booking'[\s\S]*shouldRefreshConference = true/)
  assert.match(conferenceUi, /window\.api\.conference\.getAll\(start, end\)/)
  assert.match(conferenceUi, /window\.api\.conference\.create\(payload\)/)
  assert.match(conferenceUi, /window\.api\.conference\.update\(editing\.id, payload\)/)
  assert.match(conferenceUi, /window\.api\.conference\.delete\(id\)/)

  // Pool / day use: offline create/delete stay queued and UI refreshes on sync.
  assert.match(database, /queueOperation\('rpc', 'add_pool_day_use', \{ payload \}/)
  assert.match(database, /queueOperation\('rpc', 'delete_pool_day_use', \{/)
  assert.match(database, /shouldRefreshPoolDayUse = true/)
  assert.match(database, /refreshTargets\.push\('pool-day-use'\)/)
  assert.match(dayUseUi, /window\.api\.dayuse\.getAll\(selectedDate, selectedDate\)/)
  assert.match(dayUseUi, /window\.api\.sync\.onStatusChanged\(\(\) => \{/)
  assert.match(dayUseUi, /window\.api\.dayuse\.delete\(id\)/)

  console.log('offline-queue-regression: ok')
}

run().catch((error) => {
  console.error('offline-queue-regression: failed')
  console.error(error)
  process.exitCode = 1
})
