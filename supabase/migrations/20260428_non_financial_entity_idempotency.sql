-- Migration: 20260428_non_financial_entity_idempotency
-- Adds id-based idempotency to create_customer, create_room, create_user.
-- Replay after ACK loss returns the existing row rather than inserting a duplicate.

create or replace function public.create_customer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  -- Idempotency: replay after ACK loss returns existing row rather than inserting duplicate
  if exists (select 1 from public.customers where id = (payload->>'id')::uuid and lodge_id = (payload->>'lodge_id')::uuid) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  insert into public.customers (
    id,
    lodge_id,
    name,
    email,
    phone,
    id_number,
    nationality
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'email', ''),
    coalesce(payload->>'phone', ''),
    coalesce(payload->>'id_number', ''),
    coalesce(payload->>'nationality', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_customer(jsonb) to anon, authenticated;

create or replace function public.create_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  -- Idempotency: replay after ACK loss returns existing row rather than inserting duplicate
  if exists (select 1 from public.rooms where id = (payload->>'id')::uuid and lodge_id = (payload->>'lodge_id')::uuid) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  insert into public.rooms (
    id,
    lodge_id,
    room_number,
    room_type,
    rate_per_night,
    max_occupancy,
    status,
    description
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'room_number',
    payload->>'room_type',
    coalesce((payload->>'rate_per_night')::numeric, 0),
    coalesce((payload->>'max_occupancy')::integer, 2),
    coalesce(payload->>'status', 'available'),
    coalesce(payload->>'description', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_room(jsonb) to anon, authenticated;

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_email text;
begin
  v_email := lower(btrim(coalesce(payload->>'email', '')));

  -- Idempotency: replay after ACK loss returns existing row rather than inserting duplicate
  if exists (select 1 from public.users where id = (payload->>'id')::uuid and lodge_id = (payload->>'lodge_id')::uuid) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  if exists (
    select 1
    from public.users
    where lodge_id = (payload->>'lodge_id')::uuid
      and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;

  insert into public.users (
    id,
    lodge_id,
    name,
    email,
    password_hash,
    role
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    coalesce(payload->>'role', 'receptionist')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_user(jsonb) to anon, authenticated;
