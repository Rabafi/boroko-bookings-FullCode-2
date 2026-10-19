// @ts-check
import { dedupePromise, readCache, refreshCache } from './infrastructure.js';
import { state } from '../state.js';
import { submitIntent } from './folioLedger.js';
import { getAllBookings, getBookingCharges, addBookingCharge } from './bookings.js';

/** @typedef {Record<string, unknown>} FolioPropertyView */

/** @param {unknown[]} bookings @returns {FolioPropertyView[]} */
function activeHotelBookings(bookings) {
  const active = (bookings || []).filter((rawBooking) => {
    const booking = /** @type {FolioPropertyView | null | undefined} */ (rawBooking)
    const status = String(booking?.status || '').toLowerCase();
    return status && status !== 'cancelled';
  });
  return active.map((rawBooking) => /** @type {FolioPropertyView} */ (rawBooking))
}

/** @param {FolioPropertyView} booking @param {FolioPropertyView[]} [charges] @returns {FolioPropertyView} */
function buildFolioSummary(booking, charges = []) {
  const customers = /** @type {FolioPropertyView | null | undefined} */ (booking.customers)
  const rooms = /** @type {FolioPropertyView | null | undefined} */ (booking.rooms)
  const roomTotal = Number(booking.total_amount || 0);
  const chargeTotal = charges.length > 0
    ? charges.reduce((sum, charge) => sum + Number(charge.amount || 0), 0)
    : Number(booking.charges_total || 0);
  const paid = Number(booking.amount_paid || 0);
  const balance = Math.max(0, roomTotal + chargeTotal - paid);
  return {
    id: booking.id,
    booking_id: booking.id,
    customer_id: booking.customer_id,
    guest_name: booking.customer_name || customers?.name || 'Guest',
    room_id: booking.room_id,
    room_number: booking.room_number || rooms?.room_number || '',
    room_type: booking.room_type || rooms?.room_type || '',
    check_in: booking.check_in,
    check_out: booking.check_out,
    status: booking.status,
    payment_status: booking.payment_status,
    room_total: roomTotal,
    charges_total: chargeTotal,
    amount_paid: paid,
    balance,
    entries_count: charges.length,
    updated_at: booking.updated_at || booking.created_at || null
  };
}

/** @returns {Promise<FolioPropertyView[]>} */
async function _getAllFolios() {
  const bookings = activeHotelBookings(await getAllBookings());
  const cachedCharges = /** @type {unknown[]} */ (readCache('booking-charges') || []);
  return bookings.map((booking) => {
    const charges = cachedCharges.filter((rawCharge) => {
      const charge = /** @type {FolioPropertyView | null | undefined} */ (rawCharge)
      return charge?.booking_id === booking.id && !charge?.voided_at
    }).map((rawCharge) => /** @type {FolioPropertyView} */ (rawCharge));
    return buildFolioSummary(booking, charges);
  }).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

/** @returns {Promise<FolioPropertyView[]>} */
export function getAllFolios() {
  return dedupePromise('hotelFolios', _getAllFolios);
}

/** @param {unknown} bookingId @returns {Promise<FolioPropertyView[]>} */
export async function getFolioEntries(bookingId) {
  const rawCharges = /** @type {unknown[]} */ ((await getBookingCharges(bookingId)) || []);
  return rawCharges.map((rawCharge) => {
    const charge = /** @type {FolioPropertyView} */ (rawCharge)
    const outlets = /** @type {FolioPropertyView | null | undefined} */ (charge.outlets)
    return ({
    id: charge.id,
    booking_id: charge.booking_id,
    entry_type: 'charge',
    description: charge.description,
    category: charge.category || 'other',
    quantity: Number(charge.quantity || 1),
    unit_price: Number(charge.unit_price || 0),
    amount: Number(charge.amount || 0),
    outlet_name: outlets?.name || null,
    created_at: charge.created_at,
    pending_sync: charge._pending_sync === true
  })
  });
}

/** @param {unknown} bookingId @param {unknown} data @returns {Promise<unknown>} */
export async function postFolioCharge(bookingId, data) {
  // This view does not validate the IPC object and preserves its current reads.
  const values = /** @type {FolioPropertyView} */ (data)
  const quantity = Number(values.quantity) || 1
  const unitPrice = Number(values.unit_price) || 0
  const cachedBookings = /** @type {unknown[]} */ (readCache('bookings') || [])
  const rawBooking = cachedBookings.find((candidate) => {
    const row = /** @type {FolioPropertyView} */ (candidate)
    return row.id === bookingId
  })
  const booking = /** @type {FolioPropertyView | null | undefined} */ (rawBooking)
  const result = state.isOnline
    ? await submitIntent('booking_charge', {
      bookingId,
      description: values.description,
      category: values.category || 'folio',
      quantity,
      unitPrice,
      outletId: values.outlet_id || null,
      expectedUpdatedAt: booking?.updated_at || null
    }, values.idempotency_key)
    : await addBookingCharge(bookingId, {
      description: values.description,
      category: values.category || 'folio',
      quantity,
      unit_price: unitPrice,
      outlet_id: values.outlet_id || null,
      idempotency_key: values.idempotency_key || null
    })
  await Promise.all([
    refreshCache('bookings').catch(() => null),
    refreshCache('booking-charges').catch(() => null)
  ])
  return result
}
