import { dedupePromise, readCache, refreshCache } from './infrastructure.js';
import { getAllBookings, getBookingCharges, addBookingCharge } from './bookings.js';

function activeHotelBookings(bookings) {
  return (bookings || []).filter((booking) => {
    const status = String(booking?.status || '').toLowerCase();
    return status && status !== 'cancelled';
  });
}

function buildFolioSummary(booking, charges = []) {
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
    guest_name: booking.customer_name || booking.customers?.name || 'Guest',
    room_id: booking.room_id,
    room_number: booking.room_number || booking.rooms?.room_number || '',
    room_type: booking.room_type || booking.rooms?.room_type || '',
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

async function _getAllFolios() {
  const bookings = activeHotelBookings(await getAllBookings());
  const cachedCharges = readCache('booking-charges') || [];
  return bookings.map((booking) => {
    const charges = cachedCharges.filter((charge) => charge?.booking_id === booking.id && !charge?.voided_at);
    return buildFolioSummary(booking, charges);
  }).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function getAllFolios() {
  return dedupePromise('hotelFolios', _getAllFolios);
}

export async function getFolioEntries(bookingId) {
  const charges = await getBookingCharges(bookingId);
  return (charges || []).map((charge) => ({
    id: charge.id,
    booking_id: charge.booking_id,
    entry_type: 'charge',
    description: charge.description,
    category: charge.category || 'other',
    quantity: Number(charge.quantity || 1),
    unit_price: Number(charge.unit_price || 0),
    amount: Number(charge.amount || 0),
    outlet_name: charge.outlets?.name || null,
    created_at: charge.created_at,
    pending_sync: charge._pending_sync === true
  }));
}

export async function postFolioCharge(bookingId, data) {
  const result = await addBookingCharge(bookingId, {
    description: data.description,
    category: data.category || 'folio',
    quantity: Number(data.quantity) || 1,
    unit_price: Number(data.unit_price) || 0,
    outlet_id: data.outlet_id || null,
    idempotency_key: data.idempotency_key || null
  });
  await Promise.all([
    refreshCache('bookings').catch(() => null),
    refreshCache('booking-charges').catch(() => null)
  ]);
  return result;
}
