import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { state } from '../src/main/state.js'
import { writeSyncQueue } from '../src/main/domains/syncStore.js'

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
  const packageJson = await read('package.json')
  const bookingsUi = await read('src/renderer/src/components/Bookings.jsx')
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
  assert.match(database, /queueOperation\('rpc', 'create_booking', \{/)
  assert.match(database, /_queue_id:\s*`booking-\$\{id\}`/)
  assert.match(database, /function buildLocalPendingInvoiceNumber\(/)
  assert.match(database, /function buildOfflineBookingFinancialState\(/)
  assert.match(database, /function mergeRemoteBookingsWithLocalState\(/)
  assert.match(database, /writeCache\(name, mergeRemoteBookingsWithLocalState\(data \|\| \[\]\), \{ source: 'remote' \}\)/)
  assert.match(database, /const mergedLiveRows = mergeRemoteBookingsWithLocalState\(mapped, localRowsForMerge\)/)
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
  assert.match(database, /refreshTargets\.push\('bookings'\)/)
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
  assert.match(quotationsUi, /window\.api\.quotations\.getAll\(\)/)
  assert.match(quotationsUi, /window\.api\.quotations\.create\(data\)/)
  assert.match(quotationsUi, /window\.api\.quotations\.update\(q\.id, \{ \.\.\.q, status: newStatus \}\)/)
  assert.match(quotationsUi, /Booking queued offline/)

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
  assert.match(database, /queueOperation\('rpc', 'create_pos_order', \{/)
  assert.match(database, /queueOperation\('rpc', 'approve_pos_void_with_pin', \{/)
  assert.match(database, /_queue_id:\s*`pos-order-\$\{id\}`/)
  assert.match(database, /_queue_id:\s*`pos-void-\$\{order_id\}`/)
  assert.match(database, /restoreOfflinePosInventoryReservation\(orderItems/)
  assert.match(database, /upsertLocalPosVoidHistory/)
  assert.match(database, /inventory_item_id:\s*item\.inventory_item_id \|\| null/)
  assert.match(database, /depletion_qty:\s*normalizePositiveQty\(item\.depletion_qty, 1\)/)
  assert.match(database, /inventory_item_id:\s*i\.inventory_item_id \|\| null/)
  assert.match(database, /depletion_qty:\s*normalizePositiveQty\(i\.depletion_qty, 1\)/)
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
  assert.match(database, /refreshTargets\.push\('conference-bookings'\)/)
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
