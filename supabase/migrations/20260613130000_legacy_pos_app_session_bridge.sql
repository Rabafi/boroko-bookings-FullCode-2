begin;

drop function if exists public.resolve_legacy_pos_staff_profile(uuid);

create or replace function public.resolve_legacy_pos_staff_profile(
  p_lodge_id uuid default null
)
returns table (
  id uuid,
  auth_user_id uuid,
  name text,
  email text,
  role text,
  status text,
  lodge_id uuid,
  lodge_name text,
  allowed_outlet_ids uuid[],
  pin_hash text,
  capability_overrides jsonb,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_match_count integer := 0;
begin
  if v_auth_user_id is null then
    return;
  end if;

  with candidates as (
    select u.id
    from public.users u
    where (p_lodge_id is null or u.lodge_id = p_lodge_id)
      and (
        u.auth_user_id = v_auth_user_id
        or lower(btrim(u.email)) = v_email
      )
  )
  select count(*) into v_match_count from candidates;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 and p_lodge_id is null then
    raise exception 'More than one Boroko staff profile matches this Supabase account. Ask an administrator to link this POS login to the correct lodge.';
  end if;

  update public.users u
     set auth_user_id = v_auth_user_id,
         last_desktop_sign_in_at = now(),
         last_sign_in_at = now(),
         last_activity_at = now()
   where (p_lodge_id is null or u.lodge_id = p_lodge_id)
     and lower(btrim(u.email)) = v_email
     and (
       u.auth_user_id is null
       or u.auth_user_id = v_auth_user_id
     );

  return query
  select
    u.id,
    u.auth_user_id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    coalesce(lower(btrim(u.status)), 'active') as status,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name) as lodge_name,
    coalesce(u.allowed_outlet_ids, '{}'::uuid[]) as allowed_outlet_ids,
    u.pin_hash,
    coalesce(u.capability_overrides, '{}'::jsonb) as capability_overrides,
    issued.session_token,
    issued.session_expires_at
  from public.users u
  left join lateral (
    select settings.lodge_name, settings.company_name
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral public.issue_app_session(
    u.id,
    u.lodge_id,
    u.role,
    'desktop',
    jsonb_build_object(
      'email', lower(btrim(u.email)),
      'auth_user_id', v_auth_user_id,
      'app', 'legacy-pos'
    )
  ) issued on coalesce(lower(btrim(u.status)), 'active') in ('active', 'enabled')
  where (p_lodge_id is null or u.lodge_id = p_lodge_id)
    and (
      u.auth_user_id = v_auth_user_id
      or (
        lower(btrim(u.email)) = v_email
        and (
          u.auth_user_id is null
          or u.auth_user_id = v_auth_user_id
        )
      )
    )
  order by case when u.auth_user_id = v_auth_user_id then 0 else 1 end, u.created_at desc
  limit 1;
end;
$$;

revoke all on function public.resolve_legacy_pos_staff_profile(uuid) from public;
grant execute on function public.resolve_legacy_pos_staff_profile(uuid) to authenticated, service_role;

commit;
