begin;

create or replace function public.authenticate_user(
  p_email text,
  p_lodge_id uuid,
  p_password text default null,
  p_session_type text default 'desktop'
)
returns table (
  contract_version integer,
  found boolean,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  created_at timestamptz,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_user public.users%rowtype;
  v_password text := nullif(coalesce(p_password, ''), '');
  v_session_token text := null;
  v_session_expires_at timestamptz := null;
begin
  select *
    into v_user
    from public.users u
   where lower(btrim(u.email)) = lower(btrim(p_email))
     and u.lodge_id = p_lodge_id
   limit 1;

  if v_user.id is null then
    return query
    select
      2 as contract_version,
      false as found,
      false as authenticated,
      null::uuid,
      ''::text,
      lower(btrim(p_email)) as email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
    return;
  end if;

  if v_password is not null
     and nullif(coalesce(v_user.password_hash, ''), '') is not null
     and extensions.crypt(v_password, v_user.password_hash) = v_user.password_hash then
    select issued.session_token, issued.session_expires_at
      into v_session_token, v_session_expires_at
      from public.issue_app_session(
        v_user.id,
        v_user.lodge_id,
        v_user.role,
        p_session_type,
        jsonb_build_object('email', lower(btrim(v_user.email)))
      ) as issued(session_token, session_expires_at);
  end if;

  return query
  select
    2 as contract_version,
    true as found,
    v_session_token is not null as authenticated,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)) as email,
    v_user.role,
    v_user.lodge_id,
    v_user.created_at,
    v_session_token,
    v_session_expires_at;
end;
$function$;

revoke all on function public.authenticate_user(text, uuid, text, text) from public;
grant execute on function public.authenticate_user(text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
