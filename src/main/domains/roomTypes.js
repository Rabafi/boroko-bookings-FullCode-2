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

function isMissingRoomTypesSchema(error) {
  const message = String(error?.message || error || '');
  return /schema cache|Could not find the table|room_types|create_room_type|update_room_type|delete_room_type/i.test(message);
}

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
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getAllRoomTypes received empty live result; using cached room types instead');
      return cached;
    }
    writeCache('room-types', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('room-types');
    if (cached.length > 0) {
      console.warn('getAllRoomTypes falling back to cache:', error?.message || error);
      return cached;
    }
    if (isMissingRoomTypesSchema(error)) {
      console.warn('getAllRoomTypes schema not deployed yet; returning empty local list:', error?.message || error);
      return [];
    }
    if (!state.isOnline) return [];
    throw new Error(error?.message || 'Failed to load room types');
  }
}

export function getAllRoomTypes() {
  return dedupePromise('getAllRoomTypes', _getAllRoomTypes);
}

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
    return readCache('room-types').find((rt) => rt.id === id) || null;
  }
}

export async function createRoomType(data) {
  const id = randomUUID();
  const roomType = {
    id,
    name: data.name,
    description: data.description || '',
    rate_per_night: Number(data.rate_per_night) || 0,
    base_rate: Number(data.base_rate) || Number(data.rate_per_night) || 0,
    weekend_rate: Number(data.weekend_rate) || 0,
    peak_rate: Number(data.peak_rate) || 0,
    max_occupancy: Number(data.max_occupancy) || 2,
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    lodge_id: state.lodgeId,
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_room_type', { payload: roomType });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create room type');
    await refreshCache('room-types');
    logActivity('room_type_created', `Room type created · ${roomType.name}`);
    return result?.id || id;
  } else {
    const cached = readCache('room-types');
    const newRoomType = { ...roomType, _pending_sync: true, created_at: new Date().toISOString() };
    cached.push(newRoomType);
    writeCache('room-types', cached);
    queueOperation('rpc', 'create_room_type', { payload: roomType }, null, { _queue_id: `room-type-${id}` });
    logActivity('room_type_created', `Room type created (offline) · ${roomType.name}`);
    return id;
  }
}

export async function updateRoomType(id, data) {
  const update = {
    name: data.name,
    description: data.description ?? '',
    rate_per_night: Number(data.rate_per_night) || 0,
    base_rate: Number(data.base_rate) || Number(data.rate_per_night) || 0,
    weekend_rate: Number(data.weekend_rate) || 0,
    peak_rate: Number(data.peak_rate) || 0,
    max_occupancy: Number(data.max_occupancy) || 2,
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_room_type', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update room type');
    await refreshCache('room-types');
    logActivity('room_type_updated', `Room type updated · ${update.name}`);
  } else {
    const cached = readCache('room-types');
    const idx = cached.findIndex((rt) => rt.id === id);
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update, _pending_sync: true };
    writeCache('room-types', cached);
    queueOperation('rpc', 'update_room_type', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update, p_expected_updated_at: null
    }, null, { _queue_id: `room-type-update-${id}` });
    logActivity('room_type_updated', `Room type updated (offline) · ${update.name}`);
  }
}

export async function deleteRoomType(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_room_type', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete room type');
    await refreshCache('room-types');
    logActivity('room_type_deleted', `Room type deleted`);
  } else {
    const cached = readCache('room-types');
    const deleted = cached.find((rt) => rt.id === id);
    writeCache('room-types', cached.filter((rt) => rt.id !== id));
    queueOperation('rpc', 'delete_room_type', {
      p_id: id, p_lodge_id: state.lodgeId
    }, null, { _queue_id: `room-type-delete-${id}` });
    logActivity('room_type_deleted', `Room type deleted (offline) · ${deleted?.name || id}`);
  }
}
