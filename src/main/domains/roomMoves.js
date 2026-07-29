import { createHash, randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, queueOperation, readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js';
import { getAllBookings } from './bookings.js';
import { getAllRooms } from './rooms.js';

function buildRoomMoveIdempotencyKey({ bookingId, targetRoomId, reason, actorName, expectedUpdatedAt }) {
  const payload = JSON.stringify({
    bookingId: bookingId || null,
    targetRoomId: targetRoomId || null,
    reason: String(reason || '').trim(),
    actorName: String(actorName || '').trim(),
    expectedUpdatedAt: expectedUpdatedAt || null
  });
  return `room-move:${createHash('sha256').update(payload).digest('hex')}`;
}

function requireMoveReason(reason) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) {
    throw new Error('Room move requires an audit reason');
  }
  return trimmed;
}

async function _getAvailableRoomsForMove(currentRoomId, checkIn, checkOut) {
  const rooms = await getAllRooms();
  const bookings = await getAllBookings();

  const available = rooms.filter((room) => {
    if (room.id === currentRoomId) return false;
    const roomStatus = String(room.status || 'available').toLowerCase();
    if (roomStatus !== 'available') return false;
    const hk = String(room.housekeeping_status || 'clean').toLowerCase();
    if (['out_of_order', 'out_of_service', 'maintenance'].includes(hk) || roomStatus === 'maintenance') {
      return false;
    }

    const hasConflict = bookings.some((b) => {
      if (!b || b.status === 'cancelled' || b.status === 'checked_out' || b.status === 'no_show') return false;
      if (String(b.room_id) !== String(room.id)) return false;
      const bCheckIn = String(b.check_in || '');
      const bCheckOut = String(b.check_out || '');
      return checkIn < bCheckOut && checkOut > bCheckIn;
    });

    return !hasConflict;
  });

  return available.map((room) => ({
    id: room.id,
    room_number: room.room_number,
    room_type: room.room_type,
    rate_per_night: room.rate_per_night,
    floor_section_id: room.floor_section_id,
    housekeeping_status: room.housekeeping_status || 'clean',
    status: room.status || 'available'
  }));
}

