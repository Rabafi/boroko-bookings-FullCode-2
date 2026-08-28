-- Enforce the commercial booking cap exclusively against the selected
-- check-in month. Booking created_at remains server-authored for audit and
-- reporting, but the creation month is not a quota bucket.

create or replace function public.enforce_usage_limits_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := public.get_lodge_usage_plan(new.lodge_id);
  v_booking_limit integer;
  v_booking_grace integer;
  v_room_limit integer;
  v_user_limit integer;
  v_upgrade_plan text;
  v_used integer;
  v_target_month_start date;
  v_target_month_end date;
  v_effective_booking_limit integer;
  v_target_month_used integer;
begin
  -- created_at is an audit timestamp, so clients cannot choose it on insert.
  if tg_table_name = 'bookings' and tg_op = 'INSERT' then
    new.created_at := now();
  end if;

  if v_plan = 'Pro' then
    v_booking_limit := 600;
    v_booking_grace := 10;
    v_room_limit := 30;
    v_user_limit := 10;
    v_upgrade_plan := 'Enterprise';
  elsif v_plan = 'Standard' then
    v_booking_limit := 400;
    v_booking_grace := 5;
    v_room_limit := 20;
    v_user_limit := 5;
    v_upgrade_plan := 'Pro';
  else
    v_booking_limit := 120;
    v_booking_grace := 2;
    v_room_limit := 6;
    v_user_limit := 2;
    v_upgrade_plan := 'Standard';
  end if;

  v_effective_booking_limit := v_booking_limit + v_booking_grace;

  if tg_table_name = 'bookings' then
    if lower(coalesce(new.status, '')) not in ('confirmed', 'checked_in', 'checked_out') then
      return new;
    end if;
    if coalesce(new.is_exclusive_event, false) = true or new.check_in is null then
      return new;
    end if;

    v_target_month_start := date_trunc('month', new.check_in::timestamp)::date;
    v_target_month_end := (v_target_month_start + interval '1 month')::date;

    -- An update that keeps an already-counted booking in the same lodge and
    -- check-in month does not acquire another quota unit.
    if tg_op = 'UPDATE'
      and old.lodge_id is not distinct from new.lodge_id
      and lower(coalesce(old.status, '')) in ('confirmed', 'checked_in', 'checked_out')
      and coalesce(old.is_exclusive_event, false) = false
      and old.check_in is not null
      and date_trunc('month', old.check_in::timestamp)::date = v_target_month_start
    then
      return new;
    end if;

    -- Serialize quota acquisition per lodge and check-in month so concurrent
    -- inserts/confirmations cannot both pass the same count.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'booking-usage:' || new.lodge_id::text || ':' || v_target_month_start::text,
        0
      )
    );

    select count(*)
      into v_target_month_used
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
       and coalesce(b.is_exclusive_event, false) = false
       and b.check_in >= v_target_month_start
       and b.check_in < v_target_month_end
       and (tg_op <> 'UPDATE' or b.id is distinct from new.id);

    if v_target_month_used >= v_effective_booking_limit then
      raise exception 'Booking limit reached for the selected check-in month on % plan. Upgrade to % to create more bookings.',
        v_plan, v_upgrade_plan;
    end if;
    return new;
  end if;

  if tg_table_name = 'rooms' then
    select count(*)
      into v_used
      from public.rooms r
     where r.lodge_id = new.lodge_id;

    if v_used >= v_room_limit then
      raise exception 'Room limit reached: % allows up to % rooms. Upgrade to % for more rooms.',
        v_plan, v_room_limit, v_upgrade_plan;
    end if;
    return new;
  end if;

  if tg_table_name = 'users' then
    select count(*)
      into v_used
      from public.users u
     where u.lodge_id = new.lodge_id;

    if v_used >= v_user_limit then
      raise exception 'User limit reached: % allows up to % staff accounts. Upgrade to % for more users.',
        v_plan, v_user_limit, v_upgrade_plan;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_usage_limit on public.bookings;
create trigger trg_enforce_booking_usage_limit
before insert or update of status, check_in, lodge_id, is_exclusive_event on public.bookings
for each row execute function public.enforce_usage_limits_on_insert();

notify pgrst, 'reload schema';
