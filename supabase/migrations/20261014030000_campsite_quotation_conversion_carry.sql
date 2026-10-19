-- LodgingOS campsite quotation conversion carry (single-line + multi-room match).
--
-- Gap repaired (independent review BLOCKING-1): a single accommodation line
-- pointing at a campsite converted through convert_quotation_to_booking while
-- silently dropping tents/vehicles (booking kept 0/0, no accommodation_kind,
-- no details row, no server rate verification). Multi-room conversion had the
-- mirror defect: the quotation/request comparison forced tents/vehicles to 0
-- on the quotation side, so any nonzero campsite occupancy was rejected with
-- quotation_group_mismatch instead of converting.
--
-- After this migration:
-- - create_multi_room_booking compares actual tents/vehicles from the accepted
--   quotation lines against the requested rooms (matching values proceed
--   through the per-line campsite pricing contract; mismatches still reject).
-- - convert_quotation_to_booking_pre_intent_v1 carries a lone campsite line
--   (tents/vehicles/adults/children) into the booking row, stamps
--   accommodation_kind='campsite', persists booking_accommodation_details, and
--   requires the quoted total to match the server campsite rate within 0.01
--   (fail closed with a re-quote repair path). Room quotations, event
--   quotations and legacy rows without lines keep byte-identical behavior.
-- - The intent-envelope wrapper (convert_quotation_to_booking) and its
--   receipt checks are untouched; deposit, invoice and quotation-link
--   verification keep working because the inner booking/invoice/quotation
--   rows are still written in the same transaction.
--
-- Room-only, event, tax and deposit semantics are unchanged. No client payload
-- changes: the desktop offline queue keeps calling convert_quotation_to_booking
-- with the same parameters (the server reads occupancy from the quotation row).

begin;

