begin;

-- SQL NULL must never be interpreted as an authorization success by callers
-- that use `if not app_lodge_access(...)`. Normalize every unauthenticated or
-- invalid-session result to false while preserving the service-role bypass.
create or replace function public.app_lodge_access(
  p_lodge_id uuid,
  p_token text default null::text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cached text;
begin
  if public.app_is_service_role() is true then
    return true;
  end if;
  if p_lodge_id is null then
    return false;
  end if;

  if p_token is null and current_setting('app.session_valid', true) = 'true' then
    v_cached := nullif(current_setting('app.lodge_id', true), '');
    return coalesce(v_cached is not null and v_cached::uuid = p_lodge_id, false);
  end if;

  return coalesce(public.app_current_lodge_id(p_token) = p_lodge_id, false);
end;
$function$;

notify pgrst, 'reload schema';

commit;
