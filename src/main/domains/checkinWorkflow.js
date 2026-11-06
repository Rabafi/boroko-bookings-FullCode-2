// @ts-check
import { state } from '../state.js'
import { logActivity, readCache, writeCache, dedupePromise } from './infrastructure.js'
import { getAllBookings } from './bookings.js'
import { getAllRooms } from './rooms.js'

const CHECKIN_CACHE = 'checkin-checklist'
const CHECKOUT_CACHE = 'checkout-checklist'
const CONFIG_CACHE = 'checkin-config'

/** @typedef {Record<string, unknown>} CheckinRecordExpectedView */
/** @typedef {CheckinRecordExpectedView & {items?: unknown, config?: unknown, ready_to_check_in?: unknown, ready_to_check_out?: unknown}} CheckinPayloadExpectedView */
/** @typedef {CheckinRecordExpectedView & {completed?: unknown, required?: unknown, id?: unknown, step_key?: unknown}} CheckinItemExpectedView */
/** @typedef {CheckinRecordExpectedView & {total_amount?: unknown, charges_total?: unknown, amount_paid?: unknown, deposit_amount?: unknown}} CheckinBookingFinancialExpectedView */
/** @typedef {CheckinRecordExpectedView & {id?: unknown, room_number?: unknown, room_type?: unknown, status?: unknown, housekeeping_status?: unknown, housekeeping_notes?: unknown}} CheckinRoomExpectedView */
/** @typedef {{message?: unknown}} CheckinErrorExpectedView */

/** @param {unknown} data @returns {CheckinPayloadExpectedView & {items: CheckinItemExpectedView[]}} */
function normalizeChecklistPayload(data) {
  if (!data || typeof data !== 'object') {
    return { items: [], config: null, ready_to_check_in: false, ready_to_check_out: false }
  }
  const payload = /** @type {CheckinPayloadExpectedView} */ (data)
  const items = Array.isArray(payload.items)
    ? payload.items.map((/** @type {unknown} */ item) => {
      const itemView = /** @type {CheckinItemExpectedView|null|undefined} */ (item)
      return ({
        .../** @type {CheckinRecordExpectedView|null|undefined} */ (item),
        // Strict boolean — never treat missing/null as completed
        completed: itemView?.completed === true,
        required: itemView?.required === true
      })
    })
    : []
  return { ...payload, items }
}

/**
 * Booking ledger fields used only as display estimates for the desk.
 * Never author payment_status client-side.
 */
/** @param {unknown} booking */
function computeBalanceEstimate(booking) {
  if (!booking || typeof booking !== 'object') {
    return {
      total_estimate: 0,
      amount_paid_estimate: 0,
      balance_due_estimate: 0,
      deposit_amount: 0,
      balance_source: 'booking_ledger_estimate'
    }
  }
  const bookingView = /** @type {CheckinBookingFinancialExpectedView} */ (booking)
  const total = Number(bookingView.total_amount || 0) + Number(bookingView.charges_total || 0)
  const paid = Number(bookingView.amount_paid || 0)
  return {
    total_estimate: total,
    amount_paid_estimate: paid,
    balance_due_estimate: Math.max(0, total - paid),
    deposit_amount: Number(bookingView.deposit_amount || 0),
    balance_source: 'booking_ledger_estimate'
  }
}

/** @param {unknown} room */
function roomReadiness(room) {
  if (!room) {
    return {
      room_assigned: false,
      room_ready: false,
      room_status: null,
      housekeeping_status: null,
      blockers: ['No room assigned to this booking']
    }
  }
  const roomView = /** @type {CheckinRoomExpectedView} */ (room)
  const status = String(roomView.status || '').toLowerCase()
  const hk = String(roomView.housekeeping_status || 'clean').toLowerCase()
  const blockers = []
  if (status === 'maintenance' || hk === 'out_of_order' || hk === 'out_of_service') {
    blockers.push('Room is out of order / under maintenance')
  }
  if (hk === 'dirty' || hk === 'in_progress') {
    blockers.push(`Housekeeping not ready (${hk.replace(/_/g, ' ')})`)
  }
  // inspected and clean are ready; available/occupied without dirty are ready for assignment
  const ready =
    blockers.length === 0 &&
    !['dirty', 'in_progress', 'out_of_order', 'out_of_service'].includes(hk)
  return {
    room_assigned: true,
    room_id: roomView.id,
    room_number: roomView.room_number || null,
    room_type: roomView.room_type || null,
    room_ready: ready,
    room_status: roomView.status || null,
    housekeeping_status: roomView.housekeeping_status || 'clean',
    housekeeping_notes: roomView.housekeeping_notes || '',
    blockers
  }
}

