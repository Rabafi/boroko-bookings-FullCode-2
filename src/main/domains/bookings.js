import { randomUUID } from 'crypto';
import crypto from 'crypto';
import { state } from '../state.js';
import { getAllRooms, getRoomById } from './rooms.js';
import { getAllCustomers } from './customers.js';
import {
  DEBUG_CACHE_FALLBACKS,
  readCache,
  writeCache,
  refreshCache,
  queueOperation,
  logActivity,
  createBackup,
  recordCriticalError,
  assertCreationWithinUsageLimit,
  normalizeLodgeId,
  mergeRemoteBookingsWithLocalState,
  createBookingIdempotencyKey,
  createPaymentIdempotencyKey,
  buildPaymentFallbackSignature,
  patchCachedQuotationSyncState,
  checkExclusiveEventConflict,
  isMissingInvoiceNumberRpcError,
  getNextInvoiceNumberByLookup,
  roundMoneyValue
} from './infrastructure.js';

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

function buildLocalPendingInvoiceNumber(bookingId) {
  const suffix = String(bookingId || randomUUID()).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `PENDING-${suffix}`;
}

function buildOfflineBookingFinancialState(totalAmount, depositAmount = 0) {
  const total = Math.max(0, Number(totalAmount || 0));
  const paid = Math.max(0, Number(depositAmount || 0));
  const amountPaid = Math.min(paid, total);
  return {
    amount_paid: amountPaid,
    payment_status: amountPaid >= total && total > 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'
  };
}

export async function getAllBookings() {
  try {
    const { data, error } = await state.supabase.
    from('bookings').
    select(`*, customers(name, phone, email), rooms(room_number, room_type, rate_per_night)`).
    eq('lodge_id', state.lodgeId).
    order('check_in', { ascending: false });
    if (error) throw error;

    const cached = readCache('bookings');
    if ((data || []).length === 0 && cached.length > 0) {
      if (DEBUG_CACHE_FALLBACKS) {
        console.warn('getAllBookings received empty live result; using cached bookings instead');
      }
      return cached;
    }

    const localRowsForMerge = cached;
    const mapped = (data || []).map((b) => ({
      ...b,
      customer_name: b.customers?.name,
      customer_phone: b.customers?.phone,
      customer_email: b.customers?.email,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type,
      rate_per_night: b.rooms?.rate_per_night
    }));
    const mergedLiveRows = mergeRemoteBookingsWithLocalState(mapped, localRowsForMerge);
    writeCache('bookings', mergedLiveRows);
    return mergedLiveRows;
  } catch (error) {
    if (state.isOnline) {
      const cached = readCache('bookings');
      if (cached.length > 0) {
        console.warn('getAllBookings falling back to cache:', error?.message || error);
      } else if (error) {
        console.error('getAllBookings failed:', error);
      }
    }
  }

  const bookings = readCache('bookings');
  const customers = readCache('customers');
  const rooms = readCache('rooms');

  return bookings.
  map((b) => {
    const customer = customers.find((c) => c.id === b.customer_id);
    const room = rooms.find((r) => r.id === b.room_id);
    return {
      ...b,
      customer_name: customer?.name,
      customer_phone: customer?.phone,
      customer_email: customer?.email,
      room_number: room?.room_number,
      room_type: room?.room_type,
      rate_per_night: room?.rate_per_night
    };
  }).
  sort((a, b) => new Date(b.check_in) - new Date(a.check_in));
}

export async function getBookingById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('bookings').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('bookings').find((booking) => booking.id === id) || null;
  }
}

export async function getPendingOnlineBookings() {
  try {
    if (state.isOnline) {
      const { data, error } = await state.supabase.
      from('bookings').
      select(`*, customers(name, phone, email), rooms(room_number, room_type)`).
      eq('lodge_id', state.lodgeId).
      eq('source', 'online').
      eq('status', 'pending').
      order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        customer_phone: b.customers?.phone,
        customer_email: b.customers?.email,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type
      }));
    }
    // Offline fallback — filter from cache
    const cached = readCache('bookings');
    return cached.filter((b) => b.source === 'online' && b.status === 'pending');
  } catch {
    const cached = readCache('bookings');
    return cached.filter((b) => b.source === 'online' && b.status === 'pending');
  }
}

export async function getBookingsByDateRange(startDate, endDate) {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('bookings').
    select(`*, customers(name), rooms(room_number, room_type, rate_per_night)`).
    eq('lodge_id', state.lodgeId).
    neq('status', 'cancelled').
    lte('check_in', endDate).
    gt('check_out', startDate);

    if (data) {
      return data.map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type,
        rate_per_night: b.rooms?.rate_per_night
      }));
    }
    return [];
  }

  const bookings = readCache('bookings');
  const customers = readCache('customers');
  const rooms = readCache('rooms');

  return bookings.
  filter(
    (b) => b.status !== 'cancelled' && b.check_in <= endDate && b.check_out > startDate
  ).
  map((b) => {
    const customer = customers.find((c) => c.id === b.customer_id);
    const room = rooms.find((r) => r.id === b.room_id);
    return {
      ...b,
      customer_name: customer?.name,
      room_number: room?.room_number,
      room_type: room?.room_type,
      rate_per_night: room?.rate_per_night
    };
  }).
  sort((a, b) => (a.room_number || '').localeCompare(b.room_number || ''));
}

function normalizeEventBookingName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildEventGroupId({ eventName, checkIn, checkOut }) {
  const signature = [
  normalizeLodgeId(state.lodgeId) || 'no-lodge',
  normalizeEventBookingName(eventName),
  String(checkIn || '').trim(),
  String(checkOut || '').trim()].
  join('|');
  return `evt-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 24)}`;
}

function parseEventRoomCount(notes = '') {
  const match = String(notes || '').match(/\[ROOMS:(\d+)\]/);
  const count = Number(match?.[1] || 0);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function stripEventMetadata(notes = '') {
  return String(notes || '').replace(/\[GROUP:[^\]]+\]/g, '').replace(/\[ROOMS:\d+\]/g, '').trim();
}

function findCachedEventBookingByGroup(groupId) {
  return readCache('bookings').find((booking) =>
  booking?.is_exclusive_event &&
  String(booking?.notes || '').includes(`[GROUP:${groupId}]`) &&
  String(booking?.status || '').toLowerCase() !== 'cancelled'
  );
}

