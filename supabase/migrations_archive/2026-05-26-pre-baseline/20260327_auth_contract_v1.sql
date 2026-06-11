alter table public.users
add column if not exists lodge_id uuid;

alter table public.settings
add column if not exists lodge_id uuid;

create unique index if not exists settings_lodge_id_uidx
on public.settings (lodge_id)
where lodge_id is not null;

create index if not exists users_lodge_email_lookup_idx
on public.users (lodge_id, lower(btrim(email)));

create or replace function public.authenticate_user(
  p_email text,
  p_lodge_id uuid
)
returns table (
  contract_version integer,
  found boolean,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  created_at timestamptz,
  password_hash text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    1 as contract_version,
    true as found,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    u.role,
    u.lodge_id,
    u.created_at,
    u.password_hash
  from public.users u
  where lower(btrim(u.email)) = lower(btrim(p_email))
    and u.lodge_id = p_lodge_id
  limit 1;

  if not found then
    return query
    select
      1 as contract_version,
      false as found,
      null::uuid,
      ''::text,
      lower(btrim(p_email)) as email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text;
  end if;
end;
$$;

revoke all on function public.authenticate_user(text, uuid) from public;
grant execute on function public.authenticate_user(text, uuid) to anon, authenticated;
