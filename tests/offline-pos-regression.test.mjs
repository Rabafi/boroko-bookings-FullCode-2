import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

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
  assert.match(database, /return applyPosOrderFilters\(mergedLiveRows, startDate, endDate, outletFilter\)/)

  // Replay payload carries selections only; catalog snapshot resolves price and stock links.
  assert.match(database, /modifier_option_ids: Array\.isArray\(item\.modifier_option_ids\)/)
  assert.match(database, /modifier_option_ids: Array\.isArray\(i\.modifier_option_ids\)/)
  assert.match(database, /catalog_snapshot_id: offlineCatalogSnapshotId/)
  assert.match(database, /source_device_id: getDesktopPosDeviceId\(\)/)
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

  console.log('offline-pos-regression: ok')
}

run().catch((error) => {
  console.error('offline-pos-regression: failed')
  console.error(error)
  process.exitCode = 1
})
