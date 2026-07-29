-- Enforce the one-settlement-per-event invariant at the database boundary.
-- Abort if historical duplicates exist; financial records must be reconciled
-- explicitly and must never be deleted automatically by a migration.

begin;

do $$
begin
  if exists (
    select 1
    from public.event_settlements
    group by lodge_id, event_booking_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate event settlements exist. Reconcile them before applying the unique invariant.';
  end if;
end $$;

alter table public.event_settlements
  drop constraint if exists event_settlements_unique_event;
alter table public.event_settlements
  add constraint event_settlements_unique_event unique (lodge_id, event_booking_id);

commit;
