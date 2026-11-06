import { randomUUID } from 'crypto'
import crypto from 'crypto'
import { state } from '../state.js'
import {
  dedupePromise,
  logActivity,
  markQueuedOperationCommitted,
  queueOperation,
  readCache,
  readSyncQueue,
  refreshCache,
  writeCache
} from './infrastructure.js'

// ─── EVENTS & VENUES ──────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = ['conference', 'meeting', 'party', 'wedding', 'corporate', 'pool_party', 'braai', 'reception', 'other']
const VALID_SCOPES = ['venue_only', 'venue_with_rooms', 'exclusive_lodge']
const VALID_EVENT_STATUSES = ['draft', 'reserved', 'confirmed', 'active', 'completed', 'cancelled']

/**
 * Expected IPC input, cache and RPC consumer views; these declarations do not
 * validate the incoming IPC payload, cache rows or RPC JSON. Cache IDs come
 * from the existing conference-booking/item writers (UUIDs or database IDs).
 * Numeric fields retain the number/string forms already handled by Number().
 * @typedef {{id: string, event_booking_id?: string|undefined, inventory_item_id?: string|null, voided_at?: string|null, void_reason?: string|null, cancelled_at?: string|null, cancellation_reason?: string|null, status?: string|null, created_at?: string|null, updated_at?: string|null, booking_date?: string|null|undefined, start_time?: string|null, client_name?: string|null, amount_paid?: number|string|null, deposit_paid?: number|string|null, total_amount?: number|string|null, balance_due?: number|string|null, subtotal?: number|string|null, unit_price?: number|string|null, quantity?: number|string|null, depletion_quantity?: number|string|null, extras_total?: number|string|null, charges_total?: number|string|null, current_stock?: number|string|null, payment_status?: string|null, _pending_sync?: boolean, _pending_payment?: boolean, _financial_estimate?: boolean, _sync_state?: string, _sync_error?: string|null}} EventCacheExpectedData
 * These input views describe the local call shapes; IPC payloads are not validated here.
 * @typedef {{booking_date: string, start_time: string, end_time: string, id?: string, idempotency_key?: string, operation_id?: string, customer_id?: string|null, customer_name?: string, event_name?: string, event_type?: string, reservation_scope?: string, status?: string, client_name?: string, company?: string|null, adults?: number, children?: number, room_name?: string|null, setup_type?: string, includes_catering?: boolean, catering_notes?: string|null, total_amount?: number|string, deposit_amount?: number|string, payment_method?: string|null, currency?: string, notes?: string|null, room_ids?: string[]|null, resources?: unknown, check_in?: string|null, check_out?: string|null, event_daily_rate?: number|string|null, quotation_id?: string|null}} CreateEventBookingInputExpectedData\n * @typedef {{event_name?: string, event_type?: string, reservation_scope?: string, status?: string, client_name?: string, company?: string|null, adults?: number, children?: number, room_name?: string|null, setup_type?: string, includes_catering?: boolean, catering_notes?: string|null, booking_date?: string, start_time?: string, end_time?: string, check_in?: string|null, check_out?: string|null, room_ids?: string[]|null, resources?: unknown, event_daily_rate?: number|string|null, customer_id?: string|null, total_amount?: number|string, currency?: string, notes?: string|null, idempotency_key?: string, operation_id?: string, expected_updated_at?: string|null}} UpdateEventBookingPatchExpectedData\n * @typedef {{event_booking_id: string, id?: string, idempotency_key?: string, line_type?: string, description?: string, category?: string|null, quantity?: number|string, unit_price?: number|string, inventory_item_id?: string|null, depletion_quantity?: number|string|null}} AddEventLineItemInputExpectedData
 * @typedef {{success?: boolean, error?: string, event_id?: string, exclusive_booking_id?: string|null, idempotent?: boolean, line_item_id?: string, subtotal?: number|string}} EventRpcResultExpectedData
 * @typedef {{id: string, package_name: string, description: string|null, category: string, base_price: number, max_capacity: number|null, min_capacity: number|null, duration_hours: number|null, items: unknown, is_active: boolean|null, created_at: string, updated_at: string}} VenuePackageCacheExpectedData
 */