async function findRemoteEventBookingByGroup(groupId) {
  if (!state.isOnline) return null;
  const { data, error } = await state.supabase.
  from('bookings').
  select('id, notes, total_amount, check_in, check_out').
  eq('lodge_id', state.lodgeId).
  eq('is_exclusive_event', true).
  neq('status', 'cancelled').
  ilike('notes', `%[GROUP:${groupId}]%`).
  limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

function validateBookingDates(checkIn, checkOut) {
  if (!checkIn || !checkOut) throw new Error('Check-in and check-out dates are required');
  const inMs = new Date(checkIn).getTime();
  const outMs = new Date(checkOut).getTime();
  if (isNaN(inMs) || isNaN(outMs)) throw new Error('Invalid date format');
  if (outMs <= inMs) throw new Error('Check-out must be after check-in');
  const nights = Math.ceil((outMs - inMs) / (1000 * 60 * 60 * 24));
  if (nights < 1) throw new Error('Booking must be at least one night');
  return { nights };
}

async function checkRoomConflict(roomId, checkIn, checkOut, excludeId = null) {
  await checkExclusiveEventConflict(checkIn, checkOut);
  const existingBookings = state.isOnline ?
  (() => {
    let q = state.supabase.
    from('bookings').
    select('id, check_in, check_out').
    eq('lodge_id', state.lodgeId).
    eq('room_id', roomId).
    neq('status', 'cancelled');
    if (excludeId) q = q.neq('id', excludeId);
    return q;
  })().then((r) => r.data || []) :
  Promise.resolve(
    readCache('bookings').filter(
      (b) => b.room_id === roomId && b.status !== 'cancelled' && b.id !== excludeId
    )
  );

  const bookings = await existingBookings;
  const conflict = bookings.find((b) => b.check_in < checkOut && b.check_out > checkIn);
  if (conflict) throw new Error('Room is already booked for these dates');
}

export async function createBooking(data) {
  try {
    await assertCreationWithinUsageLimit('booking', {
      forceRemoteRefresh: state.isOnline,
      monthDate: data?.check_in ? new Date(data.check_in) : new Date()
    });
    const { nights } = validateBookingDates(data.check_in, data.check_out);
    await checkRoomConflict(data.room_id, data.check_in, data.check_out);

    const room = await getRoomById(data.room_id);
    if (!room) throw new Error('Room not found');
    const totalGuests = (data.adults || 1) + (data.children || 0);
    if (totalGuests > (room.max_occupancy || 2)) {
      throw new Error(`Number of guests (${totalGuests}) exceeds room maximum occupancy (${room.max_occupancy || 2})`);
    }
    const baseTotal = room.rate_per_night * nights;
    const requestedTotal = Number(data.total_amount);
    const allowTotalOverride = data.allow_total_override === true &&
    Number.isFinite(requestedTotal) &&
    requestedTotal > 0 &&
    Math.abs(requestedTotal - baseTotal) > 0.01;
    const total = allowTotalOverride ? requestedTotal : baseTotal;
    if (isNaN(total) || total <= 0) throw new Error('Invalid total — check room rate and dates');

    const deposit = Number(data.deposit_amount) || 0;
    const paymentMethod = data.payment_method || 'cash';
    const invoice_number = await getNextBookingInvoiceNumber();
    const id = randomUUID();
    const booking = {
      id,
      customer_id: data.customer_id,
      room_id: data.room_id,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults || 1,
      children: data.children || 0,
      total_amount: total,
      status: 'confirmed',
      payment_status: 'unpaid',
      amount_paid: 0,
      deposit_amount: deposit,
      payment_method: null,
      notes: data.notes || '',
      created_by: data.created_by || null,
      invoice_number,
      lodge_id: state.lodgeId
    };
    const bookingCreateIdempotencyKey = createBookingIdempotencyKey(id);

    if (state.isOnline) {
      if (!booking.customer_id) {
        throw new Error('Customer ID is required for booking');
      }

      const { data: result, error } = await state.supabase.rpc('create_booking', {
        p_lodge_id: booking.lodge_id,
        p_customer_id: booking.customer_id,
        p_room_id: booking.room_id,
        p_check_in: booking.check_in,
        p_check_out: booking.check_out,
        p_adults: booking.adults,
        p_children: booking.children,
        p_total_amount: booking.total_amount,
        p_invoice_number: booking.invoice_number,
        p_notes: booking.notes,
        p_created_by: booking.created_by,
        p_deposit_amount: deposit,
        p_booking_id: booking.id,
        p_idempotency_key: bookingCreateIdempotencyKey,
        p_deposit_method: deposit > 0 ? paymentMethod : null,
        p_allow_total_override: allowTotalOverride
      });

      if (error) {
        if (/function create_booking|p_booking_id|p_idempotency_key|create_idempotency_key|p_allow_total_override/i.test(error.message || '')) {
          throw new Error('The Supabase booking sync contract is outdated. Run the latest checked-in booking sync migration, then try again.');
        }
        if (error.message?.includes('no_overlapping_bookings')) {
          throw new Error('This room is already booked for the selected dates.');
        }
        throw new Error('Network Error: ' + error.message);
      }
      if (!result || !result.success) {
        throw new Error(result?.error || 'Booking failed');
      }
      await refreshCache('bookings');
      const _r = readCache('rooms').find((r) => r.id === booking.room_id);
      const _c = readCache('customers').find((c) => c.id === booking.customer_id);
      logActivity('booking_created', `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${booking.check_in} → ${booking.check_out}`);
      createBackup();

      const bookingId = result.booking_id || id;

      // P2: Explicitly record deposit if provided.
      // This ensures payment records are created even if the create_booking RPC is an older version.
      if (deposit > 0) {
        try {
          await updateBookingPayment(bookingId, deposit, paymentMethod, 'deposit');
        } catch (depError) {
          // If deposit fails but booking succeeded, surface as a warning so the UI stays in the modal.
          const err = new Error(depError.message || 'Deposit could not be recorded');
          err.code = 'DEPOSIT_FAILED';
          err.booking_id = bookingId;
          throw err;
        }
      }
      return bookingId;
    } else {
      const cached = readCache('bookings');
      const cachedCustomer = booking.customer_id ?
      readCache('customers').find((customer) => customer.id === booking.customer_id) :
      null;
      const optimisticPayment = buildOfflineBookingFinancialState(total, deposit);
      const newBooking = {
        ...booking,
        amount_paid: optimisticPayment.amount_paid,
        payment_status: optimisticPayment.payment_status,
        _local_invoice_number: buildLocalPendingInvoiceNumber(id),
        _pending_sync: true,
        _pending_payment: deposit > 0,
        _sync_created_offline: true,
        _sync_state: 'pending',
        _sync_error: null,
        created_at: new Date().toISOString()
      };

      queueOperation('rpc', 'create_booking', {
        p_lodge_id: booking.lodge_id,
        p_customer_id: booking.customer_id,
        p_room_id: booking.room_id,
        p_check_in: booking.check_in,
        p_check_out: booking.check_out,
        p_adults: booking.adults,
        p_children: booking.children || 0,
        p_total_amount: booking.total_amount,
        p_invoice_number: booking.invoice_number,
        p_notes: booking.notes || '',
        p_created_by: booking.created_by,
        p_deposit_amount: deposit,
        p_booking_id: booking.id,
        p_idempotency_key: bookingCreateIdempotencyKey,
        p_deposit_method: deposit > 0 ? paymentMethod : null,
        p_allow_total_override: allowTotalOverride
      }, null, {
        _queue_id: `booking-${id}`,
        ...(cachedCustomer?._pending_sync ? { _depends_on: `customer-${booking.customer_id}` } : {})
      });

      cached.push(newBooking);
      writeCache('bookings', cached);

      // P2: Explicitly queue deposit if provided.
      // updateBookingPayment handles its own queuing and dependency on the booking creation record.
      if (deposit > 0) {
        await updateBookingPayment(id, deposit, paymentMethod, 'deposit');
      }

      const _r = readCache('rooms').find((r) => r.id === newBooking.room_id);
      const _c = readCache('customers').find((c) => c.id === newBooking.customer_id);

      logActivity(
        'booking_created',
        `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${newBooking.check_in} → ${newBooking.check_out}`
      );

      createBackup();

      return id;
    }
  } catch (error) {
    recordCriticalError('booking.create', error, {
      customer_id: data?.customer_id || null,
      room_id: data?.room_id || null,
      check_in: data?.check_in || null,
      check_out: data?.check_out || null,
      deposit_amount: Number(data?.deposit_amount || 0)
    });
    throw error;
  }
}

export async function updateBooking(id, data) {
  try {
    const { nights } = validateBookingDates(data.check_in, data.check_out);
    await checkRoomConflict(data.room_id, data.check_in, data.check_out, id);

    const room = await getRoomById(data.room_id);
    if (!room) throw new Error('Room not found');
    const totalGuests = (data.adults || 1) + (data.children || 0);
    if (totalGuests > (room.max_occupancy || 2)) {
      throw new Error(`Number of guests (${totalGuests}) exceeds room maximum occupancy (${room.max_occupancy || 2})`);
    }
    const total = room.rate_per_night * nights;
    if (isNaN(total) || total <= 0) throw new Error('Invalid total — check room rate and dates');

    // Local payment_status estimate for the offline cache only.
    // The server ALWAYS recomputes payment_status authoritatively (Phase 2 hardening).
    // payment_status is intentionally NOT sent in the RPC payload — the server ignores it anyway.
    const currentBooking = readCache('bookings').find((b) => b.id === id);
    const expectedUpdatedAt = data.expected_updated_at || currentBooking?.updated_at || null;
    const amountPaid = Number(currentBooking?.amount_paid) || 0;
    // Include charges_total so the offline estimate matches server logic
    const chargesTotal = Number(currentBooking?.charges_total) || 0;
    const totalOwed = total + chargesTotal;
    const offlinePaymentStatus = amountPaid >= totalOwed ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';

    // payment_status is NOT included — server derives it from authoritative fields
    const update = {
      customer_id: data.customer_id,
      room_id: data.room_id,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults,
      children: data.children,
      total_amount: total,
      notes: data.notes,
      updated_at: new Date().toISOString()
    };

    const rpcPayload = {
      ...update,
      ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {})
    };

    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('update_booking', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: rpcPayload,
        p_expected_updated_at: rpcPayload.expected_updated_at || null
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not update booking');
      await refreshCache('bookings');
    } else {
      const cached = readCache('bookings');
      const idx = cached.findIndex((b) => b.id === id);
      const _updDepend = cached[idx]?._pending_sync ? `booking-${id}` : null;
      // Queue FIRST — dependency resolved from pre-write cache; no second read needed
      queueOperation('rpc', 'update_booking', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: rpcPayload,
        p_expected_updated_at: rpcPayload.expected_updated_at || null
      }, null, _updDepend ? { _depends_on: _updDepend } : {});
      // Cache SECOND — offline estimate includes charges_total for correct local display
      if (idx >= 0) {
        cached[idx] = {
          ...cached[idx],
          ...update,
          payment_status: offlinePaymentStatus,
          _pending_payment: true,
          _pending_sync: true
        };
      }
      writeCache('bookings', cached);
    }
  } catch (error) {
    recordCriticalError('booking.update', error, {
      booking_id: id,
      room_id: data?.room_id || null,
      check_in: data?.check_in || null,
      check_out: data?.check_out || null
    });
    throw error;
  }
}

