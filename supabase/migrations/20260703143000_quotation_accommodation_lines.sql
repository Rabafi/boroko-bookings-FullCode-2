-- Multi-room accommodation quotations.
-- Keeps events/full-lodge quotations separate while allowing room quotations
-- to carry several room lines before conversion to grouped accommodation bookings.

alter table public.quotations
  add column if not exists accommodation_lines jsonb;

alter table public.quotations
  drop constraint if exists quotations_accommodation_lines_array_check,
  add constraint quotations_accommodation_lines_array_check
    check (accommodation_lines is null or jsonb_typeof(accommodation_lines) = 'array');

create or replace function public.create_quotation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (payload->>'id')::uuid;
  v_existing uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    (payload->>'lodge_id')::uuid,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select id
    into v_existing
    from public.quotations
   where id = v_id
     and lodge_id = (payload->>'lodge_id')::uuid
   limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'id', v_existing,
      'quotation_number', payload->>'quotation_number',
      'idempotent', true
    );
  end if;

  insert into public.quotations (
    id, quotation_number, lodge_id, customer_id, customer_name, customer_phone,
    quotation_type, event_name, event_daily_rate,
    room_id, room_name, accommodation_lines,
    check_in, check_out, adults, children,
    subtotal, tax_amount, total_amount, currency, notes, status,
    valid_until, parent_quotation_id, created_by, created_at, updated_at
  ) values (
    v_id,
    payload->>'quotation_number',
    (payload->>'lodge_id')::uuid,
    nullif(payload->>'customer_id', '')::uuid,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'customer_phone', ''),
    coalesce(nullif(payload->>'quotation_type', ''), 'room'),
    nullif(payload->>'event_name', ''),
    nullif(payload->>'event_daily_rate', '')::numeric,
    nullif(payload->>'room_id', '')::uuid,
    coalesce(payload->>'room_name', ''),
    case when jsonb_typeof(payload->'accommodation_lines') = 'array' then payload->'accommodation_lines' else null end,
    nullif(payload->>'check_in', '')::date,
    nullif(payload->>'check_out', '')::date,
    coalesce((payload->>'adults')::integer, 1),
    coalesce((payload->>'children')::integer, 0),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'tax_amount')::numeric, 0),
    coalesce((payload->>'total_amount')::numeric, 0),
    coalesce(payload->>'currency', 'BWP'),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'status', 'draft'),
    nullif(payload->>'valid_until', '')::date,
    nullif(payload->>'parent_quotation_id', '')::uuid,
    nullif(payload->>'created_by', '')::uuid,
    coalesce((payload->>'created_at')::timestamptz, now()),
    coalesce((payload->>'updated_at')::timestamptz, now())
  );

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'quotation_number', payload->>'quotation_number'
  );
end;
$$;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.quotations%rowtype;
  v_updated uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select *
    into v_record
    from public.quotations
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  if p_expected_updated_at is not null
     and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  update public.quotations
     set customer_id = case when payload ? 'customer_id' then nullif(payload->>'customer_id', '')::uuid else customer_id end,
         customer_name = case when payload ? 'customer_name' then coalesce(payload->>'customer_name', '') else customer_name end,
         customer_phone = case when payload ? 'customer_phone' then coalesce(payload->>'customer_phone', '') else customer_phone end,
         quotation_type = case when payload ? 'quotation_type' then coalesce(nullif(payload->>'quotation_type', ''), 'room') else quotation_type end,
         event_name = case when payload ? 'event_name' then nullif(payload->>'event_name', '') else event_name end,
         event_daily_rate = case when payload ? 'event_daily_rate' then nullif(payload->>'event_daily_rate', '')::numeric else event_daily_rate end,
         room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
         room_name = case when payload ? 'room_name' then coalesce(payload->>'room_name', '') else room_name end,
         accommodation_lines = case when payload ? 'accommodation_lines' then
           case when jsonb_typeof(payload->'accommodation_lines') = 'array' then payload->'accommodation_lines' else null end
           else accommodation_lines end,
         check_in = case when payload ? 'check_in' then nullif(payload->>'check_in', '')::date else check_in end,
         check_out = case when payload ? 'check_out' then nullif(payload->>'check_out', '')::date else check_out end,
         adults = case when payload ? 'adults' then coalesce((payload->>'adults')::integer, 1) else adults end,
         children = case when payload ? 'children' then coalesce((payload->>'children')::integer, 0) else children end,
         subtotal = case when payload ? 'subtotal' then coalesce((payload->>'subtotal')::numeric, 0) else subtotal end,
         tax_amount = case when payload ? 'tax_amount' then coalesce((payload->>'tax_amount')::numeric, 0) else tax_amount end,
         total_amount = case when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0) else total_amount end,
         currency = case when payload ? 'currency' then coalesce(payload->>'currency', 'BWP') else currency end,
         notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         status = case when payload ? 'status' then payload->>'status' else status end,
         valid_until = case when payload ? 'valid_until' then nullif(payload->>'valid_until', '')::date else valid_until end,
         converted_booking_id = case when payload ? 'converted_booking_id' then nullif(payload->>'converted_booking_id', '')::uuid else converted_booking_id end,
         updated_at = case when payload ? 'updated_at' then coalesce((payload->>'updated_at')::timestamptz, now()) else now() end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

grant execute on function public.create_quotation(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_quotation(uuid, uuid, jsonb, timestamptz) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
