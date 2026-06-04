create table if not exists public.day_use_config (
  lodge_id uuid primary key references public.settings(lodge_id) on delete cascade,
  templates jsonb not null default '[]'::jsonb,
  resources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  has_templates boolean;
  has_resources boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'day_use_templates'
  ) into has_templates;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'day_use_resources'
  ) into has_resources;

  if has_templates or has_resources then
    execute format(
      $sql$
        insert into public.day_use_config (lodge_id, templates, resources, created_at, updated_at)
        select
          lodge_id,
          %s,
          %s,
          now(),
          coalesce(updated_at, now())
        from public.settings
        where lodge_id is not null
          and (%s <> '[]'::jsonb or %s <> '[]'::jsonb)
        on conflict (lodge_id) do update
        set
          templates = excluded.templates,
          resources = excluded.resources,
          updated_at = now()
      $sql$,
      case when has_templates then 'coalesce(day_use_templates, ''[]''::jsonb)' else '''[]''::jsonb' end,
      case when has_resources then 'coalesce(day_use_resources, ''[]''::jsonb)' else '''[]''::jsonb' end,
      case when has_templates then 'coalesce(day_use_templates, ''[]''::jsonb)' else '''[]''::jsonb' end,
      case when has_resources then 'coalesce(day_use_resources, ''[]''::jsonb)' else '''[]''::jsonb' end
    );
  end if;
end $$;

alter table public.day_use_config enable row level security;

drop policy if exists day_use_config_lodge_scope_select on public.day_use_config;
create policy day_use_config_lodge_scope_select
  on public.day_use_config
  for select
  using (public.app_lodge_access(lodge_id));

drop policy if exists day_use_config_lodge_scope_insert on public.day_use_config;
create policy day_use_config_lodge_scope_insert
  on public.day_use_config
  for insert
  with check (public.app_lodge_access(lodge_id));

drop policy if exists day_use_config_lodge_scope_update on public.day_use_config;
create policy day_use_config_lodge_scope_update
  on public.day_use_config
  for update
  using (public.app_lodge_access(lodge_id))
  with check (public.app_lodge_access(lodge_id));

grant select, insert, update on table public.day_use_config to anon, authenticated;