/** @param {unknown} bookingId */
async function loadBookingAndRoom(bookingId) {
  let booking = null
  try {
    const bookings = await getAllBookings()
    booking = (Array.isArray(bookings) ? bookings : []).find((/** @type {unknown} */ b) => String((/** @type {CheckinRecordExpectedView|null|undefined} */ (b))?.id) === String(bookingId)) || null
  } catch {
    const cached = readCache('bookings') || []
    booking = (Array.isArray(cached) ? cached : []).find((/** @type {unknown} */ b) => String((/** @type {CheckinRecordExpectedView|null|undefined} */ (b))?.id) === String(bookingId)) || null
  }
  let room = null
  const bookingView = /** @type {CheckinRecordExpectedView|null} */ (booking)
  if (bookingView?.room_id) {
    try {
      const rooms = await getAllRooms()
      room = (Array.isArray(rooms) ? rooms : []).find((/** @type {unknown} */ r) => String((/** @type {CheckinRecordExpectedView|null|undefined} */ (r))?.id) === String(bookingView.room_id)) || null
    } catch {
      const cachedRooms = readCache('rooms') || []
      room = (Array.isArray(cachedRooms) ? cachedRooms : []).find((/** @type {unknown} */ r) => String((/** @type {CheckinRecordExpectedView|null|undefined} */ (r))?.id) === String(bookingView.room_id)) || null
    }
  }
  return { booking, room }
}

/** @param {unknown} bookingId @param {unknown} payload @param {string} [mode] */
async function enrichChecklist(bookingId, payload, mode = 'checkin') {
  const normalized = normalizeChecklistPayload(payload)
  const { booking, room } = await loadBookingAndRoom(bookingId)
  const balance = computeBalanceEstimate(booking)
  const readiness = roomReadiness(room)
  const incompleteRequired = (normalized.items || []).filter(
    (/** @type {CheckinItemExpectedView} */ item) => item.required === true && item.completed !== true
  )

  const messaging = []
  if (balance.balance_due_estimate > 0.009) {
    messaging.push({
      level: 'warn',
      code: 'balance_due',
      message: `Outstanding balance estimate: ${balance.balance_due_estimate.toFixed(2)} (from booking ledger — not folio-authoritative)`
    })
  } else {
    messaging.push({
      level: 'info',
      code: 'balance_settled',
      message: 'Booking ledger estimate shows no outstanding balance (confirm on folio before final settlement).'
    })
  }
  if (balance.deposit_amount > 0) {
    messaging.push({
      level: 'info',
      code: 'deposit_on_file',
      message: `Deposit on file (estimate): ${Number(balance.deposit_amount).toFixed(2)}`
    })
  }
  for (const blocker of readiness.blockers || []) {
    messaging.push({ level: 'blocker', code: 'room_readiness', message: blocker })
  }
  if (incompleteRequired.length > 0) {
    messaging.push({
      level: 'warn',
      code: 'required_steps',
      message: `${incompleteRequired.length} required checklist step(s) incomplete`
    })
  }

  const bookingView = /** @type {CheckinRecordExpectedView|null} */ (booking)
  const preArrival = {
    mode,
    booking_id: bookingId,
    guest_name: bookingView?.customer_name || bookingView?.guest_name || null,
    booking_status: bookingView?.status || null,
    ...balance,
    ...readiness,
    incomplete_required_steps: incompleteRequired.map((s) => s.step_key || s.id),
    can_manager_override: incompleteRequired.length > 0,
    messaging
  }

  return {
    ...normalized,
    pre_arrival: preArrival,
    readiness: preArrival
  }
}

/** @param {unknown} bookingId */
async function _getCheckinChecklist(bookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { items: [], config: null, ready_to_check_in: false }
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_checkin_checklist', {
      p_booking_id: bookingId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    const enriched = await enrichChecklist(bookingId, data, 'checkin')
    writeCache(`${CHECKIN_CACHE}-${bookingId}`, enriched)
    return enriched
  } catch (e) {
    const errorView = /** @type {CheckinErrorExpectedView|null|undefined} */ (e)
    const cached = readCache(`${CHECKIN_CACHE}-${bookingId}`)
    if (cached && typeof cached === 'object') {
      const enriched = await enrichChecklist(bookingId, cached, 'checkin')
      return {
        ...enriched,
        stale: true,
        from_cache: true,
        warning: errorView?.message || 'Using cached checklist; live load failed'
      }
    }
    // Never convert a live failure into empty success
    throw new Error(errorView?.message || 'Could not load check-in checklist')
  }
}

