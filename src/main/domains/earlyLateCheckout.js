// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const EARLY_POLICY_CACHE = 'early-checkin-policies'
const LATE_POLICY_CACHE = 'late-checkout-policies'
const EARLY_REQ_CACHE = 'early-checkin-requests'
const LATE_REQ_CACHE = 'late-checkout-requests'

/** @typedef {Record<string, unknown>} EarlyLatePropertyView */

/**
 * Approval affects billing fees — ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
 */
/** @param {string} operation */
function requireOnlineApproval(operation) {
  if (state.isOnline === false) {
    const err = new Error(
      `${operation} requires an internet connection. Early/late approval cannot be queued offline.`
    )
    err.onlineOnly = true
    throw err
  }
}

/** @returns {Promise<unknown>} */
async function _getEarlyPolicies() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { policies: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_early_checkin_policies', { p_lodge_id: currentLodgeId })
    if (error) throw error
    // The generated Supabase RPC client currently exposes unvalidated JSON as `any`.
    const result = /** @type {unknown} */ (data) || { policies: [] }
    const resultView = /** @type {EarlyLatePropertyView} */ (result)
    writeCache(EARLY_POLICY_CACHE, resultView.policies || [])
    return result
  } catch (e) {
    const cached = readCache(EARLY_POLICY_CACHE)
    return { policies: Array.isArray(cached) ? cached : [] }
  }
}

