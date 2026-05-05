import { randomUUID } from 'crypto'
import crypto from 'crypto'
import { state } from '../state.js'
import {
  checkExclusiveEventConflict,
  logActivity,
  queueOperation,
  readCache,
  refreshCache,
  writeCache
} from './infrastructure.js'

// ─── CONFERENCE BOOKINGS ───────────────────────────────────────────────────────

export async function getConferenceBookings(start, end) {
  const cached = readCache('conference-bookings');
  if (!state.isOnline) {
    return cached.
    filter((row) => (!start || String(row.booking_date || '') >= start) && (!end || String(row.booking_date || '') <= end)).
    sort((a, b) => String(b.booking_date || '').localeCompare(String(a.booking_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
  }
  let q = state.supabase.from('conference_bookings').select('*').eq('lodge_id', state.lodgeId);
  if (start) q = q.gte('booking_date', start);
  if (end) q = q.lte('booking_date', end);
  const { data } = await q.order('booking_date', { ascending: false }).order('start_time', { ascending: true });
  if (data) writeCache('conference-bookings', data, { source: 'remote' });
  return data || [];
}

export async function getConferenceBookingById(id) {
  if (!id) return null;
  if (!state.isOnline) return readCache('conference-bookings').find((row) => row.id === id) || null;
  const { data, error } = await state.supabase.
  from('conference_bookings').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

function computeConferencePaymentStatus(depositPaid, totalAmount) {
  const total = Number(totalAmount) || 0;
  const deposit = Number(depositPaid) || 0;
  if (total <= 0) return 'pending';
  if (deposit >= total) return 'paid';
  if (deposit > 0) return 'deposit_paid';
  return 'pending';
}

export async function createConferenceBooking(data) {
  await checkExclusiveEventConflict(data.booking_date, data.booking_date + 'T23:59:59');
  const id = randomUUID();
  const depositPaid = Number(data.deposit_paid) || 0;
  const totalAmount = Number(data.total_amount) || 0;
  const paymentStatus = computeConferencePaymentStatus(depositPaid, totalAmount);
  const payload = {
    id,
    lodge_id: state.lodgeId,
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    client_name: data.client_name,
    company: data.company || null,
    attendees: data.attendees || 0,
    setup_type: data.setup_type || 'Theatre',
    room_name: data.room_name || 'Conference Room',
    includes_catering: data.includes_catering || false,
    catering_notes: data.catering_notes || null,
    total_amount: totalAmount,
    deposit_paid: depositPaid,
    payment_status: paymentStatus,
    payment_method: data.payment_method || null,
    notes: data.notes || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_conference_booking', { payload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create conference booking');
    const serverPaymentStatus = result?.payment_status || paymentStatus;
    const cachedRow = { ...payload, payment_status: serverPaymentStatus };
    writeCache('conference-bookings', [cachedRow, ...readCache('conference-bookings').filter((row) => row.id !== id)], { source: 'local' });
    logActivity('conference_booking_created', `Conference booking · ${data.client_name}${data.company ? ' · ' + data.company : ''} · ${data.booking_date} · ${data.room_name || 'Conference Room'}`);
    return { id: result.id || id };
  }
  const offlineRow = {
    ...payload,
    payment_status: paymentStatus,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  };
  writeCache('conference-bookings', [offlineRow, ...readCache('conference-bookings').filter((row) => row.id !== id)], { source: 'local' });
  queueOperation('rpc', 'create_conference_booking', { payload }, null, {
    _queue_id: `conference-${id}`
  });
  logActivity('conference_booking_created', `(Offline) Conference booking · ${data.client_name} · ${data.booking_date}`);
  return { id };
}

export async function updateConferenceBooking(id, data) {
  if (!id) throw new Error('Conference booking ID is required');
  if (!state.isOnline) {
    const cached = readCache('conference-bookings');
    const existing = cached.find((row) => row.id === id);
    const dependsOn = existing?._pending_sync ? `conference-${id}` : null;
    const merged = { ...existing, ...data };
    const offlinePaymentStatus = 'deposit_paid' in data || 'total_amount' in data ?
    computeConferencePaymentStatus(
      Number(merged.deposit_paid) || 0,
      Number(merged.total_amount) || 0
    ) :
    merged.payment_status;
    writeCache('conference-bookings', cached.map((row) => row.id === id ?
    { ...row, ...data, payment_status: offlinePaymentStatus, _pending_sync: true, _sync_state: 'pending', _sync_error: null, updated_at: new Date().toISOString() } :
    row
    ), { source: 'local' });
    queueOperation('rpc', 'update_conference_booking', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: data
    }, null, dependsOn ? { _depends_on: dependsOn } : {});
    return { success: true };
  }
  const { data: result, error } = await state.supabase.rpc('update_conference_booking', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload: data
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update conference booking');
  const serverPaymentStatus = result?.payment_status;
  const cached = readCache('conference-bookings');
  const existing = cached.find((row) => row.id === id);
  const updated = { ...(existing || {}), ...data };
  if (serverPaymentStatus) {
    updated.payment_status = serverPaymentStatus;
  } else if ('deposit_paid' in data || 'total_amount' in data) {
    updated.payment_status = computeConferencePaymentStatus(
      Number(updated.deposit_paid) || 0,
      Number(updated.total_amount) || 0
    );
  } else {
    updated.payment_status = existing?.payment_status || updated.payment_status;
  }
  writeCache('conference-bookings', cached.map((row) => row.id === id ? updated : row), { source: 'local' });
  return { success: true };
}

export async function updateConferenceBookingPayment(id, paymentAmount, paymentMethod, type = 'payment', dependsOn = null, idempotencyKey = null) {
  if (!id) throw new Error('Conference booking ID is required');
  if (!paymentAmount || Number(paymentAmount) <= 0) throw new Error('Payment amount must be greater than zero');
  if (!paymentMethod) throw new Error('Payment method is required');
  const numericAmount = Number(Number(paymentAmount).toFixed(2));
  const intentKey = idempotencyKey || String(Date.now()) + '-' + crypto.randomUUID();

  if (state.isOnline) {
    const { data: existing } = await state.supabase.
    from('conference_bookings').
    select('deposit_paid, total_amount').
    eq('id', id).eq('lodge_id', state.lodgeId).single();
    if (!existing) throw new Error('Conference booking not found');
    const { data: result, error } = await state.supabase.rpc('update_conference_booking_payment', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_amount: numericAmount,
      p_method: paymentMethod,
      p_type: type,
      p_idempotency_key: intentKey,
      p_recorded_by: state.currentUser?.id || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not record conference booking payment');
    await refreshCache('conference-bookings');
    const name = (readCache('conference-bookings') || []).find((row) => row.id === id)?.client_name || 'Guest';
    logActivity('conference_payment', `Conference payment ${numericAmount.toFixed(2)} · ${name} · ${paymentMethod}`);
    return result;
  }

  const cached = readCache('conference-bookings');
  const idx = cached.findIndex((row) => row.id === id);
  if (idx < 0) throw new Error('Conference booking not found in offline cache');
  const row = cached[idx];
  const newDeposit = Number(row.deposit_paid || 0) + numericAmount;
  const newStatus = computeConferencePaymentStatus(newDeposit, Number(row.total_amount || 0));
  cached[idx] = {
    ...row,
    deposit_paid: newDeposit,
    payment_status: newStatus,
    _pending_payment: true,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  };
  writeCache('conference-bookings', cached, { source: 'local' });
  queueOperation('rpc', 'update_conference_booking_payment', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_amount: numericAmount,
    p_method: paymentMethod,
    p_type: type,
    p_idempotency_key: intentKey,
    p_recorded_by: state.currentUser?.id || null
  }, null, dependsOn ? { _depends_on: dependsOn } : {
    _queue_id: `conf-pay-${id}-${Date.now()}`
  });
  const name = row?.client_name || 'Guest';
  logActivity('conference_payment', `(Offline) Conference payment ${numericAmount.toFixed(2)} · ${name} · ${paymentMethod}`);
  return { success: true, offline: true, queued: true };
}

export async function deleteConferenceBooking(id) {
  if (!id) throw new Error('Conference booking ID is required');
  if (!state.isOnline) {
    const cached = readCache('conference-bookings');
    const existing = cached.find((row) => row.id === id);
    const dependsOn = existing?._pending_sync ? `conference-${id}` : null;
    writeCache('conference-bookings', cached.filter((row) => row.id !== id), { source: 'local' });
    queueOperation('rpc', 'delete_conference_booking', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, dependsOn ? { _depends_on: dependsOn } : {});
    return { success: true };
  }
  const { data: result, error } = await state.supabase.rpc('delete_conference_booking', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete conference booking');
  writeCache('conference-bookings', readCache('conference-bookings').filter((row) => row.id !== id), { source: 'local' });
  return { success: true };
}