/** @param {string} eventId */
function getCachedEventLineItems(eventId) {
  return /** @type {EventCacheExpectedData[]} */ (readCache('event-line-items'))
    .filter((line) => line?.event_booking_id === eventId && !line?.voided_at)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

/** @param {Partial<EventCacheExpectedData>} [line] */
function upsertCachedEventLineItem(line = {}) {
  if (!line?.id) return
  writeCache('event-line-items', [
    line,
    .../** @type {EventCacheExpectedData[]} */ (readCache('event-line-items')).filter((row) => row?.id !== line.id)
  ].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))))
}

/** @param {string} lineItemId @param {Partial<EventCacheExpectedData>} [patch] */
function patchCachedEventLineItem(lineItemId, patch = {}) {
  const rows = /** @type {EventCacheExpectedData[]} */ (readCache('event-line-items'))
  const idx = rows.findIndex((line) => line?.id === lineItemId)
  if (idx < 0) return null
  const next = [...rows]
  next[idx] = { ...next[idx], ...patch }
  writeCache('event-line-items', next)
  return next[idx]
}

/** @param {string} eventId @param {number} [delta] */
function patchCachedEventTotals(eventId, delta = 0) {
  const rows = /** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))
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

/** @param {Partial<EventCacheExpectedData>} [line] @param {boolean} [restore] */
function patchEventInventoryEstimate(line = {}, restore = false) {
  if (!line?.inventory_item_id) return
  const depletion = Number(line.depletion_quantity || line.quantity || 0)
  if (!Number.isFinite(depletion) || depletion <= 0) return
  const multiplier = restore ? 1 : -1
  writeCache('inventory-items', (/** @type {EventCacheExpectedData[]} */ (readCache('inventory-items'))).map((item) => item.id === line.inventory_item_id ? {
    ...item,
    current_stock: Math.max(0, Number(item.current_stock || 0) + multiplier * depletion),
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : item))
}

/** @param {string|null} [start] @param {string|null} [end] */
export function getEventBookings(start, end) {
  const cached = /** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))
  if (!state.isOnline) {
    return cached
      .filter((row) => (!start || String(row.booking_date || '') >= start) && (!end || String(row.booking_date || '') <= end))
      .sort((a, b) => String(b.booking_date || '').localeCompare(String(a.booking_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
  }
  // This existing online branch is the lifecycle guard for the optional client in state.js.
  let q = /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
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

/** @param {string} id */
export async function getEventBookingById(id) {
  if (!id) return null
  if (!state.isOnline) return (/** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))).find((row) => row.id === id) || null
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
    .from('conference_bookings')
    .select('*')
    .eq('lodge_id', state.lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

/** @param {string} id */
export async function getEventBookingDetails(id) {
  if (!id) return null
  if (!state.isOnline) {
    const event = (/** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))).find((row) => row.id === id) || null
    return event ? { event, resources: [], line_items: getCachedEventLineItems(id), rooms: [], payments: [] } : null
  }
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_event_booking_details', {
    p_event_id: id,
    p_lodge_id: state.lodgeId
  })
  if (error) throw new Error(error.message)
  const details = /** @type {{success?: boolean, error?: string, event?: Record<string, unknown>, resources?: Record<string, unknown>[], rooms?: Record<string, unknown>[], line_items?: EventCacheExpectedData[]}} */ (data)
  if (!details?.success) throw new Error(details?.error || 'Could not load event details')
  if (Array.isArray(details.line_items)) {
    writeCache('event-line-items', [
      ...details.line_items,
      .../** @type {EventCacheExpectedData[]} */ (readCache('event-line-items')).filter((line) => line?.event_booking_id !== id)
    ])
  }
  let normalizedRooms = Array.isArray(details.rooms) ? details.rooms : []
  const exclusiveBookingId = String(details.event?.exclusive_booking_id || '')
  if (exclusiveBookingId && state.supabase) {
    const { data: exclusiveBooking, error: bookingError } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
      .from('bookings')
      .select('id, room_id, check_in, check_out, total_amount, amount_paid, payment_status, event_daily_rate, rooms(room_number, room_type)')
      .eq('lodge_id', state.lodgeId)
      .eq('id', exclusiveBookingId)
      .maybeSingle()
    if (bookingError) throw new Error(bookingError.message)
    if (exclusiveBooking && !normalizedRooms.some((room) => room.booking_id === exclusiveBooking.id)) {
      const room = /** @type {{room_number?: unknown, room_type?: unknown}|null} */ (exclusiveBooking.rooms)
      normalizedRooms = [...normalizedRooms, {
        booking_id: exclusiveBooking.id,
        room_id: exclusiveBooking.room_id,
        check_in: exclusiveBooking.check_in,
        check_out: exclusiveBooking.check_out,
        total_amount: exclusiveBooking.total_amount,
        amount_paid: exclusiveBooking.amount_paid,
        event_daily_rate: exclusiveBooking.event_daily_rate,
        payment_status: exclusiveBooking.payment_status,
        room_number: room?.room_number,
        room_type: room?.room_type
      }]
    }
  }
  return {
    ...data,
    event: exclusiveBookingRate(details.event, normalizedRooms, exclusiveBookingId),
    rooms: normalizedRooms
  }
}

/** @param {Record<string, unknown>|undefined} event @param {Record<string, unknown>[]} rooms @param {string} exclusiveBookingId */
function exclusiveBookingRate(event, rooms, exclusiveBookingId) {
  if (!event || !exclusiveBookingId) return event
  const exclusive = rooms.find((room) => room.booking_id === exclusiveBookingId)
  return exclusive ? { ...event, event_daily_rate: exclusive.event_daily_rate } : event
}

/** @param {CreateEventBookingInputExpectedData} data */
export async function createEventBooking(data) {
  const idempotencyKey = data.idempotency_key || data.operation_id || `event-${Date.now()}-${crypto.randomUUID()}`
  const eventName = String(data.event_name || data.client_name || 'Event').trim() || 'Event'
  const clientName = String(data.client_name || '').trim()
  const payload = {
    id: data.id || data.operation_id || randomUUID(),
    lodge_id: state.lodgeId,
    idempotency_key: idempotencyKey,
    customer_id: data.customer_id || null,
    event_name: eventName,
    event_type: data.event_type || 'conference',
    reservation_scope: data.reservation_scope || 'venue_only',
    status: data.status || 'reserved',
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    client_name: clientName || 'Guest',
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
  const queueId = `event-${payload.id}`
  const queueExactPayload = () => queueOperation('rpc', 'create_event_booking', { payload }, null, { _queue_id: queueId })

  if (state.isOnline) {
    // Save the exact RPC envelope before dispatch. A process crash or lost
    // response leaves this same idempotent operation available to the normal
    // replay worker; successful/definitive responses leave a durable commit
    // marker for its crash-safe cleanup.
    queueExactPayload()
    const { data: rawResult, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_event_booking', { payload })
    const result = /** @type {EventRpcResultExpectedData|null} */ (rawResult)
    if (error) throw new Error(error.message)
    if (!result?.success) {
      markQueuedOperationCommitted(queueId)
      throw new Error(result?.error || 'Could not create event booking')
    }
    markQueuedOperationCommitted(queueId)
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
  writeCache('conference-bookings', [offlineRow, .../** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings')).filter((row) => row.id !== payload.id)], { source: 'local' })
  queueExactPayload()
  logActivity('event_created', `(Offline) Event created · ${payload.event_name} · ${payload.booking_date}`)
  return { id: payload.id }
}

/** @param {string} id @param {UpdateEventBookingPatchExpectedData} data */
export async function updateEventBooking(id, data) {
  if (!id) throw new Error('Event booking ID is required')
  const idempotencyKey = data.idempotency_key || data.operation_id || `event-update-${Date.now()}-${crypto.randomUUID()}`
  const existing = (/** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))).find((row) => row.id === id)
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
    check_in: data.check_in,
    check_out: data.check_out,
    room_ids: data.room_ids,
    resources: data.resources,
    event_daily_rate: data.event_daily_rate,
    customer_id: data.customer_id,
    total_amount: data.total_amount,
    currency: data.currency,
    notes: data.notes
  }
  Object.keys(rpcPayload).forEach((k) => { if ((/** @type {Record<string, unknown>} */ (rpcPayload))[k] === undefined) delete (/** @type {Record<string, unknown>} */ (rpcPayload))[k] })

  if (state.isOnline) {
    const { data: rawResult, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_event_booking', {
      p_event_id: id,
      p_lodge_id: state.lodgeId,
      payload: rpcPayload,
      p_expected_updated_at: expectedUpdatedAt,
      p_idempotency_key: idempotencyKey
    })
    const result = /** @type {EventRpcResultExpectedData|null} */ (rawResult)
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update event')
    await refreshCache('conference-bookings')
    logActivity('event_updated', `Event updated · ${data.event_name || id}`)
    return { success: true }
  }

  const cached = /** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))
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

/** @param {string} id @param {string} reason @param {boolean} [cancelLinkedRooms] */
export async function cancelEventBooking(id, reason, cancelLinkedRooms = true) {
  if (!id) throw new Error('Event booking ID is required')
  if (!reason) throw new Error('Cancellation reason is required')

  if (state.isOnline) {
    const { data: rawResult, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('cancel_event_booking', {
      p_event_id: id,
      p_lodge_id: state.lodgeId,
      p_reason: reason,
      p_cancel_linked_rooms: cancelLinkedRooms
    })
    const result = /** @type {EventRpcResultExpectedData|null} */ (rawResult)
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not cancel event')
    await refreshCache('conference-bookings')
    logActivity('event_cancelled', `Event cancelled · ${id} · ${reason}`)
    return { success: true }
  }

  const cached = /** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))
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

/** @param {AddEventLineItemInputExpectedData} data */
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
    const { data: rawResult, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('add_event_line_item', { payload })
    const result = /** @type {EventRpcResultExpectedData|null} */ (rawResult)
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
    ...((/** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))).find((row) => row?.id === payload.event_booking_id)?._pending_sync ? { _depends_on: `event-${payload.event_booking_id}` } : {})
  })
  logActivity('event_line_item_added', `(Offline) Line item added · ${payload.description} · ${quantity}x ${unitPrice}`)
  return { id: lineId, subtotal, offline: true, queued: true }
}

/** @param {string} lineItemId @param {string} reason */
export async function voidEventLineItem(lineItemId, reason) {
  if (!lineItemId) throw new Error('Line item ID is required')
  if (!reason) throw new Error('Void reason is required')

  if (state.isOnline) {
    const { data: rawResult, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('void_event_line_item', {
      p_line_item_id: lineItemId,
      p_lodge_id: state.lodgeId,
      p_reason: reason
    })
    const result = /** @type {EventRpcResultExpectedData|null} */ (rawResult)
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not void line item')
    await refreshCache('conference-bookings')
    logActivity('event_line_item_voided', `Line item voided · ${lineItemId} · ${reason}`)
    return { success: true }
  }

  const line = (/** @type {EventCacheExpectedData[]} */ (readCache('event-line-items'))).find((row) => row?.id === lineItemId)
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

/** @param {string} id @param {number|string} amount @param {string} method @param {string} [type] @param {string|null} [idempotencyKey] */
export async function updateEventPayment(id, amount, method, type = 'payment', idempotencyKey = null) {
  if (!id) throw new Error('Event booking ID is required')
  if (!amount || Number(amount) <= 0) throw new Error('Payment amount must be greater than zero')
  if (!method) throw new Error('Payment method is required')
  const numericAmount = Number(Number(amount).toFixed(2))
  let intentKey = idempotencyKey || `event-pay-${Date.now()}-${crypto.randomUUID()}`
  const queuedPayment = /** @type {import('./infrastructure.js').ReplayQueueItemExpectedView|null} */ (readSyncQueue().find((item) =>
    item?.type === 'rpc' && ['update_event_payment', 'record_event_invoice_payment'].includes(String(item?.table || ''))
    && item?._state !== 'committed'
    && item?.data?.p_event_id === id
    && item?.data?.p_lodge_id === state.lodgeId
  ) || null)
  if (queuedPayment) {
    if (queuedPayment.table === 'record_event_invoice_payment') {
      throw new Error('A consolidated invoice payment is pending. Retry it from Booking Invoices before recording another event payment.')
    }
    const original = queuedPayment.data || {}
    if (Number(original.p_amount) !== numericAmount
      || String(original.p_method || '') !== String(method)
      || String(original.p_type || 'payment') !== String(type || 'payment')
      || !original.p_idempotency_key) {
      throw new Error('A previous event payment has an uncertain result. Retry its original amount and method after sync; do not start a changed payment yet.')
    }
    intentKey = String(original.p_idempotency_key)
  }
  const rpcArgs = queuedPayment?.data || {
    p_event_id: id,
    p_lodge_id: state.lodgeId,
    p_amount: numericAmount,
    p_method: method,
    p_type: type,
    p_idempotency_key: intentKey,
    p_recorded_by: state.currentUser?.id || null
  }
  const queueId = `event-pay-${id}-${intentKey}`
  const persistExactPayment = () => queueOperation('rpc', 'update_event_payment', rpcArgs, null, { _queue_id: queueId })

  if (state.isOnline) {
    persistExactPayment()
    const { data: rawResult, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_event_payment', rpcArgs)
    const result = /** @type {EventRpcResultExpectedData|null} */ (rawResult)
    if (error) throw new Error(error.message)
    if (!result?.success) {
      markQueuedOperationCommitted(queueId)
      throw new Error(result?.error || 'Could not record payment')
    }
    markQueuedOperationCommitted(queueId)
    await refreshCache('conference-bookings')
    const name = (/** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings')) || []).find((row) => row.id === id)?.client_name || 'Guest'
    logActivity('event_payment_recorded', `Event payment ${numericAmount.toFixed(2)} · ${name} · ${method}`)
    return result
  }

  const cached = /** @type {EventCacheExpectedData[]} */ (readCache('conference-bookings'))
  const idx = cached.findIndex((row) => row.id === id)
  if (idx < 0) throw new Error('Event not found in offline cache')
  const row = cached[idx]
  const estimatedPaid = Number(row._estimated_amount_paid ?? row.amount_paid ?? 0) + numericAmount
  const estimatedStatus = estimatedPaid >= Number(row.total_amount || 0) ? 'paid' : estimatedPaid > 0 ? 'partial' : 'unpaid'
  cached[idx] = {
    ...row,
    _estimated_amount_paid: estimatedPaid,
    _estimated_balance_due: Math.max(0, Number(row.total_amount || 0) - estimatedPaid),
    _estimated_payment_status: estimatedStatus,
    _pending_payment: true,
    _pending_sync: true,
    _sync_state: 'pending',
    updated_at: new Date().toISOString()
  }
  writeCache('conference-bookings', cached, { source: 'local' })
  persistExactPayment()
  logActivity('event_payment_recorded', `(Offline) Event payment ${numericAmount.toFixed(2)} · ${row.client_name || 'Guest'} · ${method}`)
  return { success: true, offline: true, queued: true }
}

/** @param {string} eventId */
export function getPendingEventPaymentIntent(eventId) {
  if (!eventId) return null
  const queued = readSyncQueue().find((item) => item?.type === 'rpc'
    && ['update_event_payment', 'record_event_invoice_payment'].includes(String(item?.table || ''))
    && item?._state !== 'committed'
    && item?.data?.p_event_id === eventId
    && item?.data?.p_lodge_id === state.lodgeId)
  if (!queued?.data) return null
  return {
    amount: Number(queued.data.p_amount),
    method: String(queued.data.p_method || ''),
    type: String(queued.data.p_type || 'payment'),
    idempotency_key: String(queued.data.p_idempotency_key || ''),
    scope: queued.table === 'record_event_invoice_payment' ? 'group' : 'event',
    pending: true
  }
}

/** @param {string} eventId @param {number|string} amount @param {string} method @param {string} [idempotencyKey] */
export async function recordEventInvoicePayment(eventId, amount, method, idempotencyKey = '') {
  if (!eventId) throw new Error('Event invoice ID is required')
  if (!state.isOnline) throw new Error('Reconnect to verify the consolidated invoice balance before collecting payment.')
  const numericAmount = Number(Number(amount).toFixed(2))
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('Payment amount must be greater than zero')
  if (!method) throw new Error('Payment method is required')

  const queued = readSyncQueue().find((item) => item?.type === 'rpc'
    && ['update_event_payment', 'record_event_invoice_payment'].includes(String(item?.table || ''))
    && item?._state !== 'committed'
    && item?.data?.p_event_id === eventId
    && item?.data?.p_lodge_id === state.lodgeId)
  if (queued && queued.table !== 'record_event_invoice_payment') {
    throw new Error('An event payment is pending. Retry it from Events before collecting against the consolidated invoice.')
  }
  const original = queued?.data || null
  const intentKey = String(original?.p_idempotency_key || idempotencyKey || `event-invoice-pay-${eventId}-${crypto.randomUUID()}`)
  if (original && (Number(original.p_amount) !== numericAmount || String(original.p_method || '') !== method)) {
    throw new Error('A previous consolidated invoice payment has an uncertain result. Retry the original amount and method after sync.')
  }
  const args = original || {
    p_lodge_id: state.lodgeId,
    p_event_id: eventId,
    p_amount: numericAmount,
    p_method: method,
    p_idempotency_key: intentKey
  }
  const queueId = `event-invoice-pay-${eventId}-${intentKey}`
  queueOperation('rpc', 'record_event_invoice_payment', args, null, { _queue_id: queueId })
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('record_event_invoice_payment', args)
  if (error) throw new Error(error.message)
  const result = /** @type {EventRpcResultExpectedData|null} */ (data)
  if (!result?.success) {
    markQueuedOperationCommitted(queueId)
    return result || { success: false, error: 'Could not collect payment for this event invoice' }
  }
  markQueuedOperationCommitted(queueId)
  await refreshCache('conference-bookings')
  return result
}

/** @param {string} resourceKey @param {string} startAt @param {string} endAt @param {string|null} [excludeEventId] */
export async function checkEventResourceAvailability(resourceKey, startAt, endAt, excludeEventId = null) {
  if (!state.isOnline) return { available: true }
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('check_event_resource_conflict', {
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

/** @param {string|null} [category] @param {boolean} [activeOnly] */
async function _getVenuePackages(category, activeOnly) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_venue_packages', {
      p_lodge_id: currentLodgeId,
      p_category: category || null,
      p_active_only: activeOnly !== false
    })
    if (error) throw error
    writeCache(PACKAGES_CACHE, data || [])
    return data || []
  } catch (e) {
    const cached = readCache(PACKAGES_CACHE)
    if (Array.isArray(cached) && (cached.length > 0 || !state.isOnline)) return /** @type {VenuePackageCacheExpectedData[]} */ (cached)
    return []
  }
}
/** @type {(...args: [string|null, (boolean|undefined)?]) => ReturnType<typeof _getVenuePackages>} */
export const getVenuePackages = (...args) => dedupePromise('getVenuePackages', () => _getVenuePackages(...args))

function requireOnline() {
  if (!state.isOnline) {
    const err = /** @type {Error & {onlineOnly?: boolean}} */ (new Error('Venue packages require an internet connection'))
    err.onlineOnly = true
    throw err
  }
}

/** @param {Record<string, unknown>} data */
export async function createVenuePackage(data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_venue_package', {
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {string} id @param {Record<string, unknown>} data */
export async function updateVenuePackage(id, data) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_venue_package', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: data
  })
  if (error) throw error
  return result
}

/** @param {string} id */
export async function deleteVenuePackage(id) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('delete_venue_package', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return result
}

/** @param {string} packageId @param {string} eventBookingId @param {number} quantity @param {string} idempotencyKey */
export async function applyVenuePackageToEvent(packageId, eventBookingId, quantity, idempotencyKey) {
  requireOnline()
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const intentKey = String(idempotencyKey || '').trim()
  if (intentKey.length < 8 || intentKey.length > 128) {
    throw new Error('A stable idempotency key between 8 and 128 characters is required')
  }
  const { data: result, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('apply_venue_package_to_event', {
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
