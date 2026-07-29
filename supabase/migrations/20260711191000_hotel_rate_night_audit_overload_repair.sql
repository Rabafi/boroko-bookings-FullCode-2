-- Repair ambiguous function overloads introduced by 20260711190000.
-- 1) room_booking_expected_total: 4-arg wrapper + 5-arg with DEFAULT both match 4-arg calls
-- 2) run_night_audit_checks: (uuid) + (uuid, date DEFAULT) both match 1-arg calls

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- room_booking_expected_total: single 5-arg function with corporate default
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.room_booking_expected_total(uuid, uuid, date, date);
drop function if exists public.room_booking_expected_total(uuid, uuid, date, date, uuid);

create or replace function public.room_booking_expected_total(
  p_lodge_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_corporate_account_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
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
begin
  if p_room_id is null or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return null;
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id and lodge_id = p_lodge_id
  limit 1;

  if not found then
    return null;
  end if;

  v_nights := p_check_out - p_check_in;
  v_day := p_check_in;

  while v_day < p_check_out loop
    v_day_rate := coalesce(v_room.rate_per_night, 0);
    v_override := null;
    v_plan_rate := null;

    if to_regclass('public.room_rate_overrides') is not null then
      select o.rate_per_night
        into v_override
      from public.room_rate_overrides o
      where o.lodge_id = p_lodge_id
        and o.start_date <= v_day
        and o.end_date >= v_day
        and (o.room_id = p_room_id or o.room_id is null)
      order by case when o.room_id is not null then 0 else 1 end, o.start_date desc
      limit 1;
    end if;

    if v_override is not null then
      v_day_rate := v_override;
    else
      v_dow := lower(to_char(v_day, 'dy'));
      if to_regclass('public.rate_plans') is not null then
        select rp.rate_amount
          into v_plan_rate
        from public.rate_plans rp
        where rp.lodge_id = p_lodge_id
          and coalesce(rp.status, 'active') = 'active'
          and (rp.room_type_id is null or rp.room_type_id is not distinct from v_room.room_type_id)
          and (
            p_corporate_account_id is null and rp.corporate_account_id is null
            or rp.corporate_account_id is not distinct from p_corporate_account_id
            or rp.corporate_account_id is null
          )
          and (rp.valid_from is null or rp.valid_from <= v_day)
          and (rp.valid_to is null or rp.valid_to >= v_day)
          and (
            rp.days_of_week is null
            or jsonb_typeof(rp.days_of_week) <> 'array'
            or rp.days_of_week ? v_dow
            or exists (
              select 1
              from jsonb_array_elements_text(rp.days_of_week) d
              where lower(d) in (v_dow, left(v_dow, 3))
            )
          )
          and coalesce(rp.min_stay, 1) <= v_nights
          and (rp.max_stay is null or rp.max_stay >= v_nights)
        order by
          case when rp.corporate_account_id is not null then 0 else 1 end,
          case when rp.room_type_id is not null then 0 else 1 end,
          rp.rate_amount
        limit 1;

        if v_plan_rate is not null then
          v_day_rate := v_plan_rate;
        end if;
      end if;
    end if;

    v_total := v_total + coalesce(v_day_rate, 0);
    v_day := v_day + 1;
  end loop;

  return round(v_total::numeric, 2);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- run_night_audit_checks: single (uuid, date default) signature
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.run_night_audit_checks(uuid);
drop function if exists public.run_night_audit_checks(uuid, date);

create or replace function public.run_night_audit_checks(
  p_lodge_id uuid,
  p_business_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := coalesce(p_business_date, current_date);
  v_arrivals int := 0;
  v_departures int := 0;
  v_no_shows int := 0;
  v_in_house int := 0;
  v_open_hotel_folios int := 0;
  v_unpaid_balances numeric := 0;
  v_dirty_rooms int := 0;
  v_pending_moves int := 0;
  v_already_closed boolean := false;
  v_exceptions jsonb := '[]'::jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['owner', 'admin', 'manager', 'super_admin', 'night_audit', 'receptionist', 'finance']
  );

  select exists (
    select 1 from public.night_audit_close nac
    where nac.lodge_id = p_lodge_id
      and nac.business_date = v_today
      and nac.status = 'closed'
  ) into v_already_closed;

  select count(*) into v_arrivals
  from public.bookings
  where lodge_id = p_lodge_id
    and check_in = v_today
    and status not in ('cancelled', 'no_show', 'checked_out');

  select count(*) into v_departures
  from public.bookings
  where lodge_id = p_lodge_id
    and check_out = v_today
    and status in ('checked_in', 'confirmed');

  select count(*) into v_no_shows
  from public.bookings
  where lodge_id = p_lodge_id
    and check_in < v_today
    and status in ('confirmed', 'pending');

  select count(*) into v_in_house
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in'
    and check_in <= v_today
    and check_out > v_today;

  select coalesce(sum(
    greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))
  ), 0)
    into v_unpaid_balances
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in'
    and check_in <= v_today
    and check_out > v_today;

  select count(*) into v_dirty_rooms
  from public.rooms
  where lodge_id = p_lodge_id
    and (
      lower(coalesce(status, '')) = 'dirty'
      or lower(coalesce(housekeeping_status, '')) = 'dirty'
    );

  select count(*) into v_pending_moves
  from public.booking_room_moves
  where lodge_id = p_lodge_id
    and completed_at is null;

  if to_regclass('public.hotel_folios') is not null then
    select count(*) into v_open_hotel_folios
    from public.hotel_folios hf
    where hf.lodge_id = p_lodge_id
      and hf.status = 'open'
      and coalesce(hf.balance, 0) > 0.009;
  end if;

  if v_already_closed then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'already_closed',
      'description', 'Business date is already closed',
      'severity', 'critical'
    ));
  end if;

  if v_departures > 0 then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'pending_departures',
      'description', v_departures::text || ' departure(s) still not checked out',
      'severity', 'warning'
    ));
  end if;

  if v_no_shows > 0 then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'possible_no_shows',
      'description', v_no_shows::text || ' past-arrival booking(s) still confirmed/pending',
      'severity', 'warning'
    ));
  end if;

  if v_unpaid_balances > 0 then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'unpaid_balances',
      'description', 'In-house unpaid balances totalling ' || v_unpaid_balances::text,
      'severity', 'warning'
    ));
  end if;

  if v_open_hotel_folios > 0 then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'open_hotel_folios',
      'description', v_open_hotel_folios::text || ' open hotel folio(s) with balance',
      'severity', 'warning'
    ));
  end if;

  if v_dirty_rooms > 0 then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'dirty_rooms',
      'description', v_dirty_rooms::text || ' dirty room(s)',
      'severity', 'info'
    ));
  end if;

  if v_pending_moves > 0 then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'exception_type', 'pending_room_moves',
      'description', v_pending_moves::text || ' pending room move(s)',
      'severity', 'info'
    ));
  end if;

  return jsonb_build_object(
    'success', true,
    'date', v_today,
    'arrivals', v_arrivals,
    'departures', v_departures,
    'no_shows', v_no_shows,
    'in_house', v_in_house,
    'open_folios', v_in_house,
    'open_hotel_folios', v_open_hotel_folios,
    'unpaid_balances', v_unpaid_balances,
    'dirty_rooms', v_dirty_rooms,
    'pending_room_moves', v_pending_moves,
    'exceptions', v_exceptions,
    'already_closed', v_already_closed,
    'checks_passed', (
      not v_already_closed
      and not exists (
        select 1
        from jsonb_array_elements(v_exceptions) e
        where e.value->>'severity' = 'critical'
      )
    )
  );
end;
$$;

grant execute on function public.room_booking_expected_total(uuid, uuid, date, date, uuid) to anon, authenticated, service_role;
grant execute on function public.run_night_audit_checks(uuid, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
