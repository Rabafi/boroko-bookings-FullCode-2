import { state } from '../state.js'
import { readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js'

// ─── MAINTENANCE TICKETS ──────────────────────────────────────────────────────

function normalizeMaintenanceTicketRow(ticket = {}) {
  if (!ticket || typeof ticket !== 'object') return ticket;
  return {
    ...ticket,
    title: ticket.title || ticket.issue || '',
    description: ticket.description || ticket.notes || '',
    room_number: ticket.rooms?.room_number,
    room_type: ticket.rooms?.room_type,
    labour_cost: Number(ticket.labour_cost || 0),
    parts_cost: Number(ticket.parts_cost || 0),
    total_cost: Number(ticket.total_cost || 0)
  };
}

async function _getMaintenanceTickets() {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('maintenance_tickets').
    select('id, room_id, title, issue, description, status, priority, reported_date, labour_cost, parts_cost, total_cost, vendor_name, cost_notes, completed_at, created_at, updated_at, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }).
    limit(200);
    const rows = (data || []).map(normalizeMaintenanceTicketRow);
    writeCache('maintenance', data || [], { source: 'remote' });
    return rows;
  }
  return readCache('maintenance').map(normalizeMaintenanceTicketRow);
}

export function getMaintenanceTickets() {
  return dedupePromise('getMaintenanceTickets', _getMaintenanceTickets);
}

export async function getMaintenanceTicketById(id) {
  if (!id || !state.isOnline) return null;
  const { data, error } = await state.supabase.
  from('maintenance_tickets').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function createMaintenanceTicket(data) {
  const ticket = {
    lodge_id: state.lodgeId,
    room_id: data.room_id || null,
    title: data.title || data.issue || '',
    issue: data.issue || data.title || '',
    description: data.description || '',
    status: 'open',
    priority: data.priority || 'medium',
    reported_date: data.reported_date || new Date().toISOString().slice(0, 10),
    labour_cost: Number(data.labour_cost || 0),
    parts_cost: Number(data.parts_cost || 0),
    total_cost: Number(data.total_cost || Number(data.labour_cost || 0) + Number(data.parts_cost || 0)),
    vendor_name: data.vendor_name || '',
    cost_notes: data.cost_notes || ''
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_maintenance_ticket', { payload: ticket });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create maintenance ticket');
    // If a room is selected, mark it as maintenance
    if (data.room_id) {
      const { data: roomResult, error: roomError } = await state.supabase.rpc('set_room_status', {
        p_id: data.room_id,
        p_lodge_id: state.lodgeId,
        p_status: 'maintenance'
      });
      if (roomError) throw new Error(roomError.message);
      if (!roomResult?.success) throw new Error(roomResult?.error || 'Could not update room status');
      await refreshCache('rooms');
    }
    await refreshCache('maintenance');
    return { success: true, id: result?.id };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function updateMaintenanceTicket(id, data) {
  const update = {
    title: data.title,
    issue: data.issue || data.title,
    description: data.description,
    notes: data.notes,
    priority: data.priority,
    status: data.status,
    labour_cost: data.labour_cost,
    parts_cost: data.parts_cost,
    total_cost: data.total_cost,
    vendor_name: data.vendor_name,
    cost_notes: data.cost_notes
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_maintenance_ticket', {
      p_id: String(id),
      p_lodge_id: String(state.lodgeId),
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update maintenance ticket');
    await refreshCache('maintenance');
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function resolveMaintenanceTicket(id, roomId) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('resolve_maintenance_ticket', {
      p_id: String(id),
      p_lodge_id: String(state.lodgeId)
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not resolve maintenance ticket');
    // Restore room status to available if no other open tickets
    if (roomId) {
      const { data: openTickets } = await state.supabase.
      from('maintenance_tickets').
      select('id').
      eq('lodge_id', state.lodgeId).
      eq('room_id', roomId).
      neq('status', 'resolved').
      neq('id', id);
      if (!openTickets || openTickets.length === 0) {
        const { data: roomResult, error: roomError } = await state.supabase.rpc('set_room_status', {
          p_id: roomId,
          p_lodge_id: state.lodgeId,
          p_status: 'available'
        });
        if (roomError) throw new Error(roomError.message);
        if (!roomResult?.success) throw new Error(roomResult?.error || 'Could not update room status');
      }
      await refreshCache('rooms');
    }
    await refreshCache('maintenance');
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}


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
    total_cost: Number(row.total_cost || 0)
  })).
  sort((a, b) => String(b.reported_date || '').localeCompare(String(a.reported_date || '')));

  if (!startDate || !endDate || !state.lodgeId || !state.isOnline) return cachedRows;

  try {
    const { data, error } = await state.supabase.
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
      total_cost: Number(row.total_cost || 0)
    })) :
    [];
    return liveRows.length > 0 ? liveRows : cachedRows;
  } catch {
    return cachedRows;
  }
}
