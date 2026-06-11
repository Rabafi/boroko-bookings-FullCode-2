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

create or replace function public.update_user_profile(
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
  v_email text;
begin
  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1
      from public.users
      where lodge_id = p_lodge_id
        and id <> p_id
        and lower(btrim(email)) = v_email
    ) then
      return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
    end if;
  end if;

  update public.users
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    email = case when payload ? 'email' then v_email else email end,
    role = case when payload ? 'role' then payload->>'role' else role end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_user_profile(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.set_user_password(
  p_id uuid,
  p_lodge_id uuid,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.users
  set password_hash = p_password_hash
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.set_user_password(uuid, uuid, text) to anon, authenticated;

create or replace function public.delete_user(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  delete from public.users
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_user(uuid, uuid) to anon, authenticated;
