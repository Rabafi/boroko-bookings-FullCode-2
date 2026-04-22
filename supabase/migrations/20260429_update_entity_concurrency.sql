-- Migration: 20260429_update_entity_concurrency
-- Adds p_expected_updated_at optimistic concurrency guard to update_customer,
-- update_room, and update_quotation. Pattern follows update_booking_status in
-- 20260426_financial_integrity_followups.sql.

create or replace function public.update_customer(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_record public.customers%rowtype;
  v_updated uuid;
begin
  select * into v_record
    from public.customers
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  -- Optimistic concurrency guard
  if p_expected_updated_at is not null and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  update public.customers
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    email = case when payload ? 'email' then coalesce(payload->>'email', '') else email end,
    phone = case when payload ? 'phone' then coalesce(payload->>'phone', '') else phone end,
    id_number = case when payload ? 'id_number' then coalesce(payload->>'id_number', '') else id_number end,
    nationality = case when payload ? 'nationality' then coalesce(payload->>'nationality', '') else nationality end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_customer(uuid, uuid, jsonb, timestamptz) to anon, authenticated;

create or replace function public.update_room(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_record public.rooms%rowtype;
  v_updated uuid;
begin
  select * into v_record
    from public.rooms
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  -- Optimistic concurrency guard
  if p_expected_updated_at is not null and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  update public.rooms
  set
    room_number = case when payload ? 'room_number' then payload->>'room_number' else room_number end,
    room_type = case when payload ? 'room_type' then payload->>'room_type' else room_type end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end,
    max_occupancy = case when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, 2) else max_occupancy end,
    status = case when payload ? 'status' then coalesce(payload->>'status', 'available') else status end,
    description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_room(uuid, uuid, jsonb, timestamptz) to anon, authenticated;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_record public.quotations%rowtype;
  v_updated uuid;
begin
  select * into v_record
    from public.quotations
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  -- Optimistic concurrency guard
  if p_expected_updated_at is not null and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  update public.quotations
  set
    customer_id = case when payload ? 'customer_id' then nullif(payload->>'customer_id', '')::uuid else customer_id end,
    customer_name = case when payload ? 'customer_name' then coalesce(payload->>'customer_name', '') else customer_name end,
    customer_phone = case when payload ? 'customer_phone' then coalesce(payload->>'customer_phone', '') else customer_phone end,
    room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
    room_name = case when payload ? 'room_name' then coalesce(payload->>'room_name', '') else room_name end,
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
    updated_at = case when payload ? 'updated_at' then coalesce((payload->>'updated_at')::timestamptz, now()) else now() end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_quotation(uuid, uuid, jsonb, timestamptz) to anon, authenticated;
