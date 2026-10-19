// @ts-check
import { state } from '../state.js';
import {
  logActivity,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

/** @typedef {Record<string, unknown>} RoomAttributePropertyView */

/** @param {unknown} error @returns {boolean} */
function isMissingSchema(error) {
  const errorView = /** @type {RoomAttributePropertyView | null | undefined} */ (error)
  const message = String(errorView?.message || error || '');
  return /schema cache|Could not find the table|room_attributes/i.test(message);
}

/** @param {...unknown} _args @returns {Promise<unknown>} */
async function _getAll(..._args) {
  if (!state.isOnline) return readCache('room-attributes');
  try {
    // Supabase's unparameterized RPC response exposes data as any; preserve it as unknown.
    const { data, error } = await state.supabase.rpc('get_room_attributes', { p_lodge_id: state.lodgeId });
    if (error) throw error;
    const cached = readCache('room-attributes');
    const responseRows = /** @type {RoomAttributePropertyView} */ (data || [])
    const cachedView = /** @type {RoomAttributePropertyView} */ (cached)
    if (responseRows.length === 0 && Number(cachedView.length) > 0) {
      return cached;
    }
    writeCache('room-attributes', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('room-attributes');
    const cachedView = /** @type {RoomAttributePropertyView} */ (cached)
    if (Number(cachedView.length) > 0) return cached;
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
async function _create(...args) {
  const payload = /** @type {RoomAttributePropertyView} */ (args[0])
  if (!state.isOnline) {
    // Fail closed: the legacy 'roomAttributes:create' queue type matched no
    // replay branch, so offline edits were deleted while reporting success.
    // Config RPCs carry no idempotency key, so queueing them risks duplicates.
    throw new Error('Room attributes need an internet connection. Reconnect and save again.');
  }
  // RPC payload/result remain unknown until a consumer applies its own contract.
  const { data, error } = await state.supabase.rpc('create_room_attribute', {
    p_lodge_id: state.lodgeId,
    p_room_type_id: payload.room_type_id || null,
    p_attribute_key: payload.attribute_key,
    p_attribute_type: payload.attribute_type || 'text',
    p_label: payload.label,
    p_options: payload.options || [],
    p_sort_order: payload.sort_order || 0
  });
  if (error) throw error;
  await logActivity('room-attribute-created', { attribute_key: payload.attribute_key });
  refreshCache('room-attributes');
  return data;
}

/** @param {...unknown} args @returns {Promise<unknown>} */
async function _update(...args) {
  const [id] = args
  const payload = /** @type {RoomAttributePropertyView} */ (args[1])
  if (!state.isOnline) {
    throw new Error('Room attributes need an internet connection. Reconnect and save again.');
  }
  const { data, error } = await state.supabase.rpc('update_room_attribute', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_room_type_id: payload.room_type_id ?? undefined,
    p_attribute_key: payload.attribute_key ?? undefined,
    p_attribute_type: payload.attribute_type ?? undefined,
    p_label: payload.label ?? undefined,
    p_options: payload.options ?? undefined,
    p_active: payload.active ?? undefined,
    p_sort_order: payload.sort_order ?? undefined
  });
  if (error) throw error;
  await logActivity('room-attribute-updated', { id, attribute_key: payload.attribute_key });
  refreshCache('room-attributes');
  return data;
}

/** @param {...unknown} args @returns {Promise<unknown>} */
async function _remove(...args) {
  const [id] = args
  if (!state.isOnline) {
    throw new Error('Room attributes need an internet connection. Reconnect and delete again.');
  }
  const { data, error } = await state.supabase.rpc('delete_room_attribute', { p_id: id, p_lodge_id: state.lodgeId });
  if (error) throw error;
  await logActivity('room-attribute-deleted', { id });
  refreshCache('room-attributes');
  return data;
}

/** @param {string} key */
function refreshCache(key) {
  const supabase = state.supabase;
  if (!supabase || !state.lodgeId) return;
  supabase.rpc('get_room_attributes', { p_lodge_id: state.lodgeId }).then(({ data }) => {
    /** @type {unknown} */ const response = data
    if (response) writeCache(key, response);
  }).catch(() => {});
}

/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getAllRoomAttributes = (...args) => dedupePromise('getAllRoomAttributes', () => _getAll(...args));
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const createRoomAttribute = (...args) => dedupePromise('createRoomAttribute', () => _create(...args));
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const updateRoomAttribute = (...args) => dedupePromise('updateRoomAttribute', () => _update(...args));
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const deleteRoomAttribute = (...args) => dedupePromise('deleteRoomAttribute', () => _remove(...args));
