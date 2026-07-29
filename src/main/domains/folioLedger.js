import { state } from '../state.js';
import {
  logActivity,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

const CACHE_KEY = 'folio-ledger';

/**
 * Folio financial mutations are ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
 * They must never be silently queued — atomic double-entry requires the server.
 */
function requireOnline(operation) {
  if (!state.isOnline) {
    const err = new Error(
      `${operation} requires an internet connection. Folio financial mutations cannot be queued offline.`
    );
    err.onlineOnly = true;
    throw err;
  }
}

/**
 * Optional stable key for retry identity. Callers should supply a unique
 * operation-intent UUID per user action to avoid key collisions.
 * add_folio_charge / add_folio_payment accept p_idempotency_key via
 * 20260713210000 migration; other folio RPCs accept it in the domain layer
 * for forward compatibility.
 */
function stableIdempotencyKey(prefix, parts = []) {
  const base = [prefix, state.lodgeId, ...parts]
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join(':');
  return base.slice(0, 180);
}

/** RPCs that accept p_idempotency_key after 20260713210000 migration. */
const IDEMPOTENT_FOLIO_RPCS = new Set(['add_folio_charge', 'add_folio_payment']);

async function callFolioRpc(fn, payload, { activity, activityDetail } = {}) {
  if (!state.supabase) {
    throw new Error('Database connection is not available');
  }
  let rpcPayload = { ...(payload || {}) };
  // Only charge/payment accept p_idempotency_key; strip for other RPCs.
  if (!IDEMPOTENT_FOLIO_RPCS.has(fn) && Object.prototype.hasOwnProperty.call(rpcPayload, 'p_idempotency_key')) {
    delete rpcPayload.p_idempotency_key;
  }
  // Ensure key length satisfies financial_operation_idempotency (8–128)
  if (rpcPayload.p_idempotency_key) {
    const k = String(rpcPayload.p_idempotency_key);
    if (k.length < 8) rpcPayload.p_idempotency_key = `${k}________`.slice(0, 16);
    if (k.length > 128) rpcPayload.p_idempotency_key = k.slice(0, 128);
  }
  const { data, error } = await state.supabase.rpc(fn, rpcPayload);
  if (error) throw new Error(error.message || `${fn} failed`);
  if (data?.success === false) throw new Error(data.error || `${fn} failed`);
  if (activity) logActivity(activity, activityDetail || activity);
  return data;
}

async function _getFolios(bookingId) {
  if (!state.isOnline) {
    const cached = readCache(CACHE_KEY) || [];
    if (bookingId) return cached.filter((f) => f.booking_id === bookingId);
    return cached;
  }

  try {
    const { data, error } = await state.supabase.rpc('get_hotel_folios', {
      p_lodge_id: state.lodgeId,
      p_booking_id: bookingId || null
    });
    if (error) throw error;
    const rows = Array.isArray(data)
      ? data
      : (Array.isArray(data?.folios) ? data.folios : []);
    writeCache(CACHE_KEY, rows);
    return rows;
  } catch (error) {
    const cached = readCache(CACHE_KEY) || [];
    if (cached.length > 0) return bookingId ? cached.filter((f) => f.booking_id === bookingId) : cached;
    throw new Error(error?.message || 'Failed to load folios');
  }
}

export function getFolios(bookingId) {
  return dedupePromise(`${CACHE_KEY}-list-${bookingId || 'all'}`, () => _getFolios(bookingId));
}

async function _getLineItems(folioId) {
  if (!state.isOnline) {
    return readCache(`${CACHE_KEY}-items-${folioId}`) || [];
  }

  try {
    const { data, error } = await state.supabase.rpc('get_folio_line_items', {
      p_lodge_id: state.lodgeId,
      p_folio_id: folioId
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data : [];
    writeCache(`${CACHE_KEY}-items-${folioId}`, result);
    return result;
  } catch (error) {
    const cached = readCache(`${CACHE_KEY}-items-${folioId}`) || [];
    if (cached.length > 0) return cached;
    throw new Error(error?.message || 'Failed to load line items');
  }
}

export function getLineItems(folioId) {
  return dedupePromise(`${CACHE_KEY}-items-${folioId}`, () => _getLineItems(folioId));
}

export async function createFolio(bookingId, guestId, folioType, label, idempotencyKey = null) {
  requireOnline('Create folio');
  const key = idempotencyKey || stableIdempotencyKey('folio-create', [bookingId, folioType, label]);
  const payload = {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_guest_id: guestId || null,
    p_folio_type: folioType || 'guest',
    p_label: label || '',
    // Client-only until RPC accepts p_idempotency_key
    p_idempotency_key: key
  };

  const data = await callFolioRpc('create_hotel_folio', payload, {
    activity: 'folio_created',
    activityDetail: `Folio created · ${folioType} · ${label}`
  });
  return data?.folio || data;
}

export async function addCharge(folioId, amount, description, referenceType, referenceId, idempotencyKey = null) {
  requireOnline('Add folio charge');
  const key = idempotencyKey || stableIdempotencyKey('folio-charge', [
    folioId, amount, description, referenceType, referenceId
  ]);
  const payload = {
    p_lodge_id: state.lodgeId,
    p_folio_id: folioId,
    p_amount: Number(amount) || 0,
    p_description: description || '',
    p_reference_type: referenceType || null,
    p_reference_id: referenceId || null,
    p_idempotency_key: key
  };

  return callFolioRpc('add_folio_charge', payload, {
    activity: 'folio_charge_added',
    activityDetail: `Folio charge added · ${description}`
  });
}

export async function addPayment(folioId, amount, description, idempotencyKey = null) {
  requireOnline('Add folio payment');
  const key = idempotencyKey || stableIdempotencyKey('folio-payment', [folioId, amount, description]);
  const payload = {
    p_lodge_id: state.lodgeId,
    p_folio_id: folioId,
    p_amount: Number(amount) || 0,
    p_description: description || '',
    p_idempotency_key: key
  };

  return callFolioRpc('add_folio_payment', payload, {
    activity: 'folio_payment_added',
    activityDetail: `Folio payment added · ${description}`
  });
}

export async function transferCharge(sourceFolioId, targetFolioId, amount, description, idempotencyKey = null) {
  requireOnline('Transfer folio charge');
  const key = idempotencyKey || stableIdempotencyKey('folio-transfer', [
    sourceFolioId, targetFolioId, amount, description
  ]);
  const payload = {
    p_lodge_id: state.lodgeId,
    p_source_folio_id: sourceFolioId,
    p_target_folio_id: targetFolioId,
    p_amount: Number(amount) || 0,
    p_description: description || '',
    p_idempotency_key: key
  };

  return callFolioRpc('transfer_folio_charge', payload, {
    activity: 'folio_transfer',
    activityDetail: `Folio charge transferred · ${description}`
  });
}

export async function splitFolio(sourceFolioId, targetFolioType, targetLabel, amount, description, idempotencyKey = null) {
  requireOnline('Split folio');
  const key = idempotencyKey || stableIdempotencyKey('folio-split', [
    sourceFolioId, targetFolioType, targetLabel, amount
  ]);
  const payload = {
    p_lodge_id: state.lodgeId,
    p_source_folio_id: sourceFolioId,
    p_target_folio_type: targetFolioType || 'guest',
    p_target_label: targetLabel || '',
    p_amount: Number(amount) || 0,
    p_description: description || '',
    p_idempotency_key: key
  };

  return callFolioRpc('split_folio', payload, {
    activity: 'folio_split',
    activityDetail: `Folio split · ${targetLabel}`
  });
}

export async function voidLineItem(lineItemId, reason, idempotencyKey = null) {
  requireOnline('Void folio line');
  if (!String(reason || '').trim()) {
    throw new Error('A reason is required to void a folio line');
  }
  const key = idempotencyKey || stableIdempotencyKey('folio-void', [lineItemId, reason]);
  const payload = {
    p_lodge_id: state.lodgeId,
    p_line_item_id: lineItemId,
    p_reason: reason || '',
    p_idempotency_key: key
  };

  return callFolioRpc('void_folio_line', payload, {
    activity: 'folio_line_voided',
    activityDetail: `Folio line voided · ${reason}`
  });
}

export async function closeFolio(folioId, idempotencyKey = null) {
  requireOnline('Close folio');
  const key = idempotencyKey || stableIdempotencyKey('folio-close', [folioId]);
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId, p_idempotency_key: key };
  return callFolioRpc('close_folio', payload, {
    activity: 'folio_closed',
    activityDetail: 'Folio closed'
  });
}

export async function reopenFolio(folioId, idempotencyKey = null) {
  requireOnline('Reopen folio');
  const key = idempotencyKey || stableIdempotencyKey('folio-reopen', [folioId]);
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId, p_idempotency_key: key };
  return callFolioRpc('reopen_folio', payload, {
    activity: 'folio_reopened',
    activityDetail: 'Folio reopened'
  });
}

export async function lockFolio(folioId, idempotencyKey = null) {
  requireOnline('Lock folio');
  const key = idempotencyKey || stableIdempotencyKey('folio-lock', [folioId]);
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId, p_idempotency_key: key };
  return callFolioRpc('lock_folio', payload, {
    activity: 'folio_locked',
    activityDetail: 'Folio locked'
  });
}

export async function getBalance(folioId) {
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('get_folio_balance', payload);
    if (error) throw new Error(error.message);
    return Number(data || 0);
  }

  const cached = readCache(CACHE_KEY) || [];
  const folio = cached.find((f) => f.id === folioId);
  return folio ? Number(folio.balance || 0) : 0;
}

export { requireOnline as requireFolioOnline, stableIdempotencyKey };
