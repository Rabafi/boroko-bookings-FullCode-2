begin;

-- Add 'retention_fee' as a valid payment type.
-- The original constraint only allowed ('deposit', 'payment', 'refund').
-- Without this change, the approve_booking_refund RPC will fail on any refund
-- with retention > 0% because the retention_fee row insert is rejected, rolling
-- back the entire refund transaction.

alter table public.payments
  drop constraint if exists payments_type_check;

alter table public.payments
  add constraint payments_type_check
  check (type in ('deposit', 'payment', 'refund', 'retention_fee'));

commit;
