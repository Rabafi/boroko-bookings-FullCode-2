// @ts-check
import fs from 'fs';
import path from 'path';
import { state } from '../../state.js';
import { meshState } from './meshState.js';
import { sendSignedMeshRequest } from './meshClient.js';
import { appendHealthFault, appendOperationJournalEntry, readSyncQueue, writeSyncQueue } from '../syncStore.js';
import { detectConflicts } from './meshConflict.js';
import { computeBodyHash } from './meshSecurity.js';
import { readCache, writeCache } from '../cacheStore.js';
import { broadcastSyncStatus } from '../connectivity.js';

/** @typedef {{at: string, peerCount: number, perPeer: Array<Record<string, unknown>>}} MeshTeamSyncExpectedView */
/** @type {typeof meshState & {lastTeamSync?: MeshTeamSyncExpectedView | null}} */
const meshStateWithTeamSync = meshState;
/** @typedef {{message?: unknown}} MeshErrorExpectedDataView */

/** @typedef {Record<string, unknown> & {payload?: unknown}} MeshQueueDataExpectedView */
/** A menu item queue payload mirrors the current pos.js writer; fields remain unvalidated after mesh receipt. */
/** @typedef {Record<string, unknown> & {id?: unknown, name?: unknown, menu_item_id?: unknown}} MeshMenuItemPayloadExpectedView */
/** Modifier and promotion arrays mirror the respective pos.js full-list queue writers; this view does not validate elements. */
/** @typedef {Record<string, unknown> & {groups?: Record<string, unknown>[], promotions?: Record<string, unknown>[]}} MeshModifierPromotionPayloadExpectedView */
/** Cache rows mirror the local checklist writer; persisted cache values remain unvalidated. */
/** @typedef {Record<string, unknown> & {id?: unknown, items?: unknown}} MeshChecklistCacheExpectedView */
/** @typedef {Record<string, unknown> & {id?: unknown, notes?: unknown}} MeshChecklistLineExpectedView */
/** Pool-day-use cache values are expected rows from the existing list/write paths; persisted JSON is not validated. */
/** @typedef {Record<string, unknown> & {id?: unknown, total?: unknown}} MeshPoolDayUseCacheExpectedView */
/**
 * @typedef {Record<string, unknown> & {
 *   type: 'rpc',
 *   table: string,
 *   data: MeshQueueDataExpectedView,
 *   _queue_id: string,
 *   _mesh_source_node_id?: unknown,
 *   timestamp?: unknown,
 *   created_at?: unknown,
 *   _local_booking_ids?: unknown,
 *   _origin_lodge_id?: unknown
 * }} MeshQueueItemExpectedView
 * These effect helpers receive queue rows only after validateSyncQueueItem has
 * established the RPC envelope and plain-object data. The view does not claim
 * validation of individual fields or payload contents.
 */

const ALLOWED_RPC_TABLES = new Set([
  'create_booking',
  'create_campsite_booking',
  'create_multi_room_booking',
  'create_booking_invoice_group',
  'create_booking_record',
  'reschedule_booking',
  'update_booking',
  'update_booking_status',
  'update_booking_payment',
  'add_booking_charge',
  'delete_booking_charge',
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
  'create_room_rate_override',
  'update_room_rate_override',
  'delete_room_rate_override',
  'record_customer_credit',
  'apply_customer_credit_to_booking',
  'refund_customer_credit',
  'reverse_customer_credit_entry',
  'create_conference_booking',
  'update_conference_booking',
  'update_conference_booking_payment',
  'delete_conference_booking',
  'create_event_booking',
  'update_event_booking',
  'update_event_payment',
  'cancel_event_booking',
  'add_event_line_item',
  'void_event_line_item',
  'add_pool_day_use',
  'delete_pool_day_use',
  'update_pool_day_use',
  'create_inventory_item',
  'update_inventory_item',
  'delete_inventory_item',
  'add_inventory_purchase',
  'adjust_inventory_stock',
  'create_inventory_stocktake_session',
  'save_inventory_stocktake_counts',
  'post_inventory_stocktake_session',
  'post_bar_physical_count',
  'post_bar_simple_delivery',
  'create_expense',
  'update_expense',
  'delete_expense',
  'create_supply_item',
  'update_supply_item',
  'delete_supply_item',
  'add_supply_purchase',
  'adjust_supply_stock',
  'save_room_supply_allocations',
  'load_supply_to_room',
  'use_room_supply_stock',
  'return_room_supply_to_store',
  'create_supply_stocktake_session',
  'create_room_supply_stocktake_session',
  'save_supply_stocktake_counts',
  'save_room_supply_stocktake_counts',
  'post_supply_stocktake_session',
  'post_room_supply_stocktake_session',
  'create_room_supply_stocktake_line',
  'create_pos_order',
  'create_pos_order_v3',
  'create_pos_return_v3',
  'approve_pos_void_with_pin',
  'upsert_pos_cashup',
  'finalize_pos_shift_cashup_v2',
  'upsert_pos_tab',
  'update_pos_tab_status',
  'transfer_pos_tab_waiter',
  'upsert_pos_table',
  'open_pos_shift_with_id',
  'close_pos_shift_with_id',
  'create_pos_menu_item',
  'create_pos_menu_item_offline',
  'update_pos_menu_item',
  'update_pos_menu_item_offline',
  'delete_pos_menu_item',
  'set_bar_pos_pack_template',
  'update_pos_prep_ticket_status',
  'upsert_pos_modifier_groups',
  'upsert_pos_promotions',
  'upsert_pos_floor_layout',
  'create_maintenance_ticket',
  'update_maintenance_ticket',
  'resolve_maintenance_ticket',
  // Second wave (bar multi-till): every payload below was verified PIN-free.
  // Anything carrying a staff, operator, or manager PIN stays off the mesh
  // permanently: clock in/out, cash movements/counts/submits, cash-up and
  // drawer reviews, and till-operator activation all carry raw PINs.
  'open_pos_drawer_period',
  'set_bar_pos_pack_template_offline',
  'save_bar_pos_product_with_packs_offline',
  'create_daily_checklist',
  'create_bar_checklist_from_template',
  'complete_checklist_item',
  // Third wave (remote-Bar contract coverage): operations the desktop already
  // queued for server replay but that were silently excluded from the mesh
  // contract, so a peer could never take them over. Every payload below was
  // verified PIN-free and mirrors its online RPC call.
  'reschedule_accommodation_booking',
  'move_booking_room',
  'create_corporate_account',
  'update_corporate_account',
  'delete_corporate_account',
  'create_floor_section',
  'update_floor_section',
  'delete_floor_section',
  'create_fnb_room_service_order',
  'create_fnb_meal_entitlement',
  'redeem_fnb_meal',
  'create_fnb_temperature_log',
  'capture_fnb_supplier_invoice',
  'set_rate_calendar_entry',
  'set_rate_calendar_bulk',
  'set_rate_restriction',
  'create_promo_code',
  'update_promo_code',
  'delete_promo_code',
  'create_season_label',
  'update_season_label',
  'delete_season_label',
  'create_yield_rule',
  'update_yield_rule',
  'delete_yield_rule',
  'create_rate_plan',
  'update_rate_plan',
  'delete_rate_plan',
  'create_room_type',
  'update_room_type',
  'delete_room_type',
  'publish_pos_catalog_snapshot_offline',
  'save_bar_product_with_stock'
]);

