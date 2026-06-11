-- Ensure older/live databases have the canonical booking charges total column.
-- This is intentionally idempotent so it is safe after the original migration.

alter table public.bookings
  add column if not exists charges_total numeric not null default 0;

update public.bookings
set charges_total = 0
where charges_total is null;

create or replace function public.sync_booking_charges_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_new_charges numeric;
begin
  v_booking_id := case
    when tg_op = 'DELETE' then old.booking_id
    else new.booking_id
  end;

  select greatest(0, coalesce(sum(amount), 0))
    into v_new_charges
  from public.booking_charges
  where booking_id = v_booking_id
    and voided_at is null;

  update public.bookings
     set charges_total = v_new_charges,
         payment_status = public.compute_payment_status(
           coalesce(amount_paid, 0),
           coalesce(total_amount, 0),
           v_new_charges
         ),
         updated_at = now()
   where id = v_booking_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_charges_total on public.booking_charges;
create trigger trg_sync_charges_total
after insert or update or delete on public.booking_charges
for each row execute function public.sync_booking_charges_total();
