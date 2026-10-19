// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { assertCreationWithinUsageLimit } from './usage.js';
import {
  logActivity,
  queueOperation,
  readCache,
  refreshCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

/** @typedef {Record<string, unknown>} RoomPropertyView */

/** @param {unknown} rows @param {string} source @param {boolean} complete @returns {RoomPropertyView[]} */
function withReadMetadata(rows, source, complete) {
  const result = Array.isArray(rows) ? rows : [];
  Object.defineProperties(result, {
    _source: { value: source, enumerable: true, configurable: true },
    _complete: { value: complete === true, enumerable: true, configurable: true }
  });
  return result;
}

/** @returns {Promise<RoomPropertyView[]>} */
async function _getAllRooms() {
  if (!state.isOnline) {
    return withReadMetadata(readCache('rooms'), 'offline-cache', false);
  }

  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
    from('rooms').
    select('id, room_number, room_type, room_type_id, floor_section_id, rate_per_night, max_occupancy, status, amenities, description, photo, photos, lodge_id, created_at, updated_at, housekeeping_status, housekeeping_notes, accommodation_kind, capacity_adults, capacity_children, max_tents, max_vehicles, is_powered, site_surface, shared_facilities, rate_mode, rate_per_person, rate_per_tent, rate_per_vehicle').
    eq('lodge_id', state.lodgeId).
    order('room_number').
    limit(200);
    if (error) throw error;
    const cached = /** @type {RoomPropertyView[]} */ (readCache('rooms'));
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getAllRooms received empty live result; using cached rooms instead');
      return withReadMetadata(cached, 'cache', false);
    }
    writeCache('rooms', data || []);
    return withReadMetadata(data || [], 'server', true);
  } catch (error) {
    const cached = /** @type {RoomPropertyView[]} */ (readCache('rooms'));
    if (cached.length > 0) {
      const errorView = /** @type {Record<string, unknown> | null | undefined} */ (error)
      console.warn('getAllRooms falling back to cache:', errorView?.message || error);
      return withReadMetadata(cached, 'cache', false);
    }
    if (!state.isOnline) return withReadMetadata([], 'offline-cache', false);
    const errorView = /** @type {Record<string, unknown> | null | undefined} */ (error)
    // Error() applies ToString at runtime; preserve that coercion for arbitrary caught messages.
    throw new Error(/** @type {string} */ (errorView?.message || 'Failed to load rooms'));
  }
}

/** @returns {Promise<RoomPropertyView[]>} */
export function getAllRooms() {
  return /** @type {Promise<RoomPropertyView[]>} */ (dedupePromise('getAllRooms', _getAllRooms));
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function getRoomById(id) {
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
    from('rooms').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return /** @type {RoomPropertyView[]} */ (readCache('rooms')).find((r) => r.id === id) || null;
  }
}

/** @param {unknown} input @returns {Promise<unknown>} */
export async function createRoom(input) {
  // This property view preserves existing reads of untrusted IPC values; it adds no validation.
  const data = /** @type {RoomPropertyView} */ (input)
  await assertCreationWithinUsageLimit('room', { forceRemoteRefresh: state.isOnline });
  const id = randomUUID();
  const maintenanceTicketId = data.status === 'maintenance' ? randomUUID() : null;
  const room = {
    id,
    room_number: data.room_number,
    room_type: data.room_type,
    room_type_id: data.room_type_id || null,
    floor_section_id: data.floor_section_id || null,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy || data.capacity_adults || 2,
    status: data.status || 'available',
    description: data.description || '',
    photos: Array.isArray(data.photos) ? data.photos : data.photo ? [data.photo] : [],
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    lodge_id: state.lodgeId,
    maintenance_ticket_id: maintenanceTicketId,
    maintenance_issue: data.maintenance_issue || '',
    maintenance_description: data.maintenance_description || '',
    maintenance_priority: data.maintenance_priority || 'medium',
    accommodation_kind: data.accommodation_kind || 'room',
    capacity_adults: data.capacity_adults || data.max_occupancy || 2,
    capacity_children: data.capacity_children ?? 0,
    max_tents: data.max_tents ?? null,
    max_vehicles: data.max_vehicles ?? null,
    is_powered: data.is_powered === true,
    site_surface: data.site_surface || null,
    shared_facilities: data.shared_facilities === true,
    rate_mode: data.rate_mode || 'site',
    rate_per_person: data.rate_per_person ?? 0,
    rate_per_tent: data.rate_per_tent ?? 0,
    rate_per_vehicle: data.rate_per_vehicle ?? 0
  };

  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_room', { payload: room });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create room');
    await Promise.all([refreshCache('rooms'), refreshCache('maintenance')]);
    return result?.id;
  } else {
    const cached = /** @type {RoomPropertyView[]} */ (readCache('rooms'));
    const newRoom = { ...room, _pending_sync: true, created_at: new Date().toISOString() };
    cached.push(newRoom);
    writeCache('rooms', cached);
    if (maintenanceTicketId) {
      writeCache('maintenance', [{
        id: maintenanceTicketId,
        lodge_id: state.lodgeId,
        room_id: id,
        room_number: room.room_number,
        room_type: room.room_type,
        title: room.maintenance_issue || 'Room created under maintenance',
        issue: room.maintenance_issue || 'Room created under maintenance',
        description: room.maintenance_description || '',
        priority: room.maintenance_priority,
        status: 'open',
        reported_date: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        _pending_sync: true
      }, .../** @type {RoomPropertyView[]} */ (readCache('maintenance'))]);
    }
    // P2-15: assign _queue_id so any offline update to this room can declare _depends_on
    queueOperation('rpc', 'create_room', { payload: room }, null, { _queue_id: `room-${id}` });
    return id;
  }
}

