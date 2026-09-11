/**
 * Presentation-only booking money helpers.
 *
 * The database fields remain authoritative.  Offline mutations store their
 * provisional values under `_estimated_*`; this module makes the distinction
 * explicit wherever a booking amount or payment status is shown to an
 * operator.
 */
export function isPendingBookingFinancial(booking = {}) {
  return booking?._financial_estimate === true
    || booking?._pending_payment === true
    || booking?._pricing_estimate === true
    || booking?._sync_created_offline === true
    || booking?._pending_sync === true
    || booking?._sync_state === 'pending'
    || booking?._sync_state === 'sync_failed'
}

function amount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getBookingFinancialView(booking = {}) {
  const pending = isPendingBookingFinancial(booking)
  const total = Math.max(0, amount(pending && booking._estimated_total_amount != null
    ? booking._estimated_total_amount
    : booking.total_amount))
  const charges = Math.max(0, amount(booking.charges_total))
  const amountPaid = Math.max(0, amount(pending && booking._estimated_amount_paid != null
    ? booking._estimated_amount_paid
    : booking.amount_paid))
  const paymentStatus = pending
    ? (booking._estimated_payment_status || booking.payment_status || 'unpaid')
    : (booking.payment_status || 'unpaid')
  const grandTotal = total + charges
  return {
    pending,
    authoritative: !pending,
    total,
    charges,
    grandTotal,
    amountPaid,
    outstanding: Math.max(0, grandTotal - amountPaid),
    paymentStatus,
    statusLabel: pending ? 'Pending confirmation' : paymentStatus
  }
}

export function bookingPaymentStatusLabel(booking = {}) {
  const view = getBookingFinancialView(booking)
  if (view.pending) return 'Pending confirmation'
  if (view.paymentStatus === 'paid') return 'Paid'
  if (view.paymentStatus === 'partial') return 'Part paid'
  return 'Unpaid'
}

