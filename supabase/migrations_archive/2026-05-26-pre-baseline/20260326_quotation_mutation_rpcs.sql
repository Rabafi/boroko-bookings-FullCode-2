create or replace function public.create_quotation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (payload->>'id')::uuid;
  v_existing uuid;
begin
  select id into v_existing
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
    id,
    quotation_number,
    lodge_id,
    customer_id,
    customer_name,
    customer_phone,
    room_id,
    room_name,
    check_in,
    check_out,
    adults,
    children,
    subtotal,
    tax_amount,
    total_amount,
    currency,
    notes,
    status,
    valid_until,
    parent_quotation_id,
    created_by,
    created_at,
    updated_at
  ) values (
    v_id,
    payload->>'quotation_number',
    (payload->>'lodge_id')::uuid,
    nullif(payload->>'customer_id', '')::uuid,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'customer_phone', ''),
    nullif(payload->>'room_id', '')::uuid,
    coalesce(payload->>'room_name', ''),
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
$function$;

grant execute on function public.create_quotation(jsonb) to anon, authenticated;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
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

grant execute on function public.update_quotation(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.mark_quotation_sent(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.quotations
  set
    status = 'sent',
    updated_at = now()
  where id = p_id
    and lodge_id = p_lodge_id
    and status = 'draft'
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', true, 'id', p_id, 'noop', true);
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.mark_quotation_sent(uuid, uuid) to anon, authenticated;