export async function updateBookingStatus(id, status) {
  // Enforce state machine — read current status from cache first
  const currentBooking = readCache('bookings').find((b) => b.id === id);
  if (currentBooking) {
    const allowed = VALID_STATUS_TRANSITIONS[currentBooking.status];
    if (allowed && !allowed.includes(status)) {
      throw new Error(`Cannot transition booking from '${currentBooking.status}' to '${status}'`);
    }
  }

  if (status === 'checked_in' && currentBooking) {
    const checkInDate = new Date(currentBooking.check_in + 'T00:00:00');
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    if (checkInDate.getTime() > todayDate.getTime()) {
      throw new Error(`Cannot check in before the check-in date (${currentBooking.check_in}).`);
    }
  }

  if (status === 'checked_out' && currentBooking) {
    const outstanding = Math.max(
      0,
      Number(currentBooking.total_amount || 0) + Number(currentBooking.charges_total || 0) - Number(currentBooking.amount_paid || 0)
    );
    if (outstanding > 0) {
      throw new Error(`Cannot check out this guest until the full balance is paid. Outstanding: ${outstanding.toFixed(2)}`);
    }
  }

  const expectedUpdatedAt = currentBooking?.updated_at || null;
  const update = { status, updated_at: new Date().toISOString() };

  const roomStatus =
  status === 'checked_in' ? 'occupied' :
  status === 'checked_out' || status === 'cancelled' ? 'available' : null;

  const actionLabel = {
    checked_in: 'Check-in',
    checked_out: 'Check-out',
    cancelled: 'Booking cancelled',
    confirmed: 'Booking confirmed'
  }[status] || `Status → ${status}`;

  const actionKey = {
    checked_in: 'check_in',
    checked_out: 'check_out',
    cancelled: 'booking_cancelled',
    confirmed: 'booking_confirmed'
  }[status] || 'booking_updated';

  if (state.isOnline) {
    const { data: booking } = await state.supabase.
    from('bookings').select('room_id, customer_id').
    eq('id', id).eq('lodge_id', state.lodgeId).single();
    const { data: result, error } = await state.supabase.rpc('update_booking_status', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update booking status');
    await refreshCache('bookings', 'rooms');
    const _r = readCache('rooms').find((r) => r.id === booking?.room_id);
    const _c = readCache('customers').find((c) => c.id === booking?.customer_id);
    logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''}`);
    if (status === 'checked_in' || status === 'checked_out') createBackup();
  } else {
    const bookings = readCache('bookings');
    const idx = bookings.findIndex((b) => b.id === id);
    const bk = bookings[idx] || {};
    const roomId = bk.room_id;
    const _stDepend = bookings[idx]?._pending_sync ? `booking-${id}` : null;
    // Queue FIRST — single entry; update_booking_status updates room status atomically server-side.
    // IMPORTANT: Do NOT reintroduce set_room_status here.
    // update_booking_status RPC already updates room status atomically server-side.
    // Adding it again creates duplicate writes and potential race conditions.
    queueOperation('rpc', 'update_booking_status', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status,
      p_expected_updated_at: _stDepend ? null : expectedUpdatedAt
    }, null, _stDepend ? { _depends_on: _stDepend } : {});
    // Cache SECOND — booking
    if (idx >= 0) bookings[idx] = { ...bookings[idx], ...update };
    writeCache('bookings', bookings);
    // Cache SECOND — room (read rooms only when needed; room variable preserved for logActivity)
    if (roomStatus && roomId) {
      const rooms = readCache('rooms');
      const rIdx = rooms.findIndex((r) => r.id === roomId);
      const room = rooms[rIdx];
      if (rIdx >= 0) rooms[rIdx] = { ...rooms[rIdx], status: roomStatus };
      writeCache('rooms', rooms);
      const _c = readCache('customers').find((c) => c.id === bk.customer_id);
      logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${room?.room_number || ''}`);
    } else {
      logActivity(actionKey, `${actionLabel} · Booking #${id}`);
    }
    if (status === 'checked_in' || status === 'checked_out') createBackup();
  }
}

