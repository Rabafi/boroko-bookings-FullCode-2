import { randomUUID } from 'crypto';
import { state } from '../state.js';
import {
  queueOperation,
  readCache,
  refreshCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

async function _getAllCustomers() {
  if (state.isOnline) {
    const { data } = await state.supabase.from('customers').select('id, name, email, phone, id_number, nationality, created_at, updated_at, is_blacklisted, blacklist_reason, lodge_id').eq('lodge_id', state.lodgeId).order('name').limit(500);
    if (data) writeCache('customers', data);
    return data || [];
  }
  return readCache('customers');
}

export function getAllCustomers() {
  return dedupePromise('getAllCustomers', _getAllCustomers);
}

export async function createCustomer(data) {
  const id = randomUUID();
  const customer = {
    id,
    name: data.name,
    email: data.email || '',
    phone: data.phone || '',
    id_number: data.id_number || '',
    nationality: data.nationality || '',
    lodge_id: state.lodgeId
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_customer', { payload: customer });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create customer');
    await refreshCache('customers');
    return result?.id;
  } else {
    const cached = readCache('customers');
    const newCustomer = { ...customer, _pending_sync: true, created_at: new Date().toISOString() };
    cached.push(newCustomer);
    writeCache('customers', cached);
    queueOperation('rpc', 'create_customer', {
      payload: {
        ...customer,
        created_at: newCustomer.created_at
      }
    }, null, { _queue_id: `customer-${id}` });
    return id;
  }
}

export async function updateCustomerBlacklist(id, is_blacklisted, reason) {
  const update = { is_blacklisted: !!is_blacklisted, blacklist_reason: reason || '' };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_customer_blacklist', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_is_blacklisted: !!is_blacklisted,
      p_reason: reason || ''
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update customer blacklist');
    await refreshCache('customers');
  } else {
    const cached = readCache('customers');
    const idx = cached.findIndex((c) => c.id === id);
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('customers', cached);
    queueOperation('rpc', 'update_customer_blacklist', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_is_blacklisted: !!is_blacklisted,
      p_reason: reason || ''
    });
  }
}

export async function getCustomerBookings(customerId) {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('bookings').
    select('*, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    eq('customer_id', customerId).
    order('check_in', { ascending: false }).
    limit(10);
    return (data || []).map((b) => ({
      ...b,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type
    }));
  }
  const rooms = readCache('rooms');
  return readCache('bookings').
  filter((b) => b.customer_id === customerId).
  map((b) => {
    const room = rooms.find((r) => r.id === b.room_id);
    return { ...b, room_number: room?.room_number, room_type: room?.room_type };
  }).
  sort((a, b) => new Date(b.check_in) - new Date(a.check_in)).
  slice(0, 10);
}

export async function updateCustomer(id, data) {
  const update = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    id_number: data.id_number,
    nationality: data.nationality
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_customer', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update customer');
    await refreshCache('customers');
  } else {
    const cached = readCache('customers');
    const idx = cached.findIndex((c) => c.id === id);
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('customers', cached);
    queueOperation('rpc', 'update_customer', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
  }
}

export async function updateCustomerIdPhoto(id, photo) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_customer_id_photo', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_photo: photo
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update customer ID photo');
    await refreshCache('customers');
    return { success: true };
  }
  // Offline: update cache
  const cached = readCache('customers');
  const idx = cached.findIndex((c) => c.id === id);
  if (idx >= 0) cached[idx] = { ...cached[idx], id_photo: photo };
  writeCache('customers', cached);
  queueOperation('rpc', 'update_customer_id_photo', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_photo: photo
  });
  return { success: true };
}

export async function getCustomerById(id) {
  if (!id) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('customers').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return readCache('customers').find((customer) => customer.id === id) || null;
}