-- ── Part A: multi-room quotation/request comparison carries occupancy ──────
-- The quotation-side aggregation hard-codes tents/vehicles to 0 while the
-- request side carries actual values, so any nonzero campsite occupancy can
-- never compare equal. Patch the single zero-fill site (assert uniqueness so
-- a future edit fails loudly instead of patching the wrong expression).
do $$
declare
  v_def text;
  v_target text := E'''tents'',0,''vehicles'',0';
  v_replacement text := E'''tents'',greatest(coalesce(nullif(btrim(x.value->>''tents''),''''),''0'')::integer,0),\n          ''vehicles'',greatest(coalesce(nullif(btrim(x.value->>''vehicles''),''''),''0'')::integer,0)';
  v_occurrences integer;
begin
  select pg_get_functiondef(
    'public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)'::regprocedure
  ) into v_def;
  if v_def is null then
    raise exception 'create_multi_room_booking(...) is missing; apply the booking intent migrations in order';
  end if;
  v_occurrences := (length(v_def) - length(replace(v_def, v_target, ''))) / length(v_target);
  if v_occurrences <> 1 then
    raise exception 'campsite quotation carry patch expects exactly one tents/vehicles zero-fill, found %', v_occurrences;
  end if;
  v_def := replace(v_def, v_target, v_replacement);
  if position('v_quotation_rooms' in v_def) = 0 then
    raise exception 'patched multi-room function lost its quotation comparison';
  end if;
  execute v_def;
end $$;

-- ── Part B: single-line campsite carry in the conversion inner function ────
-- Full replacement of the service-role-only inner function. The public
-- envelope wrapper keeps its signature, grants and receipt checks.
create or replace function public.convert_quotation_to_booking_pre_intent_v1(
  p_quotation_id uuid,
  p_lodge_id uuid,
  p_deposit_amount numeric default 0,
  p_payment_method text default 'cash',
  p_created_by uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotations%rowtype;
  v_booking_id uuid;
  v_room_id uuid;
  v_room public.rooms%rowtype;
  v_room_count integer := 0;
  v_inv_number text;
  v_dep_result jsonb;
  v_max_occupancy integer;
  v_is_event boolean;
  v_booking_notes text;
  -- Single-line campsite carry (see header): all default off so legacy rows
  -- keep the exact legacy insert below.
  v_line_count integer := 0;
  v_single_line jsonb;
  v_is_campsite boolean := false;
  v_line_adults integer;
  v_line_children integer;
  v_line_tents integer;
  v_line_vehicles integer;
  v_expected numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select *
    into v_q
    from public.quotations
   where id = p_quotation_id
     and lodge_id = p_lodge_id
    for update;

  if not found then
    raise exception 'Quotation not found';
  end if;

  if v_q.status = 'converted' and v_q.converted_booking_id is not null then
    select b.invoice_number
      into v_inv_number
      from public.bookings b
     where b.id = v_q.converted_booking_id
       and b.lodge_id = p_lodge_id;

    return json_build_object(
      'success', true,
      'booking_id', v_q.converted_booking_id,
      'invoice_number', v_inv_number,
      'idempotent', true,
      'booking_type', v_q.quotation_type
    );
  end if;

  if v_q.status in ('converted', 'cancelled') then
    raise exception 'Quotation is already % and cannot be converted', v_q.status;
  end if;

  if v_q.status not in ('sent', 'accepted') then
    raise exception 'Quotation must be sent or accepted before conversion';
  end if;

  if v_q.check_in is null
     or v_q.check_out is null
     or v_q.check_out <= v_q.check_in then
    raise exception 'Valid check-in and check-out dates are required before conversion';
  end if;

  if coalesce(p_deposit_amount, 0) < 0 then
    raise exception 'Deposit amount cannot be negative';
  end if;

  if coalesce(p_deposit_amount, 0) > 0
     and nullif(btrim(coalesce(p_payment_method, '')), '') is null then
    raise exception 'Payment method is required when deposit amount is provided';
  end if;

  v_is_event := v_q.quotation_type = 'exclusive_event';

  -- This is the same lock used by the booking overlap trigger.
  perform pg_advisory_xact_lock(
    hashtextextended('booking-overlap:' || p_lodge_id::text, 0)
  );

  if v_is_event then
    if nullif(btrim(coalesce(v_q.event_name, '')), '') is null
       or v_q.check_in is null
       or v_q.check_out is null
       or coalesce(v_q.event_daily_rate, 0) <= 0 then
      raise exception 'Event / lodge quotation details are incomplete';
    end if;

    select count(*)
      into v_room_count
      from public.rooms r
     where r.lodge_id = p_lodge_id
       and coalesce(r.status, '') <> 'maintenance';

    select r.id
      into v_room_id
      from public.rooms r
     where r.lodge_id = p_lodge_id
       and coalesce(r.status, '') <> 'maintenance'
     order by r.room_number::text collate "C", r.id
     limit 1;

    if v_room_id is null or v_room_count = 0 then
      raise exception 'No rooms are available for an exclusive event booking';
    end if;

    if exists (
      select 1
        from public.bookings b
       where b.lodge_id = p_lodge_id
         and coalesce(b.status, '') <> 'cancelled'
         and b.check_in < v_q.check_out
         and b.check_out > v_q.check_in
    ) then
      raise exception 'Cannot create exclusive event: the lodge already has bookings during these dates';
    end if;

    v_booking_notes :=
      format('[GROUP:evt-quotation-%s][ROOMS:%s]', p_quotation_id, v_room_count)
      || E'\nEvent: ' || v_q.event_name
      || case when nullif(btrim(coalesce(v_q.notes, '')), '') is not null
              then E'\n' || v_q.notes
              else ''
         end;
  else
    v_room_id := v_q.room_id;
    v_booking_notes := v_q.notes;

    -- Single-line campsite carry: a lone accommodation line pointing at a
    -- campsite converts through the campsite occupancy/pricing contract.
    -- Room quotations and legacy rows without lines keep legacy behavior.
    if jsonb_typeof(v_q.accommodation_lines) = 'array' then
      select count(*)
        into v_line_count
        from jsonb_array_elements(v_q.accommodation_lines) as x(value)
       where jsonb_typeof(x.value) = 'object'
         and nullif(btrim(x.value->>'room_id'), '') is not null;
      if v_line_count = 1 then
        select x.value
          into v_single_line
          from jsonb_array_elements(v_q.accommodation_lines) as x(value)
         where jsonb_typeof(x.value) = 'object'
           and nullif(btrim(x.value->>'room_id'), '') is not null
         limit 1;
      end if;
    end if;
    if v_single_line is not null
       and (v_room_id is null
            or nullif(btrim(v_single_line->>'room_id'), '') = v_room_id::text) then
      if v_room_id is null then
        begin
          v_room_id := nullif(btrim(v_single_line->>'room_id'), '')::uuid;
        exception when invalid_text_representation then
          v_room_id := null;
        end;
      end if;
      if v_room_id is not null then
        select * into v_room from public.rooms r
         where r.id = v_room_id and r.lodge_id = p_lodge_id;
        if found
           and public._normalize_accommodation_kind(v_room.accommodation_kind) = 'campsite' then
          v_is_campsite := true;
        end if;
      end if;
      if v_is_campsite then
        if coalesce(nullif(btrim(v_single_line->>'adults'), ''), '1') !~ '^-?[0-9]+$'
            or coalesce(nullif(btrim(v_single_line->>'children'), ''), '0') !~ '^-?[0-9]+$'
            or coalesce(nullif(btrim(v_single_line->>'tents'), ''), '0') !~ '^-?[0-9]+$'
            or coalesce(nullif(btrim(v_single_line->>'vehicles'), ''), '0') !~ '^-?[0-9]+$' then
          raise exception 'The accepted quotation line occupancy must be whole numbers. Review and resend the quotation before converting.';
        end if;
        v_line_adults := greatest(
          coalesce(nullif(btrim(v_single_line->>'adults'), '')::integer, v_q.adults, 1), 1);
        v_line_children := greatest(
          coalesce(nullif(btrim(v_single_line->>'children'), '')::integer, v_q.children, 0), 0);
        v_line_tents := greatest(
          coalesce(nullif(btrim(v_single_line->>'tents'), '')::integer, 0), 0);
        v_line_vehicles := greatest(
          coalesce(nullif(btrim(v_single_line->>'vehicles'), '')::integer, 0), 0);
        if coalesce(v_q.tax_amount, 0) <> 0 then
          raise exception 'This campsite quotation carries a tax amount that single conversion cannot apply. Review the approved tax treatment, re-quote without tax, and convert again.';
        end if;
        -- Capacity and rate presence are enforced here; the failure message
        -- names the repair (set the rate or fix occupancy, then re-quote).
        v_expected := public.accommodation_booking_expected_total(
          p_lodge_id, v_room_id, v_q.check_in, v_q.check_out,
          v_line_adults, v_line_children, v_line_tents, v_line_vehicles, null
        );
        if abs(round(coalesce(v_q.total_amount, 0), 2) - round(v_expected, 2)) > 0.01 then
          raise exception 'Quotation total % does not match the campsite rate % for this occupancy. Re-quote with current rates and occupancy, then convert again.',
            round(coalesce(v_q.total_amount, 0), 2), round(v_expected, 2);
        end if;
      end if;
    end if;

    if v_room_id is not null then
      perform public.app_check_room_maintenance(p_lodge_id, v_room_id);

      -- Room-style maximum occupancy does not apply to campsites: the
      -- campsite contract above already enforced capacity_adults,
      -- capacity_children, max_tents and max_vehicles.
      if not v_is_campsite then
        select r.max_occupancy
          into v_max_occupancy
          from public.rooms r
         where r.id = v_room_id
           and r.lodge_id = p_lodge_id;

        if v_max_occupancy is not null
           and (v_q.adults + v_q.children) > v_max_occupancy then
          raise exception 'Number of guests exceeds room maximum occupancy';
        end if;
      end if;

      if exists (
        select 1
          from public.bookings b
         where b.room_id = v_room_id
           and b.lodge_id = p_lodge_id
           and coalesce(b.status, '') <> 'cancelled'
           and b.check_in < v_q.check_out
           and b.check_out > v_q.check_in
      ) then
        raise exception 'Room is not available for the requested dates';
      end if;
    end if;
  end if;

  v_inv_number := public.get_next_invoice_number(p_lodge_id);
  v_booking_id := gen_random_uuid();

  insert into public.bookings (
    id, lodge_id, room_id, customer_id,
    check_in, check_out, adults, children,
    tents_count, vehicles_count, accommodation_kind,
    total_amount, amount_paid, deposit_amount, payment_status, payment_method,
    status, invoice_number, quotation_id, created_by, notes,
    is_exclusive_event, event_daily_rate, create_idempotency_key,
    created_at, updated_at
  ) values (
    v_booking_id, p_lodge_id, v_room_id, v_q.customer_id,
    v_q.check_in, v_q.check_out,
    case when v_is_event then 1 when v_is_campsite then v_line_adults else v_q.adults end,
    case when v_is_event then 0 when v_is_campsite then v_line_children else v_q.children end,
    case when v_is_campsite then v_line_tents else 0 end,
    case when v_is_campsite then v_line_vehicles else 0 end,
    case when v_is_campsite then 'campsite' else null end,
    v_q.total_amount, 0, coalesce(p_deposit_amount, 0), 'unpaid', null,
    'confirmed', v_inv_number, p_quotation_id, p_created_by, v_booking_notes,
    v_is_event,
    case when v_is_event then v_q.event_daily_rate else null end,
    'quotation-conversion:' || p_quotation_id::text,
    now(), now()
  );

  -- Campsite occupancy evidence for reports and readiness: same snapshot
  -- shape as the direct campsite booking contract, tagged with its source.
  if v_is_campsite then
    insert into public.booking_accommodation_details (
      booking_id, lodge_id, accommodation_kind, adults, children, tents, vehicles,
      rate_mode, pricing_snapshot
    ) values (
      v_booking_id, p_lodge_id, 'campsite',
      v_line_adults, v_line_children, v_line_tents, v_line_vehicles,
      public._normalize_rate_mode(v_room.rate_mode),
      jsonb_build_object(
        'nights', v_q.check_out - v_q.check_in,
        'site_rate', v_room.rate_per_night,
        'person_rate', v_room.rate_per_person,
        'tent_rate', v_room.rate_per_tent,
        'vehicle_rate', v_room.rate_per_vehicle,
        'people', v_line_adults + v_line_children,
        'tents', v_line_tents,
        'vehicles', v_line_vehicles,
        'calculated_total', v_expected,
        'source', 'quotation_conversion',
        'quotation_id', p_quotation_id
      )
    )
    on conflict (booking_id) do update set
      adults = excluded.adults,
      children = excluded.children,
      tents = excluded.tents,
      vehicles = excluded.vehicles,
      rate_mode = excluded.rate_mode,
      pricing_snapshot = excluded.pricing_snapshot;
  end if;

  insert into public.invoices (
    booking_id, lodge_id, invoice_number, issued_at, due_date
  ) values (
    v_booking_id, p_lodge_id, v_inv_number, now(), v_q.check_in
  )
  on conflict do nothing;

  update public.quotations
     set status = 'converted',
         converted_booking_id = v_booking_id,
         updated_at = now()
   where id = p_quotation_id
     and lodge_id = p_lodge_id;

  if coalesce(p_deposit_amount, 0) > 0 then
    select public.update_booking_payment(
      v_booking_id,
      p_lodge_id,
      p_deposit_amount,
      p_payment_method,
      'deposit',
      'payment:deposit:' || v_booking_id::text,
      p_created_by
    )
    into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return json_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'invoice_number', v_inv_number,
    'booking_type', v_q.quotation_type,
    'room_count', case when v_is_event then v_room_count else null end
  );
end;
$$;

comment on function public.convert_quotation_to_booking_pre_intent_v1(uuid, uuid, numeric, text, uuid) is
  'Inner quotation conversion. A lone campsite accommodation line converts through the campsite occupancy/pricing contract (tents/vehicles carried, total verified); room, event and legacy rows keep legacy behavior.';

notify pgrst, 'reload schema';
commit;
