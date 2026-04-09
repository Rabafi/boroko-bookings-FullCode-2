create or replace function public.create_customer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
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

create or replace function public.update_customer(
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

grant execute on function public.update_customer(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.update_customer_blacklist(
  p_id uuid,
  p_lodge_id uuid,
  p_is_blacklisted boolean,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.customers
  set
    is_blacklisted = coalesce(p_is_blacklisted, false),
    blacklist_reason = case when coalesce(p_is_blacklisted, false) then coalesce(p_reason, '') else '' end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_customer_blacklist(uuid, uuid, boolean, text) to anon, authenticated;

create or replace function public.update_customer_id_photo(
  p_id uuid,
  p_lodge_id uuid,
  p_photo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.customers
  set id_photo = p_photo
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_customer_id_photo(uuid, uuid, text) to anon, authenticated;
