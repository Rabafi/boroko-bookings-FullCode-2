begin;

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_email text;
  v_outlet_ids uuid[];
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_role text := coalesce(payload->>'role', 'receptionist');
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(payload->>'pwa_password_hash', '');
  v_pwa_disabled_reason text := nullif(payload->>'pwa_disabled_reason', '');
  v_pwa_password_reset_by uuid := nullif(payload->>'pwa_password_reset_by', '')::uuid;
begin
  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
  ) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'manager', 'super_admin']);
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object(
      'success', false,
      'error', format('A user with the email "%s" already exists in this lodge.', v_email)
    );
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if lower(v_role) in ('cashier', 'supervisor')
     and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object(
      'success', false,
      'error', 'Only Manager and Admin roles can receive Manager PWA access.'
    );
  end if;

  if v_pwa_enabled and v_pwa_password_hash is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Set a separate Manager PWA password before enabling mobile access.'
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
    pin_hash,
    pwa_enabled,
    pwa_password_hash,
    pwa_password_set_at,
    pwa_password_reset_by,
    pwa_disabled_reason
  ) values (
    (payload->>'id')::uuid,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    v_role,
    v_outlet_ids,
    nullif(payload->>'pin_hash', ''),
    v_pwa_enabled,
    v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case when v_pwa_password_hash is not null then v_pwa_password_reset_by else null end,
    case
      when v_pwa_enabled then null
      else coalesce(v_pwa_disabled_reason, 'Manager PWA access has been turned off.')
    end
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_user(jsonb) from public;
grant execute on function public.create_user(jsonb) to anon, authenticated;

commit;