export async function updateBookingPayment(id, paymentAmount, paymentMethod, type = 'payment', dependsOn = null, callerKey = null) {
  const numericAmount = Number(paymentAmount) || 0;
  const currentBooking = readCache('bookings').find((b) => b.id === id) || null;
  const expectedUpdatedAt = currentBooking?.updated_at || null;
  if (type === 'refund') {
    if (numericAmount >= 0) throw new Error('Refund amount must be negative');
  } else if (numericAmount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  // Generate deterministic fallback signature (booking+status+amount) to prevent double-payments
  // even if intentKey is lost after app restart. Format: booking_id:status:amount
  const fallbackSignature = buildPaymentFallbackSignature(id, type, numericAmount, expectedUpdatedAt);
  if (type === 'payment' && !callerKey) {
    console.warn('[PAYMENT] Missing intent key — using deterministic fallback signature. Booking:', id, 'Signature:', fallbackSignature);
  }
  const idempotencyKey = callerKey ?
  createPaymentIdempotencyKey(id, type, callerKey) :
  createPaymentIdempotencyKey(id, type, null, fallbackSignature);
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_booking_payment', {
      p_booking_id: id,
      p_lodge_id: state.lodgeId,
      p_amount: numericAmount,
      p_method: paymentMethod || 'cash',
      p_type: type,
      p_idempotency_key: idempotencyKey,
      p_recorded_by: state.currentUser?.id || null,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Payment failed');

    await refreshCache('bookings');
    const bk = readCache('bookings').find((b) => b.id === id);
    const _c = readCache('customers').find((c) => c.id === bk?.customer_id);
    const activityLabel = type === 'refund' ? 'refund_processed' : 'payment_updated';
    const verb = type === 'refund' ? 'Refund recorded' : 'Payment updated';
    logActivity(activityLabel, `${verb} · ${_c?.name || 'Guest'} · ${result.payment_status} · ${Math.abs(numericAmount).toFixed(2)} (${paymentMethod})`);
    return { success: true, offline: false, ...result };
  } else {
    const cached = readCache('bookings');
    const idx = cached.findIndex((b) => b.id === id);
    if (idx >= 0) {
      const b = cached[idx];
      const newPaid = (Number(b.amount_paid) || 0) + numericAmount;
      if (newPaid < 0) {
        throw new Error('Payment update would result in a negative amount paid.');
      }
      // Canonical amount owed = room total + charges; || 0 guards against null/undefined charges_total
      const totalOwed = (Number(b.total_amount) || 0) + (Number(b.charges_total) || 0);

      if (type === 'payment' && newPaid > totalOwed + 0.01) {
        throw new Error(`Amount paid (${newPaid.toFixed(2)}) cannot exceed total booking value (${totalOwed.toFixed(2)}).`);
      }

      // Use b._pending_sync (pre-write value) — only depend on booking creation entry;
      // avoids false dependency when booking is already synced to server
      const autoDepend = dependsOn || (b._pending_sync ? `booking-${id}` : null);
      const paymentMeta = autoDepend ? { _depends_on: autoDepend } : {};
      // Queue FIRST — intent is durable before local state changes
      queueOperation('rpc', 'update_booking_payment', {
        p_booking_id: id,
        p_lodge_id: state.lodgeId,
        p_amount: numericAmount,
        p_method: paymentMethod || 'cash',
        p_type: type,
        p_idempotency_key: idempotencyKey,
        p_recorded_by: state.currentUser?.id || null,
        p_expected_updated_at: b.updated_at || null
      }, null, paymentMeta);
      // Cache SECOND
      cached[idx] = {
        ...b,
        _pending_payment: true, // local estimate — not server-confirmed; cleared by refreshCache
        _pending_sync: true, // UI-only flag — never sent to Supabase; cleared by next refreshCache from DB
        updated_at: new Date().toISOString()
      };
      writeCache('bookings', cached);
      const _c = readCache('customers').find((c) => c.id === b.customer_id);
      const activityLabel = type === 'refund' ? 'refund_processed' : 'payment_updated';
      const verb = type === 'refund' ? 'Refund recorded (offline)' : 'Payment updated (offline)';
      logActivity(activityLabel, `${verb} · ${_c?.name || 'Guest'} · Pending sync · ${Math.abs(numericAmount).toFixed(2)} (${paymentMethod})`);
      return { success: true, offline: true, queued: true };
    } else {
      // Booking not found in cache — queue with no dependency (prevents false links)
      queueOperation('rpc', 'update_booking_payment', {
        p_booking_id: id,
        p_lodge_id: state.lodgeId,
        p_amount: numericAmount,
        p_method: paymentMethod || 'cash',
        p_type: type,
        p_idempotency_key: idempotencyKey,
        p_recorded_by: state.currentUser?.id || null,
        p_expected_updated_at: expectedUpdatedAt
      }, null, dependsOn ? { _depends_on: dependsOn } : {});
      return { success: true, offline: true, queued: true };
    }
  }
}

