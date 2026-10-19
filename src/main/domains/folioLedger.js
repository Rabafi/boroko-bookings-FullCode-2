// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import {
  prepareHotelFolioIntent, markHotelFolioIntent, getHotelFolioIntent, listHotelFolioRecoveryIntents, runHotelFolioIntentOnce
} from './hotelFolioIntentJournal.js';
import {
  logActivity,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

const CACHE_KEY = 'folio-ledger';

const FOLIO_INTENT_KINDS = new Set(['create', 'charge', 'payment', 'booking_charge', 'transfer', 'split', 'void', 'close', 'reopen', 'lock']);

/** @typedef {Record<string, unknown>} FolioPropertyView */
/** @typedef {{intentId: string, lodgeId: string, actorId: string, operationKind: string, payload: Record<string, unknown>}} HotelFolioIntentSubmission */

/** @param {unknown} value */
function canonicalIntentJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalIntentJson).join(',') + ']'
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalIntentJson(value[key])).join(',') + '}'
}

/** @param {unknown} intentId @param {string} operation */
function requireIntentKey(intentId, operation) {
  if (!/^[0-9a-f-]{36}$/i.test(String(intentId || ''))) {
    throw new Error(operation + ' requires a valid operation intent UUID. Keep the same UUID for recovery retries.');
  }
  return String(intentId);
}

/** @param {string} operation */
function requireOnline(operation) {
  if (!state.isOnline) {
    const err = new Error(operation + ' requires an internet connection. Folio financial mutations cannot be queued offline.');
    err.onlineOnly = true;
    throw err;
  }
}

/** @param {string} kind @param {unknown} [input] @returns {Record<string, unknown>} */
function normalizeIntentPayload(kind, input = {}) {
  // This view preserves the original property reads, including their behavior for null and primitives.
  const fields = /** @type {FolioPropertyView} */ (input);
  const number = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error('A finite amount is required for the folio operation.');
    return parsed;
  };
  switch (kind) {
    case 'create':
      return {
        booking_id: fields.bookingId || null,
        guest_id: fields.guestId || null,
        folio_type: fields.folioType || 'guest',
        label: fields.label || ''
      };
    case 'charge':
      return {
        folio_id: fields.folioId,
        amount: number(fields.amount),
        description: fields.description || '',
        reference_type: fields.referenceType || null,
        reference_id: fields.referenceId || null
      };
    case 'payment':
      return { folio_id: fields.folioId, amount: number(fields.amount), description: fields.description || 'Payment' };
    case 'booking_charge':
      return {
        booking_id: fields.bookingId,
        description: fields.description || '',
        category: fields.category || 'folio',
        quantity: number(fields.quantity),
        unit_price: number(fields.unitPrice),
        outlet_id: fields.outletId || null,
        expected_updated_at: fields.expectedUpdatedAt || null
      }
    case 'transfer':
      return {
        source_folio_id: fields.sourceFolioId,
        target_folio_id: fields.targetFolioId,
        amount: number(fields.amount),
        description: fields.description || ''
      };
    case 'split':
      return {
        source_folio_id: fields.sourceFolioId,
        target_folio_type: fields.targetFolioType || 'guest',
        target_label: fields.targetLabel || '',
        amount: number(fields.amount),
        description: fields.description || ''
      };
    case 'void':
      return { line_item_id: fields.lineItemId, reason: String(fields.reason || '').trim() };
    case 'close':
    case 'reopen':
    case 'lock':
      return { folio_id: fields.folioId };
    default:
      throw new Error('Unsupported Hotel folio operation.');
  }
}

/** @param {unknown} error */
function isAmbiguousFolioError(error) {
  const errorView = /** @type {FolioPropertyView | null | undefined} */ (error)
  return /fetch failed|network|timeout|timed out|connection|ECONN|ETIMEDOUT|EAI_AGAIN|socket|aborted|closed connection/i
    .test(String(errorView?.message || error || ''));
}

