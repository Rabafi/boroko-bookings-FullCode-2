alter table public.bookings
  drop constraint if exists chk_bookings_amount_paid_non_negative;

alter table public.bookings
  add constraint chk_bookings_amount_paid_non_negative
  check (amount_paid >= 0) not valid;

alter table public.bookings
  drop constraint if exists chk_bookings_charges_total_non_negative;

alter table public.bookings
  add constraint chk_bookings_charges_total_non_negative
  check (charges_total >= 0) not valid;

notify pgrst, 'reload schema';
