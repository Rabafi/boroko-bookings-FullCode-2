import fs from 'fs';
import path from 'path';
import { state } from '../../state.js';
import { meshState } from './meshState.js';
import { sendSignedMeshRequest } from './meshClient.js';
import { readSyncQueue, writeSyncQueue } from '../syncStore.js';
import { detectConflicts } from './meshConflict.js';
import { computeBodyHash } from './meshSecurity.js';
import { readCache, writeCache } from '../cacheStore.js';
import { broadcastSyncStatus } from '../connectivity.js';

const ALLOWED_RPC_TABLES = new Set([
  'create_booking',
  'create_booking_record',
  'update_booking',
  'update_booking_status',
  'update_booking_payment',
  'create_customer',
  'update_customer',
  'update_customer_blacklist',
  'update_customer_id_photo',
  'create_room',
  'update_room',
  'update_room_housekeeping',
  'delete_room',
  'create_quotation',
  'update_quotation',
  'mark_quotation_sent',
  'convert_quotation_to_booking',
  'create_conference_booking',
  'update_conference_booking',
  'update_conference_booking_payment',
  'delete_conference_booking',
  'add_pool_day_use',
  'delete_pool_day_use',
  'adjust_inventory_stock',
  'create_pos_order',
  'approve_pos_void_with_pin',
  'upsert_pos_cashup'
]);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value) {
  return hasString(value) && !Number.isNaN(Date.parse(value));
}

function hasValidDateRange(checkIn, checkOut) {
  return isValidDate(checkIn) && isValidDate(checkOut) && Date.parse(checkOut) > Date.parse(checkIn);
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function getPosInventoryUsage(items = []) {
  const usage = new Map();
  for (const entry of items || []) {
    const inventoryItemId = String(entry?.inventory_item_id || '').trim();
    if (!inventoryItemId) continue;
    const quantity = Number(entry.quantity || 0);
    const depletionQty = normalizePositiveQty(entry.depletion_qty, 1);
    if (quantity === 0) continue;
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * depletionQty);
  }
  return usage;
}

export function applyImportedPosInventoryEffects(items = []) {
  if (!items.length) return;
  const inventory = readCache('inventory-items');
  if (!Array.isArray(inventory) || inventory.length === 0) return;

  let changed = false;
  let nextInventory = inventory;

  for (const item of items) {
    if (item.table !== 'create_pos_order' && item.table !== 'approve_pos_void_with_pin') continue;
    const payload = item.data?.payload || {};
    const usage = getPosInventoryUsage(payload.items || []);
    if (usage.size === 0) continue;

    const multiplier = item.table === 'approve_pos_void_with_pin' ? 1 : -1;
    nextInventory = nextInventory.map((row) => {
      const delta = usage.get(row?.id) || 0;
      if (!delta) return row;
      changed = true;
      return {
        ...row,
        current_stock: Math.max(0, Number(row.current_stock || 0) + (delta * multiplier)),
        _pending_sync: true,
        _sync_state: 'pending',
        _mesh_inventory_adjusted_at: new Date().toISOString()
      };
    });
  }

  if (changed) {
    writeCache('inventory-items', nextInventory);
  }
}

function stripMeshMetadata(item = {}) {
  const {
    _mesh_imported,
    _mesh_source_node_id,
    _mesh_imported_at,
    _mesh_body_hash,
    ...rest
  } = item || {};
  return rest;
}

export function getQueueItemBodyHash(item = {}) {
  return item?._mesh_body_hash || computeBodyHash(stripMeshMetadata(item));
}

function getQueueItemIntentId(item = {}) {
  return String(
    item.intentId ||
    item.data?.p_idempotency_key ||
    item.data?.payload?.create_idempotency_key ||
    item.data?.payload?.idempotency_key ||
    ''
  ).trim();
}

/**
 * Validates a incoming P2P sync queue operation item against structural and safety schemas.
 */