export async function getBookingPayments(bookingId) {
  if (!bookingId) return [];
  // NOTE: Payment history is only available when online.
  // When offline, callers should display the booking's amount_paid and note that detailed payment history is unavailable.
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_booking_payments', {
    p_booking_id: bookingId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function refundBooking(bookingId, options = {}) {
  try {
    const booking = (await getAllBookings()).find((entry) => entry.id === bookingId);
    if (!booking) throw new Error('Booking not found');
    const bookingStatus = String(booking.status || '').toLowerCase();
    if (bookingStatus === 'checked_in') {
      throw new Error('Refunds are not allowed while guest is checked in. Please wait until check-out or cancel the booking.');
    }

    const retainedPercent = Math.min(100, Math.max(0, Number(options.retained_percent ?? options.retainedPercent ?? 0) || 0));
    const baseAmount = Math.max(0, Number(booking.amount_paid || 0));
    if (baseAmount <= 0) throw new Error('This booking has no paid amount available to refund');

    const refundAmount = Math.round(baseAmount * ((100 - retainedPercent) / 100) * 100) / 100;
    const retainedAmount = Math.max(0, Math.round((baseAmount - refundAmount) * 100) / 100);
    if (refundAmount <= 0) throw new Error('Retained percentage leaves nothing to refund');

    const paymentMethod = options.method || 'refund';
    const notes = String(options.notes || '').trim();
    const proofReference = String(options.proof_reference ?? options.proofReference ?? '').trim();
    const approvalNote = String(options.approval_note ?? options.approvalNote ?? '').trim();
    const approverPin = String(options.approver_pin ?? options.approverPin ?? '').trim();

    if (!state.isOnline) throw new Error('Refund approvals require an internet connection');
    if (!proofReference) throw new Error('Proof reference is required before a refund can be approved');
    if (!approverPin) throw new Error('Manager/Admin approval PIN is required');

    const { data: approver, error: approverError } = await state.supabase.rpc('verify_refund_approver_pin', {
      p_lodge_id: state.lodgeId,
      p_pin: approverPin
    });
    if (approverError) throw new Error(approverError.message);
    if (!approver?.success) throw new Error(approver?.error || 'Invalid approval PIN or unauthorized approver');

    const { data, error } = await state.supabase.rpc('approve_booking_refund', {
      p_booking_id: bookingId,
      p_lodge_id: state.lodgeId,
      p_retained_percent: retainedPercent,
      p_method: paymentMethod,
      p_notes: notes,
      p_requested_by: state.currentUser?.id || null,
      p_approved_by: approver.approved_by,
      p_proof_reference: proofReference,
      p_approval_note: approvalNote
    });

    if (error) throw new Error(error.message || 'Refund failed');
    if (!data?.success) throw new Error(data?.error || 'Refund failed');

    await refreshCache('bookings');

    const customer = readCache('customers').find((entry) => entry.id === booking.customer_id);
    logActivity(
      'refund_processed',
      `Refund processed · ${customer?.name || booking.customer_name || 'Guest'} · refunded ${refundAmount.toFixed(2)} · retained ${retainedAmount.toFixed(2)} (${retainedPercent.toFixed(2)}%) · approved by ${approver?.approved_by_name || 'manager'}`
    );

    return {
      success: true,
      booking_id: bookingId,
      refund_amount: refundAmount,
      retained_amount: retainedAmount,
      retained_percent: retainedPercent,
      approved_by: approver?.approved_by || null,
      approved_by_name: approver?.approved_by_name || null
    };
  } catch (error) {
    recordCriticalError('booking.refund', error, {
      booking_id: bookingId,
      retained_percent: options?.retained_percent ?? options?.retainedPercent ?? null,
      method: options?.method || 'refund'
    });
    throw error;
  }
}

export async function createEventBooking(data) {
  let customerId;
  let bookingCustomerDepend = null;
  const eventName = String(data.event_name || '').trim();
  if (!eventName) throw new Error('Event / group name is required');
  const { nights } = validateBookingDates(data.check_in, data.check_out);
  const groupId = buildEventGroupId({
    eventName,
    checkIn: data.check_in,
    checkOut: data.check_out
  });
  const cachedExistingEvent = findCachedEventBookingByGroup(groupId);
  if (cachedExistingEvent) {
    return {
      success: true,
      idempotent: true,
      bookingId: cachedExistingEvent.id,
      count: parseEventRoomCount(cachedExistingEvent.notes) || 1,
      groupId,
      rooms: [],
      totalPrice: Number(cachedExistingEvent.total_amount || 0),
      nights
    };
  }
  const contactCustomer = {
    name: eventName,
    phone: data.contact_phone || '',
    email: data.contact_email || '',
    id_number: '',
    nationality: '',
    lodge_id: state.lodgeId
  };

  if (state.isOnline) {
    const existingEvent = await findRemoteEventBookingByGroup(groupId);
    if (existingEvent) {
      return {
        success: true,
        idempotent: true,
        bookingId: existingEvent.id,
        count: parseEventRoomCount(existingEvent.notes) || 1,
        groupId,
        rooms: [],
        totalPrice: Number(existingEvent.total_amount || 0),
        nights
      };
    }

    const { data: existing } = await state.supabase.
    from('customers').select('id').eq('lodge_id', state.lodgeId).eq('name', eventName).limit(1);
    if (existing?.length > 0) {
      customerId = existing[0].id;
    } else {
      const newCustomer = { ...contactCustomer, id: randomUUID() };
      const { data: result, error } = await state.supabase.rpc('create_customer', { payload: newCustomer });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not create customer');
      customerId = result?.id;
    }
  } else {
    const cached = readCache('customers');
    const existing = cached.find((c) => c.name === eventName);
    if (existing) {
      customerId = existing.id;
      if (existing._pending_sync) {
        bookingCustomerDepend = `customer-${customerId}`;
      }
    } else {
      customerId = randomUUID();
      const newCustomer = { ...contactCustomer, id: customerId, _pending_sync: true, created_at: new Date().toISOString() };
      cached.push(newCustomer);
      writeCache('customers', cached);
      // P2-15: assign a stable _queue_id so booking records can declare _depends_on
      bookingCustomerDepend = `customer-${customerId}`;
      queueOperation('rpc', 'create_customer', {
        payload: {
          ...contactCustomer,
          id: customerId,
          created_at: newCustomer.created_at
        }
      }, null, { _queue_id: bookingCustomerDepend });
    }
  }

  const allRooms = await getAllRooms();
  const bookableRooms = allRooms.filter((r) => r.status !== 'maintenance');

  const conflicting = state.isOnline ?
  (
  await state.supabase.
  from('bookings').
  select('room_id').
  eq('lodge_id', state.lodgeId).
  neq('status', 'cancelled').
  lt('check_in', data.check_out).
  gt('check_out', data.check_in)).
  data || [] :
  readCache('bookings').filter(
    (b) =>
    b.status !== 'cancelled' &&
    b.check_in < data.check_out &&
    b.check_out > data.check_in
  );

  if (conflicting.length > 0) {
    const roomCount = new Set(conflicting.map((b) => b.room_id)).size;
    throw new Error(
      `Cannot create exclusive event — ${roomCount} room${roomCount !== 1 ? 's' : ''} already have bookings on these dates. Cancel or move existing bookings first.`
    );
  }

  if (bookableRooms.length === 0) {
    throw new Error('No rooms available — all rooms are under maintenance.');
  }

  const eventDailyRate = Number(data.event_daily_rate) || 0;
  const totalEventPrice = eventDailyRate * nights;
  const totalDeposit = Number(data.deposit_amount) || 0;
  const paymentMethod = data.payment_method || 'cash';
  const eventNotes = `[GROUP:${groupId}][ROOMS:${bookableRooms.length}]${data.notes ? '\n' + data.notes : ''}`;
  const representativeRoom = [...bookableRooms].sort((left, right) =>
  String(left.room_number || '').localeCompare(String(right.room_number || ''), undefined, { numeric: true, sensitivity: 'base' })
  )[0];

  const invoice_number = await getNextBookingInvoiceNumber();
  const bookingId = randomUUID();
  const eventIdempotencyKey = `event-booking:${groupId}`;
  const booking = {
    id: bookingId,
    customer_id: customerId,
    room_id: representativeRoom.id,
    check_in: data.check_in,
    check_out: data.check_out,
    adults: 1,
    children: 0,
    total_amount: totalEventPrice,
    status: 'confirmed',
    payment_status: 'unpaid',
    amount_paid: 0,
    deposit_amount: totalDeposit,
    payment_method: null,
    notes: eventNotes,
    is_exclusive_event: true,
    event_daily_rate: eventDailyRate,
    invoice_number,
    created_by: data.created_by || null,
    lodge_id: state.lodgeId
  };

  let createdBookingId = bookingId;

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_booking_record', {
      payload: {
        ...booking,
        deposit_method: totalDeposit > 0 ? paymentMethod : null,
        create_idempotency_key: eventIdempotencyKey,
        allow_total_override: true
      }
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create event booking');
    createdBookingId = result.booking_id || bookingId;
  } else {
    const newBooking = {
      ...booking,
      amount_paid: 0,
      payment_status: 'unpaid',
      _local_invoice_number: buildLocalPendingInvoiceNumber(bookingId),
      _pending_sync: true,
      _pending_payment: totalDeposit > 0,
      _sync_created_offline: true,
      _sync_state: 'pending',
      _sync_error: null,
      created_at: new Date().toISOString()
    };
    // Queue FIRST — crash before cache write means booking syncs but won't appear locally until refresh.
    queueOperation('rpc', 'create_booking_record', {
      payload: {
        ...booking,
        deposit_method: totalDeposit > 0 ? paymentMethod : null,
        create_idempotency_key: eventIdempotencyKey,
        allow_total_override: true
      }
    }, null, {
      _queue_id: `booking-${bookingId}`,
      ...(bookingCustomerDepend ? { _depends_on: bookingCustomerDepend } : {})
    });
    // Cache SECOND.
    const cachedBookings = readCache('bookings');
    cachedBookings.push(newBooking);
    writeCache('bookings', cachedBookings);
  }

  if (state.isOnline) await refreshCache('bookings');

  logActivity(
    'event_booking_created',
    `Exclusive event · ${eventName} · ${bookableRooms.length} room${bookableRooms.length !== 1 ? 's' : ''} · ${data.check_in} → ${data.check_out} · ${totalEventPrice.toFixed(2)}`
  );
  createBackup();

  return {
    bookingId: createdBookingId,
    count: bookableRooms.length,
    groupId,
    rooms: bookableRooms.map((r) => r.room_number),
    totalPrice: totalEventPrice,
    nights
  };
}

export async function getBookingCharges(bookingId) {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('booking_charges').
    select('*, outlets(name)').
    eq('lodge_id', state.lodgeId).
    eq('booking_id', bookingId).
    is('voided_at', null).
    order('created_at');
    return data || [];
  }
  return { unavailable: true };
}

export async function getBookingChargeById(chargeId) {
  if (!chargeId) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('booking_charges').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', chargeId).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return null;
}

