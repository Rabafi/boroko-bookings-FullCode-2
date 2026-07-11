import { state } from '../state.js';
import {
  logActivity,
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

function isMissingSchema(error) {
  const message = String(error?.message || error || '');
  return /schema cache|Could not find the table|room_attributes/i.test(message);
}

async function _getAll() {
  if (!state.isOnline) return readCache('room-attributes');
  try {
    const { data, error } = await state.supabase.rpc('get_room_attributes', { p_lodge_id: state.lodgeId });
    if (error) throw error;
    const cached = readCache('room-attributes');
    if ((data || []).length === 0 && cached.length > 0) {
      return cached;
    }
    writeCache('room-attributes', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('room-attributes');
    if (cached.length > 0) return cached;
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

async function _create(payload) {
  if (!state.isOnline) {
    return queueOperation('roomAttributes:create', payload);
  }
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

async function _update(id, payload) {
  if (!state.isOnline) {
    return queueOperation('roomAttributes:update', { id, ...payload });
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

async function _remove(id) {
  if (!state.isOnline) {
    return queueOperation('roomAttributes:delete', { id });
  }
  const { data, error } = await state.supabase.rpc('delete_room_attribute', { p_id: id, p_lodge_id: state.lodgeId });
  if (error) throw error;
  await logActivity('room-attribute-deleted', { id });
  refreshCache('room-attributes');
  return data;
}

function refreshCache(key) {
  const supabase = state.supabase;
  if (!supabase || !state.lodgeId) return;
  supabase.rpc('get_room_attributes', { p_lodge_id: state.lodgeId }).then(({ data }) => {
    if (data) writeCache(key, data);
  }).catch(() => {});
}

export const getAllRoomAttributes = (...args) => dedupePromise('getAllRoomAttributes', () => _getAll(...args));
export const createRoomAttribute = (...args) => dedupePromise('createRoomAttribute', () => _create(...args));
export const updateRoomAttribute = (...args) => dedupePromise('updateRoomAttribute', () => _update(...args));
export const deleteRoomAttribute = (...args) => dedupePromise('deleteRoomAttribute', () => _remove(...args));
