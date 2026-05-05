import { randomUUID } from 'crypto';
import { state } from '../state.js';
import {
  assertCreationWithinUsageLimit,
  logActivity,
  queueOperation,
  readCache,
  refreshCache,
  writeCache
} from './infrastructure.js';

export async function getAllRooms() {
  try {
    const { data, error } = await state.supabase.
    from('rooms').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('room_number');
    if (error) throw error;
    const cached = readCache('rooms');
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getAllRooms received empty live result; using cached rooms instead');
      return cached;
    }
    writeCache('rooms', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('rooms');
    if (cached.length > 0) {
      console.warn('getAllRooms falling back to cache:', error?.message || error);
      return cached;
    }
    if (!state.isOnline) return [];
    throw new Error(error?.message || 'Failed to load rooms');
  }
}

export async function getRoomById(id) {
  try {
    const { data, error } = await state.supabase.
    from('rooms').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('rooms').find((r) => r.id === id) || null;
  }
}

export async function createRoom(data) {
  await assertCreationWithinUsageLimit('room', { forceRemoteRefresh: state.isOnline });
  const id = randomUUID();
  const room = {
    id,
    room_number: data.room_number,
    room_type: data.room_type,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy || 2,
    status: data.status || 'available',
    description: data.description || '',
    photos: Array.isArray(data.photos) ? data.photos : data.photo ? [data.photo] : [],
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    lodge_id: state.lodgeId
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_room', { payload: room });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create room');
    await refreshCache('rooms');
    return result?.id;
  } else {
    const cached = readCache('rooms');
    const newRoom = { ...room, _pending_sync: true, created_at: new Date().toISOString() };
    cached.push(newRoom);
    writeCache('rooms', cached);
    // P2-15: assign _queue_id so any offline update to this room can declare _depends_on
    queueOperation('rpc', 'create_room', { payload: room }, null, { _queue_id: `room-${id}` });
    return id;
  }
}

export async function updateRoom(id, data) {
  const update = {
    room_number: data.room_number,
    room_type: data.room_type,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy,
    status: data.status,
    description: data.description,
    photos: Array.isArray(data.photos) ? data.photos : data.photo ? [data.photo] : [],
    amenities: Array.isArray(data.amenities) ? data.amenities : []
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_room', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update room');
    await refreshCache('rooms');
  } else {
    const cached = readCache('rooms');
    const idx = cached.findIndex((r) => r.id === id);
    // P2-15: if the room itself hasn't synced yet, update must wait for creation to land first
    const roomPendingSync = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('rooms', cached);
    queueOperation('rpc', 'update_room', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {});
  }
}

export async function updateRoomHousekeeping(id, status, notes) {
  const update = {
    housekeeping_status: status || 'clean',
    housekeeping_notes: notes || ''
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_room_housekeeping', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status || 'clean',
      p_notes: notes || ''
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update housekeeping');
    await refreshCache('rooms');
    const room = readCache('rooms').find((r) => r.id === id);
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`);
  } else {
    const cached = readCache('rooms');
    const idx = cached.findIndex((r) => r.id === id);
    const room = cached[idx];
    const roomPendingSync = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('rooms', cached);
    queueOperation('rpc', 'update_room_housekeeping', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status || 'clean',
      p_notes: notes || ''
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {});
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`);
  }
}

export async function deleteRoom(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_room', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete room');
    await refreshCache('rooms');
  } else {
    const cached = readCache('rooms');
    const roomPendingSync = cached.some((r) => r.id === id && r?._pending_sync);
    writeCache('rooms', cached.filter((r) => r.id !== id));
    queueOperation('rpc', 'delete_room', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {});
  }
}
