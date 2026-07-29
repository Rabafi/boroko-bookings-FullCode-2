import { createHash, randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, dedupePromise, readCache, writeCache } from './infrastructure.js';

const INTENT_CACHE = 'booking-engine-intents';

function stableIdempotencyKey(prefix, parts = {}) {
  const digest = createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}:${digest}`.slice(0, 128);
}

function readIntentCache() {
  const cached = readCache(INTENT_CACHE);
  return Array.isArray(cached) ? cached : [];
}

function writeIntentCache(rows) {
  writeCache(INTENT_CACHE, Array.isArray(rows) ? rows.slice(0, 200) : []);
}

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
  if (!state.isOnline) {
    return {
      error: 'Price calculation requires online connection',
      is_estimate: true,
      authoritative: false,
      source: 'offline'
    };
  }
  try {
    const { data, error } = await state.supabase.rpc('calculate_booking_price', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_num_guests: Number(numGuests) || 1
    });
    if (error) throw error;
    const result = data || { error: 'Could not calculate price' };
    // Booking-engine price helper is advisory relative to quote_room_stay for room stays.
    return {
      ...result,
      is_estimate: result.is_estimate !== false,
      authoritative: result.authoritative === true,
      source: result.source || 'server_calculate_booking_price',
      price_is_estimate: true,
      note: result.note || 'Prefer quote_room_stay for authoritative room booking totals.'
    };
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

/**
 * Create a booking intent with a stable idempotency key.
 * Price is always labelled as an estimate unless the caller supplies an authoritative quote.
 * Retries must pass the same idempotencyKey — never invent a new key on timeout.
 */
export async function createBookingIntent(roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options = {}) {
  if (!state.isOnline) return { success: false, error: 'Cannot create booking intent offline' };

  const lodgeId = state.lodgeId;
  if (!lodgeId) return { success: false, error: 'No lodge selected' };

  const guests = Number(numGuests) || 1;
  const providedKey = options.idempotencyKey || options.idempotency_key || null;
  const idempotencyKey = providedKey || stableIdempotencyKey('booking-engine-intent', {
    lodge_id: lodgeId,
    room_type_id: roomTypeId,
    check_in: checkIn,
    check_out: checkOut,
    num_guests: guests
  });

  // Idempotent local replay: same key returns prior intent without re-RPC.
  const cached = readIntentCache();
  const existing = cached.find((row) => row.idempotency_key === idempotencyKey && row.lodge_id === lodgeId);
  if (existing && existing.status !== 'cancelled') {
    return {
      success: true,
      ...existing,
      idempotent_replay: true,
      price_is_estimate: true,
      is_estimate: true
    };
  }

  let estimate = Number(priceEstimate) || 0;
  let estimateSource = 'caller_price_estimate';

  // Prefer server quote when a concrete room is provided.
  if (options.roomId && typeof state.supabase?.rpc === 'function') {
    try {
      const { data: quote, error: quoteError } = await state.supabase.rpc('quote_room_stay', {
        p_lodge_id: lodgeId,
        p_room_id: options.roomId,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_corporate_account_id: options.corporateAccountId || null
      });
      if (!quoteError && quote?.success !== false && Number.isFinite(Number(quote.total))) {
        estimate = Number(quote.total);
        estimateSource = 'server_quote_room_stay';
      }
    } catch {
      // keep caller estimate
    }
  }

  const intentId = randomUUID();
  let rpcResult = null;

  try {
    const { data, error } = await state.supabase.rpc('create_booking_intent', {
      p_lodge_id: lodgeId,
      p_room_type_id: roomTypeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_num_guests: guests,
      p_price_estimate: estimate
    });
    if (error) throw error;
    rpcResult = data;
  } catch (err) {
    // Some deployments only accept the public (slug, jsonb) overload or reject bigint lodges.
    // Persist a local intent with the stable key so confirm can still be idempotent.
    rpcResult = {
      success: false,
      error: err?.message || 'create_booking_intent RPC unavailable',
      local_intent: true
    };
  }

  const record = {
    success: rpcResult?.success !== false || rpcResult?.local_intent === true,
    intent_id: rpcResult?.id || rpcResult?.intent_id || intentId,
    lodge_id: lodgeId,
    room_type_id: roomTypeId,
    room_id: options.roomId || null,
    check_in: checkIn,
    check_out: checkOut,
    num_guests: guests,
    price_estimate: estimate,
    price_is_estimate: true,
    is_estimate: true,
    estimate_source: estimateSource,
    idempotency_key: idempotencyKey,
    status: 'pending',
    created_at: new Date().toISOString(),
    rpc: rpcResult
  };

  writeIntentCache([record, ...cached.filter((r) => r.idempotency_key !== idempotencyKey)]);
  logActivity('booking_engine_intent_created', `Intent ${record.intent_id} · key ${idempotencyKey.slice(0, 24)}`);
  return record;
}

/**
 * Confirm a booking intent idempotently.
 * Reuses the original idempotency key — never replaces it after a timeout.
 * Full booking creation still requires room/customer via create_booking when payload is complete.
 */
export async function confirmBookingIntent(intentOrId, confirmation = {}) {
  if (!state.isOnline) return { success: false, error: 'Cannot confirm booking intent offline' };
  if (!state.lodgeId) return { success: false, error: 'No lodge selected' };

  const intentId = typeof intentOrId === 'object' ? (intentOrId.intent_id || intentOrId.id) : intentOrId;
  const cached = readIntentCache();
  const prior = cached.find((row) => row.intent_id === intentId || row.id === intentId) ||
    (typeof intentOrId === 'object' ? intentOrId : null);

  // Stable key: never invent a new one on retry.
  const idempotencyKey =
    confirmation.idempotencyKey ||
    confirmation.idempotency_key ||
    prior?.idempotency_key ||
    prior?.idempotencyKey ||
    null;

  if (!idempotencyKey) {
    return {
      success: false,
      error: 'Idempotency key is required to confirm a booking intent; do not generate a new key after a timeout.'
    };
  }

  if (prior?.status === 'confirmed' && prior?.confirm_result) {
    return {
      success: true,
      intent_id: intentId,
      idempotency_key: idempotencyKey,
      idempotent_replay: true,
      status: 'confirmed',
      ...prior.confirm_result
    };
  }

  const roomId = confirmation.roomId || confirmation.room_id || prior?.room_id;
  const customerId = confirmation.customerId || confirmation.customer_id || prior?.customer_id;

  // Without full booking inputs, mark intent confirmed locally only (operator still creates booking).
  if (!roomId || !customerId) {
    const result = {
      success: true,
      intent_id: intentId,
      idempotency_key: idempotencyKey,
      status: 'confirmed_pending_booking',
      booking_created: false,
      price_is_estimate: true,
      message: 'Intent confirmed with stable idempotency key. Create the booking with the same key when room and guest are known.'
    };
    if (prior) {
      const next = cached.map((row) =>
        row.intent_id === prior.intent_id
          ? { ...row, status: 'confirmed_pending_booking', confirm_result: result, idempotency_key: idempotencyKey }
          : row
      );
      writeIntentCache(next);
    }
    return result;
  }

  const totalAmount = Number(
    confirmation.totalAmount ??
    confirmation.total_amount ??
    prior?.price_estimate ??
    0
  );

  try {
    const { data, error } = await state.supabase.rpc('create_booking', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId,
      p_room_id: roomId,
      p_check_in: confirmation.checkIn || confirmation.check_in || prior?.check_in,
      p_check_out: confirmation.checkOut || confirmation.check_out || prior?.check_out,
      p_adults: Number(confirmation.adults ?? prior?.num_guests ?? 1) || 1,
      p_children: Number(confirmation.children ?? 0) || 0,
      p_total_amount: totalAmount,
      p_notes: confirmation.notes || `booking-engine-intent:${intentId}`,
      p_created_by: state.currentUser?.id || null,
      p_deposit_amount: Number(confirmation.depositAmount ?? 0) || 0,
      p_booking_id: confirmation.bookingId || confirmation.booking_id || null,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not confirm booking intent');

    const result = {
      success: true,
      intent_id: intentId,
      idempotency_key: idempotencyKey,
      status: 'confirmed',
      booking_created: true,
      booking: data,
      idempotent_replay: Boolean(data?.idempotent || data?.replayed)
    };

    if (prior) {
      const next = cached.map((row) =>
        row.intent_id === prior.intent_id
          ? { ...row, status: 'confirmed', confirm_result: result, idempotency_key: idempotencyKey }
          : row
      );
      writeIntentCache(next);
    }

    logActivity('booking_engine_intent_confirmed', `Intent ${intentId} confirmed · booking`);
    return result;
  } catch (err) {
    throw new Error(err?.message || 'Failed to confirm booking intent');
  }
}
