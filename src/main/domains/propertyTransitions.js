// @ts-check
import { state } from '../state.js';
import { createAppError, isUuid } from './shared.js';
import { readCache, writeCache } from './infrastructure.js';

// LodgingOS same-product property-type transitions. Online-only: classification
// changes are never queued, and the stable idempotency key is always supplied
// by the caller (renderer) and passed through unchanged on every retry — a new
// key is never generated here, including after an ambiguous timeout (recover
// via getPropertyTypeTransitionStatus instead).

/** @type {ReadonlyArray<string>} */
export const SUPPORTED_LODGING_TYPES = Object.freeze(['guest_house', 'bnb', 'lodge', 'camp', 'motel']);

const CROSS_PRODUCT_TYPES = Object.freeze(['hotel', 'resort', 'restaurant', 'bar', 'pos_only']);

/** @param {unknown} targetType @returns {string} */
function normalizeTargetType(targetType) {
  return String(targetType || '').trim().toLowerCase();
}

function assertOnline() {
  if (state.isOnline !== true) {
    throw createAppError(
      'property_transition_offline',
      'Property-type changes need an internet connection. Reconnect, then preview and commit again. Nothing was queued.'
    );
  }
}

function assertLodgeSelected() {
  if (!state.lodgeId) {
    throw createAppError('property_transition_no_lodge', 'Choose a lodge profile on this computer before changing the property type.');
  }
}

/** @param {unknown} targetType @returns {string} */
function assertSupportedTarget(targetType) {
  const normalized = normalizeTargetType(targetType);
  if (!SUPPORTED_LODGING_TYPES.includes(normalized)) {
    throw createAppError(
      'cross_product_rejected',
      'Property type changes stay inside LodgingOS (guest house, B&B, lodge, camp, motel).'
        + (CROSS_PRODUCT_TYPES.includes(normalized) ? ' That type belongs to another product.' : ' Unknown target type.'),
      { target_type: targetType }
    );
  }
  return normalized;
}

/** @param {unknown} idempotencyKey @returns {unknown} */
function assertIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey || !isUuid(idempotencyKey)) {
    throw createAppError(
      'property_transition_key_required',
      'A stable idempotency key (UUID) is required. Generate one UUID per operation and reuse it on every retry.',
      { idempotency_key: typeof idempotencyKey === 'string' ? idempotencyKey : null }
    );
  }
  return idempotencyKey;
}

function readCachedExpectations() {
  const cached = (readCache('settings') || [])[0] || {};
  return {
    expectedPropertyType: cached.property_type || cached.business_type || null,
    expectedUpdatedAt: cached.updated_at || null
  };
}

/** @param {string} rpcName @param {unknown} error @param {string} fallbackCode */
function throwRpcFailure(rpcName, error, fallbackCode) {
  const message = error?.message || `Property-type ${rpcName} failed.`;
  const code = error?.code || fallbackCode || 'property_transition_failed';
  throw createAppError(code, message, { rpc: rpcName });
}

/** @param {unknown} payload @param {string} rpcName @returns {unknown} */
function unwrapRpcResult(payload, rpcName) {
  if (payload && payload.success === true) return payload;
  const error = new Error(payload?.error || `Property-type ${rpcName} was rejected by the server.`);
  error.code = payload?.code || 'property_transition_rejected';
  throw error;
}

/**
 * Awaited authoritative settings read for transition reconciliation. Bypasses
 * the local cache, writes it on success, and ALWAYS reports truthfully:
 * `{ ok: true, updatedAt }` or `{ ok: false, reason, detail? }` where reason
 * is one of 'rpc-error' | 'missing-row' | 'scope-changed' | 'lodge-mismatch'
 * | 'exception'. A resolved Supabase error or a missing/mismatched row is a
 * FAILURE, never a silent success. The lodge scope is captured before the
 * await and re-checked after so a scope switch mid-flight cannot reconcile
 * one lodge's cache with another lodge's row.
 */
export async function refreshSettingsCache() {
  const lodgeId = state.lodgeId;
  try {
    const { data, error } = await state.supabase.from('settings').select('*').eq('lodge_id', lodgeId).maybeSingle();
    if (error) {
      console.warn('[PROPERTY_TRANSITION] settings refresh delayed:', error?.message || error);
      return { ok: false, reason: 'rpc-error', detail: error?.message || String(error) };
    }
    if (!data) {
      console.warn('[PROPERTY_TRANSITION] settings refresh delayed: no settings row for this lodge.');
      return { ok: false, reason: 'missing-row' };
    }
    if (state.lodgeId !== lodgeId) {
      console.warn('[PROPERTY_TRANSITION] settings refresh delayed: lodge scope changed during refresh.');
      return { ok: false, reason: 'scope-changed' };
    }
    if (data.lodge_id && data.lodge_id !== lodgeId) {
      console.warn('[PROPERTY_TRANSITION] settings refresh delayed: row lodge mismatch.');
      return { ok: false, reason: 'lodge-mismatch', detail: data.lodge_id };
    }
    writeCache('settings', [{ ...data, lodge_id: data.lodge_id || lodgeId }]);
    return { ok: true, updatedAt: data.updated_at || null };
  } catch (error) {
    console.warn('[PROPERTY_TRANSITION] settings refresh delayed:', error?.message || error);
    return { ok: false, reason: 'exception', detail: error?.message || String(error) };
  }
}

