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
  'update_pool_day_use',
  'create_inventory_item',
  'adjust_inventory_stock',
  'create_pos_order',
  'create_pos_order_v3',
  'create_pos_return_v3',
  'approve_pos_void_with_pin',
  'upsert_pos_cashup',
  'finalize_pos_shift_cashup_v2',
  'upsert_pos_tab',
  'update_pos_tab_status',
  'upsert_pos_table',
  'open_pos_shift_with_id',
  'close_pos_shift_with_id',
  'create_pos_menu_item',
  'update_pos_menu_item',
  'delete_pos_menu_item',
  'set_bar_pos_pack_template',
  'update_pos_prep_ticket_status',
  'upsert_pos_modifier_groups',
  'upsert_pos_promotions',
  'upsert_pos_floor_layout',
  'create_maintenance_ticket'
]);

const ORIGIN_DEVICE_ONLY_RPC_TABLES = new Set([
  'approve_pos_void_with_pin',
  'create_pos_return_v3'
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
    const menuItem = entry?.menu_item_id
      ? readCache('pos-menu-items').find((row) => row?.id === entry.menu_item_id)
      : null;
    const inventoryItemId = String(entry?.inventory_item_id || menuItem?.inventory_item_id || '').trim();
    if (!inventoryItemId) continue;
    const quantity = Number(entry.quantity || 0);
    const depletionQty = normalizePositiveQty(entry.depletion_qty ?? menuItem?.depletion_qty, 1);
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
    if (!['create_pos_order', 'create_pos_order_v3'].includes(item.table)) continue;
    const payload = item.data?.payload || {};
    const usage = getPosInventoryUsage(payload.items || []);
    if (usage.size === 0) continue;

    nextInventory = nextInventory.map((row) => {
      const delta = usage.get(row?.id) || 0;
      if (!delta) return row;
      changed = true;
      return {
        ...row,
        current_stock: Math.max(0, Number(row.current_stock || 0) - delta),
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

function containsMachineBoundSecret(value) {
  if (Array.isArray(value)) return value.some(containsMachineBoundSecret);
  if (!value || typeof value !== 'object') return false;
  if (value._secure_queue_secret === true) return true;
  return Object.values(value).some(containsMachineBoundSecret);
}

export function isMeshShareableQueueItem(item = {}) {
  if (!item || item.type !== 'rpc') return false;
  if (!ALLOWED_RPC_TABLES.has(String(item.table || '').trim())) return false;
  if (ORIGIN_DEVICE_ONLY_RPC_TABLES.has(item.table)) return false;
  return !containsMachineBoundSecret(item.data);
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
    item.data?.payload?.return_idempotency_key ||
    item.data?.payload?.cashup_id ||
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
      if (!isFiniteNumber(line.quantity) || Number(line.quantity) <= 0) {
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

  if (item.table === 'create_pos_order_v3') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'create_pos_order_v3 missing payload object' };
    const required = ['id', 'lodge_id', 'catalog_snapshot_id', 'shift_id', 'source_device_id', 'create_idempotency_key'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_pos_order_v3 missing ${missing.join(', ')}` };
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return { isValid: false, reason: 'create_pos_order_v3 missing line items' };
    }
    for (const line of payload.items) {
      if (!isPlainObject(line) || !hasString(line.menu_item_id)) {
        return { isValid: false, reason: 'create_pos_order_v3 line item missing menu identity' };
      }
      if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0) {
        return { isValid: false, reason: 'create_pos_order_v3 line item has invalid quantity' };
      }
      if (line.modifier_option_ids != null && !Array.isArray(line.modifier_option_ids)) {
        return { isValid: false, reason: 'create_pos_order_v3 modifier selections must be an array' };
      }
    }
  }

  if (item.table === 'upsert_pos_cashup') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'upsert_pos_cashup missing payload object' };
    if (!hasString(payload.id) || !hasString(payload.lodge_id) || !hasString(payload.date)) {
      return { isValid: false, reason: 'upsert_pos_cashup missing required cash-up fields' };
    }
  }

  if (item.table === 'finalize_pos_shift_cashup_v2') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'finalize_pos_shift_cashup_v2 missing payload object' };
    const required = ['cashup_id', 'lodge_id', 'shift_id'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `finalize_pos_shift_cashup_v2 missing ${missing.join(', ')}` };
    if (!isPlainObject(payload.counted_by_method)) {
      return { isValid: false, reason: 'finalize_pos_shift_cashup_v2 missing counted tender totals' };
    }
  }

  if (item.table === 'create_inventory_item') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id) || !hasString(payload.name)) {
      return { isValid: false, reason: 'create_inventory_item missing required item fields' };
    }
  }

  if (item.table === 'create_maintenance_ticket') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id)) {
      return { isValid: false, reason: 'create_maintenance_ticket missing required ticket fields' };
    }
  }

  if (['upsert_pos_tab', 'upsert_pos_table'].includes(item.table)) {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id)) {
      return { isValid: false, reason: `${item.table} missing required payload fields` };
    }
  }

  if (item.table === 'update_pos_tab_status') {
    if (!hasString(item.data.p_tab_id) || !hasString(item.data.p_status)) {
      return { isValid: false, reason: 'update_pos_tab_status missing tab or status' };
    }
  }

  if (['open_pos_shift_with_id', 'close_pos_shift_with_id'].includes(item.table)) {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id)) {
      return { isValid: false, reason: `${item.table} missing required shift fields` };
    }
  }

  if (['create_pos_menu_item', 'set_bar_pos_pack_template', 'upsert_pos_modifier_groups', 'upsert_pos_promotions', 'upsert_pos_floor_layout'].includes(item.table)) {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id)) {
      return { isValid: false, reason: `${item.table} missing lodge-scoped payload` };
    }
  }

  if (['update_pos_menu_item', 'delete_pos_menu_item'].includes(item.table)) {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: `${item.table} missing item or lodge` };
    }
  }

  if (item.table === 'update_pos_prep_ticket_status' && !hasString(item.data.p_ticket_id)) {
    return { isValid: false, reason: 'update_pos_prep_ticket_status missing ticket id' };
  }

  if (item.table === 'update_pool_day_use') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id) || !hasString(payload.idempotency_key)) {
      return { isValid: false, reason: 'update_pool_day_use missing required operation fields' };
    }
  }

  return { isValid: true };
}

function applyImportedBookingCacheEffects(items = []) {
  const imported = [];
  for (const item of items) {
    if (item.table === 'create_booking') {
      const data = item.data || {};
      imported.push({
        id: data.p_booking_id,
        lodge_id: data.p_lodge_id,
        customer_id: data.p_customer_id,
        room_id: data.p_room_id,
        check_in: data.p_check_in,
        check_out: data.p_check_out,
        adults: data.p_adults,
        children: data.p_children || 0,
        total_amount: Number(data.p_total_amount || 0),
        amount_paid: Number(data.p_deposit_amount || 0),
        notes: data.p_notes || '',
        status: 'pending',
        payment_status: Number(data.p_deposit_amount || 0) > 0 ? 'partial' : 'unpaid',
        created_at: item.timestamp || item.created_at || new Date().toISOString(),
        _pending_sync: true,
        _sync_state: 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: item._mesh_source_node_id
      });
    } else if (item.table === 'create_booking_record') {
      const payload = item.data?.payload || {};
      imported.push({
        ...payload,
        status: payload.status || 'pending',
        created_at: payload.created_at || item.timestamp || new Date().toISOString(),
        _pending_sync: true,
        _sync_state: 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: item._mesh_source_node_id
      });
    }
  }
  if (imported.length === 0) return;
  const existing = readCache('bookings');
  const importedIds = new Set(imported.map((row) => row.id).filter(Boolean));
  writeCache('bookings', [
    ...existing.filter((row) => !importedIds.has(row?.id)),
    ...imported
  ]);
}

function applyImportedOperationalCacheEffects(items = []) {
  for (const item of items) {
    if (item.table !== 'update_pool_day_use') continue;
    const payload = item.data?.payload || {};
    const rows = readCache('pool-day-use');
    const index = rows.findIndex((row) => row?.id === payload.id);
    if (index < 0) continue;
    const current = rows[index];
    const next = [...rows];
    next[index] = {
      ...current,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.payment_method ? { payment_method: payload.payment_method } : {}),
      ...(payload.settle_balance ? {
        deposit_amount: Number(current.total || 0),
        balance_due: 0
      } : {}),
      _pending_sync: true,
      _sync_state: 'pending',
      _mesh_imported: true,
      _mesh_source_node_id: item._mesh_source_node_id
    };
    writeCache('pool-day-use', next);
  }
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
          applyImportedBookingCacheEffects(deduplicatedNewItems);
          applyImportedOperationalCacheEffects(deduplicatedNewItems);
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
