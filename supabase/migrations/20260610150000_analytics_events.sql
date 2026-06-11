create table if not exists public.analytics_events (
  id uuid not null default gen_random_uuid(),
  action text not null,
  label text,
  url text,
  ts timestamptz not null default now(),
  constraint analytics_events_pkey primary key (id)
);

alter table public.analytics_events enable row level security;

drop policy if exists "Anyone can insert analytics events" on public.analytics_events;
create policy "Anyone can insert analytics events"
  on public.analytics_events
  for insert
  to anon
  with check (true);

drop policy if exists "Only authenticated can view analytics" on public.analytics_events;
create policy "Only authenticated can view analytics"
  on public.analytics_events
  for select
  to authenticated
  using (true);
