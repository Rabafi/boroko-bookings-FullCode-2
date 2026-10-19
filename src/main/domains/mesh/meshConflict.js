// @ts-check
import { BrowserWindow } from 'electron';
import { readCache, writeCache } from '../cacheStore.js';
import { readFailedSyncQueue, readSyncQueue, writeFailedSyncQueue, writeSyncQueue } from '../syncStore.js';

const CONFLICT_REVIEW_ERROR_PREFIX = 'Mesh conflict detected';

/**
 * Deterministically checks for date overlaps between any two bookings.
 * Overlap criteria: check_in of one is before check_out of another, and vice-versa.
 */
export function datesOverlap(checkIn1, checkOut1, checkIn2, checkOut2) {
  return checkIn1 < checkOut2 && checkOut1 > checkIn2;
}

/**
 * Generates suggested alternative rooms (swaps or upgrades) that are unoccupied
 * during the check-in / check-out dates of a conflicting booking.
 */
export function generateSuggestedAlternatives(checkIn, checkOut, currentRoomId, allRooms, allBookings, queuedOps) {
  const currentRoom = allRooms.find((r) => r.id === currentRoomId);
  const currentRate = currentRoom ? Number(currentRoom.rate_per_night || 0) : 0;

  const occupiedRoomIds = new Set();
  for (const booking of allBookings) {
    if (booking.status !== 'cancelled' && datesOverlap(booking.check_in, booking.check_out, checkIn, checkOut)) {
      occupiedRoomIds.add(booking.room_id);
    }
  }
  for (const op of queuedOps) {
    for (const queued of getQueuedBookingRecords(op)) {
      if (datesOverlap(queued.checkIn, queued.checkOut, checkIn, checkOut)) occupiedRoomIds.add(queued.roomId);
    }
  }

  const suggestions = [];
  for (const room of allRooms) {
    if (room.id === currentRoomId || occupiedRoomIds.has(room.id)) continue;
    const rate = Number(room.rate_per_night || 0);
    const action = rate > currentRate ? 'upgrade' : 'swap';
    const label = action === 'upgrade'
      ? 'Upgrade to Room ' + room.room_number + ' (' + room.room_type + ')'
      : 'Swap to Room ' + room.room_number;
    suggestions.push({ roomId: room.id, roomNumber: room.room_number, roomType: room.room_type, ratePerNight: rate, action, label });
  }
  return suggestions.sort((a, b) => {
    if (a.action === 'upgrade' && b.action !== 'upgrade') return -1;
    if (a.action !== 'upgrade' && b.action === 'upgrade') return 1;
    return b.ratePerNight - a.ratePerNight;
  });
}
function getQueuedBookingRecords(op) {
  const createdAt = op?.created_at || op?.timestamp || new Date(0).toISOString();
  if (op?.table === 'create_multi_room_booking') {
    const data = op.data || {};
    const rooms = Array.isArray(data.p_rooms) ? data.p_rooms : [];
    const ids = Array.isArray(op._local_booking_ids) ? op._local_booking_ids : [];
    return rooms.map((room, index) => ({
      id: ids[index] || null,
      roomId: room?.room_id,
      checkIn: data.p_check_in,
      checkOut: data.p_check_out,
      groupId: data.p_group_key || op._group_id || op._queue_id || null,
      createdAt: data.created_at || createdAt
    })).filter((booking) => booking.id && booking.roomId);
  }
  if (op?.table === 'create_booking') {
    const data = op.data || {};
    return [{
      id: data.p_booking_id,
      roomId: data.p_room_id,
      checkIn: data.p_check_in,
      checkOut: data.p_check_out,
      createdAt: data.created_at || createdAt
    }];
  }
  if (op?.table === 'create_booking_record') {
    const payload = op.data?.payload || {};
    return [{
      id: payload.id,
      roomId: payload.room_id,
      checkIn: payload.check_in,
      checkOut: payload.check_out,
      createdAt: payload.created_at || createdAt
    }];
  }
  return [];
}
function moveQueuedBookingToManualReview(queueItem, message, suggestions = []) {
  if (!queueItem?._queue_id) return false;
  const pending = readSyncQueue();
  const failed = readFailedSyncQueue();
  const index = pending.findIndex((item) => item?._queue_id === queueItem._queue_id);
  if (index < 0) return false;

  const [item] = pending.splice(index, 1);
  const reviewedItem = {
    ...item,
    _state: 'pending',
    _sync_state: 'manual_review_required',
    _sync_error: message,
    _sync_resolution_suggestions: suggestions,
    manualRetryOnly: true,
    retryCount: Number.MAX_SAFE_INTEGER,
    lastError: message,
    lastAttemptedAt: new Date().toISOString()
  };
  const nextFailed = failed.some((entry) => entry?._queue_id === reviewedItem._queue_id) ?
    failed.map((entry) => entry?._queue_id === reviewedItem._queue_id ? reviewedItem : entry) :
    [reviewedItem, ...failed];

  writeSyncQueue(pending);
  writeFailedSyncQueue(nextFailed);
  return true;
}

function findPendingQueueItemForBooking(bookingId) {
  if (!bookingId) return null;
  return readSyncQueue().find((item) => getQueuedBookingRecords(item).some((booking) => booking.id === bookingId)) || null;
}

/**
 * Scan cache and sync queues to identify overlapping room assignments.
 * Flags loser rows, logs sync_error, computes alternatives, and triggers IPC events.
 */
