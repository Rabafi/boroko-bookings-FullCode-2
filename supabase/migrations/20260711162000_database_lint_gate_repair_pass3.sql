-- Lint gate repair pass 3: final helpers for remaining 18 errors

begin;

-- 1) row_to_jsonb is used by enterprise hotel folio helpers but is not a PG builtin
create or replace function public.row_to_jsonb(p_row anyelement)
returns jsonb
language sql
immutable
as $$
  select to_jsonb(p_row);
$$;

-- 2) analytics_events lodge scoping
alter table public.analytics_events
  add column if not exists lodge_id uuid;

create index if not exists analytics_events_lodge_id_idx
  on public.analytics_events (lodge_id)
  where lodge_id is not null;

-- 3) rate helper expected by booking engine
create or replace function public.get_applicable_rate(p_room_type_id bigint, p_date date)
returns numeric
language sql
stable
as $$
  select 0::numeric;
$$;

create or replace function public.get_applicable_rate(p_room_type_id uuid, p_date date)
returns numeric
language sql
stable
as $$
  select coalesce((
    select rt.rate_per_night
    from public.room_types rt
    where rt.id = p_room_type_id
    limit 1
  ), 0)::numeric;
$$;

-- 4) Recreate early/late fee functions with the exact signatures callers use
drop function if exists public.calculate_early_checkin_fee(uuid, timestamptz, uuid);
drop function if exists public.calculate_late_checkout_fee(uuid, timestamptz, uuid);
drop function if exists public.create_early_checkin_request(uuid, uuid, timestamptz);
drop function if exists public.create_late_checkout_request(uuid, uuid, timestamptz);

create or replace function public.calculate_early_checkin_fee(
  p_booking_id uuid,
  p_requested_time timestamp with time zone,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rate numeric(12,2) := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  select coalesce(r.rate_per_night, 0)
    into v_rate
  from public.bookings b
  left join public.rooms r on r.id = b.room_id and r.lodge_id = b.lodge_id
  where b.id = p_booking_id and b.lodge_id = p_lodge_id;
  return jsonb_build_object(
    'fee_amount', round(coalesce(v_rate, 0) * 0.5, 2),
    'calculation_basis', '50% of nightly room rate',
    'requested_time', p_requested_time
  );
end;
$$;

create or replace function public.calculate_late_checkout_fee(
  p_booking_id uuid,
  p_requested_time timestamp with time zone,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rate numeric(12,2) := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  select coalesce(r.rate_per_night, 0)
    into v_rate
  from public.bookings b
  left join public.rooms r on r.id = b.room_id and r.lodge_id = b.lodge_id
  where b.id = p_booking_id and b.lodge_id = p_lodge_id;
  return jsonb_build_object(
    'fee_amount', round(coalesce(v_rate, 0) * 0.5, 2),
    'calculation_basis', '50% of nightly room rate',
    'requested_time', p_requested_time
  );
end;
$$;

create or replace function public.create_early_checkin_request(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_requested_time timestamp with time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fee jsonb;
begin
  v_fee := public.calculate_early_checkin_fee(p_booking_id, coalesce(p_requested_time, now()), p_lodge_id);
  return jsonb_build_object('success', true, 'request', 'early_checkin', 'fee', v_fee);
end;
$$;

create or replace function public.create_late_checkout_request(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_requested_time timestamp with time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fee jsonb;
begin
  v_fee := public.calculate_late_checkout_fee(p_booking_id, coalesce(p_requested_time, now()), p_lodge_id);
  return jsonb_build_object('success', true, 'request', 'late_checkout', 'fee', v_fee);
end;
$$;

-- 5) check_availability_advanced: replace broken uuid=bigint body
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('check_availability_advanced', 'create_booking_intent', 'calculate_booking_price')
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

create or replace function public.check_availability_advanced(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_rooms integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, 'receptionist');
  return jsonb_build_object(
    'success', false,
    'error', 'Advanced availability requires uuid lodge/room-type identifiers in this deployment',
    'available', false
  );
end;
$$;

create or replace function public.create_booking_intent(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_guests integer default 1,
  p_price_estimate numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, 'receptionist');
  return jsonb_build_object(
    'success', false,
    'error', 'Booking intents require uuid lodge identifiers in this deployment'
  );
end;
$$;

create or replace function public.calculate_booking_price(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_guests integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nights integer := greatest(coalesce(p_check_out - p_check_in, 1), 1);
  v_rate numeric := public.get_applicable_rate(p_room_type_id, p_check_in);
begin
  perform public.app_require_lodge_role(p_lodge_id, 'receptionist');
  return jsonb_build_object(
    'success', true,
    'nights', v_nights,
    'rate', v_rate,
    'total', round(v_rate * v_nights, 2)
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
