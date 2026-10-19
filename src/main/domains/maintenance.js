// @ts-check
import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { queueOperation, readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js'

// ─── MAINTENANCE TICKETS ──────────────────────────────────────────────────────

const MAINTENANCE_TICKET_SELECT = 'id, room_id, title, issue, description, status, priority, reported_date, labour_cost, parts_cost, total_cost, vendor_name, cost_notes, completed_at, created_at, updated_at, rooms(room_number, room_type)';
const MAINTENANCE_TICKET_LEGACY_SELECT = 'id, room_id, title, description, status, priority, reported_date, labour_cost, parts_cost, total_cost, vendor_name, cost_notes, created_at, rooms(room_number, room_type)';

/** @param {unknown} rows @param {string} source @param {boolean} complete */
function withReadMetadata(rows, source, complete) {
  const result = /** @type {unknown[]} */ (Array.isArray(rows) ? rows : [])
  Object.defineProperties(result, {
    _source: { value: source, enumerable: true, configurable: true },
    _complete: { value: complete === true, enumerable: true, configurable: true }
  })
  return result
}

/** @param {unknown} error */
function isMaintenanceTicketSchemaCompatibilityError(error) {
  const errorView = /** @type {Record<string, unknown> | null | undefined} */ (error)
  return /column maintenance_tickets\.(issue|completed_at|updated_at) does not exist/i.test(String(errorView?.message || ''));
}

/** @param {unknown} ticket */
function normalizeMaintenanceTicketRow(ticket = {}) {
  if (!ticket || typeof ticket !== 'object') return ticket;
  // The existing object guard proves an object; this view adds no row validation.
  const ticketView = /** @type {Record<string, unknown>} */ (ticket)
  return {
    ...ticketView,
    title: ticketView.title || ticketView.issue || '',
    issue: ticketView.issue || ticketView.title || '',
    description: ticketView.description || ticketView.notes || '',
    completed_at: ticketView.completed_at || null,
    updated_at: ticketView.updated_at || ticketView.created_at || null,
    room_number: /** @type {Record<string, unknown> | null | undefined} */ (ticketView.rooms)?.room_number,
    room_type: /** @type {Record<string, unknown> | null | undefined} */ (ticketView.rooms)?.room_type,
    labour_cost: Number(ticketView.labour_cost || 0),
    parts_cost: Number(ticketView.parts_cost || 0),
    total_cost: Number(ticketView.total_cost || 0)
  };
}

async function fetchMaintenanceTickets() {
  const client = /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
  const primary = await client.
    from('maintenance_tickets').
    select(MAINTENANCE_TICKET_SELECT).
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }).
    limit(200);
  if (!primary.error || !isMaintenanceTicketSchemaCompatibilityError(primary.error)) {
    return primary;
  }
  return client.
    from('maintenance_tickets').
    select(MAINTENANCE_TICKET_LEGACY_SELECT).
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }).
    limit(200);
}

async function _getMaintenanceTickets() {
  if (state.isOnline) {
    const { data, error } = await fetchMaintenanceTickets();
    if (error) throw new Error(error.message);
    const rows = (data || []).map(normalizeMaintenanceTicketRow);
    writeCache('maintenance', rows, { source: 'remote' });
    return rows;
  }
  return readCache('maintenance').map(normalizeMaintenanceTicketRow);
}

export function getMaintenanceTickets() {
  return dedupePromise('getMaintenanceTickets', _getMaintenanceTickets);
}

/** @param {unknown} id */
export async function getMaintenanceTicketById(id) {
  if (!id) return null;
  if (!state.isOnline) return readCache('maintenance').map(normalizeMaintenanceTicketRow).find((ticket) => ticket?.id === id) || null;
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
  from('maintenance_tickets').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

/** @param {unknown} data */
export async function createMaintenanceTicket(data) {
  const input = /** @type {Record<string, unknown>} */ (data)
  const ticket = {
    lodge_id: state.lodgeId,
    room_id: input.room_id || null,
    title: input.title || input.issue || '',
    issue: input.issue || input.title || '',
    description: input.description || '',
    status: 'open',
    priority: input.priority || 'medium',
    reported_date: input.reported_date || new Date().toISOString().slice(0, 10),
    labour_cost: Number(input.labour_cost || 0),
    parts_cost: Number(input.parts_cost || 0),
    total_cost: Number(input.total_cost || Number(input.labour_cost || 0) + Number(input.parts_cost || 0)),
    vendor_name: input.vendor_name || '',
    cost_notes: input.cost_notes || ''
  };
  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_maintenance_ticket', { payload: ticket });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create maintenance ticket');
    await refreshCache('rooms');
    await refreshCache('maintenance');
    return { success: true, id: result?.id };
  }
  const id = randomUUID();
  const queuedTicket = {
    ...ticket,
    id,
    created_at: new Date().toISOString(),
    _pending_sync: true
  };
  writeCache('maintenance', [queuedTicket, ...readCache('maintenance')]);
  if (input.room_id) {
    const rooms = readCache('rooms');
    const roomIndex = rooms.findIndex((room) => String(room.id) === String(input.room_id));
    if (roomIndex >= 0) rooms[roomIndex] = { ...rooms[roomIndex], status: 'maintenance' };
    writeCache('rooms', rooms);
  }
  queueOperation('rpc', 'create_maintenance_ticket', { payload: queuedTicket }, null, {
    _queue_id: `maintenance-${id}`
  });
  return { success: true, id, queued: true };
}

