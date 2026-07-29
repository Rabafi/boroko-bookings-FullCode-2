-- Hotel follow-on: rate-plan-aware booking totals, night-audit hardening,
-- corporate charge settlement linked to bookings + optional folio payment.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. room_booking_expected_total: night-by-night overrides + rate plans
-- ═══════════════════════════════════════════════════════════════════════════

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

    -- Per-night override (room-specific first)
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
      -- Active rate plan (corporate-specific, then room-type, then general)
      v_dow := lower(to_char(v_day, 'dy')); -- mon, tue, ...
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

-- Keep 4-arg signature working for existing callers
create or replace function public.room_booking_expected_total(
  p_lodge_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date
)
returns numeric
language sql
security definer
set search_path to 'public'
as $$
  select public.room_booking_expected_total(p_lodge_id, p_room_id, p_check_in, p_check_out, null::uuid);
$$;

-- Quote helper for desktop/UI
create or replace function public.quote_room_stay(
  p_lodge_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_corporate_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_nights integer;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin', 'finance', 'cashier']
  );

  v_total := public.room_booking_expected_total(
    p_lodge_id, p_room_id, p_check_in, p_check_out, p_corporate_account_id
  );
  if v_total is null then
    return jsonb_build_object('success', false, 'error', 'Unable to price stay for this room/dates');
  end if;

  v_nights := greatest(p_check_out - p_check_in, 0);
  return jsonb_build_object(
    'success', true,
    'room_id', p_room_id,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', v_nights,
    'total', v_total,
    'average_nightly', case when v_nights > 0 then round(v_total / v_nights, 2) else 0 end,
    'corporate_account_id', p_corporate_account_id
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Night audit: robust checks + single close per business date
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure booking_room_moves has columns used by audit (compat)
alter table public.booking_room_moves
  add column if not exists completed_at timestamptz;

create unique index if not exists night_audit_close_lodge_date_closed_uidx
  on public.night_audit_close (lodge_id, business_date)
  where status = 'closed';

create or replace function public.run_night_audit_checks(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := current_date;
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

drop function if exists public.close_night_audit(uuid, uuid, text);
drop function if exists public.close_night_audit(uuid, uuid, text, boolean);

create or replace function public.close_night_audit(
  p_lodge_id uuid,
  p_closed_by uuid,
  p_notes text default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_checks jsonb;
  v_close_id uuid;
  v_today date := current_date;
  v_prev_business_date date;
  v_next_business_date date;
  v_exception jsonb;
  v_has_critical boolean := false;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['owner', 'admin', 'manager', 'super_admin', 'night_audit']
  );

  if exists (
    select 1 from public.night_audit_close
    where lodge_id = p_lodge_id and business_date = v_today and status = 'closed'
  ) then
    return jsonb_build_object('success', false, 'error', 'Business date already closed', 'code', 'already_closed');
  end if;

  select business_date into v_prev_business_date
  from public.night_audit_close
  where lodge_id = p_lodge_id and status = 'closed'
  order by business_date desc
  limit 1;

  v_next_business_date := v_today + 1;
  v_checks := public.run_night_audit_checks(p_lodge_id);

  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_checks->'exceptions', '[]'::jsonb)) e
    where e.value->>'severity' = 'critical'
  ) into v_has_critical;

  if v_has_critical and not coalesce(p_force, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'Critical exceptions block night audit close',
      'checks', v_checks
    );
  end if;

  -- Soft-mark overdue confirmed arrivals as no_show for audit cleanliness
  update public.bookings
     set status = 'no_show',
         updated_at = now(),
         notes = coalesce(notes, '') || E'\n[NIGHT_AUDIT] Marked no-show on ' || v_today::text
   where lodge_id = p_lodge_id
     and check_in < v_today
     and status in ('confirmed', 'pending');

  v_close_id := gen_random_uuid();
  insert into public.night_audit_close (
    id, lodge_id, business_date, closed_by, status, exceptions, notes,
    audit_pack, previous_business_date, next_business_date
  ) values (
    v_close_id, p_lodge_id, v_today, p_closed_by, 'closed',
    coalesce(v_checks->'exceptions', '[]'::jsonb),
    p_notes,
    v_checks,
    v_prev_business_date,
    v_next_business_date
  );

  for v_exception in
    select value from jsonb_array_elements(coalesce(v_checks->'exceptions', '[]'::jsonb))
  loop
    insert into public.night_audit_exceptions (
      close_id, exception_type, description, severity
    ) values (
      v_close_id,
      coalesce(v_exception->>'exception_type', 'unknown'),
      coalesce(v_exception->>'description', ''),
      coalesce(v_exception->>'severity', 'warning')
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'close_id', v_close_id,
    'date', v_today,
    'next_business_date', v_next_business_date,
    'checks', v_checks
  );
end;
$$;