async function _executeRoomMove(bookingId, targetRoomId, reason, actorName) {
  const auditReason = requireMoveReason(reason);

  const bookings = await getAllBookings();
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.status === 'cancelled') throw new Error('Cannot move a cancelled booking');
  if (booking.status === 'checked_out') throw new Error('Cannot move a checked-out booking');

  const rooms = await getAllRooms();
  const sourceRoom = rooms.find((r) => String(r.id) === String(booking.room_id));
  const targetRoom = rooms.find((r) => r.id === targetRoomId);
  if (!targetRoom) throw new Error('Target room not found');

  const targetStatus = String(targetRoom.status || 'available').toLowerCase();
  if (targetStatus === 'maintenance') {
    throw new Error('Target room is under maintenance and cannot receive a move');
  }
  if (targetStatus !== 'available') {
    throw new Error(`Target room is not available (status: ${targetStatus})`);
  }

  const hk = String(targetRoom.housekeeping_status || 'clean').toLowerCase();
  if (hk === 'out_of_order' || hk === 'out_of_service') {
    throw new Error(`Target room is ${hk.replace(/_/g, ' ')} and cannot receive a move`);
  }

  const bookings2 = await getAllBookings();
  const conflict = bookings2.find((b) => {
    if (!b || b.status === 'cancelled' || b.status === 'checked_out' || b.status === 'no_show') return false;
    if (String(b.id) === String(bookingId)) return false;
    if (String(b.room_id) !== String(targetRoomId)) return false;
    return String(b.check_in || '') < String(booking.check_out || '') && String(b.check_out || '') > String(booking.check_in || '');
  });
  if (conflict) {
    const guest = conflict.customer_name || conflict.guest_name || 'another guest';
    throw new Error(
      `Target room has a booking conflict for the stay dates (${guest} · ${conflict.check_in || '?'} → ${conflict.check_out || '?'})`
    );
  }

  const previousRoomId = booking.room_id;
  const previousRoomNumber = sourceRoom?.room_number || 'unknown';
  const expectedUpdatedAt = booking.updated_at || null;
  const idempotencyKey = buildRoomMoveIdempotencyKey({
    bookingId,
    targetRoomId,
    reason: auditReason,
    actorName,
    expectedUpdatedAt
  });

  const fromRate = Number(sourceRoom?.rate_per_night || 0);
  const toRate = Number(targetRoom?.rate_per_night || 0);
  const rateDelta = toRate - fromRate;
  const rateImpact = Math.abs(rateDelta) > 0.009;

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('move_booking_room', {
      p_booking_id: bookingId,
      p_lodge_id: state.lodgeId,
      p_target_room_id: targetRoomId,
      p_reason: auditReason,
      p_idempotency_key: idempotencyKey,
      p_expected_updated_at: expectedUpdatedAt,
      p_actor_id: state.currentUser?.id || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Room move failed');

    await refreshCache('bookings');
    await refreshCache('rooms').catch(() => null);
    logActivity(
      'room_move',
      `Booking moved from Room ${previousRoomNumber} to Room ${targetRoom.room_number}: ${auditReason}` +
        (rateImpact ? ` (rate delta ${rateDelta >= 0 ? '+' : ''}${rateDelta.toFixed(2)}/night — review folio)` : '')
    );
  } else {
    const cached = readCache('bookings');
    const idx = cached.findIndex((b) => b.id === bookingId);
    if (idx >= 0) {
      cached[idx] = {
        ...cached[idx],
        room_id: targetRoomId,
        room_number: targetRoom.room_number,
        room_type: targetRoom.room_type
      };
      writeCache('bookings', cached);
    }
    const moveLog = {
      id: randomUUID(),
      lodge_id: state.lodgeId,
      booking_id: bookingId,
      guest_name: booking.customer_name || 'Guest',
      from_room_id: previousRoomId,
      from_room_number: previousRoomNumber,
      to_room_id: targetRoomId,
      to_room_number: targetRoom.room_number,
      reason: auditReason,
      moved_by: actorName || 'system',
      moved_at: new Date().toISOString(),
      source_reference: idempotencyKey,
      rate_impact: rateImpact,
      rate_delta: rateDelta,
      _pending_sync: true
    };
    const logCache = readCache('room-move-log') || [];
    logCache.unshift(moveLog);
    writeCache('room-move-log', logCache);
    queueOperation('rpc', 'move_booking_room', {
      p_booking_id: bookingId,
      p_lodge_id: state.lodgeId,
      p_target_room_id: targetRoomId,
      p_reason: auditReason,
      p_idempotency_key: idempotencyKey,
      p_expected_updated_at: expectedUpdatedAt,
      p_actor_id: state.currentUser?.id || null
    }, null, {
      _queue_id: `room-move-${bookingId}-${targetRoomId}`,
      ...(booking?._pending_sync ? { _depends_on: `booking-${bookingId}` } : {})
    });
    logActivity(
      'room_move',
      `Booking moved from Room ${previousRoomNumber} to Room ${targetRoom.room_number}: ${auditReason}`
    );
  }

  return {
    success: true,
    from: previousRoomNumber,
    to: targetRoom.room_number,
    booking_id: bookingId,
    reason: auditReason,
    rate_impact: rateImpact,
    rate_delta: rateDelta,
    from_rate: fromRate,
    to_rate: toRate,
    navigate_folio: rateImpact
  };
}

export function getAvailableRoomsForMove(currentRoomId, checkIn, checkOut) {
  return dedupePromise(`roomMove:${currentRoomId}:${checkIn}:${checkOut}`, () =>
    _getAvailableRoomsForMove(currentRoomId, checkIn, checkOut)
  );
}

export function executeRoomMove(bookingId, targetRoomId, reason, actorName) {
  return dedupePromise(`roomMoveExec:${bookingId}`, () =>
    _executeRoomMove(bookingId, targetRoomId, reason, actorName)
  );
}
