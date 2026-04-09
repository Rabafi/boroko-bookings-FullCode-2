begin;

create or replace function public.handle_pgrst_request()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_token text;
  v_session public.app_sessions;
begin
  v_token := coalesce(
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session', '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token', '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session', '')), ''),
    ''
  );

  perform set_config('app.session_token', v_token, true);
  perform set_config('app.actor_id', '', true);

  if v_token <> '' then
    v_session := public.app_current_session_row(v_token);
    if v_session.id is not null and v_session.user_id is not null then
      perform set_config('app.actor_id', v_session.user_id::text, true);
    end if;
  end if;
end;
$function$;

revoke all on function public.handle_pgrst_request() from public, anon, authenticated;
grant execute on function public.handle_pgrst_request() to authenticator;

notify pgrst, 'reload schema';

commit;