export async function addBookingCharge(bookingId, data) {
  try {
    if (Number(data.unit_price) <= 0) throw new Error('Charge unit price must be greater than zero');
    const currentBooking = readCache('bookings').find((booking) => booking.id === bookingId) || null;
    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('add_booking_charge', {
        p_booking_id: bookingId,
        p_lodge_id: state.lodgeId,
        p_description: data.description,
        p_category: data.category || 'other',
        p_quantity: Number(data.quantity) || 1,
        p_unit_price: Number(data.unit_price) || 0,
        p_outlet_id: data.outlet_id || null, // explicit outlet attribution; null = Unassigned
        p_expected_updated_at: currentBooking?.updated_at || null
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not add booking charge');
      return { success: true, id: result?.id };
    }
    return { success: false, error: 'Charges require an internet connection' };
  } catch (error) {
    recordCriticalError('booking.charge.add', error, {
      booking_id: bookingId,
      description: data?.description || '',
      amount: Number(data?.unit_price || 0) * Number(data?.quantity || 1)
    });
    throw error;
  }
}

export async function deleteBookingCharge(chargeId, reason = '') {
  try {
    const charge = await getBookingChargeById(chargeId).catch(() => null);
    const currentBooking = charge?.booking_id ?
    readCache('bookings').find((booking) => booking.id === charge.booking_id) || null :
    null;
    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('delete_booking_charge', {
        p_charge_id: chargeId,
        p_lodge_id: state.lodgeId,
        p_reason: reason || null,
        p_expected_booking_updated_at: currentBooking?.updated_at || null
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not void booking charge');
      return { success: true, voided: !!result?.voided };
    }
    return { success: false, error: 'Requires internet connection' };
  } catch (error) {
    recordCriticalError('booking.charge.delete', error, {
      charge_id: chargeId,
      reason: reason || null
    });
    throw error;
  }
}

export async function getRateOverrides() {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('room_rate_overrides').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('start_date');
    return data || [];
  }
  return [];
}

export async function getRateOverrideById(id) {
  if (!id || !state.isOnline) return null;
  const { data, error } = await state.supabase.
  from('room_rate_overrides').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function createRateOverride(data) {
  const override = {
    lodge_id: state.lodgeId,
    room_id: data.room_id || null,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    rate_per_night: Number(data.rate_per_night)
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_room_rate_override', { payload: override });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create rate override');
    return { success: true, id: result?.id };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function updateRateOverride(id, data) {
  const update = {
    room_id: data.room_id || null,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    rate_per_night: Number(data.rate_per_night)
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_room_rate_override', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update rate override');
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function deleteRateOverride(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_room_rate_override', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete rate override');
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function getApplicableRate(roomId, checkIn, checkOut) {
  if (!state.isOnline) return null;
  try {
    const { data: overrides } = await state.supabase.
    from('room_rate_overrides').
    select('*').
    eq('lodge_id', state.lodgeId).
    lte('start_date', checkOut).
    gte('end_date', checkIn);
    if (!overrides || overrides.length === 0) return null;
    const specific = overrides.find((o) => o.room_id === roomId);
    const global = overrides.find((o) => !o.room_id);
    const applicable = specific || global;
    return applicable ? { rate: applicable.rate_per_night, name: applicable.name } : null;
  } catch {
    return null;
  }
}

export async function getActiveBookingForRoom(roomId) {
  if (!state.isOnline) return null;
  const today = new Date().toISOString().split('T')[0];
  const { data } = await state.supabase.
  from('bookings').
  select('id, customer_id, customers(name)').
  eq('lodge_id', state.lodgeId).
  eq('room_id', roomId).
  in('status', ['confirmed', 'checked_in']).
  lte('check_in', today).
  gt('check_out', today).
  limit(1).
  maybeSingle();
  return data ?
  {
    ...data,
    customer_name: data.customer_name || data.customers?.name || null
  } :
  null;
}

async function getNextBookingInvoiceNumber() {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('get_next_invoice_number', { p_lodge_id: state.lodgeId });
    if (error) {
      if (!isMissingInvoiceNumberRpcError(error)) {
        throw new Error('Failed to generate invoice number: ' + error.message);
      }
      console.warn('[Invoices] get_next_invoice_number RPC unavailable, falling back to lookup:', error.message);
      return await getNextInvoiceNumberByLookup(state.supabase);
    }
    return data;
  }
  // Offline: return null — server generates the real invoice number when the queued RPC fires.
  // Previously generated a provisional INV-YYYY-XXXX locally, but two offline devices could
  // produce the same number, causing a UNIQUE constraint failure on sync.
  return null;
}

export async function getBookingInvoices() {
  const bookings = await getAllBookings();
  let invoiceRows = [];

  if (state.isOnline) {
    let { data, error } = await state.supabase.
    from('invoices').
    select('id, booking_id, lodge_id, invoice_number, issued_at, due_date, notes, created_at').
    eq('lodge_id', state.lodgeId).
    not('booking_id', 'is', null).
    order('issued_at', { ascending: false });

    if (error) {
      const fallback = await state.supabase.
      from('invoices').
      select('id, booking_id, lodge_id, invoice_number, issued_at').
      eq('lodge_id', state.lodgeId).
      not('booking_id', 'is', null).
      order('issued_at', { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.warn('getBookingInvoices using booking-only fallback:', error.message);
      invoiceRows = [];
    } else {
      invoiceRows = data || [];
    }
  }

  const invoiceByBookingId = new Map(
    invoiceRows.
    filter((invoice) => invoice?.booking_id).
    map((invoice) => [invoice.booking_id, invoice])
  );

  const rows = bookings.
  map((booking) => {
    const invoice = invoiceByBookingId.get(booking.id);
    const invoice_number = invoice?.invoice_number || booking.invoice_number || booking._local_invoice_number || null;
    if (!invoice_number) return null;

    const total_amount = Number(booking.total_amount || 0);
    const amount_paid = Number(booking.amount_paid || 0);
    const charges_total = Number(booking.charges_total || 0); // || 0 guards against null on older rows
    const nights = Math.max(
      0,
      Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24))
    );

    return {
      ...booking,
      booking_id: booking.id,
      invoice_id: invoice?.id || null,
      invoice_number,
      issued_at: invoice?.issued_at || booking.created_at || null,
      due_date: invoice?.due_date || booking.check_in || null,
      invoice_notes: invoice?.notes || '',
      total_amount,
      amount_paid,
      charges_total,
      balance_due: Math.max(0, total_amount + charges_total - amount_paid),
      nights,
      ...(booking.is_exclusive_event ? {
        _event_group: true,
        room_count: parseEventRoomCount(booking.notes) || 1,
        room_type: 'Full Lodge',
        room_number: 'Full Lodge',
        display_notes: stripEventMetadata(booking.notes)
      } : {})
    };
  }).
  filter(Boolean);

  const regularRows = rows.filter((row) => !row.is_exclusive_event);
  const eventRows = rows.filter((row) => row.is_exclusive_event);
  const eventGroups = new Map();
  for (const row of eventRows) {
    const groupId = String(row.notes || '').match(/\[GROUP:([^\]]+)\]/)?.[1] || row.booking_id;
    if (!eventGroups.has(groupId)) {
      eventGroups.set(groupId, {
        ...row,
        _event_group: true,
        event_group_id: groupId,
        room_count: parseEventRoomCount(row.notes) || 0,
        room_type: 'Full Lodge',
        room_number: 'Full Lodge',
        display_notes: stripEventMetadata(row.notes),
        _event_booking_ids: []
      });
    }
    const grouped = eventGroups.get(groupId);
    grouped._event_booking_ids.push(row.booking_id);
    grouped.room_count = Math.max(Number(grouped.room_count || 0), parseEventRoomCount(row.notes) || 0, grouped._event_booking_ids.length);
    if (row.booking_id !== grouped.booking_id) {
      grouped.total_amount += Number(row.total_amount || 0);
      grouped.amount_paid += Number(row.amount_paid || 0);
      grouped.charges_total += Number(row.charges_total || 0);
      grouped.balance_due = Math.max(0, grouped.total_amount + grouped.charges_total - grouped.amount_paid);
    }
  }

  return [...regularRows, ...eventGroups.values()].
  sort((a, b) => {
    const left = String(a.issued_at || a.created_at || a.check_in || '');
    const right = String(b.issued_at || b.created_at || b.check_in || '');
    return right.localeCompare(left);
  });
}

async function getNextQuotationNumber() {
  const year = new Date().getFullYear();
  const prefix = `Q-${year}-`;
  let nums = [];
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('quotations').
    select('quotation_number').
    eq('lodge_id', state.lodgeId).
    like('quotation_number', `${prefix}%`);
    nums = (data || []).
    map((r) => parseInt((r.quotation_number || '').replace(prefix, ''), 10)).
    filter((n) => !isNaN(n));
  } else {
    nums = readCache('quotations').
    filter((q) => (q.quotation_number || '').startsWith(prefix)).
    map((q) => parseInt(q.quotation_number.replace(prefix, ''), 10)).
    filter((n) => !isNaN(n));
  }
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function getNextQuotationNumberAfter(currentNumber) {
  const match = String(currentNumber || '').match(/^(Q-\d{4}-)(\d+)$/);
  if (!match) return getNextQuotationNumber();
  const [, prefix, seq] = match;
  return `${prefix}${String(Number(seq) + 1).padStart(seq.length, '0')}`;
}

function isQuotationNumberConflict(message = '') {
  return /quotations_lodge_id_quotation_number_key|duplicate key value/i.test(String(message));
}

function buildQuotationRecord(data, overrides = {}) {
  const customer = readCache('customers').find((c) => c.id === data.customer_id);
  const room = data.room_id ? readCache('rooms').find((r) => r.id === data.room_id) : null;

  const subtotal = Number(data.subtotal ?? 0);
  const tax_amount = Number(calcTax(subtotal, data.tax_rate ?? 0));
  const total_amount = subtotal + tax_amount;

  return {
    id: overrides.id || randomUUID(),
    quotation_number: overrides.quotation_number,
    lodge_id: state.lodgeId,
    customer_id: data.customer_id,
    customer_name: data.customer_name || customer?.name || '',
    customer_phone: data.customer_phone || customer?.phone || '',
    room_id: data.room_id || null,
    room_name: data.room_name || (room ? `Room ${room.room_number}` : ''),
    check_in: data.check_in || null,
    check_out: data.check_out || null,
    adults: Number(data.adults) || 1,
    children: Number(data.children) || 0,
    subtotal,
    tax_amount,
    total_amount,
    currency: data.currency || 'BWP',
    notes: data.notes || '',
    status: 'draft',
    valid_until: data.valid_until || null,
    parent_quotation_id: data.parent_quotation_id || null,
    created_by: state.currentUser?.id || null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString()
  };
}

function normalizeQuotationForDisplay(q, { customer = null, room = null, convertedBookingId = null, todayStr = null } = {}) {
  if (!q || typeof q !== 'object') return q;
  const subtotal = Number(q.subtotal ?? 0);
  const taxAmount = Number(q.tax_amount ?? calcTax(subtotal, q.tax_rate ?? 0));
  const totalAmount = Number(q.total_amount ?? subtotal + taxAmount);
  const roomNumber = room?.room_number || q.room_number || '';
  const normalizedConvertedBookingId = q.converted_booking_id || convertedBookingId || null;
  const baseStatus = normalizedConvertedBookingId ? 'converted' : q.status || 'draft';
  const status = todayStr && q.valid_until && q.valid_until < todayStr && ['draft', 'sent', 'accepted'].includes(baseStatus) ?
  'expired' :
  baseStatus;

  return {
    ...q,
    converted_booking_id: normalizedConvertedBookingId,
    status,
    quotation_number: q.quotation_number || 'Unnumbered',
    customer_name: q.customer_name || customer?.name || 'Unknown guest',
    customer_phone: q.customer_phone || customer?.phone || '',
    customer_email: q.customer_email || q.customers?.email || customer?.email || '',
    room_name: q.room_name || (roomNumber ? `Room ${roomNumber}` : ''),
    check_in: q.check_in || null,
    check_out: q.check_out || null,
    adults: Number(q.adults) || 1,
    children: Number(q.children) || 0,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    currency: q.currency || 'BWP',
    notes: q.notes || '',
    valid_until: q.valid_until || null,
    created_at: q.created_at || q.updated_at || new Date(0).toISOString(),
    updated_at: q.updated_at || q.created_at || new Date(0).toISOString()
  };
}

export async function getAllQuotations() {
  const cachedQuotations = readCache('quotations');
  if (state.isOnline) {
    let linkedBookings = [];
    const { data, error } = await state.supabase.
    from('quotations').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false });
    if (error) {
      if (cachedQuotations.length > 0) {
        console.warn('getAllQuotations falling back to cache:', error.message);
        return cachedQuotations;
      }
      throw new Error(error.message);
    }

    const customers = readCache('customers');
    const rooms = readCache('rooms');
    const liveRows = (data || []).length === 0 && cachedQuotations.length > 0 ?
    cachedQuotations :
    data || [];
    try {
      const bookingsResult = await state.supabase.
      from('bookings').
      select('id, quotation_id').
      eq('lodge_id', state.lodgeId).
      not('quotation_id', 'is', null);
      linkedBookings = bookingsResult?.data || [];
    } catch {
      linkedBookings = [];
    }
    const convertedIds = new Map(
      (linkedBookings || []).filter((booking) => booking?.quotation_id).map((booking) => [booking.quotation_id, booking.id])
    );
    const todayStr = new Date().toISOString().split('T')[0];
    const mapped = liveRows.map((q) => {
      const customer = customers.find((c) => c.id === q.customer_id);
      const room = rooms.find((r) => r.id === q.room_id);
      const convertedBookingId = q.converted_booking_id || convertedIds.get(q.id) || null;
      return normalizeQuotationForDisplay(q, { customer, room, convertedBookingId, todayStr });
    });
    writeCache('quotations', mapped);
    return mapped;
  }
  const quotations = cachedQuotations;
  const customers = readCache('customers');
  const rooms = readCache('rooms');
  const bookings = readCache('bookings');
  const convertedIds = new Map(
    (bookings || []).filter((booking) => booking?.quotation_id).map((booking) => [booking.quotation_id, booking.id])
  );
  const todayStr = new Date().toISOString().split('T')[0];
  return quotations.
  map((q) => {
    const customer = customers.find((c) => c.id === q.customer_id);
    const room = rooms.find((r) => r.id === q.room_id);
    // Auto-expire offline (UI-only; DB will be corrected when back online)
    const convertedBookingId = q.converted_booking_id || convertedIds.get(q.id) || null;
    const baseStatus = convertedBookingId ? 'converted' : q.status;
    const status = q.valid_until && q.valid_until < todayStr && ['draft', 'sent', 'accepted'].includes(baseStatus) ?
    'expired' :
    baseStatus;
    return normalizeQuotationForDisplay(q, { customer, room, convertedBookingId, todayStr, status });
  }).
  sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function calcTax(subtotal, rate = 0) {
  return Math.round(Number(subtotal || 0) * Number(rate || 0)) / 100;
}

export async function createQuotation(data) {
  if (state.isOnline) {
    let quotation_number = await getNextQuotationNumber();
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const record = buildQuotationRecord(data, {
        id: randomUUID(),
        quotation_number
      });
      const { data: result, error } = await state.supabase.rpc('create_quotation', { payload: record });
      const failureMessage = error?.message || result?.error || '';

      if (!error && result?.success) {
        writeCache('quotations', [record, ...readCache('quotations').filter((q) => q.id !== record.id)]);
        await refreshCache('quotations');
        logActivity('quotation_created', `Quotation ${quotation_number} created for ${record.customer_name}`);
        return { id: record.id, quotation_number };
      }

      lastError = new Error(failureMessage || 'Could not create quotation');
      if (!isQuotationNumberConflict(failureMessage) || attempt === 4) {
        throw lastError;
      }

      quotation_number = getNextQuotationNumberAfter(quotation_number);
    }

    throw lastError || new Error('Could not create quotation');
  } else {
    const quotation_number = await getNextQuotationNumber();
    const record = buildQuotationRecord(data, { quotation_number });
    const offlineRecord = {
      ...record,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    };
    const cached = readCache('quotations');
    cached.unshift(offlineRecord);
    writeCache('quotations', cached);
    queueOperation('rpc', 'create_quotation', { payload: record }, null, {
      _queue_id: `quotation-${record.id}`
    });
    logActivity('quotation_created', `Quotation ${quotation_number} created for ${record.customer_name}`);
    return { id: record.id, quotation_number };
  }
}

