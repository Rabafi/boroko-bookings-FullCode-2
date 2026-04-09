begin;

create or replace function public.authenticate_manager(
  p_email text,
  p_password text default null,
  p_lodge_id uuid default null
)
returns table (
  contract_version integer,
  authenticated boolean,
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
volatile
security definer
set search_path = public
as $function$
declare
  v_match_count integer := 0;
begin
  if nullif(coalesce(p_password, ''), '') is null then
    return;
  end if;

  with candidates as (
    select
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
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
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
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select count(*)
    into v_match_count
  from candidates
  where password_ok;

  if v_match_count = 0 then
    return;
  end if;

  return query
  with candidates as (
    select
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
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
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
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select
    2 as contract_version,
    issued.session_token is not null as authenticated,
    c.id,
    c.name,
    c.email,
    c.role,
    c.lodge_id,
    c.lodge_display_name,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    issued.session_token,
    issued.session_expires_at
  from candidates c
  left join lateral (
    select
      issued_row.session_token,
      issued_row.session_expires_at
    from public.issue_app_session(
      c.id,
      c.lodge_id,
      c.role,
      'pwa',
      jsonb_build_object('email', c.email)
    ) as issued_row(session_token, session_expires_at)
    where c.password_ok
      and c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
  where c.password_ok
  order by c.lodge_display_name;
end;
$function$;

revoke all on function public.authenticate_manager(text, text, uuid) from public;
grant execute on function public.authenticate_manager(text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
