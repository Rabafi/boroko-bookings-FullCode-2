import { state } from '../state.js';
import {
  logActivity,
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

const CACHE_KEY = 'folio-ledger';

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
    const result = Array.isArray(data) ? data : [];
    writeCache(CACHE_KEY, result);
    return result;
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
    const cached = readCache(`${CACHE_KEY}-items-${folioId}`) || [];
    return cached;
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

export async function createFolio(bookingId, guestId, folioType, label) {
  const payload = {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_guest_id: guestId || null,
    p_folio_type: folioType || 'guest',
    p_label: label || ''
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('create_hotel_folio', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_created', `Folio created · ${folioType} · ${label}`);
    return data;
  }

  const offlineResult = { id: `offline-${Date.now()}`, ...payload, balance: 0, status: 'open', _pending_sync: true };
  queueOperation('rpc', 'create_hotel_folio', payload, null, { _queue_id: `folio-create-${offlineResult.id}` });
  logActivity('folio_created', `Folio created (offline) · ${folioType} · ${label}`);
  return offlineResult;
}

export async function addCharge(folioId, amount, description, referenceType, referenceId) {
  const payload = {
    p_lodge_id: state.lodgeId,
    p_folio_id: folioId,
    p_amount: Number(amount) || 0,
    p_description: description || '',
    p_reference_type: referenceType || null,
    p_reference_id: referenceId || null
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('add_folio_charge', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_charge_added', `Folio charge added · ${description}`);
    return data;
  }

  queueOperation('rpc', 'add_folio_charge', payload, null, { _queue_id: `folio-charge-${folioId}-${Date.now()}` });
  logActivity('folio_charge_added', `Folio charge added (offline) · ${description}`);
  return { success: true, offline: true };
}

export async function addPayment(folioId, amount, description) {
  const payload = {
    p_lodge_id: state.lodgeId,
    p_folio_id: folioId,
    p_amount: Number(amount) || 0,
    p_description: description || ''
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('add_folio_payment', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_payment_added', `Folio payment added · ${description}`);
    return data;
  }

  queueOperation('rpc', 'add_folio_payment', payload, null, { _queue_id: `folio-payment-${folioId}-${Date.now()}` });
  logActivity('folio_payment_added', `Folio payment added (offline) · ${description}`);
  return { success: true, offline: true };
}

export async function transferCharge(sourceFolioId, targetFolioId, amount, description) {
  const payload = {
    p_lodge_id: state.lodgeId,
    p_source_folio_id: sourceFolioId,
    p_target_folio_id: targetFolioId,
    p_amount: Number(amount) || 0,
    p_description: description || ''
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('transfer_folio_charge', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_transfer', `Folio charge transferred · ${description}`);
    return data;
  }

  queueOperation('rpc', 'transfer_folio_charge', payload, null, { _queue_id: `folio-transfer-${sourceFolioId}-${Date.now()}` });
  logActivity('folio_transfer', `Folio charge transferred (offline) · ${description}`);
  return { success: true, offline: true };
}

export async function splitFolio(sourceFolioId, targetFolioType, targetLabel, amount, description) {
  const payload = {
    p_lodge_id: state.lodgeId,
    p_source_folio_id: sourceFolioId,
    p_target_folio_type: targetFolioType || 'guest',
    p_target_label: targetLabel || '',
    p_amount: Number(amount) || 0,
    p_description: description || ''
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('split_folio', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_split', `Folio split · ${targetLabel}`);
    return data;
  }

  queueOperation('rpc', 'split_folio', payload, null, { _queue_id: `folio-split-${sourceFolioId}-${Date.now()}` });
  logActivity('folio_split', `Folio split (offline) · ${targetLabel}`);
  return { success: true, offline: true };
}

export async function voidLineItem(lineItemId, reason) {
  const payload = {
    p_lodge_id: state.lodgeId,
    p_line_item_id: lineItemId,
    p_reason: reason || ''
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('void_folio_line', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_line_voided', `Folio line voided · ${reason}`);
    return data;
  }

  queueOperation('rpc', 'void_folio_line', payload, null, { _queue_id: `folio-void-${lineItemId}-${Date.now()}` });
  logActivity('folio_line_voided', `Folio line voided (offline) · ${reason}`);
  return { success: true, offline: true };
}

export async function closeFolio(folioId) {
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('close_folio', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_closed', `Folio closed`);
    return data;
  }

  queueOperation('rpc', 'close_folio', payload, null, { _queue_id: `folio-close-${folioId}` });
  logActivity('folio_closed', `Folio closed (offline)`);
  return { success: true, offline: true };
}

export async function reopenFolio(folioId) {
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('reopen_folio', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_reopened', `Folio reopened`);
    return data;
  }

  queueOperation('rpc', 'reopen_folio', payload, null, { _queue_id: `folio-reopen-${folioId}` });
  logActivity('folio_reopened', `Folio reopened (offline)`);
  return { success: true, offline: true };
}

export async function lockFolio(folioId) {
  const payload = { p_lodge_id: state.lodgeId, p_folio_id: folioId };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('lock_folio', payload);
    if (error) throw new Error(error.message);
    logActivity('folio_locked', `Folio locked`);
    return data;
  }

  queueOperation('rpc', 'lock_folio', payload, null, { _queue_id: `folio-lock-${folioId}` });
  logActivity('folio_locked', `Folio locked (offline)`);
  return { success: true, offline: true };
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
