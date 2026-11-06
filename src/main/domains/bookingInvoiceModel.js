// @ts-check
/**
 * Pure helpers for the customer-facing booking invoice model.
 *
 * These functions do not read caches, query Supabase or write financial data.
 * They exist so that identity resolution and consolidated event-invoice
 * arithmetic can be tested without an Electron runtime or a live database.
 */

/** @param {unknown} value */
export function cleanDisplayText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the customer-facing name for a booking or event invoice.
 *
 * Order of evidence: verified linked customer, persisted booking/event name
 * snapshot, then an explicitly related event/group name. A blank result means
 * the identity is genuinely unresolved; callers must show an actionable
 * unresolved state instead of inventing "Walk-in Guest".
 *
 * @param {{customerName?: unknown, snapshotName?: unknown, eventName?: unknown}} [sources]
 */
export function resolveCustomerDisplayName(sources = {}) {
  return (
    cleanDisplayText(sources.customerName) ||
    cleanDisplayText(sources.snapshotName) ||
    cleanDisplayText(sources.eventName) ||
    ''
  );
}

/**
 * Resolve a booking name using only a verified same-lodge event parent. The
 * note is treated as an opaque legacy link marker; arbitrary note text is
 * never used as a customer name.
 * @param {{customerName?: unknown, snapshotName?: unknown, notes?: unknown, eventParentById?: Map<string, {client_name?: unknown, event_name?: unknown}>}} [sources]
 */
export function resolveBookingDisplayName(sources = {}) {
  const eventId = cleanDisplayText(sources.notes).match(/\[EVENT:([0-9a-fA-F-]{36})\]/)?.[1];
  const parent = eventId ? sources.eventParentById?.get(eventId) : null;
  return resolveCustomerDisplayName({
    customerName: sources.customerName,
    snapshotName: sources.snapshotName,
    eventName: parent?.client_name
  });
}

/**
 * Server-equivalent payment status for a consolidated total.
 * @param {unknown} totalOwed
 * @param {unknown} amountPaid
 */
export function calculateInvoicePaymentStatus(totalOwed, amountPaid) {
  const total = Math.max(0, Number(totalOwed || 0));
  const paid = Math.max(0, Number(amountPaid || 0));
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

/**
 * @typedef {{booking_id: string, room_id?: string|null, room_number?: string|null, room_type?: string|null, check_in?: string|null, check_out?: string|null, nights?: number, adults?: number|string|null, children?: number|string|null, total_amount?: number, amount_paid?: number, charges_total?: number, balance_due?: number, status?: string|null, payment_status?: string|null}} EventRoomInvoiceLine
 * @typedef {{id: string, customer_id?: string|null, customer_name?: string|null, event_name?: string|null, client_name?: string|null, reservation_scope?: string|null, status?: string|null, booking_date?: string|null, check_in?: string|null, check_out?: string|null, total_amount?: number|string|null, charges_total?: number|string|null, amount_paid?: number|string|null, payment_status?: string|null, currency?: string|null, exclusive_booking_id?: string|null}} EventInvoiceParent
 */

/**
 * Collapse an event parent plus its linked room bookings into exactly one
 * customer-facing invoice row.
 *
 * Each event ledger receipt contributes once through the event `amount_paid`;
 * each child room receipt contributes once through its own `amount_paid`.
 * Accommodation totals remain the sum of the child room bookings for venue
 * events. Exclusive-lodge events use the same max-of-room-or-event-accommodation
 * rule as the server projection, then add event and child charges once.
 *
 * @param {{event: EventInvoiceParent, roomRows: EventRoomInvoiceLine[], groupInvoiceNumber?: string|null, groupIssuedAt?: string|null, groupDueDate?: string|null, groupNotes?: string|null}} input
 */
export function summarizeEventInvoiceGroup(input) {
  const { event, roomRows } = input;
  const rooms = Array.isArray(roomRows) ? roomRows.filter(Boolean) : [];
  const roomTotal = rooms.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const roomPaid = rooms.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
  const roomCharges = rooms.reduce((sum, row) => sum + Number(row.charges_total || 0), 0);
  const eventTotal = Number(event?.total_amount || 0);
  const eventCharges = Number(event?.charges_total || 0);
  const eventPaid = Number(event?.amount_paid || 0);
  const total = event?.reservation_scope === 'exclusive_lodge'
    ? Math.max(roomTotal, Math.max(0, eventTotal - eventCharges)) + eventCharges
    : event?.reservation_scope === 'venue_with_rooms' || (!event?.reservation_scope && rooms.length > 0)
      ? roomTotal + eventTotal
      : eventTotal;
  const paid = eventPaid + roomPaid;
  // recalculate_event_totals includes event POS/folio lines in total_amount;
  // event charges are already part of the parent total and must not be added
  // a second time. Only child room charges remain outside their totals.
  const charges = roomCharges;
  const balance = Math.max(0, total + charges - paid);
  const statuses = rooms.map((row) => String(row.status || '').toLowerCase());
  const reconciliationRequired = (eventPaid > 0 && roomPaid > 0) || (eventPaid > 0 && eventTotal <= 0);
  const cancelled = statuses.length > 0 && statuses.every((status) => status === 'cancelled');
  const checkIns = rooms.map((row) => row.check_in).filter(Boolean).sort();
  const checkOuts = rooms.map((row) => row.check_out).filter(Boolean).sort();

  return {
    _event_group: true,
    _linked_event_rooms: true,
    event_group_id: event?.id || null,
    event_id: event?.id || null,
    booking_id: event?.id || null,
    booking_type: 'event',
    customer_id: event?.customer_id || null,
    customer_name: resolveCustomerDisplayName({
      customerName: event?.customer_name,
      snapshotName: event?.client_name,
      eventName: null
    }),
    invoice_number: input.groupInvoiceNumber || null,
    issued_at: input.groupIssuedAt || null,
    due_date: input.groupDueDate || checkIns[0] || event?.booking_date || null,
    invoice_notes: input.groupNotes || '',
    check_in: checkIns[0] || event?.check_in || event?.booking_date || null,
    check_out: checkOuts[checkOuts.length - 1] || event?.check_out || event?.booking_date || null,
    room_count: rooms.length,
    room_number: rooms.length === 1 ? rooms[0].room_number || '1 room' : `${rooms.length} rooms`,
    room_type: 'Event accommodation',
    display_notes: event?.event_name || '',
    total_amount: total,
    amount_paid: paid,
    charges_total: charges,
    balance_due: reconciliationRequired ? null : balance,
    payment_status: reconciliationRequired ? 'reconciliation_required' : calculateInvoicePaymentStatus(total + charges, paid),
    // A parent event receipt and room-linked receipts may be duplicated or
    // reallocations of the same cash until authoritative allocations prove
    // otherwise. Never present the arithmetic remainder as collectible.
    reconciliation_required: reconciliationRequired,
    total_is_estimate: true,
    status: cancelled ? 'cancelled' : event?.status || 'confirmed',
    nights: rooms.reduce((max, row) => Math.max(max, Number(row.nights || 0)), 0),
    _booking_ids: rooms.map((row) => String(row.booking_id)),
    child_invoice_numbers: rooms.map((row) => String(row.invoice_number || '')).filter(Boolean),
    _room_lines: rooms
  };
}