export async function detectConflicts() {
  const bookings = readCache('bookings') || [];
  const rooms = readCache('rooms') || [];
  const queue = readSyncQueue() || [];
  const failedQueue = readFailedSyncQueue() || [];
  const queuedOps = [...queue, ...failedQueue];

  // 1. Gather all active booking representations
  const activeBookings = [];

  // Add existing cached bookings
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    activeBookings.push({
      id: b.id,
      roomId: b.room_id,
      checkIn: b.check_in,
      checkOut: b.check_out,
      createdAt: b.created_at || new Date(0).toISOString(),
      sourceNodeId: b._mesh_source_node_id || 'local',
      groupId: b.group_key || b._mesh_group_operation_id || null,
      original: b,
      isQueued: false
    });
  }

  // Add queued booking operations that might not yet be in cache
  for (const op of queuedOps) {
    for (const queuedBooking of getQueuedBookingRecords(op)) {
      if (!queuedBooking?.id) continue;
      // Skip if already captured in cache. findPendingQueueItemForBooking links
      // that cached group child back to the one atomic group operation.
      if (activeBookings.some((ab) => ab.id === queuedBooking.id)) continue;

      activeBookings.push({
        id: queuedBooking.id,
        roomId: queuedBooking.roomId,
        checkIn: queuedBooking.checkIn,
        checkOut: queuedBooking.checkOut,
        createdAt: queuedBooking.createdAt,
        sourceNodeId: op._mesh_source_node_id || 'local',
        original: op,
        isQueued: true,
        groupId: queuedBooking.groupId || null
      });
    }
  }

  const conflicts = [];

  // 2. Identify overlaps
  for (let i = 0; i < activeBookings.length; i++) {
    for (let j = i + 1; j < activeBookings.length; j++) {
      const b1 = activeBookings[i];
      const b2 = activeBookings[j];

      if (b1.roomId === b2.roomId && datesOverlap(b1.checkIn, b1.checkOut, b2.checkIn, b2.checkOut)) {
        conflicts.push({ b1, b2 });
      }
    }
  }

  if (conflicts.length === 0) {
    return;
  }

  console.log(`[MeshConflict] Detected ${conflicts.length} local room booking conflict(s).`);

  let cacheDirty = false;
  const updatedBookings = [...bookings];

  for (const { b1, b2 } of conflicts) {
    // 3. Determine winner and loser deterministically:
    // Earlier createdAt wins. If equal, lexicographically smaller sourceNodeId wins. If equal, smaller ID wins.
    let winner = b1;
    let loser = b2;

    const time1 = new Date(b1.createdAt).getTime();
    const time2 = new Date(b2.createdAt).getTime();

    if (time2 < time1) {
      winner = b2;
      loser = b1;
    } else if (time1 === time2) {
      if (b2.sourceNodeId < b1.sourceNodeId) {
        winner = b2;
        loser = b1;
      } else if (b1.sourceNodeId === b2.sourceNodeId) {
        const tieId1 = b1.groupId || b1.id;
        const tieId2 = b2.groupId || b2.id;
        if (tieId2 < tieId1) {
          winner = b2;
          loser = b1;
        }
      }
    }

    console.log(`[MeshConflict] Conflict review priority: Booking ${winner.id} first. Booking ${loser.id} requires review.`);

    // 4. Mark loser as review required
    const suggestions = generateSuggestedAlternatives(
      loser.checkIn,
      loser.checkOut,
      loser.roomId,
      rooms,
      bookings,
      queuedOps
    );
    const message = `${CONFLICT_REVIEW_ERROR_PREFIX}: Room ${rooms.find((r) => r.id === loser.roomId)?.room_number || loser.roomId} was booked by another terminal during offline period.`;
    const loserIdx = updatedBookings.findIndex((b) => b.id === loser.id);
    if (loserIdx !== -1) {
      const loserBooking = updatedBookings[loserIdx];

      // Only update if not already marked to prevent duplicate edits/triggers
      if (loserBooking._sync_state !== 'manual_review_required') {
        updatedBookings[loserIdx] = {
          ...loserBooking,
          _sync_state: 'manual_review_required',
          _sync_error: message,
          _sync_resolution_suggestions: suggestions
        };

        cacheDirty = true;
      }
    }
    const loserQueueItem = loser.isQueued ? loser.original : findPendingQueueItemForBooking(loser.id);
    if (loserQueueItem) {
      if (loserQueueItem.table === 'create_multi_room_booking' && Array.isArray(loserQueueItem._local_booking_ids)) {
        const childIds = new Set(loserQueueItem._local_booking_ids);
        updatedBookings.forEach((booking, index) => {
          if (!childIds.has(booking?.id)) return;
          updatedBookings[index] = {
            ...booking,
            _sync_state: 'manual_review_required',
            _sync_error: message,
            _sync_resolution_suggestions: suggestions
          };
          cacheDirty = true;
        });
      }
      const moved = moveQueuedBookingToManualReview(loserQueueItem, message, suggestions);
      cacheDirty = moved || cacheDirty;
    }

    // 5. Emit IPC Event to alert renderer
    try {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('mesh:conflict-detected', {
            loserId: loser.id,
            winnerId: winner.id,
            roomId: loser.roomId,
            checkIn: loser.checkIn,
            checkOut: loser.checkOut,
            suggestions
          });
        }
      });
    } catch (ipcErr) {
      console.error('[MeshConflict] Failed to emit conflict IPC event:', ipcErr);
    }
  }

  if (cacheDirty) {
    writeCache('bookings', updatedBookings);
    console.log('[MeshConflict] Cache updated with conflict-marked bookings.');
  }
}
