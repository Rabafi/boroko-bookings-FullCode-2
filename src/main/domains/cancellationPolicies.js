// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const POLICY_CACHE = 'cancellation-policies'
const REQUEST_CACHE = 'cancellation-requests'

/** @typedef {Record<string, unknown>} CancellationPolicyPropertyView */

/**
 * Cancellation fee calculation / approval / processing affects refunds — ONLINE-ONLY
 * (docs/OFFLINE_MATRIX.md).
 */
/** @param {string} operation */
function requireOnlineFinancial(operation) {
  if (state.isOnline === false) {
    const err = new Error(
      `${operation} requires an internet connection. Cancellation financial mutations cannot be queued offline.`
    )
    err.onlineOnly = true
    throw err
  }
}

/** @returns {Promise<unknown>} */
async function _getAllCancellationPolicies() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { policies: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_cancellation_policies', { p_lodge_id: currentLodgeId })
    if (error) throw error
    // Supabase's generated RPC client exposes unvalidated JSON as upstream `any`.
    const result = /** @type {unknown} */ (data) || { policies: [] }
    const resultView = /** @type {CancellationPolicyPropertyView} */ (result)
    writeCache(POLICY_CACHE, resultView.policies || [])
    return result
  } catch (e) {
    const cached = readCache(POLICY_CACHE)
    return { policies: Array.isArray(cached) ? cached : [] }
  }
}

/** @param {unknown} payload @returns {Promise<unknown>} */
async function _createCancellationPolicy(payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // The caller's object is forwarded without validation; this view only types
  // the same property reads, including the existing throw for nullish input.
  const values = /** @type {CancellationPolicyPropertyView} */ (payload)
  const { data, error } = await state.supabase.rpc('create_cancellation_policy', {
    p_lodge_id: currentLodgeId, p_name: values.name,
    p_applicable_sources: values.applicable_sources || '[]',
    p_free_cancellation_hours: values.free_cancellation_hours || 24,
    p_fee_type: values.fee_type || 'flat', p_fee_amount_or_percent: values.fee_amount_or_percent || 0,
    p_deposit_retention_behavior: values.deposit_retention_behavior || 'forfeit',
    p_customer_credit_behavior: values.customer_credit_behavior || false,
    p_active: values.active !== false, p_priority: values.priority || 0
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload @returns {Promise<unknown>} */
async function _updateCancellationPolicy(id, payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // This is a non-validating property-read view, preserving forwarded values.
  const values = /** @type {CancellationPolicyPropertyView} */ (payload)
  const { data, error } = await state.supabase.rpc('update_cancellation_policy', {
    p_id: id, p_lodge_id: currentLodgeId, p_name: values.name || null,
    p_applicable_sources: values.applicable_sources || null,
    p_free_cancellation_hours: values.free_cancellation_hours, p_fee_type: values.fee_type || null,
    p_fee_amount_or_percent: values.fee_amount_or_percent,
    p_deposit_retention_behavior: values.deposit_retention_behavior || null,
    p_customer_credit_behavior: values.customer_credit_behavior,
    p_active: values.active, p_priority: values.priority
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @returns {Promise<unknown>} */
async function _deleteCancellationPolicy(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_cancellation_policy', { p_id: id, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

/** @param {unknown} bookingId @param {unknown} reasonCategory @returns {Promise<unknown>} */
async function _calculateCancellationFee(bookingId, reasonCategory) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineFinancial('Calculate cancellation fee')
  const { data, error } = await state.supabase.rpc('calculate_cancellation_fee', {
    p_booking_id: bookingId, p_reason_category: reasonCategory || null, p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

/** @param {unknown} requestId @param {unknown} approvedBy @returns {Promise<unknown>} */
async function _processCancellation(requestId, approvedBy) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineFinancial('Process cancellation')
  const { data, error } = await state.supabase.rpc('create_cancellation_request', {
    p_lodge_id: currentLodgeId, p_booking_id: requestId, p_policy_id: null,
    p_reason_category: null, p_reason_detail: null
  })
  if (error) throw error
  return data
}

/** @returns {Promise<unknown>} */
async function _getAllCancellationRequests() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { requests: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_cancellation_requests', { p_lodge_id: currentLodgeId })
    if (error) throw error
    // Preserve the raw RPC result while typing only the existing property read.
    const result = /** @type {unknown} */ (data) || { requests: [] }
    const resultView = /** @type {CancellationPolicyPropertyView} */ (result)
    writeCache(REQUEST_CACHE, resultView.requests || [])
    return result
  } catch (e) {
    const cached = readCache(REQUEST_CACHE)
    return { requests: Array.isArray(cached) ? cached : [] }
  }
}

/** @param {unknown} requestId @param {unknown} approvedBy @returns {Promise<unknown>} */
async function _approveCancellation(requestId, approvedBy) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineFinancial('Approve cancellation')
  const { data, error } = await state.supabase.rpc('approve_cancellation', {
    p_request_id: requestId, p_lodge_id: currentLodgeId, p_approved_by: approvedBy
  })
  if (error) throw error
  return data
}

/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getAllCancellationPolicies = (...args) => dedupePromise('getAllCancellationPolicies', () => _getAllCancellationPolicies(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const createCancellationPolicy = (...args) => dedupePromise('createCancellationPolicy', () => _createCancellationPolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const updateCancellationPolicy = (...args) => dedupePromise('updateCancellationPolicy', () => _updateCancellationPolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const deleteCancellationPolicy = (...args) => dedupePromise('deleteCancellationPolicy', () => _deleteCancellationPolicy(...args))
export const calculateCancellationFee = _calculateCancellationFee
export const processCancellation = _processCancellation
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getAllCancellationRequests = (...args) => dedupePromise('getAllCancellationRequests', () => _getAllCancellationRequests(...args))
export const approveCancellation = _approveCancellation
