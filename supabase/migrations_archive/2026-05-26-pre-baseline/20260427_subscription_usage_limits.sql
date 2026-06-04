create or replace function public.get_lodge_usage_plan(p_lodge_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
begin
  select lower(coalesce(l.subscription_plan, ''))
    into v_plan
    from public.licenses l
   where l.lodge_id = p_lodge_id
     and l.is_active = true
   order by l.issued_at desc nulls last, l.created_at desc nulls last
   limit 1;

  if v_plan in ('starter', 'standard', 'pro') then
    return initcap(v_plan);
  end if;

  begin
    select lower(coalesce(s.pwa_plan, s.plan, ''))
      into v_plan
      from public.settings s
     where s.lodge_id = p_lodge_id
     limit 1;
  exception
    when undefined_column then
      v_plan := '';
  end;

  if v_plan in ('starter', 'standard', 'pro') then
    return initcap(v_plan);
  end if;

  return 'Starter';
end;
$$;

grant execute on function public.get_lodge_usage_plan(uuid) to anon, authenticated, service_role;

create or replace function public.enforce_usage_limits_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := public.get_lodge_usage_plan(new.lodge_id);
  v_booking_limit integer;
  v_room_limit integer;
  v_user_limit integer;
  v_upgrade_plan text;
  v_used integer;
  v_month_start timestamptz := date_trunc('month', now());
  v_month_end timestamptz := v_month_start + interval '1 month';
begin
  if v_plan = 'Pro' then
    return new;
  end if;

  if v_plan = 'Standard' then
    v_booking_limit := 200;
    v_room_limit := 20;
    v_user_limit := 5;
    v_upgrade_plan := 'Pro';
  else
    v_booking_limit := 50;
    v_room_limit := 6;
    v_user_limit := 2;
    v_upgrade_plan := 'Standard';
  end if;

  if tg_table_name = 'bookings' then
    if lower(coalesce(new.status, '')) not in ('confirmed', 'checked_in', 'checked_out') then
      return new;
    end if;
    if coalesce(new.is_exclusive_event, false) = true then
      return new;
    end if;

    select count(*)
      into v_used
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
       and coalesce(b.is_exclusive_event, false) = false
       and b.created_at >= v_month_start
       and b.created_at < v_month_end;

    if v_used >= v_booking_limit then
      raise exception 'Monthly booking limit reached for % plan. Upgrade to % to create more bookings.', v_plan, v_upgrade_plan;
    end if;
    return new;
  end if;

  if tg_table_name = 'rooms' then
    select count(*)
      into v_used
      from public.rooms r
     where r.lodge_id = new.lodge_id;

    if v_used >= v_room_limit then
      raise exception 'Room limit reached for % plan. Upgrade to add more rooms.', v_plan;
    end if;
    return new;
  end if;

  if tg_table_name = 'users' then
    select count(*)
      into v_used
      from public.users u
     where u.lodge_id = new.lodge_id;

    if v_used >= v_user_limit then
      raise exception 'User limit reached for % plan. Upgrade to add more staff accounts.', v_plan;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_usage_limit on public.bookings;
create trigger trg_enforce_booking_usage_limit
before insert on public.bookings
for each row execute function public.enforce_usage_limits_on_insert();

drop trigger if exists trg_enforce_room_usage_limit on public.rooms;
create trigger trg_enforce_room_usage_limit
before insert on public.rooms
for each row execute function public.enforce_usage_limits_on_insert();

drop trigger if exists trg_enforce_user_usage_limit on public.users;
create trigger trg_enforce_user_usage_limit
before insert on public.users
for each row execute function public.enforce_usage_limits_on_insert();
