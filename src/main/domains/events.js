import { randomUUID } from 'crypto'
import crypto from 'crypto'
import { state } from '../state.js'
import {
  dedupePromise,
  logActivity,
  queueOperation,
  readCache,
  refreshCache,
  writeCache
} from './infrastructure.js'

// ─── EVENTS & VENUES ──────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = ['conference', 'meeting', 'party', 'wedding', 'corporate', 'pool_party', 'braai', 'reception', 'other']
const VALID_SCOPES = ['venue_only', 'venue_with_rooms', 'exclusive_lodge']
const VALID_EVENT_STATUSES = ['draft', 'reserved', 'confirmed', 'active', 'completed', 'cancelled']

function getCachedEventLineItems(eventId) {
  return readCache('event-line-items')
    .filter((line) => line?.event_booking_id === eventId && !line?.voided_at)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

function upsertCachedEventLineItem(line = {}) {
  if (!line?.id) return
  writeCache('event-line-items', [
    line,
    ...readCache('event-line-items').filter((row) => row?.id !== line.id)
  ].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))))
}

function patchCachedEventLineItem(lineItemId, patch = {}) {
  const rows = readCache('event-line-items')
  const idx = rows.findIndex((line) => line?.id === lineItemId)
  if (idx < 0) return null
  const next = [...rows]
  next[idx] = { ...next[idx], ...patch }
  writeCache('event-line-items', next)
  return next[idx]
}

function patchCachedEventTotals(eventId, delta = 0) {
  const rows = readCache('conference-bookings')
  const idx = rows.findIndex((row) => row?.id === eventId)
  if (idx < 0) return null
  const current = rows[idx]
  const extrasTotal = Math.max(0, Number(current.extras_total || 0) + Number(delta || 0))
  const chargesTotal = Math.max(0, Number(current.charges_total || 0) + Number(delta || 0))
  const totalAmount = Math.max(0, Number(current.total_amount || 0) + Number(delta || 0))
  const amountPaid = Number(current.amount_paid ?? current.deposit_paid ?? 0)
  const next = {
    ...current,
    extras_total: extrasTotal,
    charges_total: chargesTotal,
    total_amount: totalAmount,
    balance_due: Math.max(0, totalAmount - amountPaid),
    _pending_sync: true,
    _financial_estimate: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  }
  const copy = [...rows]
  copy[idx] = next
  writeCache('conference-bookings', copy, { source: 'local' })
  return next
}

