-- Phone reservations are shared front-of-house work. The creator is audited,
-- but table/server allocation remains a seating-time decision for the on-duty team.

alter table public.restaurant_waitlist_entries
  add column if not exists waitlist_type text not null default 'live'
    check (waitlist_type in ('live', 'reservation')),
  add column if not exists requested_reservation_date date,
  add column if not exists requested_reservation_time time,
  add column if not exists requested_duration_minutes integer;

create index if not exists idx_restaurant_waitlist_requested_slot
  on public.restaurant_waitlist_entries (lodge_id, waitlist_type, requested_reservation_date, requested_reservation_time)
  where status in ('waiting', 'notified');

create or replace function public.create_restaurant_reservation(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_date date := (payload->>'reservation_date')::date;
  v_time time := (payload->>'reservation_time')::time;
  v_duration integer := coalesce((payload->>'duration_minutes')::integer, 90);
  v_party_size integer := (payload->>'party_size')::integer;
  v_capacity integer;
  v_reserved_covers integer;
  v_result jsonb;
  v_actor uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor','cashier']);
  if nullif(trim(payload->>'customer_name'), '') is null or v_date is null or v_time is null or coalesce(v_party_size, 0) < 1 or v_duration < 15 then
    raise exception 'Guest name, date, time, party size and a valid duration are required.' using errcode = '22023';
  end if;
  if v_date < current_date then raise exception 'Reservations cannot be created in the past.' using errcode = '22023'; end if;

  -- Serialise competing bookings for one restaurant/date before checking covers.
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_date::text, 0));
  select coalesce(sum(greatest(coalesce(t.seats, 0), 0)), 0) into v_capacity
  from public.pos_tables t where t.lodge_id = v_lodge_id and t.active = true;
  if v_capacity < 1 then raise exception 'No active table capacity is configured. Ask a manager to set up the floor before taking reservations.' using errcode = '23514'; end if;
  if v_party_size > v_capacity then return jsonb_build_object('success', false, 'code', 'reservation_capacity_full', 'message', 'Party size exceeds configured table capacity.', 'available_covers', v_capacity); end if;
  select coalesce(sum(r.party_size), 0) into v_reserved_covers
  from public.restaurant_reservations r
  where r.lodge_id = v_lodge_id and r.reservation_date = v_date and r.status in ('booked','confirmed','waiting')
    and (v_date + r.reservation_time) < (v_date + v_time + make_interval(mins => v_duration))
    and (v_date + r.reservation_time + make_interval(mins => r.duration_minutes)) > (v_date + v_time);
  if v_reserved_covers + v_party_size > v_capacity then
    return jsonb_build_object('success', false, 'code', 'reservation_capacity_full', 'message', 'That reservation time is full.', 'available_covers', greatest(v_capacity - v_reserved_covers, 0));
  end if;

  v_actor := public.app_current_user_id();
  insert into public.restaurant_reservations (lodge_id, outlet_id, customer_id, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, duration_minutes, preferred_table_id, status, source, notes, created_by)
  values (v_lodge_id, nullif(payload->>'outlet_id', '')::uuid, nullif(payload->>'customer_id', '')::uuid, trim(payload->>'customer_name'), nullif(trim(payload->>'customer_phone'), ''), nullif(trim(payload->>'customer_email'), ''), v_party_size, v_date, v_time, v_duration, nullif(payload->>'preferred_table_id', '')::uuid, 'booked', coalesce(nullif(payload->>'source', ''), 'phone'), nullif(trim(payload->>'notes'), ''), v_actor)
  returning to_jsonb(restaurant_reservations.*) into v_result;
  insert into public.restaurant_service_events (lodge_id, reservation_id, action, before_state, after_state, actor_id)
  values (v_lodge_id, (v_result->>'id')::uuid, 'reservation_created', null, v_result, v_actor);
  return jsonb_build_object('success', true, 'reservation', v_result);
end; $$;

create or replace function public.create_restaurant_waitlist_entry(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_type text := coalesce(nullif(payload->>'waitlist_type', ''), 'live');
  v_result jsonb;
  v_actor uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor','cashier']);
  if nullif(trim(payload->>'customer_name'), '') is null or coalesce((payload->>'party_size')::integer, 0) < 1 then raise exception 'Guest name and party size are required.' using errcode = '22023'; end if;
  if v_type not in ('live', 'reservation') then raise exception 'Unknown waitlist type.' using errcode = '22023'; end if;
  if v_type = 'reservation' and ((payload->>'requested_reservation_date')::date is null or (payload->>'requested_reservation_time')::time is null) then raise exception 'A requested date and time are required for a reservation waitlist.' using errcode = '22023'; end if;
  v_actor := public.app_current_user_id();
  insert into public.restaurant_waitlist_entries (lodge_id, outlet_id, customer_id, customer_name, customer_phone, party_size, quoted_wait_minutes, notes, created_by, waitlist_type, requested_reservation_date, requested_reservation_time, requested_duration_minutes)
  values (v_lodge_id, nullif(payload->>'outlet_id', '')::uuid, nullif(payload->>'customer_id', '')::uuid, trim(payload->>'customer_name'), nullif(trim(payload->>'customer_phone'), ''), (payload->>'party_size')::integer, nullif(payload->>'quoted_wait_minutes', '')::integer, nullif(trim(payload->>'notes'), ''), v_actor, v_type, nullif(payload->>'requested_reservation_date', '')::date, nullif(payload->>'requested_reservation_time', '')::time, coalesce(nullif(payload->>'requested_duration_minutes', '')::integer, 90))
  returning to_jsonb(restaurant_waitlist_entries.*) into v_result;
  insert into public.restaurant_service_events (lodge_id, waitlist_entry_id, action, before_state, after_state, actor_id)
  values (v_lodge_id, (v_result->>'id')::uuid, case when v_type = 'reservation' then 'reservation_waitlist_created' else 'waitlist_created' end, null, v_result, v_actor);
  return jsonb_build_object('success', true, 'entry', v_result);
end; $$;

create or replace function public.get_restaurant_waitlist(p_lodge_id uuid, p_outlet_id uuid default null, p_include_reservation_waitlist boolean default false)
returns setof public.restaurant_waitlist_entries language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['cashier','supervisor','manager','admin']);
  return query select w.* from public.restaurant_waitlist_entries w
  where w.lodge_id = p_lodge_id and w.status in ('waiting','notified') and (p_outlet_id is null or w.outlet_id = p_outlet_id)
    and (p_include_reservation_waitlist or w.waitlist_type = 'live')
  order by w.requested_reservation_date nulls first, w.requested_reservation_time nulls first, w.created_at;
end; $$;

revoke all on function public.create_restaurant_reservation(jsonb) from public;
grant execute on function public.create_restaurant_reservation(jsonb) to authenticated, service_role;
revoke all on function public.create_restaurant_waitlist_entry(jsonb) from public;
grant execute on function public.create_restaurant_waitlist_entry(jsonb) to authenticated, service_role;
revoke all on function public.get_restaurant_waitlist(uuid, uuid, boolean) from public;
grant execute on function public.get_restaurant_waitlist(uuid, uuid, boolean) to authenticated, service_role;