/** @param {unknown} id @param {unknown} input */
export async function updateRoom(id, input) {
  // This property view preserves existing reads of untrusted IPC values; it adds no validation.
  const data = /** @type {RoomPropertyView} */ (input)
  const update = {
    room_number: data.room_number,
    room_type: data.room_type,
    room_type_id: data.room_type_id || null,
    floor_section_id: data.floor_section_id || null,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy,
    status: data.status,
    description: data.description,
    photos: Array.isArray(data.photos) ? data.photos : data.photo ? [data.photo] : [],
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    maintenance_ticket_id: data.status === 'maintenance' ? randomUUID() : null,
    maintenance_issue: data.maintenance_issue || '',
    maintenance_description: data.maintenance_description || '',
    maintenance_priority: data.maintenance_priority || 'medium',
    accommodation_kind: data.accommodation_kind || 'room',
    capacity_adults: data.capacity_adults || data.max_occupancy || 2,
    capacity_children: data.capacity_children ?? 0,
    max_tents: data.max_tents ?? null,
    max_vehicles: data.max_vehicles ?? null,
    is_powered: data.is_powered === true,
    site_surface: data.site_surface || null,
    shared_facilities: data.shared_facilities === true,
    rate_mode: data.rate_mode || 'site',
    rate_per_person: data.rate_per_person ?? 0,
    rate_per_tent: data.rate_per_tent ?? 0,
    rate_per_vehicle: data.rate_per_vehicle ?? 0
  };

  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_room', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update room');
    await refreshCache('rooms');
  } else {
    const cached = /** @type {RoomPropertyView[]} */ (readCache('rooms'));
    const idx = cached.findIndex((r) => r.id === id);
    const openMaintenance = /** @type {RoomPropertyView[]} */ (readCache('maintenance')).filter((ticket) =>
      String(ticket.room_id) === String(id) && ticket.status !== 'resolved'
    );
    if (data.status !== 'maintenance' && openMaintenance.length > 0) {
      throw new Error('Resolve the open maintenance ticket before changing this room status.');
    }
    // P2-15: if the room itself hasn't synced yet, update must wait for creation to land first
    const roomPendingSync = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('rooms', cached);
    if (data.status === 'maintenance' && openMaintenance.length === 0) {
      writeCache('maintenance', [{
        id: update.maintenance_ticket_id,
        lodge_id: state.lodgeId,
        room_id: id,
        room_number: cached[idx]?.room_number || null,
        room_type: cached[idx]?.room_type || null,
        title: update.maintenance_issue || 'Room marked under maintenance',
        issue: update.maintenance_issue || 'Room marked under maintenance',
        description: update.maintenance_description || '',
        priority: update.maintenance_priority,
        status: 'open',
        reported_date: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        _pending_sync: true
      }, .../** @type {RoomPropertyView[]} */ (readCache('maintenance'))]);
    }
    queueOperation('rpc', 'update_room', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {});
  }
}

/** @param {unknown} id @param {unknown} status @param {unknown} notes */
export async function updateRoomHousekeeping(id, status, notes) {
  const update = {
    housekeeping_status: status || 'clean',
    housekeeping_notes: notes || ''
  };
  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_room_housekeeping', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status || 'clean',
      p_notes: notes || ''
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update housekeeping');
    await refreshCache('rooms');
    const room = /** @type {RoomPropertyView[]} */ (readCache('rooms')).find((r) => r.id === id);
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`);
  } else {
    const cached = /** @type {RoomPropertyView[]} */ (readCache('rooms'));
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

/** @param {unknown} id */
export async function deleteRoom(id) {
  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('delete_room', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete room');
    await refreshCache('rooms');
  } else {
    const cached = /** @type {RoomPropertyView[]} */ (readCache('rooms'));
    const roomPendingSync = cached.some((r) => r.id === id && r?._pending_sync);
    writeCache('rooms', cached.filter((r) => r.id !== id));
    queueOperation('rpc', 'delete_room', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {});
  }
}