/** @param {string} intentId @param {unknown} message */
function unknownIntentResult(intentId, message) {
  return {
    success: false,
    status: 'unknown',
    pendingRecovery: true,
    intentId,
    error: 'The server outcome is not confirmed. Retry this saved folio intent to check the same operation; do not submit it again. ' + String(message || '')
  };
}

/** @param {HotelFolioIntentSubmission} entry */
async function dispatchIntent(entry) {
  requireOnline('Hotel folio ' + entry.operationKind);
  const { lodgeId, operationKind, intentId, payload } = entry;
  const operationType = 'hotel_folio_' + operationKind + '_v1';
  markHotelFolioIntent(intentId, { status: 'submitting', lastError: null, lastAttemptAt: new Date().toISOString() });
  try {
    if (!state.supabase) throw new Error('Database connection is not available');
    const { data, error } = await state.supabase.rpc('hotel_folio_mutation_v1', {
      p_lodge_id: lodgeId,
      p_operation_kind: operationKind,
      p_idempotency_key: intentId,
      p_payload: payload
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const message = 'The server returned no operation receipt.';
      markHotelFolioIntent(intentId, { status: 'unknown', lastError: message });
      return unknownIntentResult(intentId, message);
    }
    if (data.success !== true) {
      const reason = typeof data.error === 'string' ? data.error : 'The folio operation was rejected.';
      markHotelFolioIntent(intentId, { status: 'rejected', lastError: reason });
      return { success: false, status: 'rejected', intentId, error: reason, serverResult: data };
    }
    const validReceipt =
      data.operation_id === intentId &&
      data.operation_type === operationType &&
      data.lodge_id === lodgeId &&
      data.actor_id === entry.actorId &&
      canonicalIntentJson(data.request_payload) === canonicalIntentJson(payload) &&
      /^[0-9a-f]{64}$/i.test(String(data.payload_hash || '')) &&
      data.receipt && typeof data.receipt === 'object' && !Array.isArray(data.receipt);
    if (!validReceipt) {
      const message = 'The server response did not contain a matching immutable operation receipt.';
      markHotelFolioIntent(intentId, { status: 'unknown', lastError: message });
      return unknownIntentResult(intentId, message);
    }
    try {
      markHotelFolioIntent(intentId, { status: 'confirmed', serverReceipt: data, serverConfirmedAt: new Date().toISOString(), lastError: null });
    } catch (journalError) {
      console.error('[Hotel Folio Journal] Server receipt arrived but its local acknowledgement could not be saved:', journalError?.message || journalError);
      return unknownIntentResult(intentId, 'The server response arrived, but its receipt could not be saved. Retry this same intent to recover the original receipt.');
    }
    logActivity('hotel_folio_' + operationKind, 'Hotel folio ' + operationKind + ' confirmed');
    const details = data.receipt;
    const result = details.result && typeof details.result === 'object' ? details.result : details;
    return { ...result, success: true, status: 'confirmed', intentId, serverReceipt: data };
  } catch (error) {
    const message = String(error?.message || error || 'Folio operation failed');
    const status = isAmbiguousFolioError(error) ? 'unknown' : 'rejected';
    try {
      markHotelFolioIntent(intentId, { status, lastError: message });
    } catch (journalError) {
      console.error('[Hotel Folio Journal] Unable to persist the latest outcome; the original intent remains reserved:', journalError?.message || journalError);
      return unknownIntentResult(intentId, 'The server response could not be safely saved locally.');
    }
    if (status === 'unknown') return unknownIntentResult(intentId, message);
    return { success: false, status: 'rejected', intentId, error: message };
  }
}

/** @param {string} operationKind @param {unknown} [input] @param {unknown} [intentId] */
export async function submitIntent(operationKind, input = {}, intentId = randomUUID()) {
  if (!FOLIO_INTENT_KINDS.has(operationKind)) throw new Error('Unsupported Hotel folio operation.');
  requireOnline('Hotel folio ' + operationKind);
  const payload = normalizeIntentPayload(operationKind, input);
  const entry = prepareHotelFolioIntent({ intentId, operationKind, payload });
  return runHotelFolioIntentOnce(entry.intentId, () => dispatchIntent(entry));
}

/** @param {unknown} intentId */
export async function retryIntent(intentId) {
  requireOnline('Hotel folio recovery');
  const entry = getHotelFolioIntent(requireIntentKey(intentId, 'Hotel folio recovery'));
  if (entry.status === 'confirmed') {
    const result = entry.serverReceipt?.receipt?.result || entry.serverReceipt?.receipt || {};
    return { ...result, success: true, status: 'confirmed', intentId: entry.intentId, serverReceipt: entry.serverReceipt };
  }
  if (entry.status === 'rejected') {
    return { success: false, status: 'rejected', intentId: entry.intentId, error: entry.lastError || 'This folio operation was definitively rejected. Correct the issue and begin a new operation.' };
  }
  return runHotelFolioIntentOnce(entry.intentId, () => dispatchIntent(entry));
}

export function getPendingIntentRecovery() {
  return listHotelFolioRecoveryIntents();
}

/** @param {unknown} bookingId @param {unknown} guestId @param {unknown} folioType @param {unknown} label @param {unknown} idempotencyKey */
export async function createFolio(bookingId, guestId, folioType, label, idempotencyKey) {
  return submitIntent('create', { bookingId, guestId, folioType, label }, requireIntentKey(idempotencyKey, 'Create folio'));
}

/** @param {unknown} folioId @param {unknown} amount @param {unknown} description @param {unknown} referenceType @param {unknown} referenceId @param {unknown} idempotencyKey */
export async function addCharge(folioId, amount, description, referenceType, referenceId, idempotencyKey) {
  return submitIntent('charge', { folioId, amount, description, referenceType, referenceId }, requireIntentKey(idempotencyKey, 'Add folio charge'));
}

/** @param {unknown} folioId @param {unknown} amount @param {unknown} description @param {unknown} idempotencyKey */
export async function addPayment(folioId, amount, description, idempotencyKey) {
  return submitIntent('payment', { folioId, amount, description }, requireIntentKey(idempotencyKey, 'Add folio payment'));
}

/** @param {unknown} sourceFolioId @param {unknown} targetFolioId @param {unknown} amount @param {unknown} description @param {unknown} idempotencyKey */
export async function transferCharge(sourceFolioId, targetFolioId, amount, description, idempotencyKey) {
  return submitIntent('transfer', { sourceFolioId, targetFolioId, amount, description }, requireIntentKey(idempotencyKey, 'Transfer folio charge'));
}

/** @param {unknown} sourceFolioId @param {unknown} targetFolioType @param {unknown} targetLabel @param {unknown} amount @param {unknown} description @param {unknown} idempotencyKey */
export async function splitFolio(sourceFolioId, targetFolioType, targetLabel, amount, description, idempotencyKey) {
  return submitIntent('split', { sourceFolioId, targetFolioType, targetLabel, amount, description }, requireIntentKey(idempotencyKey, 'Split folio'));
}

/** @param {unknown} lineItemId @param {unknown} reason @param {unknown} idempotencyKey */
export async function voidLineItem(lineItemId, reason, idempotencyKey) {
  if (!String(reason || '').trim()) throw new Error('A reason is required to void a folio line.');
  return submitIntent('void', { lineItemId, reason }, requireIntentKey(idempotencyKey, 'Void folio line'));
}

/** @param {unknown} folioId @param {unknown} idempotencyKey */
export async function closeFolio(folioId, idempotencyKey) {
  return submitIntent('close', { folioId }, requireIntentKey(idempotencyKey, 'Close folio'));
}

/** @param {unknown} folioId @param {unknown} idempotencyKey */
export async function reopenFolio(folioId, idempotencyKey) {
  return submitIntent('reopen', { folioId }, requireIntentKey(idempotencyKey, 'Reopen folio'));
}

/** @param {unknown} folioId @param {unknown} idempotencyKey */
export async function lockFolio(folioId, idempotencyKey) {
  return submitIntent('lock', { folioId }, requireIntentKey(idempotencyKey, 'Lock folio'));
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

export { requireOnline as requireFolioOnline };
