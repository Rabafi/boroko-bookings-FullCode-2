-- Add 'declined' to the quotations status constraint.
-- The frontend STATUS_OPTIONS already includes 'declined' but the DB constraint
-- was missing it, causing update_quotation to fail when setting status = 'declined'.

alter table public.quotations
  drop constraint if exists quotations_status_check;

alter table public.quotations
  add constraint quotations_status_check
  check (status in ('draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled', 'declined'));
