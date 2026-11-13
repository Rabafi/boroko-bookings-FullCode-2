// Shared scoped event projection for invoice reconciliation and the complete
// desktop event cache. Keep these fields aligned across direct reads and
// background refreshes so a narrow cache refresh cannot erase invoice data.
export const EVENT_BOOKING_CACHE_SELECT = 'id, lodge_id, customer_id, event_name, event_type, reservation_scope, status, booking_date, start_time, end_time, client_name, company, attendees, adults, children, setup_type, room_name, includes_catering, catering_notes, subtotal, extras_total, total_amount, deposit_paid, amount_paid, charges_total, balance_due, payment_status, currency, payment_method, notes, exclusive_booking_id, quotation_id, created_by, created_at, updated_at, cancelled_at, cancellation_reason'
export const EVENT_BOOKING_CACHE_PAGE_SIZE = 500
export const EVENT_BOOKING_CACHE_MAX_ROWS = 100000
