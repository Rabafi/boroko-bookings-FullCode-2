// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, queueOperation, readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js';

/** @typedef {Record<string, unknown>} RatePlanInputView */
/** @typedef {Record<string, unknown>} RatePlanCacheView */

async function _getAllRatePlans() {
  if (!state.isOnline) return readCache('rate-plans');
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
      .from('rate_plans')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('name');
    if (error) throw error;
    writeCache('rate-plans', data || []);
    return data || [];
  } catch (err) {
    // Cache values remain unvalidated; this view only types the existing array operations.
    const cached = /** @type {RatePlanCacheView[]} */ (readCache('rate-plans'));
    if (cached.length > 0) return cached;
    const errorView = /** @type {Record<string, unknown> | null | undefined} */ (err)
    throw new Error(/** @type {string} */ (errorView?.message || 'Failed to load rate plans'));
  }
}

export function getAllRatePlans() {
  return dedupePromise('ratePlans', _getAllRatePlans);
}

/** @param {unknown} input */
export async function createRatePlan(input) {
  // This view preserves the existing direct reads of untrusted IPC input; it adds no validation.
  const data = /** @type {RatePlanInputView} */ (input)
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
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_rate_plan', { payload: plan });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create rate plan');
    await refreshCache('rate-plans');
    return result?.id || id;
  } else {
    const cached = /** @type {RatePlanCacheView[]} */ (readCache('rate-plans'));
    cached.push({ ...plan, _pending_sync: true });
    writeCache('rate-plans', cached);
    queueOperation('rpc', 'create_rate_plan', { payload: plan }, null, { _queue_id: `rate-${id}` });
    return id;
  }
}

/** @param {string} id @param {unknown} input */
export async function updateRatePlan(id, input) {
  // This view preserves the existing direct reads of untrusted IPC input; it adds no validation.
  const data = /** @type {RatePlanInputView} */ (input)
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
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update rate plan');
    await refreshCache('rate-plans');
  } else {
    const cached = /** @type {RatePlanCacheView[]} */ (readCache('rate-plans'));
    const idx = cached.findIndex((p) => p.id === id);
    const pending = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('rate-plans', cached);
    queueOperation('rpc', 'update_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    }, null, pending ? { _depends_on: `rate-${id}` } : {});
  }
}

/** @param {string} id */
export async function deleteRatePlan(id) {
  if (state.isOnline) {
    const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('delete_rate_plan', {
      p_id: id, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete rate plan');
    await refreshCache('rate-plans');
  } else {
    const cached = /** @type {RatePlanCacheView[]} */ (readCache('rate-plans'));
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
/** @param {unknown} roomId @param {unknown} checkIn @param {unknown} checkOut @param {unknown} [corporateAccountId] */
export async function quoteRoomStayFromPlans(roomId, checkIn, checkOut, corporateAccountId = null) {
  if (!state.lodgeId) throw new Error('No lodge selected');
  if (!roomId || !checkIn || !checkOut) throw new Error('roomId, checkIn, and checkOut are required');

  if (state.isOnline && typeof state.supabase?.rpc === 'function') {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('quote_room_stay', {
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
  const plans = /** @type {RatePlanCacheView[]} */ (readCache('rate-plans') || []);
  const active = plans.filter((p) => (p.status || 'active') === 'active');
  const amount = Number(active[0]?.rate_amount || 0);
  // The existing Date coercion accepts any JS date input at runtime; this view does not validate it.
  const nights = Math.max(1, Math.round((Number(new Date(/** @type {string | number | Date} */ (checkOut))) - Number(new Date(/** @type {string | number | Date} */ (checkIn)))) / 86400000));
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
/** @param {unknown} plan @param {unknown} nights */
export function estimatePlanTotal(plan, nights) {
  const planView = /** @type {RatePlanInputView | null | undefined} */ (plan)
  const n = Math.max(1, Number(nights) || 1);
  const rate = Number(planView?.rate_amount || 0);
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
