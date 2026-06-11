create or replace function public.authenticate_user_for_device(
  p_email text,
  p_password text,
  p_session_type text default 'desktop'
)
returns table(
  contract_version integer,
  found boolean,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  created_at timestamp with time zone,
  session_token text,
  session_expires_at timestamp with time zone,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_password text := nullif(coalesce(p_password, ''), '');
  v_user public.users%rowtype;
  v_match_count integer := 0;
  v_session_token text := null;
  v_session_expires_at timestamptz := null;
begin
  if v_email = '' or v_password is null then
    return query
    select 2, false, false, null::uuid, ''::text, v_email, null::text, null::uuid, null::timestamptz, null::text, null::timestamptz, 'missing_credentials'::text;
    return;
  end if;

  select count(*)
    into v_match_count
  from public.users u
  where lower(btrim(u.email)) = v_email
    and coalesce(u.status, 'active') = 'active'
    and nullif(coalesce(u.password_hash, ''), '') is not null
    and extensions.crypt(v_password, u.password_hash) = u.password_hash;

  if v_match_count = 0 then
    return query
    select 2, false, false, null::uuid, ''::text, v_email, null::text, null::uuid, null::timestamptz, null::text, null::timestamptz, 'not_found_or_wrong_password'::text;
    return;
  end if;

  if v_match_count > 1 then
    return query
    select 2, true, false, null::uuid, ''::text, v_email, null::text, null::uuid, null::timestamptz, null::text, null::timestamptz, 'ambiguous_lodge'::text;
    return;
  end if;

  select *
    into v_user
  from public.users u
  where lower(btrim(u.email)) = v_email
    and coalesce(u.status, 'active') = 'active'
    and nullif(coalesce(u.password_hash, ''), '') is not null
    and extensions.crypt(v_password, u.password_hash) = u.password_hash
  limit 1;

  select s.session_token, s.session_expires_at
    into v_session_token, v_session_expires_at
  from public.issue_app_session(
    v_user.id,
    v_user.lodge_id,
    v_user.role,
    coalesce(nullif(lower(btrim(p_session_type)), ''), 'desktop'),
    jsonb_build_object('email', lower(btrim(v_user.email)), 'device_bootstrap', true)
  ) as s;

  return query
  select
    2,
    true,
    v_session_token is not null,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)),
    lower(btrim(v_user.role)),
    v_user.lodge_id,
    v_user.created_at,
    v_session_token,
    v_session_expires_at,
    'ok'::text;
end;
$$;
