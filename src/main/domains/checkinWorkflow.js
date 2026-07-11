import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CHECKIN_CACHE = 'checkin-checklist'
const CHECKOUT_CACHE = 'checkout-checklist'
const CONFIG_CACHE = 'checkin-config'

async function _getCheckinChecklist(bookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { items: [], config: null }
  try {
    const { data, error } = await state.supabase.rpc('get_checkin_checklist', { p_booking_id: bookingId, p_lodge_id: currentLodgeId })
    if (error) throw error
    if (data) writeCache(`${CHECKIN_CACHE}-${bookingId}`, data)
    return data || { items: [], config: null }
  } catch (e) {
    const cached = readCache(`${CHECKIN_CACHE}-${bookingId}`)
    return cached || { items: [], config: null }
  }
}

async function _completeCheckinStep(stepId, completedBy, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('complete_checkin_step', { p_step_id: stepId, p_lodge_id: currentLodgeId, p_completed_by: completedBy, p_data: data || null })
  if (error) throw error
  return result
}

async function _resetCheckinStep(stepId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('reset_checkin_step', { p_step_id: stepId, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

async function _getCheckoutChecklist(bookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { items: [] }
  try {
    const { data, error } = await state.supabase.rpc('get_checkout_checklist', { p_booking_id: bookingId, p_lodge_id: currentLodgeId })
    if (error) throw error
    if (data) writeCache(`${CHECKOUT_CACHE}-${bookingId}`, data)
    return data || { items: [] }
  } catch (e) {
    const cached = readCache(`${CHECKOUT_CACHE}-${bookingId}`)
    return cached || { items: [] }
  }
}

async function _completeCheckoutStep(stepId, completedBy, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('complete_checkout_step', { p_step_id: stepId, p_lodge_id: currentLodgeId, p_completed_by: completedBy, p_data: data || null })
  if (error) throw error
  return result
}

async function _resetCheckoutStep(stepId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('reset_checkout_step', { p_step_id: stepId, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

async function _getCheckinConfig() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { config: null }
  try {
    const { data, error } = await state.supabase.rpc('get_checkin_config', { p_lodge_id: currentLodgeId })
    if (error) throw error
    if (data) writeCache(CONFIG_CACHE, data)
    return data || { config: null }
  } catch (e) {
    const cached = readCache(CONFIG_CACHE)
    return cached || { config: null }
  }
}

async function _updateCheckinConfig(config) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('update_checkin_config', { p_lodge_id: currentLodgeId, p_config: config })
  if (error) throw error
  return data
}

export const getCheckinChecklist = (...args) => dedupePromise('getCheckinChecklist', () => _getCheckinChecklist(...args))
export const completeCheckinStep = (...args) => dedupePromise('completeCheckinStep', () => _completeCheckinStep(...args))
export const resetCheckinStep = (...args) => dedupePromise('resetCheckinStep', () => _resetCheckinStep(...args))
export const getCheckoutChecklist = (...args) => dedupePromise('getCheckoutChecklist', () => _getCheckoutChecklist(...args))
export const completeCheckoutStep = (...args) => dedupePromise('completeCheckoutStep', () => _completeCheckoutStep(...args))
export const resetCheckoutStep = (...args) => dedupePromise('resetCheckoutStep', () => _resetCheckoutStep(...args))
export const getCheckinConfig = (...args) => dedupePromise('getCheckinConfig', () => _getCheckinConfig(...args))
export const updateCheckinConfig = (...args) => dedupePromise('updateCheckinConfig', () => _updateCheckinConfig(...args))
