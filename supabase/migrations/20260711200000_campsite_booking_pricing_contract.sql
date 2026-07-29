-- Authoritative campsite booking pricing and occupancy contract.
-- This migration is deliberately after 20260711191000 so the existing room
-- rate-plan contract remains the compatibility baseline for normal rooms.

begin;

alter table public.bookings
  add column if not exists tents_count integer not null default 0,
  add column if not exists vehicles_count integer not null default 0,
  add column if not exists accommodation_kind text;

create table if not exists public.booking_accommodation_details (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  lodge_id uuid not null,
  accommodation_kind text not null,
  adults integer not null default 1,
  children integer not null default 0,
  tents integer not null default 0,
  vehicles integer not null default 0,
  rate_mode text not null,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_accommodation_details_counts_check check (
    adults >= 0 and children >= 0 and tents >= 0 and vehicles >= 0
  )
);

create index if not exists booking_accommodation_details_lodge_idx
  on public.booking_accommodation_details (lodge_id, created_at desc);

alter table public.booking_accommodation_details enable row level security;
drop policy if exists booking_accommodation_details_select_own_lodge
  on public.booking_accommodation_details;
create policy booking_accommodation_details_select_own_lodge
  on public.booking_accommodation_details for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.accommodation_booking_expected_total(
  p_lodge_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer default 1,
  p_children integer default 0,
  p_tents integer default 0,
  p_vehicles integer default 0,
  p_corporate_account_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_room public.rooms%rowtype;
  v_nights integer;
  v_people integer;
  v_mode text;
  v_total numeric;
begin
  if p_lodge_id is null or p_room_id is null or p_check_in is null or p_check_out is null
     or p_check_out <= p_check_in then
    raise exception 'Invalid accommodation date range';
  end if;
  if coalesce(p_adults, 0) < 0 or coalesce(p_children, 0) < 0
     or coalesce(p_tents, 0) < 0 or coalesce(p_vehicles, 0) < 0
     or coalesce(p_adults, 0) + coalesce(p_children, 0) < 1 then
    raise exception 'Invalid accommodation occupancy';
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id and lodge_id = p_lodge_id
  for update;
  if not found then raise exception 'Accommodation does not belong to this lodge'; end if;

  if public._normalize_accommodation_kind(v_room.accommodation_kind) <> 'campsite' then
    raise exception 'Selected accommodation is not a campsite';
  end if;

  if v_room.capacity_adults is not null and p_adults > v_room.capacity_adults then
    raise exception 'Adult capacity exceeded';
  end if;
  if v_room.capacity_children is not null and p_children > v_room.capacity_children then
    raise exception 'Child capacity exceeded';
  end if;
  if v_room.max_tents is not null and p_tents > v_room.max_tents then
    raise exception 'Tent capacity exceeded';
  end if;
  if v_room.max_vehicles is not null and p_vehicles > v_room.max_vehicles then
    raise exception 'Vehicle capacity exceeded';
  end if;

  v_nights := p_check_out - p_check_in;
  v_people := p_adults + p_children;
  v_mode := public._normalize_rate_mode(v_room.rate_mode);

  if v_mode = 'site' then
    if coalesce(v_room.rate_per_night, 0) <= 0 then raise exception 'Campsite site rate is missing'; end if;
    v_total := v_room.rate_per_night * v_nights;
  elsif v_mode = 'person' then
    if coalesce(v_room.rate_per_person, 0) <= 0 then raise exception 'Campsite person rate is missing'; end if;
    v_total := v_room.rate_per_person * v_people * v_nights;
  elsif v_mode = 'tent' then
    if coalesce(v_room.rate_per_tent, 0) <= 0 then raise exception 'Campsite tent rate is missing'; end if;
    if p_tents < 1 then raise exception 'At least one tent is required'; end if;
    v_total := v_room.rate_per_tent * p_tents * v_nights;
  elsif v_mode = 'vehicle' then
    if coalesce(v_room.rate_per_vehicle, 0) <= 0 then raise exception 'Campsite vehicle rate is missing'; end if;
    if p_vehicles < 1 then raise exception 'At least one vehicle is required'; end if;
    v_total := v_room.rate_per_vehicle * p_vehicles * v_nights;
  else
    if coalesce(v_room.rate_per_night, 0) <= 0 then raise exception 'Composite campsite site rate is missing'; end if;
    if coalesce(v_room.rate_per_person, 0) <= 0 then raise exception 'Composite campsite person rate is missing'; end if;
    if p_tents > 0 and coalesce(v_room.rate_per_tent, 0) <= 0 then raise exception 'Composite campsite tent rate is missing'; end if;
    if p_vehicles > 0 and coalesce(v_room.rate_per_vehicle, 0) <= 0 then raise exception 'Composite campsite vehicle rate is missing'; end if;
    v_total := (v_room.rate_per_night + v_room.rate_per_person * v_people
      + v_room.rate_per_tent * p_tents + v_room.rate_per_vehicle * p_vehicles) * v_nights;
  end if;

  return round(v_total, 2);
end;
$$;

-- Compatibility-safe desktop contract. The established create_booking RPC is
-- retained for rooms; this wrapper supplies campsite occupancy through a
-- transaction-local context so its existing idempotency and authorization
-- checks remain the final write authority.
create or replace function public.create_campsite_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_tents integer,
  p_vehicles integer,
  p_total_amount numeric,
  p_invoice_number text default null,
  p_notes text default '',
  p_created_by uuid default null,
  p_deposit_amount numeric default 0,
  p_booking_id uuid default null,
  p_idempotency_key text default null,
  p_deposit_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing public.booking_accommodation_details%rowtype;
  v_result jsonb;
  v_booking_id uuid;
  v_room public.rooms%rowtype;
  v_expected numeric;
begin
  if p_adults < 0 or p_children < 0 or p_tents < 0 or p_vehicles < 0
     or p_adults + p_children < 1 then
    return jsonb_build_object('success', false, 'error', 'Invalid accommodation occupancy');
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Booking idempotency key is required');
  end if;

  select * into v_existing
  from public.booking_accommodation_details d
  join public.bookings b on b.id = d.booking_id
  where b.lodge_id = p_lodge_id and b.create_idempotency_key = p_idempotency_key
  limit 1;
  if found then
    if v_existing.adults <> p_adults or v_existing.children <> p_children
       or v_existing.tents <> p_tents or v_existing.vehicles <> p_vehicles then
      return jsonb_build_object('success', false, 'error', 'Idempotency key was already used with different campsite occupancy');
    end if;
    return jsonb_build_object('success', true, 'booking_id', v_existing.booking_id, 'idempotent', true);
  end if;
  if exists (
    select 1 from public.bookings b
    where b.lodge_id = p_lodge_id and b.create_idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('success', false, 'error', 'Idempotency key belongs to a booking without campsite occupancy details');
  end if;

  select * into v_room from public.rooms where id = p_room_id and lodge_id = p_lodge_id for update;
  if not found or public._normalize_accommodation_kind(v_room.accommodation_kind) <> 'campsite' then
    return jsonb_build_object('success', false, 'error', 'Selected accommodation is not a campsite');
  end if;
  v_expected := public.accommodation_booking_expected_total(
    p_lodge_id, p_room_id, p_check_in, p_check_out,
    p_adults, p_children, p_tents, p_vehicles, null
  );
  if abs(round(coalesce(p_total_amount, 0), 2) - v_expected) > 0.01 then
    return jsonb_build_object('success', false, 'error', format('Booking total must match the campsite rate. Expected %s, received %s.', v_expected, p_total_amount));
  end if;

  perform set_config('app.campsite_adults', p_adults::text, true);
  perform set_config('app.campsite_children', p_children::text, true);
  perform set_config('app.campsite_tents', p_tents::text, true);
  perform set_config('app.campsite_vehicles', p_vehicles::text, true);
  v_result := public.create_booking(
    p_lodge_id, p_customer_id, p_room_id, p_check_in, p_check_out,
    p_adults, p_children, p_total_amount, p_invoice_number, p_notes,
    p_created_by, p_deposit_amount, p_booking_id, p_idempotency_key,
    p_deposit_method, false
  );
  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;
  v_booking_id := nullif(v_result->>'booking_id', '')::uuid;
  if v_booking_id is null then return v_result; end if;

  update public.bookings
  set tents_count = p_tents, vehicles_count = p_vehicles,
      accommodation_kind = 'campsite', updated_at = now()
  where id = v_booking_id and lodge_id = p_lodge_id;
  insert into public.booking_accommodation_details (
    booking_id, lodge_id, accommodation_kind, adults, children, tents, vehicles,
    rate_mode, pricing_snapshot
  ) values (
    v_booking_id, p_lodge_id, 'campsite', p_adults, p_children, p_tents, p_vehicles,
    public._normalize_rate_mode(v_room.rate_mode),
    jsonb_build_object(
      'nights', p_check_out - p_check_in,
      'site_rate', v_room.rate_per_night,
      'person_rate', v_room.rate_per_person,
      'tent_rate', v_room.rate_per_tent,
      'vehicle_rate', v_room.rate_per_vehicle,
      'people', p_adults + p_children,
      'tents', p_tents,
      'vehicles', p_vehicles,
      'calculated_total', v_expected
    )
  ) on conflict (booking_id) do update set pricing_snapshot = excluded.pricing_snapshot;
  return v_result || jsonb_build_object('accommodation_kind', 'campsite', 'tents', p_tents, 'vehicles', p_vehicles, 'total_amount', v_expected);
end;
$$;

grant execute on function public.create_campsite_booking(uuid, uuid, uuid, date, date, integer, integer, integer, integer, numeric, text, text, uuid, numeric, uuid, text, text) to authenticated, service_role;

-- Keep the established signature and room/rate-plan behavior. Campsites now
-- use the occupancy-aware server contract instead of rate_per_night alone.
drop function if exists public.room_booking_expected_total(uuid, uuid, date, date);
drop function if exists public.room_booking_expected_total(uuid, uuid, date, date, uuid);
create or replace function public.room_booking_expected_total(
  p_lodge_id uuid, p_room_id uuid, p_check_in date, p_check_out date,
  p_corporate_account_id uuid default null
)
returns numeric language plpgsql security definer set search_path to 'public'
as $$
declare
  v_room public.rooms%rowtype;
  v_day date;
  v_nights integer;
  v_total numeric := 0;
  v_day_rate numeric;
  v_override numeric;
  v_plan_rate numeric;
  v_dow text;
  v_adults integer := greatest(coalesce(nullif(current_setting('app.campsite_adults', true), '')::integer, 1), 0);
  v_children integer := greatest(coalesce(nullif(current_setting('app.campsite_children', true), '')::integer, 0), 0);
  v_tents integer := greatest(coalesce(nullif(current_setting('app.campsite_tents', true), '')::integer, 0), 0);
  v_vehicles integer := greatest(coalesce(nullif(current_setting('app.campsite_vehicles', true), '')::integer, 0), 0);
begin
  select * into v_room from public.rooms where id = p_room_id and lodge_id = p_lodge_id for update;
  if not found or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then return null; end if;
  if public._normalize_accommodation_kind(v_room.accommodation_kind) = 'campsite' then
    return public.accommodation_booking_expected_total(p_lodge_id, p_room_id, p_check_in, p_check_out, v_adults, v_children, v_tents, v_vehicles, p_corporate_account_id);
  end if;
  v_nights := p_check_out - p_check_in;
  v_day := p_check_in;
  while v_day < p_check_out loop
    v_day_rate := coalesce(v_room.rate_per_night, 0);
    if to_regclass('public.room_rate_overrides') is not null then
      select o.rate_per_night into v_override from public.room_rate_overrides o
      where o.lodge_id = p_lodge_id and o.start_date <= v_day and o.end_date >= v_day
        and (o.room_id = p_room_id or o.room_id is null)
      order by case when o.room_id is not null then 0 else 1 end, o.start_date desc limit 1;
    end if;
    if v_override is not null then v_day_rate := v_override;
    elsif to_regclass('public.rate_plans') is not null then
      v_dow := lower(to_char(v_day, 'dy'));
      select rp.rate_amount into v_plan_rate from public.rate_plans rp
      where rp.lodge_id = p_lodge_id and coalesce(rp.status, 'active') = 'active'
        and (rp.room_type_id is null or rp.room_type_id is not distinct from v_room.room_type_id)
        and (p_corporate_account_id is null and rp.corporate_account_id is null
          or rp.corporate_account_id is not distinct from p_corporate_account_id or rp.corporate_account_id is null)
        and (rp.valid_from is null or rp.valid_from <= v_day) and (rp.valid_to is null or rp.valid_to >= v_day)
        and (rp.days_of_week is null or jsonb_typeof(rp.days_of_week) <> 'array' or rp.days_of_week ? v_dow
          or exists (select 1 from jsonb_array_elements_text(rp.days_of_week) d where lower(d) in (v_dow, left(v_dow, 3))))
        and coalesce(rp.min_stay, 1) <= v_nights and (rp.max_stay is null or rp.max_stay >= v_nights)
      order by case when rp.corporate_account_id is not null then 0 else 1 end,
        case when rp.room_type_id is not null then 0 else 1 end, rp.rate_amount limit 1;
      if v_plan_rate is not null then v_day_rate := v_plan_rate; end if;
    end if;
    v_total := v_total + coalesce(v_day_rate, 0);
    v_day := v_day + 1;
  end loop;
  return round(v_total, 2);
end;
$$;

grant execute on function public.accommodation_booking_expected_total(uuid, uuid, date, date, integer, integer, integer, integer, uuid) to anon, authenticated, service_role;
grant execute on function public.room_booking_expected_total(uuid, uuid, date, date, uuid) to anon, authenticated, service_role;

-- Patch the already deployed public RPC in-place so older clients retain its
-- signature while selected lines carry campsite occupancy and snapshots.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure) into v_def;
  if v_def is null then raise exception 'create_online_booking(text,jsonb) is missing'; end if;
  v_def := replace(v_def, 'v_children int;', 'v_children int; v_tents int; v_vehicles int;');
  v_def := replace(v_def, 'v_children := greatest(0, coalesce((v_room_line->>''children'')::int, 0));',
    'v_children := greatest(0, coalesce((v_room_line->>''children'')::int, 0)); v_tents := greatest(0, coalesce((v_room_line->>''tents'')::int, 0)); v_vehicles := greatest(0, coalesce((v_room_line->>''vehicles'')::int, 0));');
  v_def := replace(v_def, E'v_booking_total := case\n      when v_booking_type = ''full_lodge'' then v_full_lodge_total\n      else coalesce(v_room.rate_per_night, 0) * v_nights\n    end;',
    'v_booking_total := case when v_booking_type = ''full_lodge'' then v_full_lodge_total else case when public._normalize_accommodation_kind(v_room.accommodation_kind) = ''campsite'' then public.accommodation_booking_expected_total(v_lodge_id, v_room_id, v_check_in, v_check_out, v_adults, v_children, v_tents, v_vehicles, null) else public.room_booking_expected_total(v_lodge_id, v_room_id, v_check_in, v_check_out) end end;');
  v_def := replace(v_def, E'id, lodge_id, customer_id, room_id, check_in, check_out, adults, children,\n      total_amount,', E'id, lodge_id, customer_id, room_id, check_in, check_out, adults, children, tents_count, vehicles_count, accommodation_kind,\n      total_amount,');
  v_def := replace(v_def, E'v_booking_id, v_lodge_id, v_customer_id, v_room_id, v_check_in, v_check_out, v_adults, v_children,\n      v_booking_total,', E'v_booking_id, v_lodge_id, v_customer_id, v_room_id, v_check_in, v_check_out, v_adults, v_children, v_tents, v_vehicles, public._normalize_accommodation_kind(v_room.accommodation_kind),\n      v_booking_total,');
  v_def := replace(v_def, E'on conflict do nothing;\n\n    v_booking_ids := array_append', E'on conflict do nothing;\n\n    insert into public.booking_accommodation_details (booking_id, lodge_id, accommodation_kind, adults, children, tents, vehicles, rate_mode, pricing_snapshot)\n    values (v_booking_id, v_lodge_id, public._normalize_accommodation_kind(v_room.accommodation_kind), v_adults, v_children, v_tents, v_vehicles, public._normalize_rate_mode(v_room.rate_mode), jsonb_build_object(''nights'', v_nights, ''site_rate'', v_room.rate_per_night, ''person_rate'', v_room.rate_per_person, ''tent_rate'', v_room.rate_per_tent, ''vehicle_rate'', v_room.rate_per_vehicle, ''people'', v_adults + v_children, ''tents'', v_tents, ''vehicles'', v_vehicles, ''calculated_total'', v_booking_total));\n\n    v_booking_ids := array_append');
  if v_def = pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure) then raise exception 'create_online_booking patch did not match'; end if;
  execute v_def;
end $$;

notify pgrst, 'reload schema';
commit;
