// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import {
  queueOperation,
  readCache,
  refreshCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

/** @typedef {Record<string, unknown>} CustomerPropertyView */
/** @typedef {CustomerPropertyView[]} CustomerRowsView */

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForCustomerQueries() {
  // Preserve the existing unguarded client access if auth/client initialization is absent.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @param {unknown} message @returns {Error} */
function errorWithUnknownMessage(message) {
  return Reflect.construct(Error, [message])
}

/** @param {unknown} value @returns {number} */
function dateTimestamp(value) {
  // Reflect.construct preserves Date's existing coercion and invalid-date behavior for cache values.
  return Number(Reflect.construct(Date, [value]))
}

/** @returns {Promise<unknown>} */
async function _getAllCustomers() {
  if (state.isOnline) {
    // Keep the unparameterized Supabase query result at its upstream SDK boundary.
    const { data } = await supabaseForCustomerQueries().from('customers').select('id, name, email, phone, id_number, nationality, created_at, updated_at, is_blacklisted, blacklist_reason, lodge_id').eq('lodge_id', state.lodgeId).order('name').limit(500);
    if (data) writeCache('customers', data);
    return data || [];
  }
  return readCache('customers');
}

export function getAllCustomers() {
  return dedupePromise('getAllCustomers', _getAllCustomers);
}

/** @param {unknown} data @returns {Promise<unknown>} */
export async function createCustomer(data) {
  const customerData = /** @type {CustomerPropertyView} */ (data)
  const id = randomUUID();
  const customer = {
    id,
    name: customerData.name,
    email: customerData.email || '',
    phone: customerData.phone || '',
    id_number: customerData.id_number || '',
    nationality: customerData.nationality || '',
    lodge_id: state.lodgeId
  };

  if (state.isOnline) {
    const { data: result, error } = await supabaseForCustomerQueries().rpc('create_customer', { payload: customer });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CustomerPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not create customer');
    await refreshCache('customers');
    return resultView?.id;
  } else {
    const cached = /** @type {unknown[]} */ (readCache('customers'));
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

/** @param {unknown} id @param {unknown} is_blacklisted @param {unknown} reason @returns {Promise<void>} */
export async function updateCustomerBlacklist(id, is_blacklisted, reason) {
  const update = { is_blacklisted: !!is_blacklisted, blacklist_reason: reason || '' };
  if (state.isOnline) {
    const { data: result, error } = await supabaseForCustomerQueries().rpc('update_customer_blacklist', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_is_blacklisted: !!is_blacklisted,
      p_reason: reason || ''
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CustomerPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not update customer blacklist');
    await refreshCache('customers');
  } else {
    const cached = /** @type {CustomerRowsView} */ (readCache('customers'));
    const idx = cached.findIndex((entry) => {
      const customer = /** @type {CustomerPropertyView} */ (entry)
      return customer.id === id
    });
    if (idx >= 0) cached[idx] = { .../** @type {CustomerPropertyView} */ (cached[idx]), ...update };
    writeCache('customers', cached);
    queueOperation('rpc', 'update_customer_blacklist', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_is_blacklisted: !!is_blacklisted,
      p_reason: reason || ''
    });
  }
}

/** @param {unknown} customerId @returns {Promise<unknown[]>} */
export async function getCustomerBookings(customerId) {
  if (state.isOnline) {
    const { data } = await supabaseForCustomerQueries().
    from('bookings').
    select('*, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    eq('customer_id', customerId).
    order('check_in', { ascending: false }).
    limit(10);
    // The SDK supplies unparameterized query rows as upstream any; no local row validator exists.
    return (data || []).map((b) => ({
      ...b,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type
    }));
  }
  const rooms = /** @type {CustomerRowsView} */ (readCache('rooms'));
  const bookings = /** @type {CustomerRowsView} */ (readCache('bookings'))
  return bookings.
  filter((entry) => {
    const booking = /** @type {CustomerPropertyView} */ (entry)
    return booking.customer_id === customerId
  }).
  map((entry) => {
    const b = /** @type {CustomerPropertyView} */ (entry)
    const room = rooms.find((roomEntry) => {
      const roomRow = /** @type {CustomerPropertyView} */ (roomEntry)
      return roomRow.id === b.room_id
    })
    const roomView = /** @type {CustomerPropertyView | null | undefined} */ (room)
    return { ...b, room_number: roomView?.room_number, room_type: roomView?.room_type };
  }).
  sort((a, b) => dateTimestamp(b.check_in) - dateTimestamp(a.check_in)).
  slice(0, 10);
}

/** @param {unknown} id @param {unknown} data @returns {Promise<void>} */
export async function updateCustomer(id, data) {
  const customerData = /** @type {CustomerPropertyView} */ (data)
  const update = {
    name: customerData.name,
    email: customerData.email,
    phone: customerData.phone,
    id_number: customerData.id_number,
    nationality: customerData.nationality
  };

  if (state.isOnline) {
    const { data: result, error } = await supabaseForCustomerQueries().rpc('update_customer', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CustomerPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not update customer');
    await refreshCache('customers');
  } else {
    const cached = /** @type {CustomerRowsView} */ (readCache('customers'));
    const idx = cached.findIndex((entry) => {
      const customer = /** @type {CustomerPropertyView} */ (entry)
      return customer.id === id
    });
    if (idx >= 0) cached[idx] = { .../** @type {CustomerPropertyView} */ (cached[idx]), ...update };
    writeCache('customers', cached);
    queueOperation('rpc', 'update_customer', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: null
    });
  }
}

/** @param {unknown} id @param {unknown} photo @returns {Promise<{success: true}>} */
export async function updateCustomerIdPhoto(id, photo) {
  if (state.isOnline) {
    const { data: result, error } = await supabaseForCustomerQueries().rpc('update_customer_id_photo', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_photo: photo
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CustomerPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not update customer ID photo');
    await refreshCache('customers');
    return { success: true };
  }
  // Offline: update cache
  const cached = /** @type {CustomerRowsView} */ (readCache('customers'));
  const idx = cached.findIndex((entry) => {
    const customer = /** @type {CustomerPropertyView} */ (entry)
    return customer.id === id
  });
  if (idx >= 0) cached[idx] = { .../** @type {CustomerPropertyView} */ (cached[idx]), id_photo: photo };
  writeCache('customers', cached);
  queueOperation('rpc', 'update_customer_id_photo', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_photo: photo
  });
  return { success: true };
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function getCustomerById(id) {
  if (!id) return null;
  if (state.isOnline) {
    const { data, error } = await supabaseForCustomerQueries().
    from('customers').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    single();
    if (error) throw errorWithUnknownMessage(error.message);
    return data || null;
  }
  const cached = /** @type {CustomerRowsView} */ (readCache('customers'))
  return cached.find((entry) => {
    const customer = /** @type {CustomerPropertyView} */ (entry)
    return customer.id === id
  }) || null;
}
