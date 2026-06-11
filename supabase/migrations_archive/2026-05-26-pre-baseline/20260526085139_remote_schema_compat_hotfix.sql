begin;

drop index if exists public.users_pwa_lookup_idx;
drop index if exists public.users_lodge_email_lookup_idx;

alter table public.users
  add column if not exists status text not null default 'active',
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists last_desktop_sign_in_at timestamptz,
  add column if not exists last_pwa_sign_in_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists password_updated_at timestamptz,
  add column if not exists capability_overrides jsonb not null default '{}'::jsonb;

update public.users
   set status = 'active'
 where status is null
    or status not in ('active', 'suspended', 'archived');

alter table public.users
  drop constraint if exists users_status_check;

alter table public.users
  add constraint users_status_check
  check (status in ('active', 'suspended', 'archived'));

alter table public.settings
  add column if not exists assistant_enabled boolean not null default false,
  add column if not exists lodge_mesh_secret text;

alter table public.licenses
  alter column lodge_id type uuid
  using case
    when coalesce(lodge_id::text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then lodge_id::text::uuid
    else null
  end;

create index if not exists users_lodge_email_lookup_idx
  on public.users (lodge_id, lower(btrim(email::text)));

create index if not exists users_pwa_lookup_idx
  on public.users (lower(btrim(email::text)), lodge_id, role);

commit;