export async function updateQuotation(id, data) {
  // Determine if financial fields are locked (sent/accepted/converted)
  const LOCKED_STATUSES = ['sent', 'accepted', 'converted'];
  const cachedQuotations = readCache('quotations');
  const current = cachedQuotations.find((q) => q.id === id);

  // When online, verify lock status from server — cache may be stale
  let isLocked = current && LOCKED_STATUSES.includes(current.status);
  if (state.isOnline) {
    const { data: live } = await state.supabase.
    from('quotations').select('status').eq('id', id).eq('lodge_id', state.lodgeId).single();
    if (live) isLocked = LOCKED_STATUSES.includes(live.status);
  }

  const subtotal = Number(data.subtotal ?? 0);
  const tax_amount = Number(calcTax(subtotal, data.tax_rate ?? 0));
  const total_amount = subtotal + tax_amount;

  // Full update object
  const update = {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone || '',
    currency: data.currency || 'BWP',
    notes: data.notes || '',
    status: data.status,
    valid_until: data.valid_until || null,
    updated_at: new Date().toISOString()
  };

  // Financial + date fields — only allowed when not locked
  if (!isLocked) {
    Object.assign(update, {
      customer_id: data.customer_id,
      room_id: data.room_id || null,
      room_name: data.room_name || '',
      check_in: data.check_in || null,
      check_out: data.check_out || null,
      adults: Number(data.adults) || 1,
      children: Number(data.children) || 0,
      subtotal,
      tax_amount,
      total_amount
    });
  }

  const expectedUpdatedAt = current?.updated_at || null;

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_quotation', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update quotation');
    const cached = readCache('quotations');
    const idx = cached.findIndex((q) => q.id === id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...update };
      writeCache('quotations', cached);
    }
    await refreshCache('quotations');
  } else {
    const cached = readCache('quotations');
    const idx = cached.findIndex((q) => q.id === id);
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('quotations', cached);
    const dependsOn = current?._pending_sync ? `quotation-${id}` : null;
    queueOperation('rpc', 'update_quotation', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: expectedUpdatedAt
    }, null, dependsOn ? { _depends_on: dependsOn } : {});
  }

  logActivity('quotation_updated', `Quotation ${id} updated — status: ${data.status}`);
}

