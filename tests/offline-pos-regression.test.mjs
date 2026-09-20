import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { state } from '../src/main/state.js'
import { readCache, writeCache } from '../src/main/domains/cacheStore.js'
import { readSyncQueue, writeSyncQueue } from '../src/main/domains/syncStore.js'
import {
  applyQueuedPosInventoryReservations,
  buildInventoryNameIndex,
  buildPosMenuIndex,
  collectQueuedBarStockDeltas,
  refreshOfflinePosInventoryProjection,
  resolveQueuedPosInventoryLinkIndexed
} from '../src/main/domains/posOffline.js'

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
  const database = [
    await read('src/main/database.js'),
    ...(await readTree('src/main/domains'))
  ].join('\n')
  const layout = await read('src/renderer/src/components/Layout.jsx')
  const migration = await read('supabase/migrations/20260507_pos_offline_inventory_payload.sql')
  const launchReadinessSql = await read('supabase/migrations/20260604120000_pos_inventory_launch_readiness.sql')
  const packageJson = await read('package.json')

  assert.match(packageJson, /"test:offline-pos-critical":\s*"node \.\\\\tests\\\\offline-pos-regression\.test\.mjs"/)

  // Critical desktop invariants: offline POS must reserve stock locally and preserve
  // pending sync state across reconnect/live refresh.
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
  assert.match(database, /const filteredLiveRows = applyPosOrderFilters\(mergedLiveRows, startDate, endDate, outletFilter\)[\s\S]*return withPosReadMetadata\(\s*filteredLiveRows,\s*'server',\s*!hasUnresolvedPosRows\(filteredLiveRows\)/)

  // Replay payload carries selections only; catalog snapshot resolves price and stock links.
  assert.match(database, /modifier_option_ids: Array\.isArray\(item\.modifier_option_ids\)/)
  assert.match(database, /modifier_option_ids: Array\.isArray\(i\.modifier_option_ids\)/)
  assert.match(database, /catalog_snapshot_id: offlineCatalogSnapshotId/)
  assert.match(database, /source_device_id: getDesktopPosDeviceId\(\)/)
  assert.match(database, /event_booking_id: eventBookingId \|\| null/)
  assert.match(database, /queueItemNeedsInventoryRefresh\(item\)[\s\S]*resolveQueuedPosInventoryLink/)

  // The reconnect crash fix must stay imported in the sync badge.
  assert.match(layout, /Clock,/)
  assert.match(layout, /AlertCircle/)
  assert.match(layout, /pendingCount > 0 \|\| failedCount > 0/)
  assert.match(layout, /\{failedCount \|\| pendingCount\}/)

  // Server replay contract: create_pos_order must accept explicit inventory links
  // and still deduct stock for offline/inventory-backed items.
  assert.match(migration, /create or replace function public\.create_pos_order\(payload jsonb\)/)
  assert.match(migration, /nullif\(v_item->>'inventory_item_id', ''\)::uuid/)
  assert.match(migration, /coalesce\(nullif\(v_item->>'depletion_qty', ''\)::numeric, 1\)/)
  assert.match(migration, /name = v_item_name/)
  assert.match(migration, /update public\.inventory_items/)
  assert.match(migration, /set current_stock = coalesce\(current_stock, 0\) - v_required_stock/)
  assert.match(launchReadinessSql, /public\._positive_depletion_qty/)
  assert.match(launchReadinessSql, /inventory_item_id, depletion_qty/)
  assert.match(launchReadinessSql, /v_required_stock <= 0 or coalesce\(current_stock, 0\) >= v_required_stock/)

  // P0-3a delivery-aware projection: a queued offline delivery must survive a
  // projection rebuild (previously only queued sales were subtracted, so
  // 10 -> 30 locally collapsed back to 10 and the Till greyed items out).
  assert.match(database, /function collectQueuedBarStockDeltas\(/)
  assert.match(database, /post_bar_simple_delivery/)
  assert.match(database, /post_bar_physical_count/)
  assert.match(database, /function buildPosMenuIndex\(/)
  assert.match(database, /function buildInventoryNameIndex\(/)
  assert.match(database, /function resolveQueuedPosInventoryLinkIndexed\(/)
  {
    const menuById = buildPosMenuIndex([{ id: 'm1', inventory_item_id: 'i1', depletion_qty: 2 }])
    const nameIndex = buildInventoryNameIndex([{ id: 'i9', name: 'Cola' }])
    assert.equal(resolveQueuedPosInventoryLinkIndexed({ inventory_item_id: 'i1', depletion_qty: 3 }, { menuById, inventoryByName: nameIndex }).inventoryItemId, 'i1')
    assert.equal(resolveQueuedPosInventoryLinkIndexed({ menu_item_id: 'm1' }, { menuById, inventoryByName: nameIndex }).inventoryItemId, 'i1')
    assert.equal(resolveQueuedPosInventoryLinkIndexed({ menu_item_id: 'm1' }, { menuById, inventoryByName: nameIndex }).depletionQty, 2)
    const deltas = collectQueuedBarStockDeltas([
      { type: 'rpc', table: 'post_bar_simple_delivery', data: { p_lines: [{ item_id: 'i1', quantity: 20 }] } },
      { type: 'rpc', table: 'adjust_inventory_stock', data: { p_item_id: 'i1', p_delta: -2 } },
      { type: 'rpc', table: 'post_bar_physical_count', data: { p_lines: [{ item_id: 'i2', actual_qty: 7 }] } }
    ])
    assert.equal(deltas.deliveryDeltas.get('i1'), 20)
    assert.equal(deltas.adjustDeltas.get('i1'), -2)
    assert.equal(deltas.countOverrides.get('i2'), 7)
    assert.ok(deltas.touched.has('i1') && deltas.touched.has('i2'))

    // End-to-end against real cache files: synced 10 + queued delivery 20,
    // minus one queued 2x sale (depletion 1) = 28, not 10.
    const projectionRoot = await mkdtemp(path.join(os.tmpdir(), 'boroko-pos-projection-'))
    const savedCacheDir = state.cacheDir
    try {
      state.cacheDir = projectionRoot
      writeCache('inventory-items', [{ id: 'i1', name: 'Beer', synced_current_stock: 10, current_stock: 10 }])
      writeCache('pos-menu-items', [{ id: 'm1', inventory_item_id: 'i1', depletion_qty: 1 }])
      writeSyncQueue([
        { _queue_id: 'd1', type: 'rpc', table: 'post_bar_simple_delivery', data: { p_lodge_id: 'l1', p_operation_id: 'op1', p_lines: [{ item_id: 'i1', quantity: 20 }] } },
        {
          _queue_id: 's1',
          type: 'rpc',
          table: 'create_pos_order_v3',
          data: { payload: { id: 'o1', lodge_id: 'l1', outlet_id: null, items: [{ menu_item_id: 'm1', quantity: 2 }] } }
        }
      ])
      const projected = applyQueuedPosInventoryReservations(readCache('inventory-items'))
      assert.equal(projected[0].current_stock, 28)
      assert.equal(projected[0].synced_current_stock, 10)
      assert.equal(projected[0]._pending_sync, true)
      // The Till refresh path (local cache -> projection -> write) keeps it.
      writeCache('inventory-items', [{ id: 'i1', name: 'Beer', synced_current_stock: 10, current_stock: 30, _pending_sync: true, _sync_state: 'pending' }])
      const refreshed = refreshOfflinePosInventoryProjection()
      assert.equal(refreshed[0].current_stock, 28)
      void readSyncQueue
    } finally {
      state.cacheDir = savedCacheDir
      await rm(projectionRoot, { recursive: true, force: true })
    }
  }

  console.log('offline-pos-regression: ok')
}

run().catch((error) => {
  console.error('offline-pos-regression: failed')
  console.error(error)
  process.exitCode = 1
})
