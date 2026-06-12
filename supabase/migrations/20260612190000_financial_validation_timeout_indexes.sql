-- Speed up System Health money checks so production lodges do not hit
-- statement_timeout while reading recent financial rows.

create index if not exists bookings_lodge_updated_idx
  on public.bookings (lodge_id, updated_at desc);

create index if not exists payments_lodge_booking_paid_idx
  on public.payments (lodge_id, booking_id, paid_at desc);

create index if not exists booking_charges_lodge_booking_created_idx
  on public.booking_charges (lodge_id, booking_id, created_at desc);

create index if not exists booking_charges_lodge_active_booking_idx
  on public.booking_charges (lodge_id, booking_id, created_at desc)
  where voided_at is null;

create index if not exists invoices_lodge_booking_created_idx
  on public.invoices (lodge_id, booking_id, created_at desc);

create index if not exists pos_orders_lodge_created_idx
  on public.pos_orders (lodge_id, created_at desc);

create index if not exists pos_orders_lodge_folio_created_idx
  on public.pos_orders (lodge_id, booking_id, created_at desc)
  where lower(coalesce(payment_method, '')) = 'folio' and lower(coalesce(status, '')) <> 'voided';

create index if not exists financial_audit_log_lodge_created_idx
  on public.financial_audit_log (lodge_id, created_at desc);
