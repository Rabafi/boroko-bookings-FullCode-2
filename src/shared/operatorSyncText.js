export function sanitizeForOperator(raw, { restaurantMode = false } = {}) {
  if (!raw) return 'Unknown sync failure'
  const msg = String(raw)
  if (/room.*conflict|no_overlapping_bookings/i.test(msg)) {
    return restaurantMode ? 'This sale/tab conflicted with another change. Review and retry.' : 'Room already booked for those dates.'
  }
  if (/idempotency.*required/i.test(msg)) return 'This change needs another try.'
  if (/authenticated.*required|authentication.*required|session.*required/i.test(msg)) return 'Sign in again, then try once more.'
  if (/lodge.*role|permission denied|insufficient.*privilege/i.test(msg)) return 'Permission needed. Check the account role.'
  if (/unique.*violation|duplicate key/i.test(msg)) return 'This item may already exist.'
  if (/not found/i.test(msg)) return 'This item was not found online.'
  if (/monthly booking creation limit/i.test(msg)) {
    return restaurantMode ? 'This change could not sync because a plan usage limit was reached.' : 'Booking could not sync because the monthly booking creation limit has been reached.'
  }
  if (/selected check-in month/i.test(msg)) return 'Booking could not sync because the selected check-in month has reached the plan limit.'
  if (/above the current plan booking limit|booking limit.*after a downgrade|above.*plan booking limit/i.test(msg)) {
    return restaurantMode ? 'This change could not sync because the business is above the current plan limit after a downgrade.' : 'Booking could not sync because this property is above the current plan limit after downgrade.'
  }
  if (/monthly booking limit reached/i.test(msg)) return 'Booking could not sync because the monthly booking creation limit has been reached.'
  if (/room limit reached/i.test(msg)) {
    return restaurantMode ? 'This item could not sync because a plan inventory limit was reached. Upgrade, then retry.' : 'Room creation could not sync because this property has reached the plan room limit. Upgrade, then retry or clear the failed item.'
  }
  if (/user limit reached/i.test(msg)) return 'Staff user creation could not sync because this property has reached the plan user limit. Upgrade, then retry or clear the failed item.'
  if (/above the current plan room limit|room limit.*after a downgrade|above.*plan room limit/i.test(msg)) {
    return restaurantMode ? 'This item could not sync because the business is above a plan inventory limit after a downgrade.' : 'Room creation could not sync because this property is above the current plan room limit after a downgrade. Upgrade or reduce rooms, then retry.'
  }
  if (/above the current plan user limit|user limit.*after a downgrade|above.*plan user limit/i.test(msg)) return 'Staff user creation could not sync because this property is above the current plan user limit after a downgrade. Upgrade or reduce staff users, then retry.'
  if (/overpay/i.test(msg)) return restaurantMode ? 'Payment would exceed the order total — adjust and retry.' : 'Payment would exceed the booking total — adjust and retry.'
  if (/below zero/i.test(msg)) return 'Adjustment would reduce paid balance below zero.'
  const cleaned = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned
}