/** @param {unknown} stepId @param {unknown} completedBy @param {unknown} data */
async function _completeCheckinStep(stepId, completedBy, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) throw new Error('Completing check-in steps requires an online connection')
  const actor = completedBy || state.currentUser?.id || null
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('complete_checkin_step', {
    p_step_id: stepId,
    p_lodge_id: currentLodgeId,
    p_completed_by: actor,
    p_data: data || null
  })
  if (error) throw error
  const resultView = /** @type {{success?: unknown, error?: unknown}|null|undefined} */ (result)
  if (resultView?.success === false) throw new Error(/** @type {string} */ (resultView.error || 'Could not complete check-in step'))
  return result
}

/** @param {unknown} stepId */
async function _resetCheckinStep(stepId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) throw new Error('Resetting check-in steps requires an online connection')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('reset_checkin_step', {
    p_step_id: stepId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  const dataView = /** @type {{success?: unknown, error?: unknown}|null|undefined} */ (data)
  if (dataView?.success === false) throw new Error(/** @type {string} */ (dataView.error || 'Could not reset check-in step'))
  return data
}

/** @param {unknown} bookingId */
async function _getCheckoutChecklist(bookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { items: [], ready_to_check_out: false }
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_checkout_checklist', {
      p_booking_id: bookingId,
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    const enriched = await enrichChecklist(bookingId, data, 'checkout')
    writeCache(`${CHECKOUT_CACHE}-${bookingId}`, enriched)
    return enriched
  } catch (e) {
    const errorView = /** @type {CheckinErrorExpectedView|null|undefined} */ (e)
    const cached = readCache(`${CHECKOUT_CACHE}-${bookingId}`)
    if (cached && typeof cached === 'object') {
      const enriched = await enrichChecklist(bookingId, cached, 'checkout')
      return {
        ...enriched,
        stale: true,
        from_cache: true,
        warning: errorView?.message || 'Using cached checklist; live load failed'
      }
    }
    throw new Error(errorView?.message || 'Could not load check-out checklist')
  }
}

/** @param {unknown} stepId @param {unknown} completedBy @param {unknown} data */
async function _completeCheckoutStep(stepId, completedBy, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) throw new Error('Completing check-out steps requires an online connection')
  const actor = completedBy || state.currentUser?.id || null
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('complete_checkout_step', {
    p_step_id: stepId,
    p_lodge_id: currentLodgeId,
    p_completed_by: actor,
    p_data: data || null
  })
  if (error) throw error
  const resultView = /** @type {{success?: unknown, error?: unknown}|null|undefined} */ (result)
  if (resultView?.success === false) throw new Error(/** @type {string} */ (resultView.error || 'Could not complete check-out step'))
  return result
}

/** @param {unknown} stepId */
async function _resetCheckoutStep(stepId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) throw new Error('Resetting check-out steps requires an online connection')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('reset_checkout_step', {
    p_step_id: stepId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  const dataView = /** @type {{success?: unknown, error?: unknown}|null|undefined} */ (data)
  if (dataView?.success === false) throw new Error(/** @type {string} */ (dataView.error || 'Could not reset check-out step'))
  return data
}

async function _getCheckinConfig() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return { config: null }
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_checkin_config', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    if (data) writeCache(CONFIG_CACHE, data)
    return data || { config: null }
  } catch (e) {
    const errorView = /** @type {CheckinErrorExpectedView|null|undefined} */ (e)
    const cached = readCache(CONFIG_CACHE)
    if (cached) {
      return { ...cached, stale: true, from_cache: true, warning: errorView?.message || 'Using cached config' }
    }
    throw new Error(errorView?.message || 'Could not load check-in config')
  }
}

/** @param {unknown} config */
async function _updateCheckinConfig(config) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_checkin_config', {
    p_lodge_id: currentLodgeId,
    p_config: config
  })
  if (error) throw error
  return data
}

/** @param {unknown} bookingId */
export async function completeHotelCheckin(bookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) throw new Error('Hotel check-in requires an online connection')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('complete_hotel_checkin', {
    p_lodge_id: currentLodgeId,
    p_booking_id: bookingId
  })
  if (error) throw error
  const dataView = /** @type {{success?: unknown, error?: unknown}|null|undefined} */ (data)
  if (dataView?.success === false) throw new Error(/** @type {string} */ (dataView.error || 'Check-in failed'))
  logActivity('hotel_checkin', `Booking ${bookingId} checked in via hotel workflow`)
  return data
}

/** @param {unknown} bookingId */
export async function completeHotelCheckout(bookingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!state.isOnline) throw new Error('Hotel check-out requires an online connection')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('complete_hotel_checkout', {
    p_lodge_id: currentLodgeId,
    p_booking_id: bookingId
  })
  if (error) throw error
  const dataView = /** @type {{success?: unknown, error?: unknown, balance?: unknown}|null|undefined} */ (data)
  if (dataView?.success === false) {
    const balanceHint =
      dataView.balance != null ? ` (open folio balance: ${dataView.balance})` : ''
    throw new Error(/** @type {string} */ (dataView.error || 'Check-out failed') + balanceHint)
  }
  logActivity('hotel_checkout', `Booking ${bookingId} checked out via hotel workflow`)
  return data
}