function patchEventInventoryEstimate(line = {}, restore = false) {
  if (!line?.inventory_item_id) return
  const depletion = Number(line.depletion_quantity || line.quantity || 0)
  if (!Number.isFinite(depletion) || depletion <= 0) return
  const multiplier = restore ? 1 : -1
  writeCache('inventory-items', readCache('inventory-items').map((item) => item.id === line.inventory_item_id ? {
    ...item,
    current_stock: Math.max(0, Number(item.current_stock || 0) + multiplier * depletion),
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : item))
}

export function getEventBookings(start, end) {
  const cached = readCache('conference-bookings')
  if (!state.isOnline) {
    return cached
      .filter((row) => (!start || String(row.booking_date || '') >= start) && (!end || String(row.booking_date || '') <= end))
      .sort((a, b) => String(b.booking_date || '').localeCompare(String(a.booking_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
  }
  let q = state.supabase
    .from('conference_bookings')
    .select('id, booking_date, start_time, end_time, client_name, company, attendees, setup_type, room_name, includes_catering, catering_notes, total_amount, deposit_paid, payment_status, payment_method, notes, created_at, updated_at, lodge_id, customer_id, event_name, event_type, reservation_scope, status, adults, children, subtotal, extras_total, charges_total, amount_paid, balance_due, currency, exclusive_booking_id, quotation_id, cancelled_at, cancellation_reason')
    .eq('lodge_id', state.lodgeId)
  if (start) q = q.gte('booking_date', start)
  if (end) q = q.lte('booking_date', end)
  q.order('booking_date', { ascending: false }).order('start_time', { ascending: true }).limit(200)
  q.then(({ data }) => {
    if (data) writeCache('conference-bookings', data, { source: 'remote' })
  }).catch(() => {})
  return q.then(({ data }) => data || []).catch(() => cached)
}

export async function getEventBookingById(id) {
  if (!id) return null
  if (!state.isOnline) return readCache('conference-bookings').find((row) => row.id === id) || null
  const { data, error } = await state.supabase
    .from('conference_bookings')
    .select('*')
    .eq('lodge_id', state.lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

export async function getEventBookingDetails(id) {
  if (!id) return null
  if (!state.isOnline) {
    const event = readCache('conference-bookings').find((row) => row.id === id) || null
    return event ? { event, resources: [], line_items: getCachedEventLineItems(id), rooms: [], payments: [] } : null
  }
  const { data, error } = await state.supabase.rpc('get_event_booking_details', {
    p_event_id: id,
    p_lodge_id: state.lodgeId
  })
  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error || 'Could not load event details')
  if (Array.isArray(data.line_items)) {
    writeCache('event-line-items', [
      ...data.line_items,
      ...readCache('event-line-items').filter((line) => line?.event_booking_id !== id)
    ])
  }
  return data
}

export async function createEventBooking(data) {
  const idempotencyKey = data.idempotency_key || `event-${Date.now()}-${crypto.randomUUID()}`
  const payload = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    idempotency_key: idempotencyKey,
    customer_id: data.customer_id || null,
    event_name: data.event_name || data.client_name || 'Event',
    event_type: data.event_type || 'conference',
    reservation_scope: data.reservation_scope || 'venue_only',
    status: data.status || 'reserved',
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    client_name: data.client_name || 'Guest',
    company: data.company || null,
    adults: data.adults || 0,
    children: data.children || 0,
    room_name: data.room_name || null,
    setup_type: data.setup_type || 'Default',
    includes_catering: data.includes_catering || false,
    catering_notes: data.catering_notes || null,
    total_amount: data.total_amount || 0,
    deposit_amount: data.deposit_amount || 0,
    payment_method: data.payment_method || null,
    currency: data.currency || 'BWP',
    notes: data.notes || null,
    room_ids: data.room_ids || null,
    resources: Array.isArray(data.resources) ? data.resources : [],
    check_in: data.check_in || null,
    check_out: data.check_out || null,
    event_daily_rate: data.event_daily_rate || null,
    quotation_id: data.quotation_id || null
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_event_booking', { payload })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create event booking')
    await refreshCache('conference-bookings')
    logActivity('event_created', `Event created · ${payload.event_name} · ${payload.booking_date} · ${payload.reservation_scope}`)
    return { id: result.event_id, exclusive_booking_id: result.exclusive_booking_id, idempotent: result.idempotent }
  }

  const offlineRow = {
    ...payload,
    id: payload.id,
    amount_paid: payload.deposit_amount || 0,
    balance_due: payload.total_amount || 0,
    payment_status: payload.deposit_amount > 0 ? 'partial' : 'unpaid',
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    created_at: new Date().toISOString()
  }
  writeCache('conference-bookings', [offlineRow, ...readCache('conference-bookings').filter((row) => row.id !== payload.id)], { source: 'local' })
  queueOperation('rpc', 'create_event_booking', { payload }, null, { _queue_id: `event-${payload.id}` })
  logActivity('event_created', `(Offline) Event created · ${payload.event_name} · ${payload.booking_date}`)
  return { id: payload.id }
}

export async function updateEventBooking(id, data) {
  if (!id) throw new Error('Event booking ID is required')
  const idempotencyKey = data.idempotency_key || `event-update-${Date.now()}-${crypto.randomUUID()}`
  const existing = readCache('conference-bookings').find((row) => row.id === id)
  const expectedUpdatedAt = data.expected_updated_at || existing?.updated_at || null

  const rpcPayload = {
    event_name: data.event_name,
    event_type: data.event_type,
    reservation_scope: data.reservation_scope,
    status: data.status,
    client_name: data.client_name,
    company: data.company,
    adults: data.adults,
    children: data.children,
    room_name: data.room_name,
    setup_type: data.setup_type,
    includes_catering: data.includes_catering,
    catering_notes: data.catering_notes,
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    total_amount: data.total_amount,
    currency: data.currency,
    notes: data.notes
  }
  Object.keys(rpcPayload).forEach((k) => { if (rpcPayload[k] === undefined) delete rpcPayload[k] })

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_event_booking', {
      p_event_id: id,
      p_lodge_id: state.lodgeId,
      payload: rpcPayload,
      p_expected_updated_at: expectedUpdatedAt,
      p_idempotency_key: idempotencyKey
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update event')
    await refreshCache('conference-bookings')
    logActivity('event_updated', `Event updated · ${data.event_name || id}`)
    return { success: true }
  }

  const cached = readCache('conference-bookings')
  const idx = cached.findIndex((row) => row.id === id)
  const dependsOn = existing?._pending_sync ? `event-${id}` : null
  queueOperation('rpc', 'update_event_booking', {
    p_event_id: id,
    p_lodge_id: state.lodgeId,
    payload: rpcPayload,
    p_expected_updated_at: dependsOn ? null : expectedUpdatedAt,
    p_idempotency_key: idempotencyKey
  }, null, dependsOn ? { _depends_on: dependsOn } : {})
  if (idx >= 0) {
    cached[idx] = { ...cached[idx], ...rpcPayload, _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString() }
  }
  writeCache('conference-bookings', cached, { source: 'local' })
  return { success: true }
}

export async function cancelEventBooking(id, reason, cancelLinkedRooms = true) {
  if (!id) throw new Error('Event booking ID is required')
  if (!reason) throw new Error('Cancellation reason is required')

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('cancel_event_booking', {
      p_event_id: id,
      p_lodge_id: state.lodgeId,
      p_reason: reason,
      p_cancel_linked_rooms: cancelLinkedRooms
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not cancel event')
    await refreshCache('conference-bookings')
    logActivity('event_cancelled', `Event cancelled · ${id} · ${reason}`)
    return { success: true }
  }

  const cached = readCache('conference-bookings')
  const idx = cached.findIndex((row) => row.id === id)
  const dependsOn = cached[idx]?._pending_sync ? `event-${id}` : null
  queueOperation('rpc', 'cancel_event_booking', {
    p_event_id: id,
    p_lodge_id: state.lodgeId,
    p_reason: reason,
    p_cancel_linked_rooms: cancelLinkedRooms
  }, null, dependsOn ? { _depends_on: dependsOn } : {})
  if (idx >= 0) {
    cached[idx] = { ...cached[idx], status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason, _pending_sync: true, updated_at: new Date().toISOString() }
  }
  writeCache('conference-bookings', cached, { source: 'local' })
  return { success: true }
}

export async function addEventLineItem(data) {
  if (!data.event_booking_id) throw new Error('event_booking_id is required')
  const idempotencyKey = data.idempotency_key || `line-${Date.now()}-${crypto.randomUUID()}`
  const payload = {
    lodge_id: state.lodgeId,
    event_booking_id: data.event_booking_id,
    line_type: data.line_type || 'manual',
    description: data.description || '',
    category: data.category || null,
    quantity: data.quantity || 1,
    unit_price: data.unit_price || 0,
    inventory_item_id: data.inventory_item_id || null,
    depletion_quantity: data.depletion_quantity || null,
    idempotency_key: idempotencyKey
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('add_event_line_item', { payload })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not add line item')
    await refreshCache('conference-bookings')
    logActivity('event_line_item_added', `Line item added · ${data.description} · ${data.quantity}x ${data.unit_price}`)
    return { id: result.line_item_id, subtotal: result.subtotal, idempotent: result.idempotent }
  }

  const lineId = data.id || randomUUID()
  const quantity = Number(payload.quantity || 1)
  const unitPrice = Number(payload.unit_price || 0)
  const subtotal = Math.round(quantity * unitPrice * 100) / 100
  const line = {
    id: lineId,
    lodge_id: state.lodgeId,
    event_booking_id: payload.event_booking_id,
    line_type: payload.line_type,
    description: payload.description,
    category: payload.category,
    quantity,
    unit_price: unitPrice,
    subtotal,
    inventory_item_id: payload.inventory_item_id,
    depletion_quantity: payload.depletion_quantity || null,
    source_reference: idempotencyKey,
    created_at: new Date().toISOString(),
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  }
  upsertCachedEventLineItem(line)
  patchCachedEventTotals(payload.event_booking_id, subtotal)
  patchEventInventoryEstimate(line, false)
  queueOperation('rpc', 'add_event_line_item', { payload }, null, {
    _queue_id: `event-line-${lineId}`,
    _local_line_item_id: lineId,
    ...(readCache('conference-bookings').find((row) => row?.id === payload.event_booking_id)?._pending_sync ? { _depends_on: `event-${payload.event_booking_id}` } : {})
  })
  logActivity('event_line_item_added', `(Offline) Line item added · ${payload.description} · ${quantity}x ${unitPrice}`)
  return { id: lineId, subtotal, offline: true, queued: true }
}

export async function voidEventLineItem(lineItemId, reason) {
  if (!lineItemId) throw new Error('Line item ID is required')
  if (!reason) throw new Error('Void reason is required')

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('void_event_line_item', {
      p_line_item_id: lineItemId,
      p_lodge_id: state.lodgeId,
      p_reason: reason
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not void line item')
    await refreshCache('conference-bookings')
    logActivity('event_line_item_voided', `Line item voided · ${lineItemId} · ${reason}`)
    return { success: true }
  }

  const line = readCache('event-line-items').find((row) => row?.id === lineItemId)
  if (!line) throw new Error('Line item not found in offline cache')
  patchCachedEventLineItem(lineItemId, {
    voided_at: new Date().toISOString(),
    void_reason: reason,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  })
  patchCachedEventTotals(line.event_booking_id, -Number(line.subtotal || Number(line.quantity || 0) * Number(line.unit_price || 0)))
  patchEventInventoryEstimate(line, true)
  queueOperation('rpc', 'void_event_line_item', {
    p_line_item_id: lineItemId,
    p_lodge_id: state.lodgeId,
    p_reason: reason,
    p_idempotency_key: `event-line-void:${lineItemId}:${Date.now()}`
  }, null, {
    _queue_id: `event-line-void-${lineItemId}-${Date.now()}`,
    ...(line?._pending_sync ? { _depends_on: `event-line-${lineItemId}` } : {})
  })
  logActivity('event_line_item_voided', `(Offline) Line item void queued · ${lineItemId} · ${reason}`)
  return { success: true, offline: true, queued: true }
}

export async function updateEventPayment(id, amount, method, type = 'payment', idempotencyKey = null) {
  if (!id) throw new Error('Event booking ID is required')
  if (!amount || Number(amount) <= 0) throw new Error('Payment amount must be greater than zero')
  if (!method) throw new Error('Payment method is required')
  const numericAmount = Number(Number(amount).toFixed(2))
  const intentKey = idempotencyKey || `event-pay-${Date.now()}-${crypto.randomUUID()}`

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_event_payment', {
      p_event_id: id,
      p_lodge_id: state.lodgeId,
      p_amount: numericAmount,
      p_method: method,
      p_type: type,
      p_idempotency_key: intentKey,
      p_recorded_by: state.currentUser?.id || null
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not record payment')
    await refreshCache('conference-bookings')
    const name = (readCache('conference-bookings') || []).find((row) => row.id === id)?.client_name || 'Guest'
    logActivity('event_payment_recorded', `Event payment ${numericAmount.toFixed(2)} · ${name} · ${method}`)
    return result
  }

  const cached = readCache('conference-bookings')
  const idx = cached.findIndex((row) => row.id === id)
  if (idx < 0) throw new Error('Event not found in offline cache')
  const row = cached[idx]
  const newPaid = Number(row.amount_paid || 0) + numericAmount
  const newStatus = newPaid >= Number(row.total_amount || 0) ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'
  cached[idx] = {
    ...row,
    amount_paid: newPaid,
    balance_due: Math.max(0, Number(row.total_amount || 0) - newPaid),
    payment_status: newStatus,
    _pending_payment: true,
    _pending_sync: true,
    _sync_state: 'pending',
    updated_at: new Date().toISOString()
  }
  writeCache('conference-bookings', cached, { source: 'local' })
  queueOperation('rpc', 'update_event_payment', {
    p_event_id: id,
    p_lodge_id: state.lodgeId,
    p_amount: numericAmount,
    p_method: method,
    p_type: type,
    p_idempotency_key: intentKey,
    p_recorded_by: state.currentUser?.id || null
  }, null, { _queue_id: `event-pay-${id}-${Date.now()}` })
  logActivity('event_payment_recorded', `(Offline) Event payment ${numericAmount.toFixed(2)} · ${row.client_name || 'Guest'} · ${method}`)
  return { success: true, offline: true, queued: true }
}

export async function checkEventResourceAvailability(resourceKey, startAt, endAt, excludeEventId = null) {
  if (!state.isOnline) return { available: true }
  const { data, error } = await state.supabase.rpc('check_event_resource_conflict', {
    p_lodge_id: state.lodgeId,
    p_resource_key: resourceKey,
    p_start_at: startAt,
    p_end_at: endAt,
    p_exclude_event_id: excludeEventId
  })
  if (error) throw new Error(error.message)
  return { available: !data }
}

// ── Venue Packages ──────────────────────────────────────────────────────────
const PACKAGES_CACHE = 'venue-packages'

async function _getVenuePackages(category, activeOnly) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_venue_packages', {
      p_lodge_id: currentLodgeId,
      p_category: category || null,
      p_active_only: activeOnly !== false
    })
    if (error) throw error
    writeCache(PACKAGES_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(PACKAGES_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return cached
    return []
  }
}
export const getVenuePackages = (...args) => dedupePromise('getVenuePackages', () => _getVenuePackages(...args))

function requireOnline() {
  if (!state.isOnline) {
    const err = new Error('Venue packages require an internet connection')
    err.onlineOnly = true
    throw err
  }
}

export async function createVenuePackage(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_venue_package', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function updateVenuePackage(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_venue_package', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

export async function deleteVenuePackage(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_venue_package', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

export async function applyVenuePackageToEvent(packageId, eventBookingId, quantity, idempotencyKey) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const intentKey = String(idempotencyKey || '').trim()
  if (intentKey.length < 8 || intentKey.length > 128) {
    throw new Error('A stable idempotency key between 8 and 128 characters is required')
  }
  const { data: result, error } = await state.supabase.rpc('apply_venue_package_to_event', {
    p_package_id: packageId,
    p_event_booking_id: eventBookingId,
    p_lodge_id: currentLodgeId,
    p_quantity: quantity || 1,
    p_idempotency_key: intentKey
  })
  if (error) throw error
  return result
}

export { VALID_EVENT_TYPES, VALID_SCOPES, VALID_EVENT_STATUSES }