create or replace function public.get_night_audit_summary(
  p_lodge_id uuid,
  p_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_close jsonb;
  v_stats jsonb;
  v_live jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['owner', 'admin', 'manager', 'super_admin', 'receptionist', 'finance', 'night_audit']
  );

  select to_jsonb(nac) into v_close
  from public.night_audit_close nac
  where nac.lodge_id = p_lodge_id
    and nac.business_date = p_date
  order by nac.created_at desc
  limit 1;

  v_live := public.run_night_audit_checks(p_lodge_id);

  select jsonb_build_object(
    'open_folios', coalesce((v_live->>'in_house')::int, 0),
    'open_hotel_folios', coalesce((v_live->>'open_hotel_folios')::int, 0),
    'outstanding_balance', coalesce((v_live->>'unpaid_balances')::numeric, 0),
    'arrivals_today', coalesce((v_live->>'arrivals')::int, 0),
    'departures_today', coalesce((v_live->>'departures')::int, 0),
    'in_house', coalesce((v_live->>'in_house')::int, 0),
    'dirty_rooms', coalesce((v_live->>'dirty_rooms')::int, 0),
    'exceptions', coalesce(v_live->'exceptions', '[]'::jsonb)
  ) into v_stats;

  return jsonb_build_object(
    'success', true,
    'close', v_close,
    'stats', v_stats,
    'live_checks', v_live
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Corporate settlement: charge links booking + optional guest bill payment
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.charge_to_corporate_account(uuid, uuid, uuid, numeric, text);
drop function if exists public.charge_to_corporate_account(uuid, uuid, uuid, numeric, text, boolean);

create or replace function public.charge_to_corporate_account(
  p_account_id uuid,
  p_lodge_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_description text default '',
  p_settle_booking boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invoice_number text;
  v_invoice_id uuid;
  v_corp public.corporate_accounts%rowtype;
  v_booking public.bookings%rowtype;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_balance numeric;
  v_payment_id uuid;
  v_terms integer;
  v_settle numeric;
  v_folio_id uuid;
  v_folio_balance numeric;
  v_credit jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'finance']);

  select * into v_corp
  from public.corporate_accounts
  where id = p_account_id and lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Corporate account not found');
  end if;
  if lower(coalesce(v_corp.status, '')) = 'suspended' then
    return jsonb_build_object('success', false, 'error', 'Corporate account is suspended');
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and lodge_id = p_lodge_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_balance := greatest(
    0,
    coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0) - coalesce(v_booking.amount_paid, 0)
  );

  if v_amount <= 0 then
    v_amount := v_balance;
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'No amount to charge');
  end if;

  if coalesce(v_corp.credit_limit, 0) > 0 then
    v_credit := public.check_credit_limit_with_pending(p_account_id, p_lodge_id, v_amount);
    if not coalesce((v_credit->>'within_limit')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'Charge would exceed corporate credit limit', 'credit', v_credit);
    end if;
  end if;

  v_terms := greatest(coalesce(v_corp.payment_terms_days, 30), 0);
  v_invoice_number := 'CINV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(
    (select count(*) + 1 from public.corporate_invoice_items where lodge_id = p_lodge_id)::text,
    4, '0'
  );
  v_invoice_id := gen_random_uuid();

  insert into public.corporate_invoice_items (
    id, corporate_account_id, lodge_id, invoice_number, description,
    amount, tax_amount, issue_date, due_date, status, reference_booking_ids
  ) values (
    v_invoice_id, p_account_id, p_lodge_id, v_invoice_number,
    coalesce(nullif(p_description, ''), 'Company charge for booking ' || left(p_booking_id::text, 8)),
    v_amount, 0, current_date,
    current_date + v_terms, 'sent',
    array[p_booking_id]
  );

  update public.bookings
     set corporate_account_id = p_account_id,
         updated_at = now()
   where id = p_booking_id and lodge_id = p_lodge_id;

  if coalesce(p_settle_booking, true) and v_amount > 0 then
    v_settle := least(v_amount, v_balance);
    v_payment_id := gen_random_uuid();

    insert into public.payments (
      id, booking_id, lodge_id, amount, method, type, paid_at, notes
    ) values (
      v_payment_id,
      p_booking_id,
      p_lodge_id,
      v_settle,
      'corporate',
      'payment',
      now(),
      'Corporate invoice ' || v_invoice_number
    );

    update public.bookings b
       set amount_paid = coalesce(b.amount_paid, 0) + v_settle,
           payment_status = case
             when coalesce(b.amount_paid, 0) + v_settle
                  >= coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0)
                  and coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) > 0
               then 'paid'
             when coalesce(b.amount_paid, 0) + v_settle > 0 then 'partial'
             else 'unpaid'
           end,
           payment_method = 'corporate',
           updated_at = now()
     where b.id = p_booking_id and b.lodge_id = p_lodge_id;

    if to_regclass('public.hotel_folios') is not null then
      select hf.id, hf.balance
        into v_folio_id, v_folio_balance
      from public.hotel_folios hf
      where hf.lodge_id = p_lodge_id
        and hf.booking_id = p_booking_id
        and hf.status = 'open'
        and coalesce(hf.balance, 0) > 0
      order by hf.created_at
      limit 1;

      if v_folio_id is not null and coalesce(v_folio_balance, 0) > 0 then
        perform public.add_folio_payment(
          p_lodge_id,
          v_folio_id,
          least(v_settle, v_folio_balance),
          'Corporate invoice ' || v_invoice_number
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', v_amount,
    'due_date', current_date + v_terms,
    'booking_id', p_booking_id,
    'settled_booking', coalesce(p_settle_booking, true),
    'payment_id', v_payment_id
  );
end;
$$;

grant execute on function public.room_booking_expected_total(uuid, uuid, date, date) to anon, authenticated, service_role;
grant execute on function public.room_booking_expected_total(uuid, uuid, date, date, uuid) to anon, authenticated, service_role;
grant execute on function public.quote_room_stay(uuid, uuid, date, date, uuid) to authenticated, service_role;
grant execute on function public.run_night_audit_checks(uuid) to authenticated, service_role;
grant execute on function public.close_night_audit(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.get_night_audit_summary(uuid, date) to authenticated, service_role;
-- Single function with DEFAULT args; PostgreSQL only creates the full (…, text, boolean) signature.
grant execute on function public.charge_to_corporate_account(uuid, uuid, uuid, numeric, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