/**
 * Manager override: mark remaining required check-in steps complete via existing
 * complete_checkin_step RPC with auditable override reason in step data, then
 * complete the hotel check-in. There is no separate bypass RPC — incomplete
 * required steps still block complete_hotel_checkin server-side.
 */
/** @param {unknown} bookingId @param {unknown} overrideReason @param {unknown} [completedBy] */
export async function completeHotelCheckinWithOverride(bookingId, overrideReason, completedBy = null) {
  const reason = String(overrideReason || '').trim()
  if (!reason) throw new Error('Manager override requires a reason')
  if (!state.isOnline) throw new Error('Manager override check-in requires an online connection')

  const checklist = await _getCheckinChecklist(bookingId)
  const incomplete = (checklist.items || []).filter(
    (/** @type {CheckinItemExpectedView} */ item) => item.required === true && item.completed !== true
  )
  const actor = completedBy || state.currentUser?.id || null
  for (const step of incomplete) {
    await _completeCheckinStep(step.id, actor, {
      manager_override: true,
      override_reason: reason,
      overridden_at: new Date().toISOString(),
      original_step_key: step.step_key || null
    })
  }
  logActivity(
    'hotel_checkin_override',
    `Manager override check-in for booking ${bookingId}: ${reason} (${incomplete.length} step(s))`
  )
  return completeHotelCheckin(bookingId)
}

/** @param {unknown} roomId @param {unknown} [date] @param {unknown} [corporateAccountId] */
export async function getApplicableRoomRate(roomId, date = null, corporateAccountId = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_applicable_room_rate', {
    p_lodge_id: currentLodgeId,
    p_room_id: roomId,
    p_date: date || new Date().toISOString().slice(0, 10),
    p_corporate_account_id: corporateAccountId
  })
  if (error) throw error
  return data
}

/** @param {unknown} roomId @param {unknown} checkIn @param {unknown} checkOut @param {unknown} [corporateAccountId] */
export async function quoteRoomStay(roomId, checkIn, checkOut, corporateAccountId = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('quote_room_stay', {
    p_lodge_id: currentLodgeId,
    p_room_id: roomId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_corporate_account_id: corporateAccountId
  })
  if (error) throw error
  const dataView = /** @type {{success?: unknown, error?: unknown}|null|undefined} */ (data)
  if (dataView?.success === false) throw new Error(/** @type {string} */ (dataView.error || 'Could not quote stay'))
  return data
}

/** @type {(...args: Parameters<typeof _getCheckinChecklist>) => ReturnType<typeof _getCheckinChecklist>} */
export const getCheckinChecklist = (...args) =>
  dedupePromise('getCheckinChecklist', () => _getCheckinChecklist(...args))
/** @type {(...args: Parameters<typeof _completeCheckinStep>) => ReturnType<typeof _completeCheckinStep>} */
export const completeCheckinStep = (...args) =>
  dedupePromise('completeCheckinStep', () => _completeCheckinStep(...args))
/** @type {(...args: Parameters<typeof _resetCheckinStep>) => ReturnType<typeof _resetCheckinStep>} */
export const resetCheckinStep = (...args) =>
  dedupePromise('resetCheckinStep', () => _resetCheckinStep(...args))
/** @type {(...args: Parameters<typeof _getCheckoutChecklist>) => ReturnType<typeof _getCheckoutChecklist>} */
export const getCheckoutChecklist = (...args) =>
  dedupePromise('getCheckoutChecklist', () => _getCheckoutChecklist(...args))
/** @type {(...args: Parameters<typeof _completeCheckoutStep>) => ReturnType<typeof _completeCheckoutStep>} */
export const completeCheckoutStep = (...args) =>
  dedupePromise('completeCheckoutStep', () => _completeCheckoutStep(...args))
/** @type {(...args: Parameters<typeof _resetCheckoutStep>) => ReturnType<typeof _resetCheckoutStep>} */
export const resetCheckoutStep = (...args) =>
  dedupePromise('resetCheckoutStep', () => _resetCheckoutStep(...args))
/** @type {(...args: Parameters<typeof _getCheckinConfig>) => ReturnType<typeof _getCheckinConfig>} */
export const getCheckinConfig = (...args) =>
  dedupePromise('getCheckinConfig', () => _getCheckinConfig(...args))
/** @type {(...args: Parameters<typeof _updateCheckinConfig>) => ReturnType<typeof _updateCheckinConfig>} */
export const updateCheckinConfig = (...args) =>
  dedupePromise('updateCheckinConfig', () => _updateCheckinConfig(...args))
