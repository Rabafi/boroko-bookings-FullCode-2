// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import {
  logActivity,
  queueOperation,
  readCache,
  refreshCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

const ROOM_TYPE_SELECT = 'id, name, description, rate_per_night, max_occupancy, amenities, base_rate, weekend_rate, peak_rate, active, created_at, updated_at, lodge_id';

/** @typedef {Record<string, unknown>} RoomTypePropertyView */
/** @typedef {Record<string, unknown> & {[index: number]: unknown, length: number, push: (...items: unknown[]) => number, find: (predicate: (entry: unknown) => unknown) => unknown, findIndex: (predicate: (entry: unknown) => unknown) => number, filter: (predicate: (entry: unknown) => unknown) => unknown[]}} RoomTypeCacheMethodView */

/** @param {unknown} error @returns {boolean} */
function isMissingRoomTypesSchema(error) {
  const errorView = /** @type {RoomTypePropertyView | null | undefined} */ (error)
  const message = String(errorView?.message || error || '');
  return /schema cache|Could not find the table|room_types|create_room_type|update_room_type|delete_room_type/i.test(message);
}

/** @returns {Promise<unknown>} */
async function _getAllRoomTypes() {
  if (!state.isOnline) {
    return readCache('room-types');
  }

  try {
    const { data, error } = await state.supabase
      .from('room_types')
      .select(ROOM_TYPE_SELECT)
      .eq('lodge_id', state.lodgeId)
      .order('name')
      .limit(100);
    if (error) throw error;
    const cached = readCache('room-types');
    const responseRows = /** @type {RoomTypePropertyView & {length: number}} */ (data || [])
    const cachedView = /** @type {RoomTypePropertyView & {length: number}} */ (cached)
    if (responseRows.length === 0 && cachedView.length > 0) {
      console.warn('getAllRoomTypes received empty live result; using cached room types instead');
      return cached;
    }
    writeCache('room-types', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('room-types');
    const cachedView = /** @type {RoomTypePropertyView & {length: number}} */ (cached)
    const errorView = /** @type {RoomTypePropertyView | null | undefined} */ (error)
    if (cachedView.length > 0) {
      console.warn('getAllRoomTypes falling back to cache:', errorView?.message || error);
      return cached;
    }
    if (isMissingRoomTypesSchema(error)) {
      console.warn('getAllRoomTypes schema not deployed yet; returning empty local list:', errorView?.message || error);
      return [];
    }
    if (!state.isOnline) return [];
    throw new Error(String(errorView?.message || 'Failed to load room types'));
  }
}

/** @returns {Promise<unknown>} */
export function getAllRoomTypes() {
  return dedupePromise('getAllRoomTypes', _getAllRoomTypes);
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function getRoomTypeById(id) {
  try {
    const { data, error } = await state.supabase
      .from('room_types')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', state.lodgeId)
      .single();
    if (error) throw error;
    return data || null;
  } catch {
    const cached = /** @type {RoomTypeCacheMethodView} */ (readCache('room-types'))
    return cached.find((rawRoomType) => {
      const roomType = /** @type {RoomTypePropertyView | null | undefined} */ (rawRoomType)
      return roomType?.id === id
    }) || null;
  }
}

/** @param {unknown} data @returns {Promise<unknown>} */
export async function createRoomType(data) {
  const fields = /** @type {RoomTypePropertyView} */ (data)
  const id = randomUUID();
  const roomType = {
    id,
    name: fields.name,
    description: fields.description || '',
    rate_per_night: Number(fields.rate_per_night) || 0,
    base_rate: Number(fields.base_rate) || Number(fields.rate_per_night) || 0,
    weekend_rate: Number(fields.weekend_rate) || 0,
    peak_rate: Number(fields.peak_rate) || 0,
    max_occupancy: Number(fields.max_occupancy) || 2,
    amenities: Array.isArray(fields.amenities) ? /** @type {unknown[]} */ (fields.amenities) : [],
    lodge_id: state.lodgeId,
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_room_type', { payload: roomType });
    if (error) throw new Error(error.message);
    const resultView = /** @type {RoomTypePropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw new Error(String(resultView?.error || 'Could not create room type'));
    await refreshCache('room-types');
    logActivity('room_type_created', `Room type created · ${roomType.name}`);
    return resultView?.id || id;
  } else {
    const cached = /** @type {RoomTypeCacheMethodView} */ (readCache('room-types'))
    const newRoomType = { ...roomType, _pending_sync: true, created_at: new Date().toISOString() };
    cached.push(newRoomType);
    writeCache('room-types', cached);
    queueOperation('rpc', 'create_room_type', { payload: roomType }, null, { _queue_id: `room-type-${id}` });
    logActivity('room_type_created', `Room type created (offline) · ${roomType.name}`);
    return id;
  }
}

/** @param {unknown} id @param {unknown} data @returns {Promise<unknown>} */
export async function updateRoomType(id, data) {
  const fields = /** @type {RoomTypePropertyView} */ (data)
  const update = {
    name: fields.name,
    description: fields.description ?? '',
    rate_per_night: Number(fields.rate_per_night) || 0,
    base_rate: Number(fields.base_rate) || Number(fields.rate_per_night) || 0,
    weekend_rate: Number(fields.weekend_rate) || 0,
    peak_rate: Number(fields.peak_rate) || 0,
    max_occupancy: Number(fields.max_occupancy) || 2,
    amenities: Array.isArray(fields.amenities) ? /** @type {unknown[]} */ (fields.amenities) : [],
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_room_type', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
    if (error) throw new Error(error.message);
    const resultView = /** @type {RoomTypePropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw new Error(String(resultView?.error || 'Could not update room type'));
    await refreshCache('room-types');
    logActivity('room_type_updated', `Room type updated · ${update.name}`);
  } else {
    const cached = /** @type {RoomTypeCacheMethodView} */ (readCache('room-types'))
    const idx = cached.findIndex((rawRoomType) => {
      const roomType = /** @type {RoomTypePropertyView | null | undefined} */ (rawRoomType)
      return roomType?.id === id
    });
    if (idx >= 0) cached[idx] = { .../** @type {RoomTypePropertyView} */ (cached[idx]), ...update, _pending_sync: true };
    writeCache('room-types', cached);
    queueOperation('rpc', 'update_room_type', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update, p_expected_updated_at: null
    }, null, { _queue_id: `room-type-update-${id}` });
    logActivity('room_type_updated', `Room type updated (offline) · ${update.name}`);
  }
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function deleteRoomType(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_room_type', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    const resultView = /** @type {RoomTypePropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw new Error(String(resultView?.error || 'Could not delete room type'));
    await refreshCache('room-types');
    logActivity('room_type_deleted', `Room type deleted`);
  } else {
    const cached = /** @type {RoomTypeCacheMethodView} */ (readCache('room-types'))
    const deleted = cached.find((rawRoomType) => {
      const roomType = /** @type {RoomTypePropertyView | null | undefined} */ (rawRoomType)
      return roomType?.id === id
    });
    writeCache('room-types', cached.filter((rawRoomType) => {
      const roomType = /** @type {RoomTypePropertyView | null | undefined} */ (rawRoomType)
      return roomType?.id !== id
    }));
    queueOperation('rpc', 'delete_room_type', {
      p_id: id, p_lodge_id: state.lodgeId
    }, null, { _queue_id: `room-type-delete-${id}` });
    const deletedView = /** @type {RoomTypePropertyView | null | undefined} */ (deleted)
    logActivity('room_type_deleted', `Room type deleted (offline) · ${deletedView?.name || id}`);
  }
}