/** @param {unknown} payload @returns {Promise<unknown>} */
async function _createEarlyPolicy(payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // Type-only property view: the original unvalidated reads and failures remain.
  const values = /** @type {EarlyLatePropertyView} */ (payload)
  const { data, error } = await state.supabase.rpc('create_early_checkin_policy', {
    p_lodge_id: currentLodgeId, p_name: values.name, p_fee_type: values.fee_type,
    p_fee_amount: values.fee_amount || 0, p_fee_percentage: values.fee_percentage || 0,
    p_allowed_window_hours: values.allowed_window_hours || 2, p_requires_approval: values.requires_approval || false,
    p_active: values.active !== false
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload @returns {Promise<unknown>} */
async function _updateEarlyPolicy(id, payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const values = /** @type {EarlyLatePropertyView} */ (payload)
  const { data, error } = await state.supabase.rpc('update_early_checkin_policy', {
    p_id: id, p_lodge_id: currentLodgeId, p_name: values.name || null, p_fee_type: values.fee_type || null,
    p_fee_amount: values.fee_amount, p_fee_percentage: values.fee_percentage,
    p_allowed_window_hours: values.allowed_window_hours, p_requires_approval: values.requires_approval,
    p_active: values.active
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @returns {Promise<unknown>} */
async function _deleteEarlyPolicy(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_early_checkin_policy', { p_id: id, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

/** @returns {Promise<unknown>} */
async function _getLatePolicies() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { policies: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_late_checkout_policies', { p_lodge_id: currentLodgeId })
    if (error) throw error
    // Preserve the raw RPC result; this only types the existing property read.
    const result = /** @type {unknown} */ (data) || { policies: [] }
    const resultView = /** @type {EarlyLatePropertyView} */ (result)
    writeCache(LATE_POLICY_CACHE, resultView.policies || [])
    return result
  } catch (e) {
    const cached = readCache(LATE_POLICY_CACHE)
    return { policies: Array.isArray(cached) ? cached : [] }
  }
}

/** @param {unknown} payload @returns {Promise<unknown>} */
async function _createLatePolicy(payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const values = /** @type {EarlyLatePropertyView} */ (payload)
  const { data, error } = await state.supabase.rpc('create_late_checkout_policy', {
    p_lodge_id: currentLodgeId, p_name: values.name, p_fee_type: values.fee_type,
    p_fee_amount: values.fee_amount || 0, p_fee_percentage: values.fee_percentage || 0,
    p_allowed_window_hours: values.allowed_window_hours || 2, p_requires_approval: values.requires_approval || false,
    p_active: values.active !== false
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload @returns {Promise<unknown>} */
async function _updateLatePolicy(id, payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const values = /** @type {EarlyLatePropertyView} */ (payload)
  const { data, error } = await state.supabase.rpc('update_late_checkout_policy', {
    p_id: id, p_lodge_id: currentLodgeId, p_name: values.name || null, p_fee_type: values.fee_type || null,
    p_fee_amount: values.fee_amount, p_fee_percentage: values.fee_percentage,
    p_allowed_window_hours: values.allowed_window_hours, p_requires_approval: values.requires_approval,
    p_active: values.active
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @returns {Promise<unknown>} */
async function _deleteLatePolicy(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_late_checkout_policy', { p_id: id, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

/** @returns {Promise<unknown>} */
async function _getEarlyRequests() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { requests: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_early_checkin_requests', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const result = /** @type {unknown} */ (data) || { requests: [] }
    const resultView = /** @type {EarlyLatePropertyView} */ (result)
    writeCache(EARLY_REQ_CACHE, resultView.requests || [])
    return result
  } catch (e) {
    const cached = readCache(EARLY_REQ_CACHE)
    return { requests: Array.isArray(cached) ? cached : [] }
  }
}

/** @param {unknown} bookingId @param {unknown} policyId @param {unknown} time @param {unknown} notes @returns {Promise<unknown>} */
async function _createEarlyRequest(bookingId, policyId, time, notes) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_early_checkin_request', {
    p_lodge_id: currentLodgeId, p_booking_id: bookingId, p_policy_id: policyId,
    p_requested_time: time, p_notes: notes || null
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @returns {Promise<unknown>} */
async function _approveEarlyRequest(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineApproval('Approve early check-in request')
  const { data, error } = await state.supabase.rpc('approve_early_checkin_request', { p_request_id: id, p_lodge_id: currentLodgeId, p_approved_by: state.currentUser?.id || null })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} notes @returns {Promise<unknown>} */
async function _rejectEarlyRequest(id, notes) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('reject_early_checkin_request', { p_request_id: id, p_lodge_id: currentLodgeId, p_approved_by: state.currentUser?.id || null, p_notes: notes || null })
  if (error) throw error
  return data
}

/** @returns {Promise<unknown>} */
async function _getLateRequests() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { requests: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_late_checkout_requests', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const result = /** @type {unknown} */ (data) || { requests: [] }
    const resultView = /** @type {EarlyLatePropertyView} */ (result)
    writeCache(LATE_REQ_CACHE, resultView.requests || [])
    return result
  } catch (e) {
    const cached = readCache(LATE_REQ_CACHE)
    return { requests: Array.isArray(cached) ? cached : [] }
  }
}

/** @param {unknown} bookingId @param {unknown} policyId @param {unknown} time @param {unknown} notes @returns {Promise<unknown>} */
async function _createLateRequest(bookingId, policyId, time, notes) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_late_checkout_request', {
    p_lodge_id: currentLodgeId, p_booking_id: bookingId, p_policy_id: policyId,
    p_requested_time: time, p_notes: notes || null
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @returns {Promise<unknown>} */
async function _approveLateRequest(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnlineApproval('Approve late check-out request')
  const { data, error } = await state.supabase.rpc('approve_late_checkout_request', { p_request_id: id, p_lodge_id: currentLodgeId, p_approved_by: state.currentUser?.id || null })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} notes @returns {Promise<unknown>} */
async function _rejectLateRequest(id, notes) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('reject_late_checkout_request', { p_request_id: id, p_lodge_id: currentLodgeId, p_approved_by: state.currentUser?.id || null, p_notes: notes || null })
  if (error) throw error
  return data
}

/** @param {unknown} bookingId @param {unknown} time @returns {Promise<unknown>} */
async function _calculateEarlyFee(bookingId, time) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('calculate_early_checkin_fee', { p_booking_id: bookingId, p_requested_time: time, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

/** @param {unknown} bookingId @param {unknown} time @returns {Promise<unknown>} */
async function _calculateLateFee(bookingId, time) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('calculate_late_checkout_fee', { p_booking_id: bookingId, p_requested_time: time, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getEarlyPolicies = (...args) => dedupePromise('getEarlyPolicies', () => _getEarlyPolicies(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const createEarlyPolicy = (...args) => dedupePromise('createEarlyPolicy', () => _createEarlyPolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const updateEarlyPolicy = (...args) => dedupePromise('updateEarlyPolicy', () => _updateEarlyPolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const deleteEarlyPolicy = (...args) => dedupePromise('deleteEarlyPolicy', () => _deleteEarlyPolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getLatePolicies = (...args) => dedupePromise('getLatePolicies', () => _getLatePolicies(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const createLatePolicy = (...args) => dedupePromise('createLatePolicy', () => _createLatePolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const updateLatePolicy = (...args) => dedupePromise('updateLatePolicy', () => _updateLatePolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const deleteLatePolicy = (...args) => dedupePromise('deleteLatePolicy', () => _deleteLatePolicy(...args))
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getEarlyRequests = (...args) => dedupePromise('getEarlyRequests', () => _getEarlyRequests(...args))
export const createEarlyRequest = _createEarlyRequest
export const approveEarlyRequest = _approveEarlyRequest
export const rejectEarlyRequest = _rejectEarlyRequest
/** @type {(...args: unknown[]) => Promise<unknown>} */
export const getLateRequests = (...args) => dedupePromise('getLateRequests', () => _getLateRequests(...args))
export const createLateRequest = _createLateRequest
export const approveLateRequest = _approveLateRequest
export const rejectLateRequest = _rejectLateRequest
export const calculateEarlyFee = _calculateEarlyFee
export const calculateLateFee = _calculateLateFee
