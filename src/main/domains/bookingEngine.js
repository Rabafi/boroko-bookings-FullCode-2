import { state } from '../state.js';
import { logActivity, dedupePromise } from './infrastructure.js';

async function _getBookingEngineRules() {
  if (!state.isOnline) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_booking_engine_rules', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    return data || [];
  } catch (err) {
    throw new Error(err?.message || 'Failed to load booking engine rules');
  }
}

export function getBookingEngineRules() {
  return dedupePromise('getBookingEngineRules', _getBookingEngineRules);
}

export async function createBookingEngineRule(data) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_booking_engine_rule', {
      p_lodge_id: state.lodgeId,
      p_name: data.name,
      p_rule_type: data.rule_type,
      p_conditions: data.conditions || {},
      p_actions: data.actions || {},
      p_priority: data.priority || 0,
      p_active: data.active !== false
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create booking engine rule');
    logActivity('booking_engine_rule_created', `Rule created · ${data.name}`);
    return result;
  }
  throw new Error('Cannot create booking engine rules offline');
}

export async function updateBookingEngineRule(id, data) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_booking_engine_rule', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_name: data.name || null,
      p_rule_type: data.rule_type || null,
      p_conditions: data.conditions || null,
      p_actions: data.actions || null,
      p_priority: data.priority ?? null,
      p_active: data.active ?? null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update booking engine rule');
    logActivity('booking_engine_rule_updated', `Rule ${id} updated`);
    return result;
  }
  throw new Error('Cannot update booking engine rules offline');
}

export async function deleteBookingEngineRule(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_booking_engine_rule', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete booking engine rule');
    logActivity('booking_engine_rule_deleted', `Rule ${id} deleted`);
    return result;
  }
  throw new Error('Cannot delete booking engine rules offline');
}

async function _getBookingUpsellsList() {
  if (!state.isOnline) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_booking_upsells_list', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    return data || [];
  } catch (err) {
    throw new Error(err?.message || 'Failed to load booking upsells');
  }
}

export function getBookingUpsellsList() {
  return dedupePromise('getBookingUpsellsList', _getBookingUpsellsList);
}

export async function createBookingUpsell(data) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_booking_upsell', {
      p_lodge_id: state.lodgeId,
      p_name: data.name,
      p_description: data.description || '',
      p_upsell_type: data.upsell_type || 'addon_service',
      p_price_adjustment: Number(data.price_adjustment) || 0,
      p_conditions: data.conditions || {},
      p_sort_order: data.sort_order || 0,
      p_active: data.active !== false
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create booking upsell');
    logActivity('booking_upsell_created', `Upsell created · ${data.name}`);
    return result;
  }
  throw new Error('Cannot create booking upsells offline');
}

export async function updateBookingUpsell(id, data) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_booking_upsell', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_name: data.name || null,
      p_description: data.description ?? null,
      p_upsell_type: data.upsell_type || null,
      p_price_adjustment: data.price_adjustment ?? null,
      p_conditions: data.conditions || null,
      p_sort_order: data.sort_order ?? null,
      p_active: data.active ?? null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update booking upsell');
    logActivity('booking_upsell_updated', `Upsell ${id} updated`);
    return result;
  }
  throw new Error('Cannot update booking upsells offline');
}

export async function deleteBookingUpsell(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_booking_upsell', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete booking upsell');
    logActivity('booking_upsell_deleted', `Upsell ${id} deleted`);
    return result;
  }
  throw new Error('Cannot delete booking upsells offline');
}

export async function calculateBookingPrice(roomTypeId, checkIn, checkOut, numGuests) {
  if (!state.isOnline) return { error: 'Price calculation requires online connection' };
  try {
    const { data, error } = await state.supabase.rpc('calculate_booking_price', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_num_guests: Number(numGuests) || 1
    });
    if (error) throw error;
    return data || { error: 'Could not calculate price' };
  } catch (err) {
    throw new Error(err?.message || 'Failed to calculate booking price');
  }
}

export async function checkBookingAvailability(roomTypeId, checkIn, checkOut, numRooms) {
  if (!state.isOnline) return { available: false, error: 'Availability check requires online connection' };
  try {
    const { data, error } = await state.supabase.rpc('check_availability_advanced', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_num_rooms: Number(numRooms) || 1
    });
    if (error) throw error;
    return data || { available: false, blocked_reasons: [], total_rooms: 0 };
  } catch (err) {
    throw new Error(err?.message || 'Failed to check availability');
  }
}

export async function getBookingUpsells(roomTypeId, checkIn, checkOut, numGuests) {
  if (!state.isOnline) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_booking_upsells', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_num_guests: Number(numGuests) || 1
    });
    if (error) throw error;
    return data || [];
  } catch (err) {
    throw new Error(err?.message || 'Failed to get booking upsells');
  }
}

export async function createBookingIntent(roomTypeId, checkIn, checkOut, numGuests, priceEstimate) {
  if (!state.isOnline) return { success: false, error: 'Cannot create booking intent offline' };
  try {
    const { data, error } = await state.supabase.rpc('create_booking_intent', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_num_guests: Number(numGuests) || 1,
      p_price_estimate: Number(priceEstimate) || 0
    });
    if (error) throw error;
    return data || { success: true };
  } catch (err) {
    throw new Error(err?.message || 'Failed to create booking intent');
  }
}
