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
  v_creation_month_start timestamptz;
  v_creation_month_end timestamptz;
  v_effective_booking_limit integer;
  v_target_month_used integer;
  v_creation_month_used integer;
begin
  if v_plan = 'Pro' then
    return new;
  end if;

  if v_plan = 'Standard' then
    v_booking_limit := 200;
    v_booking_grace := 5;
    v_room_limit := 20;
    v_user_limit := 5;
    v_upgrade_plan := 'Pro';
  else
    v_booking_limit := 50;
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
    if coalesce(new.is_exclusive_event, false) = true then
      return new;
    end if;
    if new.check_in is null then
      return new;
    end if;

    v_target_month_start := date_trunc('month', new.check_in::timestamp)::date;
    v_target_month_end := (v_target_month_start + interval '1 month')::date;
    v_creation_month_start := date_trunc('month', coalesce(new.created_at, now()));
    v_creation_month_end := v_creation_month_start + interval '1 month';

    select count(*)
      into v_target_month_used
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
       and coalesce(b.is_exclusive_event, false) = false
       and b.check_in >= v_target_month_start
       and b.check_in < v_target_month_end;

    if v_target_month_used >= v_effective_booking_limit then
      raise exception 'Booking limit reached for the selected check-in month on % plan. Upgrade to % to create more bookings.',
        v_plan, v_upgrade_plan;
    end if;

    select count(*)
      into v_creation_month_used
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
       and coalesce(b.is_exclusive_event, false) = false
       and b.created_at >= v_creation_month_start
       and b.created_at < v_creation_month_end;

    if v_creation_month_used >= v_effective_booking_limit then
      raise exception 'Monthly booking creation limit reached for % plan. Upgrade to % to create more bookings.',
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
