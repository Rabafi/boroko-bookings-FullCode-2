import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, queueOperation, readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js';

async function _getAllRatePlans() {
  if (!state.isOnline) return readCache('rate-plans');
  try {
    const { data, error } = await state.supabase
      .from('rate_plans')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('name');
    if (error) throw error;
    writeCache('rate-plans', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('rate-plans');
    if (cached.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load rate plans');
  }
}

export function getAllRatePlans() {
  return dedupePromise('ratePlans', _getAllRatePlans);
}

export async function createRatePlan(data) {
  const id = randomUUID();
  const plan = {
    id,
    lodge_id: state.lodgeId,
    name: data.name,
    description: data.description || '',
    room_type_id: data.room_type_id || null,
    rate_amount: Number(data.rate_amount) || 0,
    rate_type: data.rate_type || 'per_night',
    currency: data.currency || 'P',
    valid_from: data.valid_from || null,
    valid_to: data.valid_to || null,
    min_stay: Number(data.min_stay) || 1,
    max_stay: Number(data.max_stay) || null,
    days_of_week: Array.isArray(data.days_of_week) ? data.days_of_week : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    corporate_account_id: data.corporate_account_id || null,
    status: data.status || 'active',
    created_at: new Date().toISOString()
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_rate_plan', { payload: plan });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create rate plan');
    await refreshCache('rate-plans');
    return result?.id || id;
  } else {
    const cached = readCache('rate-plans');
    cached.push({ ...plan, _pending_sync: true });
    writeCache('rate-plans', cached);
    queueOperation('rpc', 'create_rate_plan', { payload: plan }, null, { _queue_id: `rate-${id}` });
    return id;
  }
}

export async function updateRatePlan(id, data) {
  const update = {
    name: data.name,
    description: data.description,
    room_type_id: data.room_type_id,
    rate_amount: Number(data.rate_amount) || 0,
    rate_type: data.rate_type,
    valid_from: data.valid_from,
    valid_to: data.valid_to,
    min_stay: Number(data.min_stay) || 1,
    max_stay: Number(data.max_stay),
    days_of_week: Array.isArray(data.days_of_week) ? data.days_of_week : undefined,
    corporate_account_id: data.corporate_account_id,
    status: data.status
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update rate plan');
    await refreshCache('rate-plans');
  } else {
    const cached = readCache('rate-plans');
    const idx = cached.findIndex((p) => p.id === id);
    const pending = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('rate-plans', cached);
    queueOperation('rpc', 'update_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    }, null, pending ? { _depends_on: `rate-${id}` } : {});
  }
}

export async function deleteRatePlan(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete rate plan');
    await refreshCache('rate-plans');
  } else {
    const cached = readCache('rate-plans');
    const pending = cached.some((p) => p.id === id && p?._pending_sync);
    writeCache('rate-plans', cached.filter((p) => p.id !== id));
    queueOperation('rpc', 'delete_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId
    }, null, pending ? { _depends_on: `rate-${id}` } : {});
  }
}

/**
 * Authoritative stay quote via server `quote_room_stay`.
 * Client-side plan math must be labelled as estimates only.
 */
export async function quoteRoomStayFromPlans(roomId, checkIn, checkOut, corporateAccountId = null) {
  if (!state.lodgeId) throw new Error('No lodge selected');
  if (!roomId || !checkIn || !checkOut) throw new Error('roomId, checkIn, and checkOut are required');

  if (state.isOnline && typeof state.supabase?.rpc === 'function') {
    const { data, error } = await state.supabase.rpc('quote_room_stay', {
      p_lodge_id: state.lodgeId,
      p_room_id: roomId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_corporate_account_id: corporateAccountId
    });
    if (error) throw new Error(error.message);
    if (data?.success === false) throw new Error(data.error || 'Could not quote stay');
    return {
      ...data,
      source: 'server_quote_room_stay',
      is_estimate: false,
      authoritative: true
    };
  }

  // Offline: best-effort local estimate from cached rate plans — not financial truth.
  const plans = readCache('rate-plans') || [];
  const active = plans.filter((p) => (p.status || 'active') === 'active');
  const amount = Number(active[0]?.rate_amount || 0);
  const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
  return {
    success: true,
    total: amount * nights,
    nights,
    rate_amount: amount,
    source: 'client_rate_plan_estimate',
    is_estimate: true,
    authoritative: false,
    _financial_estimate: true,
    message: 'Offline client estimate from cached rate plans; server quote_room_stay is authoritative when online.'
  };
}

/**
 * Client-side estimate of a plan amount for display only.
 * Prefer quoteRoomStayFromPlans / server RPCs for booking totals.
 */
export function estimatePlanTotal(plan, nights) {
  const n = Math.max(1, Number(nights) || 1);
  const rate = Number(plan?.rate_amount || 0);
  return {
    total: rate * n,
    nights: n,
    rate_amount: rate,
    source: 'client_rate_plan_estimate',
    is_estimate: true,
    authoritative: false,
    _financial_estimate: true
  };
}