const ORIGIN_DEVICE_ONLY_RPC_TABLES = new Set([
  'approve_pos_void_with_pin',
  'create_pos_return_v3',
  // Cash, drawer, attendance, and till-operator operations carry raw PINs or
  // custody authority bound to the physical device that collected them. They
  // must replay only on that device; mesh failover would replay custody
  // events on a till that never held the drawer.
  'submit_pos_shift_cashup',
  'submit_pos_shift_cashup_with_attendance_pin',
  'record_pos_cash_movement',
  'record_pos_cash_count',
  'submit_pos_drawer_period_cashup',
  'review_pos_drawer_period_cashup',
  'review_pos_cashup_submission_offline',
  'clock_in_staff_offline',
  'clock_in_staff_with_attendance_pin_offline',
  'clock_in_self_for_pos_offline',
  'clock_out_staff_offline',
  'clock_out_staff_with_attendance_pin',
  'activate_shared_till_operator_offline',
  'link_my_pos_shift_to_attendance'
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {unknown} value @returns {value is string} */
function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** @param {unknown} value */
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

/** @param {unknown} value @returns {value is string} */
function isValidDate(value) {
  return hasString(value) && !Number.isNaN(Date.parse(value));
}

/** @param {unknown} checkIn @param {unknown} checkOut */
function hasValidDateRange(checkIn, checkOut) {
  return isValidDate(checkIn) && isValidDate(checkOut) && Date.parse(checkOut) > Date.parse(checkIn);
}

/** @param {unknown} startDate @param {unknown} endDate */
function hasValidInclusiveDateRange(startDate, endDate) {
  return isValidDate(startDate) && isValidDate(endDate) && Date.parse(endDate) >= Date.parse(startDate);
}

/** @param {unknown} value */
function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

/** @param {unknown} value @param {number} [fallback] */
function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/** @param {unknown} [items] */
function getPosInventoryUsage(items = []) {
  const usage = new Map();
  for (const entry of /** @type {Iterable<unknown>} */ (items || [])) {
    const entryFields = /** @type {Record<string, unknown>} */ (entry);
    const menuItem = entryFields?.menu_item_id
      ? /** @type {{ find(predicate: (row: unknown) => boolean): unknown }} */ (readCache('pos-menu-items'))
        .find((row) => /** @type {Record<string, unknown> | null | undefined} */ (row)?.id === entryFields.menu_item_id)
      : null;
    const menuItemFields = /** @type {Record<string, unknown> | null | undefined} */ (menuItem);
    const inventoryItemId = String(entryFields?.inventory_item_id || menuItemFields?.inventory_item_id || '').trim();
    if (!inventoryItemId) continue;
    const quantity = Number(entryFields.quantity || 0);
    const depletionQty = normalizePositiveQty(entryFields.depletion_qty ?? menuItemFields?.depletion_qty, 1);
    if (quantity === 0) continue;
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * depletionQty);
  }
  return usage;
}

/** @param {unknown} [items] */
export function applyImportedPosInventoryEffects(items = []) {
  const itemInput = /** @type {{ length: unknown }} */ (items);
  if (!itemInput.length) return;
  const inventory = readCache('inventory-items');
  if (!Array.isArray(inventory) || inventory.length === 0) return;

  let changed = false;
  let nextInventory = /** @type {unknown[]} */ (inventory);

  for (const item of /** @type {Iterable<unknown>} */ (items)) {
    const itemFields = /** @type {Record<string, unknown>} */ (item);
    if (!['create_pos_order', 'create_pos_order_v3'].includes(/** @type {string} */ (itemFields.table))) continue;
    const data = /** @type {Record<string, unknown> | null | undefined} */ (itemFields?.data);
    const payload = /** @type {Record<string, unknown>} */ (data?.payload || {});
    const usage = getPosInventoryUsage(payload.items || []);
    if (usage.size === 0) continue;

    nextInventory = nextInventory.map((row) => {
      const rowFields = /** @type {Record<string, unknown>} */ (row);
      const delta = usage.get(rowFields?.id) || 0;
      if (!delta) return row;
      changed = true;
      return {
        .../** @type {Record<string, unknown>} */ (row),
        current_stock: Math.max(0, Number(rowFields.current_stock || 0) - delta),
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

/** @param {unknown} value */
function containsMachineBoundSecret(value) {
  if (Array.isArray(value)) return value.some(containsMachineBoundSecret);
  if (!value || typeof value !== 'object') return false;
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record._secure_queue_secret === true) return true;
  return Object.values(record).some(containsMachineBoundSecret);
}

/** @param {unknown} item */
export function isMeshShareableQueueItem(item = {}) {
  const itemFields = /** @type {Record<string, unknown>} */ (item);
  if (!item || itemFields.type !== 'rpc') return false;
  const table = String(itemFields.table || '').trim();
  if (!ALLOWED_RPC_TABLES.has(table)) return false;
  if (ORIGIN_DEVICE_ONLY_RPC_TABLES.has(table)) return false;
  return !containsMachineBoundSecret(itemFields.data);
}

/** @param {unknown} item */
function stripMeshMetadata(item = {}) {
  const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
  const {
    _mesh_imported,
    _mesh_source_node_id,
    _mesh_imported_at,
    _mesh_body_hash,
    ...rest
  } = itemFields || {};
  return rest;
}

/** @param {unknown} value @returns {string | undefined} */
function stableMeshJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableMeshJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableMeshJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** @param {unknown} [item] */
export function getQueueItemOperationHash(item = {}) {
  const itemFields = /** @type {Record<string, unknown>} */ (item);
  const data = /** @type {Record<string, unknown> | null | undefined} */ (itemFields.data);
  const payload = /** @type {Record<string, unknown> | null | undefined} */ (data?.payload);
  return computeBodyHash(stableMeshJson({
    type: itemFields.type || null,
    table: itemFields.table || null,
    data: itemFields.data || null,
    dependency: itemFields._depends_on || null,
    local_booking_ids: Array.isArray(itemFields._local_booking_ids) ? itemFields._local_booking_ids : null,
    origin_lodge_id: itemFields._origin_lodge_id || data?.p_lodge_id || payload?.lodge_id || null
  }));
}
/** @param {unknown} [item] */
export function getQueueItemBodyHash(item = {}) {
  const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
  return itemFields?._mesh_body_hash || computeBodyHash(stripMeshMetadata(item));
}

/** @param {unknown} [item] */
function getQueueItemIntentId(item = {}) {
  const itemFields = /** @type {Record<string, unknown>} */ (item);
  const data = /** @type {Record<string, unknown> | null | undefined} */ (itemFields.data);
  const payload = /** @type {Record<string, unknown> | null | undefined} */ (data?.payload);
  return String(
    itemFields.intentId ||
    data?.p_idempotency_key ||
    data?.p_adjustment_id ||
    payload?.operation_id ||
    payload?.create_idempotency_key ||
    payload?.return_idempotency_key ||
    payload?.cashup_id ||
    payload?.idempotency_key ||
    ''
  ).trim();
}

/**
 * Validates a incoming P2P sync queue operation item against structural and safety schemas.
 */
/** @param {unknown} rawItem */
export function validateSyncQueueItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') {
    return { isValid: false, reason: 'Payload is not an object' };
  }
  // The checks below inspect untrusted fields one by one. This record view
  // only enables the existing property reads; it does not validate the item.
  const item = /** @type {Record<string, unknown>} */ (rawItem);
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
  // The payload is unknown in the shared queue view. These local expected-data
  // views only preserve the existing property reads; they do not validate it.
  if ((/** @type {Record<string, unknown> | null | undefined} */ (item.data?.payload))?.lodge_id &&
      (/** @type {Record<string, unknown>} */ (item.data.payload)).lodge_id !== meshState.lodgeId) {
    return { isValid: false, reason: 'Queue item payload lodge mismatch' };
  }

  if (item.table === 'create_booking') {
    const data = item.data;
    const required = ['p_lodge_id', 'p_customer_id', 'p_room_id', 'p_check_in', 'p_check_out', 'p_booking_id', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_booking missing ${missing.join(', ')}` };
    if (!hasValidDateRange(data.p_check_in, data.p_check_out)) return { isValid: false, reason: 'create_booking has invalid date range' };
  }

  if (item.table === 'create_multi_room_booking') {
    const data = item.data;
    const required = ['p_lodge_id', 'p_customer_id', 'p_check_in', 'p_check_out', 'p_group_key', 'p_idempotency_key', 'p_created_by'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: 'create_multi_room_booking missing ' + missing.join(', ') };
    if (!hasValidDateRange(data.p_check_in, data.p_check_out)) return { isValid: false, reason: 'create_multi_room_booking has invalid date range' };
    if (!Array.isArray(data.p_rooms) || data.p_rooms.length < 2 || data.p_rooms.length > 50) {
      return { isValid: false, reason: 'create_multi_room_booking requires 2 to 50 rooms' };
    }
    const rooms = /** @type {unknown[]} */ (data.p_rooms);
    const roomIds = rooms.map((room) => String(/** @type {{room_id?: unknown} | null | undefined} */ (room)?.room_id || '').trim());
    if (roomIds.some((id) => !isUuid(id)) || new Set(roomIds).size !== roomIds.length) {
      return { isValid: false, reason: 'create_multi_room_booking has missing or duplicate room IDs' };
    }
    for (const room of rooms) {
      const roomFields = /** @type {{adults?: unknown, children?: unknown, tents?: unknown, vehicles?: unknown} | null | undefined} */ (room);
      const adults = Number(roomFields?.adults ?? 1);
      if (!Number.isInteger(adults) || adults < 1) {
        return { isValid: false, reason: 'create_multi_room_booking has invalid adults' };
      }
      /** @type {Array<'children' | 'tents' | 'vehicles'>} */
      const countFields = ['children', 'tents', 'vehicles'];
      for (const field of countFields) {
        if (!Number.isInteger(Number(roomFields?.[field] ?? 0)) || Number(roomFields?.[field] ?? 0) < 0) {
          return { isValid: false, reason: 'create_multi_room_booking has invalid ' + field };
        }
      }
    }
    if (data.p_deposit_amount != null && (!isFiniteNumber(data.p_deposit_amount) || Number(data.p_deposit_amount) < 0)) {
      return { isValid: false, reason: 'create_multi_room_booking has invalid deposit amount' };
    }
    if (typeof data.p_idempotency_key !== 'string' || data.p_idempotency_key.trim().length < 16) {
      return { isValid: false, reason: 'create_multi_room_booking has an invalid idempotency key' };
    }
    const childIds = item._local_booking_ids;
    if (!Array.isArray(childIds) || childIds.length !== data.p_rooms.length ||
        childIds.some((id) => !isUuid(id)) || new Set(childIds).size !== childIds.length) {
      return { isValid: false, reason: 'create_multi_room_booking local child mapping does not match its rooms' };
    }
    if (item._origin_lodge_id && item._origin_lodge_id !== data.p_lodge_id) {
      return { isValid: false, reason: 'create_multi_room_booking origin lodge mismatch' };
    }
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

  if (item.table === 'create_campsite_booking') {
    const data = item.data;
    const required = ['p_lodge_id', 'p_customer_id', 'p_room_id', 'p_check_in', 'p_check_out', 'p_booking_id', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_campsite_booking missing ${missing.join(', ')}` };
    if (!hasValidDateRange(data.p_check_in, data.p_check_out)) return { isValid: false, reason: 'create_campsite_booking has invalid date range' };
    for (const field of ['p_adults', 'p_children', 'p_tents', 'p_vehicles']) {
      if (!Number.isInteger(Number(data[field])) || Number(data[field]) < 0) return { isValid: false, reason: `create_campsite_booking has invalid ${field}` };
    }
    if (Number(data.p_adults) + Number(data.p_children) < 1) return { isValid: false, reason: 'create_campsite_booking requires a guest' };
  }

  if (item.table === 'reschedule_booking') {
    const data = item.data;
    const required = ['p_booking_id', 'p_lodge_id', 'p_new_room_id', 'p_new_check_in', 'p_new_check_out', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `reschedule_booking missing ${missing.join(', ')}` };
    if (!hasValidDateRange(data.p_new_check_in, data.p_new_check_out)) return { isValid: false, reason: 'reschedule_booking has invalid date range' };
  }

  if (item.table === 'reschedule_accommodation_booking') {
    const data = item.data;
    const required = ['p_booking_id', 'p_lodge_id', 'p_new_room_id', 'p_new_check_in', 'p_new_check_out', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `reschedule_accommodation_booking missing ${missing.join(', ')}` };
    if (!hasValidDateRange(data.p_new_check_in, data.p_new_check_out)) return { isValid: false, reason: 'reschedule_accommodation_booking has invalid date range' };
  }

  if (item.table === 'move_booking_room') {
    const data = item.data;
    const required = ['p_booking_id', 'p_lodge_id', 'p_target_room_id', 'p_reason', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `move_booking_room missing ${missing.join(', ')}` };
  }

  if (item.table === 'update_booking_status' && !hasString(item.data.p_id)) {
    return { isValid: false, reason: 'update_booking_status missing p_id' };
  }

  if (item.table === 'add_booking_charge') {
    const data = item.data;
    const required = ['p_booking_id', 'p_lodge_id', 'p_description', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `add_booking_charge missing ${missing.join(', ')}` };
    if (!isFiniteNumber(data.p_quantity) || Number(data.p_quantity) <= 0) return { isValid: false, reason: 'add_booking_charge has invalid quantity' };
    if (!isFiniteNumber(data.p_unit_price) || Number(data.p_unit_price) <= 0) return { isValid: false, reason: 'add_booking_charge has invalid unit price' };
  }

  if (item.table === 'delete_booking_charge' && (!hasString(item.data.p_charge_id) || !hasString(item.data.p_lodge_id))) {
    return { isValid: false, reason: 'delete_booking_charge missing charge or lodge' };
  }

  if (item.table === 'record_customer_credit') {
    const data = item.data;
    const required = ['p_lodge_id', 'p_customer_id', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `record_customer_credit missing ${missing.join(', ')}` };
    if (!isFiniteNumber(data.p_amount) || Number(data.p_amount) <= 0) return { isValid: false, reason: 'record_customer_credit has invalid amount' };
  }

  if (['apply_customer_credit_to_booking', 'refund_customer_credit'].includes(item.table)) {
    const data = item.data;
    const required = item.table === 'apply_customer_credit_to_booking'
      ? ['p_lodge_id', 'p_customer_id', 'p_booking_id', 'p_idempotency_key']
      : ['p_lodge_id', 'p_customer_id', 'p_method', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `${item.table} missing ${missing.join(', ')}` };
    if (!isFiniteNumber(data.p_amount) || Number(data.p_amount) <= 0) return { isValid: false, reason: `${item.table} has invalid amount` };
  }

  if (item.table === 'reverse_customer_credit_entry') {
    const data = item.data;
    const required = ['p_lodge_id', 'p_entry_id', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `reverse_customer_credit_entry missing ${missing.join(', ')}` };
  }

  if (item.table === 'create_room_rate_override') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'create_room_rate_override missing payload object' };
    const required = ['id', 'lodge_id', 'name', 'start_date', 'end_date'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_room_rate_override missing ${missing.join(', ')}` };
    if (!hasValidInclusiveDateRange(payload.start_date, payload.end_date)) return { isValid: false, reason: 'create_room_rate_override has invalid date range' };
    if (!isFiniteNumber(payload.rate_per_night) || Number(payload.rate_per_night) < 0) return { isValid: false, reason: 'create_room_rate_override has invalid rate' };
  }

  if (item.table === 'update_room_rate_override') {
    const payload = item.data.payload;
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id)) return { isValid: false, reason: 'update_room_rate_override missing id or lodge' };
    if (!isPlainObject(payload)) return { isValid: false, reason: 'update_room_rate_override missing payload object' };
    if (!hasValidInclusiveDateRange(payload.start_date, payload.end_date)) return { isValid: false, reason: 'update_room_rate_override has invalid date range' };
    if (!isFiniteNumber(payload.rate_per_night) || Number(payload.rate_per_night) < 0) return { isValid: false, reason: 'update_room_rate_override has invalid rate' };
  }

  if (item.table === 'delete_room_rate_override' && (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id))) {
    return { isValid: false, reason: 'delete_room_rate_override missing id or lodge' };
  }

  if (item.table === 'create_event_booking') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'create_event_booking missing payload object' };
    const required = ['id', 'lodge_id', 'idempotency_key', 'event_name'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `create_event_booking missing ${missing.join(', ')}` };
    if (payload.check_in || payload.check_out) {
      if (!hasValidDateRange(payload.check_in, payload.check_out)) return { isValid: false, reason: 'create_event_booking has invalid linked-room date range' };
    }
  }

  if (item.table === 'update_event_booking') {
    if (!hasString(item.data.p_event_id) || !hasString(item.data.p_lodge_id) || !hasString(item.data.p_idempotency_key)) {
      return { isValid: false, reason: 'update_event_booking missing event, lodge, or idempotency key' };
    }
    if (!isPlainObject(item.data.payload)) return { isValid: false, reason: 'update_event_booking missing payload object' };
  }

  if (item.table === 'cancel_event_booking') {
    if (!hasString(item.data.p_event_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: 'cancel_event_booking missing event or lodge' };
    }
  }

  if (item.table === 'update_event_payment') {
    const data = item.data;
    const required = ['p_event_id', 'p_lodge_id', 'p_method', 'p_type', 'p_idempotency_key'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `update_event_payment missing ${missing.join(', ')}` };
    if (!isFiniteNumber(data.p_amount) || Number(data.p_amount) <= 0) return { isValid: false, reason: 'update_event_payment has invalid amount' };
  }

  if (item.table === 'add_event_line_item') {
    const payload = item.data.payload;
    if (!isPlainObject(payload)) return { isValid: false, reason: 'add_event_line_item missing payload object' };
    const required = ['lodge_id', 'event_booking_id', 'idempotency_key'];
    const missing = required.filter((field) => !hasString(payload[field]));
    if (missing.length > 0) return { isValid: false, reason: `add_event_line_item missing ${missing.join(', ')}` };
    if (!isFiniteNumber(payload.quantity) || Number(payload.quantity) <= 0) return { isValid: false, reason: 'add_event_line_item has invalid quantity' };
    if (!isFiniteNumber(payload.unit_price) || Number(payload.unit_price) < 0) return { isValid: false, reason: 'add_event_line_item has invalid unit price' };
  }

  if (item.table === 'void_event_line_item') {
    if (!hasString(item.data.p_line_item_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: 'void_event_line_item missing line item or lodge' };
    }
  }

  if (['create_expense', 'add_inventory_purchase', 'create_supply_item', 'add_supply_purchase', 'create_inventory_stocktake_session', 'create_supply_stocktake_session', 'create_room_supply_stocktake_session'].includes(item.table)) {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id)) {
      return { isValid: false, reason: `${item.table} missing lodge-scoped payload` };
    }
    if (['create_expense', 'add_inventory_purchase', 'add_supply_purchase'].includes(item.table)) {
      const amount = item.table === 'create_expense' ? payload.amount : payload.total_cost;
      if (!isFiniteNumber(amount) || Number(amount) < 0) return { isValid: false, reason: `${item.table} has invalid amount` };
    }
  }

  if (['update_expense', 'delete_expense', 'update_inventory_item', 'delete_inventory_item', 'update_supply_item', 'delete_supply_item', 'update_maintenance_ticket', 'resolve_maintenance_ticket'].includes(item.table)) {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: `${item.table} missing id or lodge` };
    }
  }

  if (['save_inventory_stocktake_counts', 'post_inventory_stocktake_session', 'save_supply_stocktake_counts', 'save_room_supply_stocktake_counts', 'post_supply_stocktake_session', 'post_room_supply_stocktake_session', 'create_room_supply_stocktake_line'].includes(item.table)) {
    if (!hasString(item.data.p_stocktake_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: `${item.table} missing stocktake or lodge` };
    }
  }

  if (['adjust_supply_stock'].includes(item.table)) {
    if (!hasString(item.data.p_item_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: `${item.table} missing item or lodge` };
    }
    if (!isFiniteNumber(item.data.p_delta) || Number(item.data.p_delta) === 0) {
      return { isValid: false, reason: `${item.table} has invalid quantity` };
    }
  }

  if (['save_room_supply_allocations', 'load_supply_to_room', 'use_room_supply_stock', 'return_room_supply_to_store'].includes(item.table)) {
    const payload = item.table === 'save_room_supply_allocations' ? item.data : item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.p_lodge_id || payload.lodge_id)) {
      return { isValid: false, reason: `${item.table} missing lodge-scoped payload` };
    }
    if (item.table !== 'save_room_supply_allocations') {
      if (!hasString(payload.operation_id) || !hasString(payload.item_id) || !hasString(payload.room_id)) {
        return { isValid: false, reason: `${item.table} missing operation, item, or room` };
      }
      if (!isFiniteNumber(payload.quantity) || Number(payload.quantity) <= 0) {
        return { isValid: false, reason: `${item.table} has invalid quantity` };
      }
    }
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

  if (item.table === 'transfer_pos_tab_waiter') {
    const data = item.data;
    const required = ['p_tab_id', 'p_target_waiter_id', 'p_target_shift_id', 'p_operation_id', 'p_expected_tab_version'];
    const missing = required.filter((field) => !hasString(data[field]));
    if (missing.length > 0) return { isValid: false, reason: `transfer_pos_tab_waiter missing ${missing.join(', ')}` };
    if (!['p_tab_id', 'p_target_waiter_id', 'p_target_shift_id', 'p_operation_id'].every((field) => isUuid(data[field]))) {
      return { isValid: false, reason: 'transfer_pos_tab_waiter requires UUID tab, waiter, shift, and operation identifiers' };
    }
    if (!Number.isInteger(Number(data.p_expected_tab_version)) || Number(data.p_expected_tab_version) < 1) {
      return { isValid: false, reason: 'transfer_pos_tab_waiter requires a positive expected tab version' };
    }
    if (data.p_operator_proof != null) {
      return { isValid: false, reason: 'transfer_pos_tab_waiter operator proofs may not be persisted or replayed through mesh' };
    }
    if (data.p_notes != null && (typeof data.p_notes !== 'string' || data.p_notes.length > 1000)) {
      return { isValid: false, reason: 'transfer_pos_tab_waiter notes are limited to 1000 characters' };
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

  // Offline menu writes carry the full item/update inline so a second till
  // can sell the new price (or the new product) before the server confirms.
  // Clock/attendance operations are deliberately never allowlisted: their
  // payloads carry raw staff PINs, which must never travel between devices.
  if (item.table === 'create_pos_menu_item_offline') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.name)) {
      return { isValid: false, reason: 'create_pos_menu_item_offline missing lodge-scoped item' };
    }
  }

  if (item.table === 'update_pos_menu_item_offline') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.menu_item_id)) {
      return { isValid: false, reason: 'update_pos_menu_item_offline missing lodge or menu item' };
    }
  }

  if (item.table === 'update_pos_prep_ticket_status' && (!hasString(item.data.p_ticket_id) || !hasString(item.data.p_operation_id))) {
    return { isValid: false, reason: 'update_pos_prep_ticket_status missing ticket or operation id' };
  }

  if (item.table === 'open_pos_drawer_period') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.outlet_id)) {
      return { isValid: false, reason: 'open_pos_drawer_period missing lodge or outlet' };
    }
    if ('pin' in payload || 'manager_pin' in payload) {
      return { isValid: false, reason: 'open_pos_drawer_period must not carry PIN material' };
    }
  }

  if (item.table === 'set_bar_pos_pack_template_offline') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.inventory_item_id)) {
      return { isValid: false, reason: 'set_bar_pos_pack_template_offline missing lodge or stock item' };
    }
  }

  if (item.table === 'save_bar_pos_product_with_packs_offline') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.name)) {
      return { isValid: false, reason: 'save_bar_pos_product_with_packs_offline missing lodge-scoped product' };
    }
  }

  if (item.table === 'create_daily_checklist') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.checklist_type)) {
      return { isValid: false, reason: 'create_daily_checklist missing lodge or checklist type' };
    }
  }

  if (item.table === 'create_bar_checklist_from_template') {
    const payload = item.data.p_payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.template_key) || !hasString(payload.operation_id)) {
      return { isValid: false, reason: 'create_bar_checklist_from_template missing lodge, template, or operation' };
    }
  }

  if (item.table === 'complete_checklist_item') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.item_id)) {
      return { isValid: false, reason: 'complete_checklist_item missing lodge or item' };
    }
    if (payload.notes != null && (typeof payload.notes !== 'string' || payload.notes.length > 1000)) {
      return { isValid: false, reason: 'complete_checklist_item notes are limited to 1000 characters' };
    }
  }

  if (item.table === 'update_pool_day_use') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id) || !hasString(payload.idempotency_key)) {
      return { isValid: false, reason: 'update_pool_day_use missing required operation fields' };
    }
  }

  if (['post_bar_physical_count', 'post_bar_simple_delivery'].includes(item.table)) {
    const data = item.data;
    if (!isUuid(data.p_lodge_id) || !isUuid(data.p_operation_id)) {
      return { isValid: false, reason: `${item.table} missing lodge or stable operation id` };
    }
    if (data.p_outlet_id != null && !isUuid(data.p_outlet_id)) {
      return { isValid: false, reason: `${item.table} has invalid outlet id` };
    }
    if (!Array.isArray(data.p_lines) || data.p_lines.length === 0 || data.p_lines.length > 500) {
      return { isValid: false, reason: `${item.table} requires 1-500 stock lines` };
    }
    if (data.p_notes != null && (typeof data.p_notes !== 'string' || data.p_notes.trim().length > 300)) {
      return { isValid: false, reason: `${item.table} notes exceed the 300 character limit` };
    }
    const seen = new Set();
    for (const line of data.p_lines) {
      if (!isPlainObject(line) || !isUuid(line.item_id) || seen.has(String(line.item_id))) {
        return { isValid: false, reason: `${item.table} contains duplicate or invalid item lines` };
      }
      seen.add(String(line.item_id));
      if (item.table === 'post_bar_simple_delivery' && ['supplier', 'supplier_id', 'purchase_order', 'purchase_order_id', 'lot_id', 'expiry', 'expiry_date', 'unit_cost', 'valuation_method'].some((field) => Object.prototype.hasOwnProperty.call(line, field))) {
        return { isValid: false, reason: 'post_bar_simple_delivery cannot carry purchasing, lot, expiry, cost, or valuation fields' };
      }
      if (typeof line.reason !== 'string' || line.reason.length > 300 || typeof line.reason_code !== 'string' || line.reason_code.length > 64) {
        return { isValid: false, reason: `${item.table} contains an invalid reason field` };
      }
      if (item.table === 'post_bar_physical_count') {
        if (line.expected_qty == null || String(line.expected_qty).trim() === '' || line.actual_qty == null || String(line.actual_qty).trim() === '' || !isFiniteNumber(line.expected_qty) || Number(line.expected_qty) < 0 || !isFiniteNumber(line.actual_qty) || Number(line.actual_qty) < 0) {
          return { isValid: false, reason: 'post_bar_physical_count contains invalid expected or actual quantity' };
        }
        if (typeof line.expected_updated_at !== 'string' || Number.isNaN(Date.parse(line.expected_updated_at))) {
          return { isValid: false, reason: 'post_bar_physical_count requires valid expected_updated_at version evidence' };
        }
      } else if (!isFiniteNumber(line.quantity) || Number(line.quantity) <= 0) {
        return { isValid: false, reason: 'post_bar_simple_delivery contains invalid quantity' };
      }
    }
  }

  // Third-wave contract coverage. Each shape mirrors the payload the desktop
  // domain emits for the online RPC, so a peer accepts exactly what the
  // origin till queued instead of trusting free-form fields.
  if (['create_corporate_account', 'create_floor_section', 'create_rate_plan', 'create_room_type'].includes(item.table)) {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.id) || !hasString(payload.lodge_id)) {
      return { isValid: false, reason: `${item.table} missing lodge-scoped entity` };
    }
  }

  if (['update_corporate_account', 'update_floor_section', 'update_rate_plan', 'update_room_type'].includes(item.table)) {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id) || !isPlainObject(item.data.payload)) {
      return { isValid: false, reason: `${item.table} missing entity, lodge, or payload` };
    }
  }

  if (['delete_corporate_account', 'delete_floor_section', 'delete_rate_plan', 'delete_room_type'].includes(item.table)) {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: `${item.table} missing entity or lodge` };
    }
  }

  if (['create_fnb_room_service_order', 'create_fnb_meal_entitlement', 'create_fnb_temperature_log', 'capture_fnb_supplier_invoice'].includes(item.table)) {
    if (!hasString(item.data.p_lodge_id) || !hasString(item.data.p_operation_id) || !isPlainObject(item.data.p_payload)) {
      return { isValid: false, reason: `${item.table} missing lodge, operation, or payload` };
    }
  }

  if (item.table === 'redeem_fnb_meal') {
    if (!hasString(item.data.p_entitlement_id) || !hasString(item.data.p_operation_id) || !isPlainObject(item.data.p_payload)) {
      return { isValid: false, reason: 'redeem_fnb_meal missing entitlement, operation, or payload' };
    }
  }

  if (item.table === 'set_rate_calendar_entry') {
    const data = item.data;
    if (!hasString(data.p_lodge_id) || !hasString(data.p_room_type_id) || !isValidDate(data.p_date)) {
      return { isValid: false, reason: 'set_rate_calendar_entry missing lodge, room type, or date' };
    }
    if (!isFiniteNumber(data.p_amount) || Number(data.p_amount) < 0) {
      return { isValid: false, reason: 'set_rate_calendar_entry has invalid amount' };
    }
  }

  if (item.table === 'set_rate_calendar_bulk') {
    if (!hasString(item.data.p_lodge_id) || !hasString(item.data.p_entries)) {
      return { isValid: false, reason: 'set_rate_calendar_bulk missing lodge or entries' };
    }
  }

  if (item.table === 'set_rate_restriction') {
    const data = item.data;
    if (!hasString(data.p_lodge_id) || !hasString(data.p_room_type_id) || !isValidDate(data.p_date) || data.p_restrictions == null) {
      return { isValid: false, reason: 'set_rate_restriction missing lodge, room type, date, or restrictions' };
    }
  }

  if (item.table === 'create_promo_code') {
    const code = item.data.p_code;
    if (!hasString(item.data.p_lodge_id) || !isPlainObject(code) || !hasString(code.id) || !hasString(code.code)) {
      return { isValid: false, reason: 'create_promo_code missing lodge or code identity' };
    }
  }

  if (item.table === 'update_promo_code') {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id) || !isPlainObject(item.data.p_code)) {
      return { isValid: false, reason: 'update_promo_code missing entity, lodge, or code' };
    }
  }

  if (['delete_promo_code', 'delete_season_label', 'delete_yield_rule'].includes(item.table)) {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id)) {
      return { isValid: false, reason: `${item.table} missing entity or lodge` };
    }
  }

  if (item.table === 'create_season_label') {
    const season = item.data.p_season;
    if (!hasString(item.data.p_lodge_id) || !isPlainObject(season) || !hasString(season.id) || !hasString(season.name)) {
      return { isValid: false, reason: 'create_season_label missing lodge or season identity' };
    }
  }

  if (item.table === 'update_season_label') {
    if (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id) || !isPlainObject(item.data.p_season)) {
      return { isValid: false, reason: 'update_season_label missing entity, lodge, or season' };
    }
  }

  if (item.table === 'create_yield_rule') {
    if (!hasString(item.data.p_lodge_id) || !hasString(item.data.p_name)) {
      return { isValid: false, reason: 'create_yield_rule missing lodge or name' };
    }
  }

  if (item.table === 'update_yield_rule' && (!hasString(item.data.p_id) || !hasString(item.data.p_lodge_id))) {
    return { isValid: false, reason: 'update_yield_rule missing entity or lodge' };
  }

  if (item.table === 'publish_pos_catalog_snapshot_offline') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.snapshot_id)) {
      return { isValid: false, reason: 'publish_pos_catalog_snapshot_offline missing lodge or snapshot' };
    }
  }

  if (item.table === 'save_bar_product_with_stock') {
    const payload = item.data.payload;
    if (!isPlainObject(payload) || !hasString(payload.lodge_id) || !hasString(payload.operation_key) ||
        !hasString(payload.inventory_item_id) || !isPlainObject(payload.product) || !hasString(payload.product.name)) {
      return { isValid: false, reason: 'save_bar_product_with_stock missing lodge-scoped product identity' };
    }
  }

  return { isValid: true };
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} row
 * @param {MeshQueueItemExpectedView} item
 * @returns {T & {_pending_sync: true, _sync_state: 'pending', _mesh_imported: true, _mesh_source_node_id: unknown, updated_at: unknown}}
 */
function stampMeshImported(row, item) {
  return {
    ...row,
    _pending_sync: true,
    _sync_state: 'pending',
    _mesh_imported: true,
    _mesh_source_node_id: item._mesh_source_node_id,
    updated_at: row.updated_at || new Date().toISOString()
  };
}

/**
 * Tabs opened, settled, or handed to another waiter on the other till appear
 * on this till's Open Tabs before the server confirms. Status changes reuse
 * the offline trust root: uncertified totals, server prices at replay.
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedTabCacheEffects(items = []) {
  const tabs = readCache('pos-tabs');
  if (!Array.isArray(tabs)) return;
  let next = tabs;
  let changed = false;
  for (const item of items) {
    if (item.table === 'upsert_pos_tab') {
      const row = item.data?.payload;
      if (!row || typeof row !== 'object' || !row.id) continue;
      next = [stampMeshImported({ ...row }, item), ...next.filter((entry) => entry?.id !== row.id)];
      changed = true;
    } else if (item.table === 'update_pos_tab_status') {
      const id = String(item.data?.p_tab_id || '');
      const status = String(item.data?.p_status || '');
      if (!id || !status) continue;
      const index = next.findIndex((entry) => String(entry?.id) === id);
      if (index < 0) continue;
      const updated = [...next];
      updated[index] = stampMeshImported({
        ...updated[index], status, financial_complete: false, _financial_complete: false,
        updated_at: new Date().toISOString()
      }, item);
      next = updated;
      changed = true;
    } else if (item.table === 'transfer_pos_tab_waiter') {
      const id = String(item.data?.p_tab_id || '');
      if (!id) continue;
      const index = next.findIndex((entry) => String(entry?.id) === id);
      if (index < 0) continue;
      const updated = [...next];
      updated[index] = stampMeshImported({
        ...updated[index],
        waiter_id: item.data.p_target_waiter_id || updated[index].waiter_id,
        shift_id: item.data.p_target_shift_id || updated[index].shift_id,
        updated_at: new Date().toISOString()
      }, item);
      next = updated;
      changed = true;
    }
  }
  if (changed) writeCache('pos-tabs', next);
}

/**
 * Shift opens on the other till land in this till's shift cache, so
 * in-shift staff and handover views stay complete through a long outage.
 * Closes reconcile at replay; the server remains shift truth.
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedShiftCacheEffects(items = []) {
  const shifts = readCache('pos-shifts');
  if (!Array.isArray(shifts)) return;
  let next = shifts;
  let changed = false;
  for (const item of items) {
    if (item.table === 'open_pos_shift_with_id') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      const id = String(payload.shift_id || payload.id || '').trim();
      if (!id) continue;
      const row = stampMeshImported({
        id,
        lodge_id: payload.lodge_id || meshState.lodgeId,
        outlet_id: payload.outlet_id || null,
        cashier_id: payload.cashier_id || null,
        cashier_name: payload.cashier_name || null,
        opening_float: payload.opening_float ?? null,
        notes: payload.notes || null,
        attendance_shift_id: payload.attendance_shift_id || null,
        status: 'open',
        opened_at: new Date().toISOString()
      }, item);
      next = [row, ...next.filter((entry) => String(entry?.id) !== id)];
      changed = true;
    } else if (item.table === 'close_pos_shift_with_id') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      const id = String(payload.shift_id || payload.id || '').trim();
      if (!id) continue;
      const index = next.findIndex((entry) => String(entry?.id) === id);
      if (index < 0) continue;
      const updated = [...next];
      updated[index] = stampMeshImported({ ...updated[index], status: 'closed', closed_at: new Date().toISOString() }, item);
      next = updated;
      changed = true;
    }
  }
  if (changed) writeCache('pos-shifts', next.slice(0, 500));
}

/**
 * Menu writes from the other till update this till's selling list: price and
 * availability changes merge by id, and brand-new offline products arrive as
 * provisional rows (same trust root as own offline products: sellable
 * offline at the entered price, replayed by name, blocked once fresh).
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedMenuCacheEffects(items = []) {
  const menu = readCache('pos-menu-items');
  if (!Array.isArray(menu)) return;
  let next = menu;
  let changed = false;
  for (const item of items) {
    if (item.table === 'create_pos_menu_item' || item.table === 'create_pos_menu_item_offline') {
      const row = /** @type {MeshMenuItemPayloadExpectedView|null|undefined} */ (item.data?.payload);
      if (!row || typeof row !== 'object' || (!row.id && !row.name)) continue;
      const id = row.id || `pending:${item._queue_id || Date.now()}`;
      next = [stampMeshImported({ ...row, id }, item), ...next.filter((entry) => String(entry?.id) !== String(id))];
      changed = true;
    } else if (item.table === 'update_pos_menu_item' || item.table === 'update_pos_menu_item_offline') {
      const data = item.data || {};
      const payload = /** @type {MeshMenuItemPayloadExpectedView} */ (data.payload && typeof data.payload === 'object' ? data.payload : {});
      const id = String(data.p_id || payload.menu_item_id || '').trim();
      if (!id) continue;
      const index = next.findIndex((entry) => String(entry?.id) === id);
      if (index < 0) continue;
      const patch = { ...(data.payload && typeof data.payload === 'object' ? data.payload : payload) };
      delete patch.lodge_id;
      delete patch.menu_item_id;
      const updated = [...next];
      updated[index] = stampMeshImported({ ...updated[index], ...patch }, item);
      next = updated;
      changed = true;
    }
  }
  if (changed) writeCache('pos-menu-items', next);
}

/**
 * Modifier groups and promotions arrive as full-list replaces (the queue
 * payload already carries the whole list), mirroring the local save path.
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedModifierPromotionEffects(items = []) {
  for (const item of items) {
    if (item.table === 'upsert_pos_modifier_groups' && Array.isArray((/** @type {MeshModifierPromotionPayloadExpectedView|null|undefined} */ (item.data?.payload))?.groups)) {
      const groups = /** @type {Record<string, unknown>[]} */ (item.data?.payload?.groups);
      writeCache('pos-modifier-groups', groups.map((row) => stampMeshImported(row, item)).slice(0, 500));
    } else if (item.table === 'upsert_pos_promotions' && Array.isArray((/** @type {MeshModifierPromotionPayloadExpectedView|null|undefined} */ (item.data?.payload))?.promotions)) {
      const promotions = /** @type {Record<string, unknown>[]} */ (item.data?.payload?.promotions);
      writeCache('pos-promotions', promotions.map((row) => stampMeshImported(row, item)).slice(0, 500));
    }
  }
}

/**
 * Deliveries received and counts taken on the other till adjust this till's
 * stock cache the same way a local offline post would (minus the movement
 * ledger rows, which stay device-local evidence and reconcile at replay).
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedStockReceiptEffects(items = []) {
  const inventory = readCache('inventory-items');
  if (!Array.isArray(inventory) || inventory.length === 0) return;
  let next = inventory;
  let changed = false;
  const now = new Date().toISOString();
  for (const item of items) {
    const lines = Array.isArray(item.data?.p_lines) ? /** @type {Record<string, unknown>[]} */ (item.data.p_lines) : [];
    if (item.table === 'post_bar_simple_delivery') {
      const byId = /** @type {Map<string, number>} */ (new Map(lines.map((line) => /** @type {[string, number]} */ ([String(line?.item_id || ''), Number(line?.quantity || 0)]))));
      next = next.map((row) => {
        const incoming = byId.get(String(row?.id || ''));
        if (!Number.isFinite(incoming) || (/** @type {number} */ (incoming)) <= 0) return row;
        changed = true;
        return stampMeshImported({ ...row, current_stock: Number(row.current_stock || 0) + /** @type {number} */ (incoming), updated_at: now }, item);
      });
    } else if (item.table === 'post_bar_physical_count') {
      const byId = /** @type {Map<string, number>} */ (new Map(lines.map((line) => /** @type {[string, number]} */ ([String(line?.item_id || ''), Number(line?.actual_qty)]))));
      next = next.map((row) => {
        const counted = byId.get(String(row?.id || ''));
        if (!Number.isFinite(counted) || (/** @type {number} */ (counted)) < 0) return row;
        changed = true;
        return stampMeshImported({ ...row, current_stock: /** @type {number} */ (counted), updated_at: now }, item);
      });
    }
  }
  if (changed) writeCache('inventory-items', next);
}

/**
 * A drawer opened on the other till appears here, so this till knows the
 * drawer is open (no double-open) and its Till gate passes. Only the
 * PIN-free open travels; drops, counts, submits, and reviews stay on their
 * own till and reconcile at replay.
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedDrawerOpenEffects(items = []) {
  const periods = readCache('pos-drawer-periods');
  if (!Array.isArray(periods)) return;
  let next = periods;
  let changed = false;
  for (const item of items) {
    if (item.table !== 'open_pos_drawer_period') continue;
    /** The matching validator branch requires a plain payload object; its fields remain unknown. */
    const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
    if (!payload.outlet_id) continue;
    const id = String(item._queue_id || '').trim() || `mesh-drawer-${Date.now()}`;
    if (next.some((entry) => String(entry?.id || '') === id || String(entry?._queue_id || '') === String(item._queue_id || ''))) continue;
    next = [stampMeshImported({
      id,
      lodge_id: payload.lodge_id || meshState.lodgeId,
      outlet_id: payload.outlet_id,
      status: 'open',
      opening_float: payload.opening_float ?? null,
      notes: payload.notes || null,
      opened_at: new Date().toISOString(),
      _queue_id: item._queue_id || null
    }, item), ...next];
    changed = true;
  }
  if (changed) writeCache('pos-drawer-periods', next);
}

/**
 * Pack templates and full products created on the other till land in the
 * selling list using the same guarded builders as a local offline save:
 * unknown linked stock means skip (never invent a price), otherwise the rows
 * match the local shape exactly, including provisional marking.
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedProductPackEffects(items = []) {
  const menu = readCache('pos-menu-items');
  /** The cache reader does not validate rows; existing logic expects an array here. */
  const inventory = /** @type {unknown[]} */ (readCache('inventory-items') || []);
  if (!Array.isArray(menu)) return;
  let next = menu;
  let changed = false;
  const now = new Date().toISOString();
  for (const item of items) {
    if (item.table === 'set_bar_pos_pack_template_offline') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      const stock = inventory.find((/** @type {unknown} */ rawRow) => {
        const row = /** @type {Record<string, unknown> | null | undefined} */ (rawRow);
        return String(row?.id || '') === String(payload.inventory_item_id || '');
      });
      if (!stock) continue;
      const stockRow = /** @type {Record<string, unknown>} */ (stock);
      const packSize = Number(payload.pack_size || 0);
      if (![6, 12, 24].includes(packSize)) continue;
      const menuItemId = String(payload.menu_item_id || `pending:${item._queue_id || 'pack'}`).trim();
      const row = stampMeshImported({
        id: menuItemId,
        lodge_id: payload.lodge_id || meshState.lodgeId,
        name: packSize === 24 ? `${stockRow.name} Case (24)` : `${stockRow.name} ${packSize} Pack`,
        category: 'Drinks',
        price: Number(stockRow.selling_price || 0) * packSize,
        is_available: payload.enabled !== false,
        barcode: payload.barcode || null,
        inventory_item_id: stockRow.id,
        depletion_qty: packSize,
        outlet_id: stockRow.outlet_id || null,
        template_kind: 'bar_pack',
        template_pack_size: packSize,
        updated_at: now
      }, item);
      next = [row, ...next.filter((entry) => String(entry?.id) !== menuItemId)];
      changed = true;
    } else if (item.table === 'save_bar_pos_product_with_packs_offline') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      if (!payload.name) continue;
      const stock = payload.inventory_item_id
        ? inventory.find((/** @type {unknown} */ rawRow) => {
          const row = /** @type {Record<string, unknown> | null | undefined} */ (rawRow);
          return String(row?.id || '') === String(payload.inventory_item_id);
        })
        : null;
      if (payload.inventory_item_id && !stock) continue;
      const stockRow = /** @type {Record<string, unknown> | null} */ (stock);
      const localId = String(payload.id || payload.menu_item_id || `pending:${item._queue_id || 'product'}`).trim();
      const baseRow = stampMeshImported({
        id: localId,
        lodge_id: payload.lodge_id || meshState.lodgeId,
        name: payload.name,
        category: payload.category || 'Drinks',
        price: Number(payload.price || 0),
        is_available: payload.is_available !== false,
        barcode: payload.barcode || null,
        stock_method: payload.stock_method || 'direct',
        inventory_item_id: payload.inventory_item_id || null,
        depletion_qty: payload.depletion_qty || null,
        outlet_id: payload.outlet_id || stockRow?.outlet_id || null,
        updated_at: now
      }, item);
      const packs = Array.isArray(payload.packs) ? /** @type {Record<string, unknown>[]} */ (payload.packs) : [];
      const packRows = packs.filter((pack) => pack?.enabled).map((pack) => {
        const packSize = Number(pack.pack_size || 0);
        return stampMeshImported({
          id: String(pack.menu_item_id || `pending:${item._queue_id || 'pack'}-${packSize}`).trim(),
          lodge_id: payload.lodge_id || meshState.lodgeId,
          name: packSize === 24 ? `${payload.name} Case (24)` : `${payload.name} ${packSize} Pack`,
          category: 'Drinks',
          price: Number(stockRow?.selling_price || payload.price || 0) * packSize,
          is_available: true,
          barcode: pack.barcode || null,
          inventory_item_id: payload.inventory_item_id || null,
          depletion_qty: packSize,
          outlet_id: payload.outlet_id || stockRow?.outlet_id || null,
          template_kind: 'bar_pack',
          template_pack_size: packSize,
          updated_at: now
        }, item);
      });
      const replaced = new Set([localId, ...packRows.map((row) => row.id)]);
      next = [baseRow, ...packRows, ...next.filter((entry) => !replaced.has(String(entry?.id)))];
      changed = true;
    }
  }
  if (changed) writeCache('pos-menu-items', next);
}

/**
 * Opening/closing routines stay visible across tills: created lists appear,
 * and check-offs tick by item id (unknown ids are skipped, never invented).
 */
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedChecklistEffects(items = []) {
  const lists = /** @type {MeshChecklistCacheExpectedView[]} */ (readCache('pos-checklists'));
  if (!Array.isArray(lists)) return;
  let next = lists;
  let changed = false;
  const now = new Date().toISOString();
  for (const item of items) {
    if (item.table === 'create_daily_checklist') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      if (!payload.checklist_type) continue;
      const id = `mesh-checklist-${String(item._queue_id || payload.checklist_type).trim()}`;
      if (next.some((entry) => String(entry?.id || '') === id)) continue;
      next = [stampMeshImported({
        id,
        lodge_id: payload.lodge_id || meshState.lodgeId,
        checklist_type: payload.checklist_type,
        items: (Array.isArray(payload.items) ? /** @type {unknown[]} */ (payload.items) : []).map((label) => ({
          id: `${id}:${String((/** @type {Record<string, unknown> | null | undefined} */ (label))?.label || label || '').trim()}`,
          item_label: String((/** @type {Record<string, unknown> | null | undefined} */ (label))?.label || label || ''),
          is_completed: false
        })),
        created_at: now
      }, item), ...next];
      changed = true;
    } else if (item.table === 'create_bar_checklist_from_template') {
      /** The matching validator branch requires a plain p_payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.p_payload || {});
      if (!payload.template_key || !payload.operation_id) continue;
      const id = `mesh-bar-checklist-${String(payload.operation_id).trim()}`;
      if (next.some((entry) => String(entry?.id || '') === id)) continue;
      next = [stampMeshImported({
        id,
        lodge_id: payload.lodge_id || meshState.lodgeId,
        template_key: payload.template_key,
        outlet_id: payload.outlet_id || null,
        items: [],
        created_at: now
      }, item), ...next];
      changed = true;
    } else if (item.table === 'complete_checklist_item') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      const target = String(payload.item_id || '');
      if (!target) continue;
      next = next.map((entry) => {
        const lines = Array.isArray(entry?.items) ? /** @type {unknown[]} */ (entry.items) : [];
        if (!lines.some((line) => String((/** @type {MeshChecklistLineExpectedView|null|undefined} */ (line))?.id || '') === target)) return entry;
        changed = true;
        return stampMeshImported({
          ...entry,
          items: lines.map((line) => String((/** @type {MeshChecklistLineExpectedView|null|undefined} */ (line))?.id || '') === target
            ? { .../** @type {MeshChecklistLineExpectedView|null|undefined} */ (line), is_completed: true, notes: payload.notes || (/** @type {MeshChecklistLineExpectedView|null|undefined} */ (line))?.notes || null, _pending_sync: true }
            : line)
        }, item);
      });
    }
  }
  if (changed) writeCache('pos-checklists', next);
}

/** @param {MeshQueueItemExpectedView[]} [items] */
export function applyImportedBookingCacheEffects(items = []) {
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
        notes: data.p_notes || '',
        status: 'pending',
        _estimated_total_amount: Number(data.p_total_amount || 0),
        _estimated_deposit_amount: Number(data.p_deposit_amount || 0),
        created_at: item.timestamp || item.created_at || new Date().toISOString(),
        _pending_sync: true,
        _financial_estimate: true,
        _sync_state: 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: item._mesh_source_node_id
      });
    } else if (item.table === 'create_campsite_booking') {
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
        tents: data.p_tents || 0,
        vehicles: data.p_vehicles || 0,
        accommodation_kind: 'campsite',
        notes: data.p_notes || '',
        status: 'pending',
        _estimated_total_amount: Number(data.p_total_amount || 0),
        _estimated_deposit_amount: Number(data.p_deposit_amount || 0),
        created_at: item.timestamp || item.created_at || new Date().toISOString(),
        _pending_sync: true,
        _financial_estimate: true,
        _sync_state: 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: item._mesh_source_node_id
      });
    } else if (item.table === 'create_multi_room_booking') {
      const data = item.data || {};
      const rooms = Array.isArray(data.p_rooms) ? data.p_rooms : [];
      const localIds = Array.isArray(item._local_booking_ids) ? item._local_booking_ids : [];
      if (rooms.length < 2 || localIds.length !== rooms.length) continue;
      /** @type {Record<string, unknown>[]} */
      const roomViews = rooms;
      roomViews.forEach((room, index) => {
        imported.push({
          id: localIds[index],
          lodge_id: data.p_lodge_id,
          customer_id: data.p_customer_id,
          room_id: room.room_id,
          check_in: data.p_check_in,
          check_out: data.p_check_out,
          adults: Number(room.adults || 0),
          children: Number(room.children || 0),
          tents: Number(room.tents || 0),
          vehicles: Number(room.vehicles || 0),
          group_key: data.p_group_key,
          notes: data.p_notes || '',
          status: 'pending',
          created_at: item.timestamp || item.created_at || new Date().toISOString(),
          _financial_estimate: true,
          _estimated_group_deposit_amount: Number(data.p_deposit_amount || 0),
          _pending_sync: true,
          _sync_state: 'pending',
          _mesh_imported: true,
          _mesh_source_node_id: item._mesh_source_node_id,
          _mesh_group_operation_id: item._queue_id
        });
      });
    } else if (item.table === 'create_booking_record') {
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
      const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
      const {
        total_amount,
        amount_paid,
        payment_status,
        ...safePayload
      } = payload;
      imported.push({
        ...safePayload,
        status: safePayload.status || 'pending',
        _estimated_total_amount: Number(total_amount || payload._estimated_total_amount || 0),
        _estimated_deposit_amount: Number(amount_paid || payload._estimated_amount_paid || 0),
        _financial_estimate: true,
        created_at: safePayload.created_at || item.timestamp || new Date().toISOString(),
        _pending_sync: true,
        _sync_state: 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: item._mesh_source_node_id
      });
    }
  }
  if (imported.length === 0) return;
  /** Cache rows remain unvalidated; this consumer already relies on array operations. */
  const existing = /** @type {unknown[]} */ (readCache('bookings'));
  const importedIds = new Set(imported.map((row) => row.id).filter(Boolean));
  writeCache('bookings', [
    ...existing.filter((/** @type {unknown} */ rawRow) => !importedIds.has(
      (/** @type {Record<string, unknown> | null | undefined} */ (rawRow))?.id
    )),
    ...imported
  ]);
}
/** @param {MeshQueueItemExpectedView[]} [items] */
function applyImportedOperationalCacheEffects(items = []) {
  for (const item of items) {
    if (item.table !== 'update_pool_day_use') continue;
      /** The matching validator branch requires a plain payload object; its fields remain unknown. */
    const payload = /** @type {Record<string, unknown>} */ (item.data?.payload || {});
    /** The preexisting path assumes this cache value is an array and calls findIndex directly. */
    const rows = /** @type {MeshPoolDayUseCacheExpectedView[]} */ (readCache('pool-day-use'));
    const index = rows.findIndex((/** @type {unknown} */ rawRow) =>
      (/** @type {Record<string, unknown> | null | undefined} */ (rawRow))?.id === payload.id
    );
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
/** @param {unknown} item @param {unknown} reason */
export function quarantineInvalidItem(item, reason) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, 'sync-mesh-quarantine.json');
  /** Parsed quarantine entries are not validated; the existing writer expects an array. */
  /** @type {unknown[]} */
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

/** @param {unknown} item @param {unknown} peerId @param {string} reason */
function quarantineMeshIdentityConflict(item, peerId, reason) {
  const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
  const queueId = String(itemFields?._queue_id || '').slice(0, 160);
  const message = 'A nearby device sent a queued operation whose ID or financial key is already bound to different contents. The incoming operation was quarantined. A manager must review System Health and include local sync details in a support bundle; do not retry it under a new key.';
  quarantineInvalidItem(item, 'Mesh queue identity conflict: ' + reason);
  appendHealthFault({
    type: 'mesh_queue_identity_conflict',
    scope: String(meshState.lodgeId || state.lodgeId || 'unknown'),
    severity: 'error',
    message,
    context: { queue_id: queueId || null, peer_id: String(peerId || 'unknown').slice(0, 120) }
  });
  appendOperationJournalEntry('mesh_identity_conflict', item, {
    source_node_id: peerId,
    includeSnapshot: false,
    message
  });
}
/**
 * Conducts a full P2P sync queue reconciliation with all discovered local peers.
 */
export async function syncMeshQueues() {
  if (!meshState.running || meshState.peers.size === 0) {
    meshState.lastQueueRepair = {
      at: new Date().toISOString(),
      peerCount: meshState.peers.size,
      importedCount: 0,
      missingCount: 0,
      conflictCount: 0,
      conflictSamples: [],
      perPeer: []
    };
    return;
  }

  console.log(`[MeshMerge] Starting P2P queue sync with ${meshState.peers.size} active peers...`);
  let hasMergedNewItems = false;
  let totalImported = 0;
  let totalMissing = 0;
  let totalIdentityConflicts = 0;
  /** @type {Array<{peer_id: unknown, queue_id: unknown, operation: unknown}>} */
  const identityConflictSamples = [];
  const repairPeers = [];

  for (const [peerId, peer] of meshState.peers.entries()) {
    try {
      const localPendingGroups = readSyncQueue().filter((item) => item.table === 'create_multi_room_booking');
      /** Capabilities are untrusted network data, read only for this existing feature gate. */
      /** @type {{protocolVersion?: unknown, queueFeatures?: unknown} | null} */
      let peerCapabilities = null;
      try {
        peerCapabilities = /** @type {{protocolVersion?: unknown, queueFeatures?: unknown}} */ (
          await sendSignedMeshRequest(peer.address, peer.httpPort, 'GET', '/mesh/capabilities')
        );
      } catch {
        peerCapabilities = null;
      }
      if (localPendingGroups.length > 0 &&
          (!peerCapabilities || Number(peerCapabilities.protocolVersion || 0) < 2 ||
           !Array.isArray(peerCapabilities.queueFeatures) ||
           !peerCapabilities.queueFeatures.includes('atomic_multi_room_booking_v1'))) {
        appendHealthFault({
          type: 'mesh_peer_protocol_incompatible',
          scope: String(meshState.lodgeId || state.lodgeId || 'unknown'),
          severity: 'warn',
          message: 'A nearby device has not confirmed support for atomic multi-room booking sync. Keep the group queued on this device and have a manager update or review the other device; do not split or recreate the group.',
          context: { peer_id: String(peer.nodeId || peerId), queue_count: localPendingGroups.length }
        });
      }
      // 1. Fetch remote queue summary
      const remoteSummary = await sendSignedMeshRequest(peer.address, peer.httpPort, 'GET', '/mesh/queue/summary');
      if (!Array.isArray(remoteSummary)) {
        console.warn(`[MeshMerge] Peer ${peerId} returned malformed queue summary.`);
        continue;
      }

      // Compare stable operation fingerprints before treating queue IDs and keys as duplicates.
      const localQueue = readSyncQueue();
      const localByQueueId = new Map(localQueue.map((item) => /** @type {[string, (typeof localQueue)[number]]} */ ([String(item?._queue_id || ''), item])));
      const localByIntentId = new Map(localQueue.map((item) => /** @type {[string, (typeof localQueue)[number]]} */ ([getQueueItemIntentId(item), item])).filter(([key]) => key));
      const localBodyHashes = new Set(localQueue.map(getQueueItemBodyHash).filter(Boolean));
      const localOperationHashes = new Set(localQueue.map(getQueueItemOperationHash));
      const missingSummaries = [];
      const identityCandidates = [];
      for (const summary of remoteSummary) {
        const queueId = String(summary?._queue_id || '').trim();
        if (!queueId) continue;
        const intentId = String(summary?.intentId || '').trim();
        const localById = localByQueueId.get(queueId);
        const localByIntent = intentId ? localByIntentId.get(intentId) : null;
        const localMatch = localById || localByIntent;
        if (localMatch) {
          const operationHash = String(summary?.operationHash || '').trim();
          const bodyHash = String(summary?.bodyHash || '').trim();
          if ((operationHash && operationHash === getQueueItemOperationHash(localMatch)) ||
              (bodyHash && bodyHash === getQueueItemBodyHash(localMatch))) continue;
          identityCandidates.push({ summary, localMatch });
          continue;
        }
        const operationHash = String(summary?.operationHash || '').trim();
        const bodyHash = String(summary?.bodyHash || '').trim();
        if ((operationHash && localOperationHashes.has(operationHash)) ||
            (bodyHash && localBodyHashes.has(bodyHash))) continue;
        missingSummaries.push(summary);
      }

      const missingIds = [...new Set([...missingSummaries, ...identityCandidates.map((entry) => entry.summary)]
        .map((item) => String(item?._queue_id || '').trim()).filter(Boolean))];
      totalMissing += missingIds.length;
      const summariesById = new Map([...missingSummaries, ...identityCandidates.map((entry) => entry.summary)]
        .map((item) => [String(item._queue_id), item]));
      const expectedHashesById = new Map(
        [...summariesById.entries()].map(([id, summary]) => [id, String(summary.bodyHash || '').trim()])
      );
      let peerIdentityConflicts = 0;
      /** @param {unknown} item @param {string} reason */
      const recordIdentityConflict = (item, reason) => {
        quarantineMeshIdentityConflict(item, peer.nodeId || peerId, reason);
        peerIdentityConflicts += 1;
        totalIdentityConflicts += 1;
        if (identityConflictSamples.length < 8) {
          const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
          identityConflictSamples.push({ peer_id: peer.nodeId || peerId, queue_id: itemFields?._queue_id || null, operation: itemFields?.table || null });
        }
      };

      if (missingIds.length === 0) {
        repairPeers.push({
          nodeId: peer.nodeId || peerId,
          address: peer.address,
          remoteQueueSize: remoteSummary.length,
          missingCount: 0,
          importedCount: 0,
          identityConflictCount: 0,
          lastError: ''
        });
        continue;
      }

      const requestedIds = new Set(missingIds);
      /** Items are appended only after validateSyncQueueItem accepts the incoming row. */
      /** @type {MeshQueueItemExpectedView[]} */
      const newValidItems = [];
      let importedFromPeer = 0;
      const batchSize = 30;

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
          console.warn('[MeshMerge] Peer ' + peerId + ' returned invalid items list for batch request.');
          continue;
        }

        for (const item of remoteItems) {
          const summary = summariesById.get(String(item?._queue_id || ''));
          if (!requestedIds.has(item?._queue_id) || !summary) {
            recordIdentityConflict(item, 'Peer returned an item that was not requested in this signed batch');
            continue;
          }
          const validation = validateSyncQueueItem(item);
          if (!validation.isValid) {
            quarantineInvalidItem(item, validation.reason);
            if (item.table === 'create_multi_room_booking') {
              appendHealthFault({
                type: 'mesh_peer_protocol_incompatible',
                scope: String(meshState.lodgeId || state.lodgeId || 'unknown'),
                severity: 'warn',
                message: 'A nearby device has a multi-room booking that this version cannot safely import. Keep the source device online and ask a manager to update or contact support; do not recreate the group.',
                context: { queue_id: item._queue_id || null, peer_id: String(peer.nodeId || peerId) }
              });
            }
            continue;
          }

          // A signed peer is authenticated, but it is not authority to move
          // device-bound credentials or drawer custody to this machine.
          if (!isMeshShareableQueueItem(item)) {
            quarantineInvalidItem({ _queue_id: item._queue_id, type: item.type, table: item.table }, 'Operation is restricted to its originating device');
            continue;
          }

          const bodyHash = getQueueItemBodyHash(item);
          const expectedHash = expectedHashesById.get(item._queue_id);
          if ((expectedHash && expectedHash !== bodyHash) ||
              (summary.operation && summary.operation !== item.table) ||
              (summary.type && summary.type !== item.type) ||
              (summary.intentId && summary.intentId !== getQueueItemIntentId(item)) ||
              (summary.operationHash && summary.operationHash !== getQueueItemOperationHash(item))) {
            recordIdentityConflict(item, 'Fetched operation did not match the signed queue summary');
            continue;
          }

          const operationHash = getQueueItemOperationHash(item);
          const currentLocalQueue = readSyncQueue();
          const sameQueueId = currentLocalQueue.find((localItem) => localItem._queue_id === item._queue_id);
          const intentId = getQueueItemIntentId(item);
          const sameIntent = intentId ? currentLocalQueue.find((localItem) => getQueueItemIntentId(localItem) === intentId) : null;
          const duplicateOperation = currentLocalQueue.some((localItem) => getQueueItemOperationHash(localItem) === operationHash);
          const identityMatch = sameQueueId || sameIntent;
          if (identityMatch) {
            if (getQueueItemOperationHash(identityMatch) === operationHash) continue;
            recordIdentityConflict(item, 'Queue ID or idempotency key already exists locally with different operation contents');
            continue;
          }
          if (duplicateOperation) continue;

          newValidItems.push(/** @type {MeshQueueItemExpectedView} */ ({
            ...item,
            _mesh_imported: true,
            _mesh_source_node_id: peer.nodeId || peerId,
            _mesh_imported_at: new Date().toISOString(),
            _mesh_body_hash: bodyHash
          }));
        }
      }

      if (newValidItems.length > 0) {
        const latestLocalQueue = readSyncQueue();
        /** Values from local reads and already-validated peer items have different record views; hashes accept either as unknown. */
        /** @type {Map<string, unknown>} */
        const seenIds = new Map(latestLocalQueue.map((item) => /** @type {[string, (typeof latestLocalQueue)[number]]} */ ([String(item?._queue_id || ''), item])));
        /** @type {Map<string, unknown>} */
        const seenIntents = new Map(latestLocalQueue.map((item) => /** @type {[string, (typeof latestLocalQueue)[number]]} */ ([getQueueItemIntentId(item), item])).filter(([key]) => key));
        const seenOperations = new Set(latestLocalQueue.map(getQueueItemOperationHash));
        const deduplicatedNewItems = [];
        for (const item of newValidItems) {
          const intentId = getQueueItemIntentId(item);
          const existing = seenIds.get(String(item._queue_id)) || (intentId ? seenIntents.get(intentId) : null);
          const operationHash = getQueueItemOperationHash(item);
          if (existing) {
            if (getQueueItemOperationHash(existing) !== operationHash) {
              recordIdentityConflict(item, 'Local queue changed during mesh merge and now binds this identity to different contents');
            }
            continue;
          }
          if (seenOperations.has(operationHash)) continue;
          deduplicatedNewItems.push(item);
        seenIds.set(String(item._queue_id), item);
        if (intentId) seenIntents.set(intentId, item);
          seenOperations.add(operationHash);
        }

        if (deduplicatedNewItems.length > 0) {
          const mergedQueueWithImports = [...latestLocalQueue, ...deduplicatedNewItems];
          writeSyncQueue(mergedQueueWithImports);
          applyImportedPosInventoryEffects(deduplicatedNewItems);
          applyImportedTabCacheEffects(deduplicatedNewItems);
          applyImportedShiftCacheEffects(deduplicatedNewItems);
          applyImportedMenuCacheEffects(deduplicatedNewItems);
          applyImportedModifierPromotionEffects(deduplicatedNewItems);
          applyImportedStockReceiptEffects(deduplicatedNewItems);
          applyImportedDrawerOpenEffects(deduplicatedNewItems);
          applyImportedProductPackEffects(deduplicatedNewItems);
          applyImportedChecklistEffects(deduplicatedNewItems);
          applyImportedBookingCacheEffects(deduplicatedNewItems);
          applyImportedOperationalCacheEffects(deduplicatedNewItems);
          for (const importedItem of deduplicatedNewItems) {
            appendOperationJournalEntry('mesh_imported', importedItem, {
              imported_from_mesh: true,
              source_node_id: peer.nodeId || peerId,
              message: 'Operation imported from a nearby Tsa Bonno device over local mesh.'
            });
          }
          meshState.lastQueueMergeAt = new Date();
          importedFromPeer = deduplicatedNewItems.length;
          totalImported += importedFromPeer;
          hasMergedNewItems = true;
          console.log('[MeshMerge] Successfully imported ' + importedFromPeer + ' operations from Peer ' + peerId + '.');
        }
      }
      repairPeers.push({
        nodeId: peer.nodeId || peerId,
        address: peer.address,
        remoteQueueSize: remoteSummary.length,
        missingCount: missingIds.length,
        importedCount: importedFromPeer,
        identityConflictCount: peerIdentityConflicts,
        lastError: ''
      });
    } catch (err) {
      const errorView = /** @type {MeshErrorExpectedDataView} */ (err);
      repairPeers.push({
        nodeId: peer.nodeId || peerId,
        address: peer.address,
        remoteQueueSize: null,
        missingCount: 0,
        importedCount: 0,
        lastError: errorView.message
      });
      console.warn(`[MeshMerge] Queue sync iteration failed for Peer ${peerId}:`, errorView.message);
    }
  }

  // Visible-only team state per peer (who is in shift, drawer cash
  // movements/counts/periods, cash-up submissions). Sanitized at the source,
  // validated again here, additive-only, and never replayed.
  const teamPeers = [];
  for (const [peerId, peer] of meshState.peers.entries()) {
    try {
      const snapshot = await sendSignedMeshRequest(peer.address, peer.httpPort, 'GET', '/mesh/state/team');
      const { applyTeamStateSnapshot } = await import('./meshStateSync.js');
      const outcome = applyTeamStateSnapshot(peer.nodeId || peerId, snapshot);
      teamPeers.push({
        nodeId: peer.nodeId || peerId,
        address: peer.address,
        added: outcome.added || {},
        error: outcome.applied === false ? (outcome.reason || 'refused') : ''
      });
    } catch (err) {
      const errorView = /** @type {MeshErrorExpectedDataView} */ (err);
      teamPeers.push({ nodeId: peer.nodeId || peerId, address: peer.address, added: {}, error: errorView.message });
    }
  }
  meshStateWithTeamSync.lastTeamSync = {
    at: new Date().toISOString(),
    peerCount: meshState.peers.size,
    perPeer: teamPeers.slice(-12)
  };

  meshState.lastQueueRepair = {
    at: new Date().toISOString(),
    peerCount: meshState.peers.size,
    importedCount: totalImported,
    missingCount: totalMissing,
    conflictCount: totalIdentityConflicts,
    conflictSamples: identityConflictSamples,
    perPeer: repairPeers.slice(-12)
  };

  // 3. Trigger conflict detection and notify UI if any new operations were merged
  if (hasMergedNewItems) {
    try {
      await detectConflicts();
    } catch (conflictErr) {
      console.error('[MeshMerge] Error triggering conflict detection post-merge:', conflictErr);
    }
  }
  if (hasMergedNewItems || totalIdentityConflicts > 0) broadcastSyncStatus();
}