export function validateSyncQueueItem(item) {
  if (!item || typeof item !== 'object') {
    return { isValid: false, reason: 'Payload is not an object' };
  }
  if (typeof item._queue_id !== 'string' || !item._queue_id.trim()) {
    return { isValid: false, reason: 'Missing _queue_id' };
  }
  if (typeof item.table !== 'string' || !item.table.trim()) {
    return { isValid: false, reason: 'Missing table entity field' };
  }
  if (item.type !== 'rpc') {
    return { isValid: false, reason: 'Only rpc queue items are allowed over mesh' };
  }
  if (!isPlainObject(item.data)) {
    return { isValid: false, reason: 'Missing queue item data object' };
  }

  // Safety limits on payload size
  const bodyStr = JSON.stringify(item);
  if (bodyStr.length > 102400) { // 100 KB limit
    return { isValid: false, reason: `Payload size exceeds limit (${bodyStr.length} bytes)` };
  }

  if (!ALLOWED_RPC_TABLES.has(item.table.trim())) {
    return { isValid: false, reason: `Table ${item.table} is not allowlisted` };
  }

  if (item.data?.p_lodge_id && item.data.p_lodge_id !== meshState.lodgeId) {
    return { isValid: false, reason: 'Queue item lodge mismatch' };
  }
  if (item.data?.payload?.lodge_id && item.data.payload.lodge_id !== meshState.lodgeId) {
    return { isValid: false, reason: 'Queue item payload lodge mismatch' };
  }

  if (item.table === 'create_booking') {
    const data = item.data;
    const required = ['p_lodge_id', 'p_customer_id', 'p_room_id', 'p_check_in', 'p_check_out', 'p_booking_id', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_booking missing ${missing.join(', ')}` };
    if (!hasValidDateRange(data.p_check_in, data.p_check_out)) return { isValid: false, reason: 'create_booking has invalid date range' };
  }

  if (item.table === 'create_booking_record') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'create_booking_record missing payload object' };
    const required = ['id', 'lodge_id', 'room_id', 'check_in', 'check_out'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_booking_record missing ${missing.join(', ')}` };
    if (!hasValidDateRange(payload.check_in, payload.check_out)) return { isValid: false, reason: 'create_booking_record has invalid date range' };
  }

  if (item.table === 'update_booking') {
    const payload = item.data.payload;
    if (!hasString(item.data.p_id)) return { isValid: false, reason: 'update_booking missing p_id' };
    if (!isPlainObject(payload)) return { isValid: false, reason: 'update_booking missing payload object' };
    if ((payload.check_in || payload.check_out) && !hasValidDateRange(payload.check_in, payload.check_out)) {
      return { isValid: false, reason: 'update_booking has invalid date range' };
    }
  }

  if (item.table === 'update_booking_status' && !hasString(item.data.p_id)) {
    return { isValid: false, reason: 'update_booking_status missing p_id' };
  }

  if (item.table === 'create_room') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'create_room missing payload object' };
    if (!hasString(payload.id) || !hasString(payload.lodge_id) || !hasString(payload.room_number)) {
      return { isValid: false, reason: 'create_room missing required room fields' };
    }
  }

  if (item.table === 'create_pos_order') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'create_pos_order missing payload object' };
    const required = ['id', 'lodge_id', 'create_idempotency_key'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_pos_order missing ${missing.join(', ')}` };
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return { isValid: false, reason: 'create_pos_order missing line items' };
    }
    for (const line of payload.items) {
      if (!isPlainObject(line)) return { isValid: false, reason: 'create_pos_order line item is invalid' };
      if (!hasString(line.item_name) && !hasString(line.menu_item_id) && !hasString(line.inventory_item_id)) {
        return { isValid: false, reason: 'create_pos_order line item missing identity' };
      }
      if (!isFiniteNumber(line.quantity) || Number(line.quantity) === 0) {
        return { isValid: false, reason: 'create_pos_order line item has invalid quantity' };
      }
      if (!isFiniteNumber(line.unit_price)) {
        return { isValid: false, reason: 'create_pos_order line item has invalid unit price' };
      }
      if (line.inventory_item_id && (!isFiniteNumber(line.depletion_qty) || Number(line.depletion_qty) <= 0)) {
        return { isValid: false, reason: 'create_pos_order line item has invalid depletion quantity' };
      }
    }
  }

  if (item.table === 'approve_pos_void_with_pin') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'approve_pos_void_with_pin missing payload object' };
    if (!hasString(payload.order_id) || !hasString(payload.lodge_id) || !hasString(payload.override_log_id)) {
      return { isValid: false, reason: 'approve_pos_void_with_pin missing required void fields' };
    }
    if (payload.items && !Array.isArray(payload.items)) {
      return { isValid: false, reason: 'approve_pos_void_with_pin items must be an array' };
    }
  }

  if (item.table === 'adjust_inventory_stock') {
    const data = item.data;
    if (!hasString(data.p_item_id) || !hasString(data.p_lodge_id)) {
      return { isValid: false, reason: 'adjust_inventory_stock missing item or lodge' };
    }
    if (!isFiniteNumber(data.p_delta) || Number(data.p_delta) === 0) {
      return { isValid: false, reason: 'adjust_inventory_stock has invalid adjustment quantity' };
    }
    const queuedAdjustmentId = String(item._queue_id || '').startsWith('inventory-adjust-')
      ? String(item._queue_id).slice('inventory-adjust-'.length)
      : '';
    if (!hasString(data.p_adjustment_id) && !hasString(queuedAdjustmentId)) {
      return { isValid: false, reason: 'adjust_inventory_stock missing adjustment id' };
    }
  }

  if (item.table === 'upsert_pos_cashup') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'upsert_pos_cashup missing payload object' };
    if (!hasString(payload.id) || !hasString(payload.lodge_id) || !hasString(payload.date)) {
      return { isValid: false, reason: 'upsert_pos_cashup missing required cash-up fields' };
    }
  }

  return { isValid: true };
}

/**
 * Quarantines any invalid/corrupted JSON payloads obtained from the mesh network.
 */
export function quarantineInvalidItem(item, reason) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, 'sync-mesh-quarantine.json');
  let quarantineList = [];
  try {
    if (fs.existsSync(filePath)) {
      quarantineList = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('[MeshMerge] Error reading quarantine file:', err);
  }

  quarantineList.push({
    quarantinedAt: new Date().toISOString(),
    reason,
    item
  });

  try {
    fs.writeFileSync(filePath, JSON.stringify(quarantineList, null, 2), 'utf-8');
    console.warn(`[MeshMerge] Quarantined invalid sync item from mesh. Reason: ${reason}`);
  } catch (err) {
    console.error('[MeshMerge] Failed to write quarantine file:', err);
  }
}

/**
 * Conducts a full P2P sync queue reconciliation with all discovered local peers.
 */
export async function syncMeshQueues() {
  if (!meshState.running || meshState.peers.size === 0) {
    return;
  }

  console.log(`[MeshMerge] Starting P2P queue sync with ${meshState.peers.size} active peers...`);
  let hasMergedNewItems = false;

  for (const [peerId, peer] of meshState.peers.entries()) {
    try {
      // 1. Fetch remote queue summary
      const remoteSummary = await sendSignedMeshRequest(peer.address, peer.httpPort, 'GET', '/mesh/queue/summary');
      if (!Array.isArray(remoteSummary)) {
        console.warn(`[MeshMerge] Peer ${peerId} returned malformed queue summary.`);
        continue;
      }

      // 2. Identify missing local queue operations by queue id, intent id, or body hash.
      const localQueue = readSyncQueue();
      const localIds = new Set(localQueue.map((item) => item._queue_id));
      const localIntentIds = new Set(localQueue.map(getQueueItemIntentId).filter(Boolean));
      const localHashes = new Set(localQueue.map(getQueueItemBodyHash).filter(Boolean));
      const missingSummaries = remoteSummary.filter((item) => {
        const queueId = String(item?._queue_id || '').trim();
        if (!queueId || localIds.has(queueId)) return false;
        const intentId = String(item?.intentId || '').trim();
        if (intentId && localIntentIds.has(intentId)) return false;
        const bodyHash = String(item?.bodyHash || '').trim();
        if (bodyHash && localHashes.has(bodyHash)) return false;
        return true;
      });
      const missingIds = missingSummaries.map((item) => item._queue_id);
      const expectedHashesById = new Map(
        missingSummaries.map((item) => [item._queue_id, String(item.bodyHash || '').trim()]).filter(([, hash]) => hash)
      );

      if (missingIds.length === 0) {
        console.log(`[MeshMerge] Local queue is fully up-to-date with Peer ${peerId}.`);
        continue;
      }

      console.log(`[MeshMerge] Found ${missingIds.length} missing items on Peer ${peerId}. Fetching full payloads...`);

      // Batch missing items request (ids are comma-separated)
      // Since HTTP GET might hit header constraints, we can batch them in groups of 30 if needed
      const batchSize = 30;
      const newValidItems = [];

      for (let i = 0; i < missingIds.length; i += batchSize) {
        const batchIds = missingIds.slice(i, i + batchSize);
        const remoteItems = await sendSignedMeshRequest(
          peer.address,
          peer.httpPort,
          'GET',
          '/mesh/queue/items',
          { ids: batchIds.join(',') }
        );

        if (!Array.isArray(remoteItems)) {
          console.warn(`[MeshMerge] Peer ${peerId} returned invalid items list for batch request.`);
          continue;
        }

        // Validate and stamp incoming items
        for (const item of remoteItems) {
          const validation = validateSyncQueueItem(item);
          if (!validation.isValid) {
            quarantineInvalidItem(item, validation.reason);
            continue;
          }

          const bodyHash = getQueueItemBodyHash(item);
          const expectedHash = expectedHashesById.get(item._queue_id);
          if (expectedHash && expectedHash !== bodyHash) {
            quarantineInvalidItem(item, 'Fetched item body hash did not match queue summary');
            continue;
          }

          newValidItems.push({
            ...item,
            _mesh_imported: true,
            _mesh_source_node_id: peer.nodeId,
            _mesh_imported_at: new Date().toISOString(),
            _mesh_body_hash: bodyHash
          });
        }
      }

      if (newValidItems.length > 0) {
        // Reload local queue to append atomically
        const latestLocalQueue = readSyncQueue();
        // Avoid duplicate appends just in case of parallel loops.
        const currentIds = new Set(latestLocalQueue.map((item) => item._queue_id));
        const currentIntentIds = new Set(latestLocalQueue.map(getQueueItemIntentId).filter(Boolean));
        const currentHashes = new Set(latestLocalQueue.map(getQueueItemBodyHash).filter(Boolean));
        const deduplicatedNewItems = newValidItems.filter((item) => {
          if (currentIds.has(item._queue_id)) return false;
          const intentId = getQueueItemIntentId(item);
          if (intentId && currentIntentIds.has(intentId)) return false;
          const bodyHash = getQueueItemBodyHash(item);
          if (bodyHash && currentHashes.has(bodyHash)) return false;
          currentIds.add(item._queue_id);
          if (intentId) currentIntentIds.add(intentId);
          if (bodyHash) currentHashes.add(bodyHash);
          return true;
        });

        if (deduplicatedNewItems.length > 0) {
          const mergedQueue = [...latestLocalQueue, ...deduplicatedNewItems];
          writeSyncQueue(mergedQueue);
          applyImportedPosInventoryEffects(deduplicatedNewItems);
          meshState.lastQueueMergeAt = new Date();
          hasMergedNewItems = true;
          console.log(`[MeshMerge] Successfully imported ${deduplicatedNewItems.length} operations from Peer ${peerId}.`);
        }
      }

    } catch (err) {
      console.warn(`[MeshMerge] Queue sync iteration failed for Peer ${peerId}:`, err.message);
    }
  }

  // 3. Trigger conflict detection and notify UI if any new operations were merged
  if (hasMergedNewItems) {
    try {
      await detectConflicts();
    } catch (conflictErr) {
      console.error('[MeshMerge] Error triggering conflict detection post-merge:', conflictErr);
    }
    // Update local UI immediately
    broadcastSyncStatus();
  }
}
