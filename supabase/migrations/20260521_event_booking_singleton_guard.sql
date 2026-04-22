begin;

create or replace function public.extract_booking_event_group(p_notes text)
returns text
language sql
immutable
as $$
  select nullif(substring(coalesce(p_notes, '') from '\[GROUP:([^\]]+)\]'), '');
$$;

create or replace function public.guard_single_active_event_booking()
returns trigger
language plpgsql
as $$
declare
  v_group text;
  v_existing uuid;
begin
  if not coalesce(new.is_exclusive_event, false) then
    return new;
  end if;

  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;

  v_group := public.extract_booking_event_group(new.notes);
  if v_group is null then
    raise exception 'Exclusive event bookings must include a [GROUP:...] marker';
  end if;

  select id
    into v_existing
    from public.bookings
   where lodge_id = new.lodge_id
     and coalesce(is_exclusive_event, false)
     and coalesce(status, '') <> 'cancelled'
     and public.extract_booking_event_group(notes) = v_group
     and id <> new.id
   limit 1;

  if v_existing is not null then
    raise exception 'An active exclusive event booking already exists for group %. Existing booking: %', v_group, v_existing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_single_active_event_booking on public.bookings;
create trigger trg_single_active_event_booking
before insert or update of lodge_id, is_exclusive_event, status, notes
on public.bookings
for each row
execute function public.guard_single_active_event_booking();

comment on function public.guard_single_active_event_booking()
is 'Prevents one lodge/event booking from becoming multiple active booking/invoice rows for the same event group.';

commit;