/**
 * Authoritative settings refresh for the Settings recovery path. Same
 * truthful contract as refreshSettingsCache, but also returns the fresh row
 * so the renderer can reconcile without a cache-first read (which could
 * silently reapply stale classification after the server committed).
 * @returns {Promise<{ ok: true, updatedAt: unknown, settings: Record<string, unknown> } | { ok: false, reason: string, detail?: unknown }>}
 */
export async function refreshSettingsFromServer() {
  const lodgeId = state.lodgeId;
  try {
    const { data, error } = await state.supabase.from('settings').select('*').eq('lodge_id', lodgeId).maybeSingle();
    if (error) {
      return { ok: false, reason: 'rpc-error', detail: error?.message || String(error) };
    }
    if (!data) {
      return { ok: false, reason: 'missing-row' };
    }
    if (state.lodgeId !== lodgeId) {
      return { ok: false, reason: 'scope-changed' };
    }
    if (data.lodge_id && data.lodge_id !== lodgeId) {
      return { ok: false, reason: 'lodge-mismatch', detail: data.lodge_id };
    }
    const normalized = { ...data, lodge_id: data.lodge_id || lodgeId };
    writeCache('settings', [normalized]);
    return { ok: true, updatedAt: data.updated_at || null, settings: normalized };
  } catch (error) {
    return { ok: false, reason: 'exception', detail: error?.message || String(error) };
  }
}

/** @param {unknown} targetType @returns {Promise<unknown>} */
export async function previewPropertyTypeChange(targetType) {
  assertOnline();
  assertLodgeSelected();
  const normalized = assertSupportedTarget(targetType);
  const { expectedPropertyType, expectedUpdatedAt } = readCachedExpectations();
  const { data, error } = await state.supabase.rpc('preview_property_type_change', {
    p_lodge_id: state.lodgeId,
    p_target_type: normalized,
    p_expected_property_type: expectedPropertyType,
    p_expected_updated_at: expectedUpdatedAt
  });
  if (error) throwRpcFailure('preview', error, 'property_transition_preview_failed');
  return unwrapRpcResult(data, 'preview');
}

/** @param {{targetType?: unknown, expectedPropertyType?: unknown, expectedUpdatedAt?: unknown, idempotencyKey?: unknown, reason?: unknown}} [options] @returns {Promise<unknown>} */
export async function commitPropertyTypeChange({ targetType, expectedPropertyType, expectedUpdatedAt, idempotencyKey, reason = '' } = {}) {
  assertOnline();
  assertLodgeSelected();
  const normalized = assertSupportedTarget(targetType);
  assertIdempotencyKey(idempotencyKey);
  const cached = readCachedExpectations();
  // The caller-supplied key passes through unchanged on every retry, including
  // after an ambiguous timeout (recover via getPropertyTypeTransitionStatus).
  const { data, error } = await state.supabase.rpc('commit_property_type_change', {
    p_lodge_id: state.lodgeId,
    p_target_type: normalized,
    p_expected_property_type: expectedPropertyType ?? cached.expectedPropertyType,
    p_expected_updated_at: expectedUpdatedAt ?? cached.expectedUpdatedAt,
    p_idempotency_key: idempotencyKey,
    p_reason: reason || ''
  });
  if (error) {
    // Payload-hash mismatch on key reuse surfaces as a uniqueness violation.
    if (error.code === '23505' || /idempotency key .* already used/i.test(error.message || '')) {
      throw createAppError(
        'idempotency_key_reuse_mismatch',
        'That operation key was already used for a different property-type change. Reuse the original values to replay, or generate a new key for a new change.',
        { idempotency_key: idempotencyKey }
      );
    }
    throwRpcFailure('commit', error, 'property_transition_commit_failed');
  }
  const result = unwrapRpcResult(data, 'commit');
  if (result?.success === true) {
    // The commit outcome is authoritative even when the local cache refresh
    // lags: report the server result and ALWAYS attach the truthful refresh
    // state instead of failing the commit (the renderer reconciles via its
    // own authoritative refresh + status check and must never resubmit on a
    // refresh warning). Canonical settings are refreshed on every success,
    // including exact replays, so a stale cache can never silently reapply
    // the old classification after the server committed.
    const refresh = await refreshSettingsCache();
    return { ...result, refresh };
  }
  return result;
}

/** @param {unknown} idempotencyKey @returns {Promise<unknown>} */
export async function getPropertyTypeTransitionStatus(idempotencyKey) {
  assertOnline();
  assertLodgeSelected();
  assertIdempotencyKey(idempotencyKey);
  const { data, error } = await state.supabase.rpc('get_property_type_transition_status', {
    p_lodge_id: state.lodgeId,
    p_idempotency_key: idempotencyKey
  });
  if (error) throwRpcFailure('status', error, 'property_transition_status_failed');
  const result = unwrapRpcResult(data, 'status');
  const outcome = result && typeof result === 'object' ? result.data : null;
  if (result?.success === true && (outcome?.changed === true || outcome?.changed === false)) {
    // A recovered authoritative outcome reconciles canonical settings too,
    // so a late-arriving ordinary save cannot overwrite the committed
    // classification. The truthful refresh state is ALWAYS attached; a
    // refresh failure is flagged, never fatal.
    const refresh = await refreshSettingsCache();
    return { ...result, refresh };
  }
  return result;
}
