begin;

alter table public.users add column if not exists pin_hash text;

create table if not exists public.pos_override_log (
  id            uuid        primary key default gen_random_uuid(),
  lodge_id      uuid        not null,
  order_id      uuid,
  action        text        not null default 'void',
  requested_by  uuid,
  approved_by   uuid,
  reason        text,
  outlet_id     uuid,
  created_at    timestamptz not null default now()
);

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id         uuid;
  v_email      text;
  v_outlet_ids uuid[];
begin
  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1
      from public.users
     where lodge_id = (payload->>'lodge_id')::uuid
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object(
      'success', false,
      'error',   format('A user with the email "%s" already exists in this lodge.', v_email)
    );
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if lower(coalesce(payload->>'role', 'receptionist')) in ('cashier', 'supervisor')
     and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  insert into public.users (
    id,
    lodge_id,
    name,
    email,
    password_hash,
    role,
    allowed_outlet_ids,
    pin_hash
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    coalesce(payload->>'role', 'receptionist'),
    v_outlet_ids,
    nullif(payload->>'pin_hash', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_user(jsonb) to anon, authenticated;

create or replace function public.update_user_profile(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated         uuid;
  v_email           text;
  v_outlet_ids      uuid[];
  v_current_role    text;
  v_current_outlets uuid[];
  v_pin_hash        text;
begin
  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1 from public.users
       where lodge_id = p_lodge_id
         and lower(btrim(email)) = v_email
         and id <> p_id
    ) then
      return jsonb_build_object(
        'success', false,
        'error',   format('A user with the email "%s" already exists.', v_email)
      );
    end if;
  end if;

  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[])
      into v_outlet_ids
      from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;
  end if;

  select role, allowed_outlet_ids
    into v_current_role, v_current_outlets
    from public.users
   where id = p_id and lodge_id = p_lodge_id;

  if lower(coalesce(nullif(payload->>'role', ''), v_current_role, '')) in ('cashier', 'supervisor')
     and cardinality(coalesce(
           case when payload ? 'allowed_outlet_ids' then v_outlet_ids
                else v_current_outlets
           end,
           '{}'::uuid[]
         )) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  if payload ? 'pin_hash' then
    v_pin_hash := nullif(payload->>'pin_hash', '');
  end if;

  update public.users
     set name = coalesce(nullif(payload->>'name', ''), name),
         email = coalesce(v_email, email),
         role = coalesce(nullif(payload->>'role', ''), role),
         pin_hash = case when payload ? 'pin_hash' then v_pin_hash else pin_hash end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if payload ? 'allowed_outlet_ids' then
    update public.users
       set allowed_outlet_ids = v_outlet_ids
     where id = p_id
       and lodge_id = p_lodge_id;
  end if;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_user_profile(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id     uuid := (payload->>'order_id')::uuid;
  v_lodge_id     uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by  uuid := nullif(payload->>'approved_by', '')::uuid;
  v_reason       text := nullif(payload->>'reason', '');
  v_outlet_id    uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_status       text;
begin
  select status
    into v_status
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  insert into public.pos_override_log (
    lodge_id,
    order_id,
    action,
    requested_by,
    approved_by,
    reason,
    outlet_id
  ) values (
    v_lodge_id,
    v_order_id,
    'void',
    v_requested_by,
    v_approved_by,
    v_reason,
    v_outlet_id
  );

  return jsonb_build_object('success', true, 'id', v_order_id);
end;
$function$;

grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated;

commit;