export async function markQuotationSent(id) {
  const update = { status: 'sent', updated_at: new Date().toISOString() };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('mark_quotation_sent', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not mark quotation as sent');
  } else {
    const cached = readCache('quotations');
    const idx = cached.findIndex((q) => q.id === id);
    if (idx >= 0 && cached[idx].status === 'draft') {
      cached[idx] = { ...cached[idx], ...update };
      writeCache('quotations', cached);
      const dependsOn = cached[idx]?._pending_sync ? `quotation-${id}` : null;
      queueOperation('rpc', 'mark_quotation_sent', {
        p_id: id,
        p_lodge_id: state.lodgeId
      }, null, {
        _queue_id: `quotation-sent-${id}`,
        ...(dependsOn ? { _depends_on: dependsOn } : {})
      });
    }
  }
}

export async function duplicateQuotation(id) {
  const source = state.isOnline ?
  (await state.supabase.from('quotations').select('*').eq('id', id).eq('lodge_id', state.lodgeId).single()).data :
  readCache('quotations').find((q) => q.id === id);
  if (!source) throw new Error('Quotation not found');

  return createQuotation({
    customer_id: source.customer_id,
    customer_name: source.customer_name,
    customer_phone: source.customer_phone,
    room_id: source.room_id,
    room_name: source.room_name,
    check_in: source.check_in,
    check_out: source.check_out,
    adults: source.adults,
    children: source.children,
    subtotal: source.subtotal || source.total_amount,
    tax_amount: source.tax_amount || 0,
    currency: source.currency,
    notes: source.notes,
    valid_until: source.valid_until,
    parent_quotation_id: source.parent_quotation_id || source.id // chain to root
  });
}

export async function getQuotationById(id) {
  if (!id) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('quotations').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return readCache('quotations').find((quotation) => quotation.id === id) || null;
}

export async function convertQuotationToBooking(quotationId, depositAmount = 0, paymentMethod = 'cash') {
  const deposit = Number(depositAmount) || 0;
  const method = paymentMethod || 'cash';

  if (!state.isOnline) {
    const quotation = readCache('quotations').find((q) => q.id === quotationId);
    if (!quotation) throw new Error('Quotation not found');
    if (quotation.converted_booking_id || quotation.status === 'converted') {
      throw new Error('This quotation has already been converted to a booking.');
    }
    if (!['sent', 'accepted'].includes(quotation.status)) {
      throw new Error('Quotation must be sent or accepted before conversion.');
    }
    if (quotation.room_id && quotation.check_in && quotation.check_out) {
      await checkRoomConflict(quotation.room_id, quotation.check_in, quotation.check_out);
    }

    const localBookingId = randomUUID();
    const now = new Date().toISOString();
    const total = Number(quotation.total_amount || 0);
    const optimisticPayment = buildOfflineBookingFinancialState(total, deposit);
    const room = quotation.room_id ?
    readCache('rooms').find((entry) => entry.id === quotation.room_id) :
    null;
    const localBooking = {
      id: localBookingId,
      lodge_id: state.lodgeId,
      customer_id: quotation.customer_id || null,
      customer_name: quotation.customer_name || '',
      customer_phone: quotation.customer_phone || '',
      room_id: quotation.room_id || null,
      room_number: room?.room_number || quotation.room_name || '',
      room_name: quotation.room_name || (room?.room_number ? `Room ${room.room_number}` : ''),
      check_in: quotation.check_in || null,
      check_out: quotation.check_out || null,
      adults: Number(quotation.adults) || 1,
      children: Number(quotation.children) || 0,
      total_amount: total,
      amount_paid: optimisticPayment.amount_paid,
      deposit_amount: deposit,
      payment_status: optimisticPayment.payment_status,
      payment_method: deposit > 0 ? method : null,
      status: 'confirmed',
      invoice_number: null,
      quotation_id: quotationId,
      created_by: state.currentUser?.id || null,
      notes: quotation.notes || '',
      _local_invoice_number: buildLocalPendingInvoiceNumber(localBookingId),
      _pending_sync: true,
      _pending_payment: deposit > 0,
      _sync_created_offline: true,
      _sync_state: 'pending',
      _sync_error: null,
      _sync_source: 'quotation_conversion',
      created_at: now,
      updated_at: now
    };

    writeCache('bookings', [
    localBooking,
    ...readCache('bookings').filter((booking) => booking.id !== localBookingId)]
    );
    patchCachedQuotationSyncState(quotationId, {
      status: 'converted',
      converted_booking_id: localBookingId,
      _pending_sync: true,
      _pending_conversion: true,
      _local_converted_booking_id: localBookingId,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: now
    });

    queueOperation('rpc', 'convert_quotation_to_booking', {
      p_quotation_id: quotationId,
      p_lodge_id: state.lodgeId,
      p_deposit_amount: deposit,
      p_payment_method: method,
      p_created_by: state.currentUser?.id || null
    }, null, {
      _queue_id: `quotation-convert-${quotationId}`,
      _local_booking_id: localBookingId,
      _previous_status: quotation.status || 'accepted',
      ...(quotation?._pending_sync ? { _depends_on: `quotation-${quotationId}` } : {})
    });

    logActivity('quotation_converted', `(Offline) Quotation ${quotationId} queued for conversion to booking ${localBookingId}`);
    return {
      booking_id: localBookingId,
      invoice_number: localBooking._local_invoice_number,
      pendingSync: true
    };
  }

  const { data: quotation } = await state.supabase.
  from('quotations').
  select('status').
  eq('id', quotationId).
  eq('lodge_id', state.lodgeId).
  single();

  if (quotation?.status === 'converted') {
    throw new Error('This quotation has already been converted to a booking.');
  }

  const { data: result, error } = await state.supabase.rpc('convert_quotation_to_booking', {
    p_quotation_id: quotationId,
    p_lodge_id: state.lodgeId,
    p_deposit_amount: deposit,
    p_payment_method: method,
    p_created_by: state.currentUser?.id || null
  });

  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Conversion failed');

  await refreshCache('bookings');
  await refreshCache('quotations');

  const bookingId = result.booking_id || result.id;

  // P2: Explicitly record deposit if provided.
  if (deposit > 0) {
    try {
      await updateBookingPayment(bookingId, deposit, method, 'deposit');
    } catch (depError) {
      logActivity('quotation_converted', `Quotation ${quotationId} converted to booking ${bookingId} (Deposit failed: ${depError.message})`);
      return {
        booking_id: bookingId,
        invoice_number: result.invoice_number,
        depositWarning: depError.message
      };
    }
  }
  logActivity('quotation_converted', `Quotation ${quotationId} converted to booking ${bookingId}`);
  return { booking_id: bookingId, invoice_number: result.invoice_number };
}
