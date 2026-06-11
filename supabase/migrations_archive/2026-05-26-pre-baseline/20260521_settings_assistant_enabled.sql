alter table public.settings
  add column if not exists assistant_enabled boolean not null default false;
