create or replace function public.app_session_ttl(p_session_type text)
returns interval
language sql
immutable
as $$
  select case
    when lower(coalesce(btrim(p_session_type), '')) = 'pwa' then interval '365 days'
    else interval '7 days'
  end;
$$;

create or replace function public.refresh_pwa_app_session(p_session_token text default null::text)
returns table (
  contract_version integer,
  authenticated boolean,
  session_type text,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := public.app_request_session_token(p_session_token);
  v_session public.app_sessions%rowtype;
  v_expires_at timestamptz;
begin
  if v_token is null then
    return;
  end if;

  select s.*
    into v_session
    from public.app_sessions s
    join public.users u
      on u.id = s.user_id
     and u.lodge_id = s.lodge_id
    left join lateral (
      select public.get_lodge_entitlement(s.lodge_id) as entitlement
    ) ent on true
   where s.token_hash = public.app_hash_token(v_token)
     and s.revoked_at is null
     and s.session_type = 'pwa'
     and s.created_at > now() - interval '365 days'
     and public._is_pwa_role_eligible(u.role)
     and coalesce(u.pwa_enabled, false) = true
     and coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) = true
   limit 1;

  if v_session.id is null then
    return;
  end if;

  v_expires_at := now() + public.app_session_ttl('pwa');

  update public.app_sessions
     set expires_at = v_expires_at,
         last_seen_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('trusted_device_refreshed_at', now())
   where app_sessions.id = v_session.id;

  return query
  select
    2 as contract_version,
    true as authenticated,
    'pwa'::text as session_type,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
    v_token as session_token,
    v_expires_at as session_expires_at
  from public.users u
  left join lateral (
    select settings.lodge_name, settings.company_name
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(u.lodge_id) as entitlement
  ) ent on true
  where u.id = v_session.user_id
    and u.lodge_id = v_session.lodge_id
  limit 1;
end;
$$;

update public.app_sessions
   set expires_at = greatest(expires_at, now() + public.app_session_ttl('pwa')),
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('trusted_device_extended_at', now())
 where session_type = 'pwa'
   and revoked_at is null
   and created_at > now() - interval '365 days';

grant execute on function public.app_session_ttl(text) to anon, authenticated, service_role;
grant execute on function public.refresh_pwa_app_session(text) to anon, authenticated, service_role;
