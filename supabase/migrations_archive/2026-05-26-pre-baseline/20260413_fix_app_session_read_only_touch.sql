-- Prevent read-only SELECT/RLS flows from failing when session lookup
-- attempts to heartbeat app_sessions.last_seen_at.
create or replace function public.app_current_session_row(p_token text default null)
returns public.app_sessions
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_token text := public.app_request_session_token(p_token);
  v_session public.app_sessions;
  v_read_only text := current_setting('transaction_read_only', true);
begin
  if v_token is null then
    return null;
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
     and s.expires_at > now()
     and (
       s.session_type <> 'pwa'
       or (
         public._is_pwa_role_eligible(u.role)
         and coalesce(u.pwa_enabled, false) = true
         and coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) = true
       )
     )
   limit 1;

  if v_session.id is not null and coalesce(v_read_only, 'off') <> 'on' then
    update public.app_sessions
       set last_seen_at = now()
     where id = v_session.id
       and last_seen_at < now() - interval '5 minutes';
  end if;

  return v_session;
end;
$function$;