/** @param {unknown} id @param {unknown} data */
export async function updateMaintenanceTicket(id, data) {
  const input = /** @type {Record<string, unknown>} */ (data)
  const update = {
    title: input.title,
    issue: input.issue || input.title,
    description: input.description,
    notes: input.notes,
    priority: input.priority,
    status: input.status,
    labour_cost: input.labour_cost,
    parts_cost: input.parts_cost,
    total_cost: input.total_cost,
    vendor_name: input.vendor_name,
    cost_notes: input.cost_notes
  };
  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_maintenance_ticket', {
      p_id: String(id),
      p_lodge_id: String(state.lodgeId),
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update maintenance ticket');
    await refreshCache('maintenance');
    return { success: true };
  }
  const cached = readCache('maintenance');
  const idx = cached.findIndex((ticket) => ticket?.id === id);
  if (idx < 0) return { success: false, error: 'Maintenance ticket not found in offline cache' };
  const existing = cached[idx];
  const dependsOn = existing?._pending_sync ? `maintenance-${id}` : null;
  const next = [...cached];
  next[idx] = {
    ...existing,
    ...update,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  };
  writeCache('maintenance', next);
  queueOperation('rpc', 'update_maintenance_ticket', {
    p_id: String(id),
    p_lodge_id: String(state.lodgeId),
    payload: update
  }, null, {
    _queue_id: `maintenance-update-${id}-${Date.now()}`,
    ...(dependsOn ? { _depends_on: dependsOn } : {})
  });
  return { success: true, offline: true, queued: true };
}

/** @param {unknown} id @param {unknown} roomId */
export async function resolveMaintenanceTicket(id, roomId) {
  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('resolve_maintenance_ticket', {
      p_id: String(id),
      p_lodge_id: String(state.lodgeId)
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not resolve maintenance ticket');
    if (roomId) await refreshCache('rooms');
    await refreshCache('maintenance');
    return { success: true };
  }
  const cached = readCache('maintenance');
  const idx = cached.findIndex((ticket) => ticket?.id === id);
  if (idx < 0) return { success: false, error: 'Maintenance ticket not found in offline cache' };
  const existing = cached[idx];
  const now = new Date().toISOString();
  const next = [...cached];
  next[idx] = {
    ...existing,
    status: 'resolved',
    completed_at: now,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: now
  };
  writeCache('maintenance', next);
  if (roomId) {
    const rooms = readCache('rooms');
    const roomIndex = rooms.findIndex((room) => String(room.id) === String(roomId));
    if (roomIndex >= 0) {
      rooms[roomIndex] = { ...rooms[roomIndex], status: 'available', _pending_sync: true };
      writeCache('rooms', rooms);
    }
  }
  queueOperation('rpc', 'resolve_maintenance_ticket', {
    p_id: String(id),
    p_lodge_id: String(state.lodgeId)
  }, null, {
    _queue_id: `maintenance-resolve-${id}-${Date.now()}`,
    ...(existing?._pending_sync ? { _depends_on: `maintenance-${id}` } : {})
  });
  return { success: true, offline: true, queued: true };
}


/** @param {unknown} startDate @param {unknown} endDate */
export async function getMaintenanceRowsForPeriod(startDate, endDate) {
  const cachedRows = readCache('maintenance').
  filter((row) => (!startDate || String(row.reported_date || '').slice(0, 10) >= startDate) && (!endDate || String(row.reported_date || '').slice(0, 10) <= endDate)).
  map((row) => ({
    id: row.id || row._queue_id || null,
    room_id: row.room_id || null,
    room_number: row.room_number || row.rooms?.room_number || null,
    room_type: row.room_type || row.rooms?.room_type || null,
    title: row.title || row.issue || '',
    description: row.description || row.notes || '',
    status: row.status || 'open',
    reported_date: row.reported_date || null,
    total_cost: row.total_cost === null || row.total_cost === undefined || row.total_cost === '' ? null : Number(row.total_cost)
  })).
  sort((a, b) => String(b.reported_date || '').localeCompare(String(a.reported_date || '')));

  if (!startDate || !endDate || !state.lodgeId || !state.isOnline) return withReadMetadata(cachedRows, state.isOnline ? 'cache' : 'offline-cache', false);

  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
    from('maintenance_tickets').
    select('*, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    gte('reported_date', startDate).
    lte('reported_date', endDate);
    if (error) throw error;
    const liveRows = Array.isArray(data) ?
    data.map((row) => ({
      id: row.id || row._queue_id || null,
      room_id: row.room_id || null,
      room_number: row.room_number || row.rooms?.room_number || null,
      room_type: row.room_type || row.rooms?.room_type || null,
      title: row.title || row.issue || '',
      description: row.description || row.notes || '',
      status: row.status || 'open',
      reported_date: row.reported_date || null,
      total_cost: row.total_cost === null || row.total_cost === undefined || row.total_cost === '' ? null : Number(row.total_cost)
    })) :
    [];
    return withReadMetadata(liveRows.length > 0 ? liveRows : cachedRows, liveRows.length > 0 ? 'server' : 'cache', liveRows.length > 0);
  } catch {
    return withReadMetadata(cachedRows, 'cache', false);
  }
}
