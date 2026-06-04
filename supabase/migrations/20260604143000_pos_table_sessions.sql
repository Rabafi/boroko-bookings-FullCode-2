-- POS table sessions and multi-terminal table locks

create table if not exists public.pos_tables (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  name text not null,
  area text,
  seats integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (lodge_id, outlet_id, name)
);

create table if not exists public.pos_tabs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  table_name text,
  tab_name text,
  customer_name text,
  waiter_name text,
  room_id uuid references public.rooms(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'open',
  opened_by uuid,
  opened_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  manager_override_by uuid,
  manager_override_reason text
);

alter table public.pos_tables enable row level security;
drop policy if exists pos_tables_lodge_scope_select on public.pos_tables;
create policy pos_tables_lodge_scope_select
  on public.pos_tables
  for select
  using (public.app_lodge_access(lodge_id));

alter table public.pos_tabs enable row level security;
drop policy if exists pos_tabs_lodge_scope_select on public.pos_tabs;
create policy pos_tabs_lodge_scope_select
  on public.pos_tabs
  for select
  using (public.app_lodge_access(lodge_id));

alter table public.pos_tabs
  add column if not exists closed_at timestamptz,
  add column if not exists manager_override_by uuid,
  add column if not exists manager_override_reason text;

with ranked_active_tabs as (
  select id,
         row_number() over (
           partition by lodge_id,
                        coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        lower(btrim(table_name))
           order by updated_at desc, created_at desc
         ) as rn
    from public.pos_tabs
   where table_name is not null
     and status in ('open', 'running', 'ready', 'delivered')
)
update public.pos_tabs pt
   set status = 'closed',
       closed_at = coalesce(pt.closed_at, now()),
       updated_at = now(),
       manager_override_reason = coalesce(pt.manager_override_reason, 'Closed by table-session migration because a newer active tab exists for this table.')
  from ranked_active_tabs ranked
 where pt.id = ranked.id
   and ranked.rn > 1;

create unique index if not exists pos_tabs_one_active_table_per_outlet
  on public.pos_tabs (
    lodge_id,
    coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(table_name))
  )
  where table_name is not null
    and status in ('open', 'running', 'ready', 'delivered');

create or replace function public.upsert_pos_table(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_name text := nullif(btrim(coalesce(payload->>'name', '')), '');
  v_row public.pos_tables%rowtype;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;
  if v_name is null then
    return jsonb_build_object('success', false, 'error', 'Table name is required.');
  end if;

  insert into public.pos_tables (
    id, lodge_id, outlet_id, name, area, seats, active, updated_at
  ) values (
    v_id,
    v_lodge_id,
    v_outlet_id,
    v_name,
    nullif(btrim(coalesce(payload->>'area', '')), ''),
    greatest(0, coalesce(nullif(payload->>'seats', '')::int, 0)),
    coalesce((payload->>'active')::boolean, true),
    now()
  )
  on conflict (lodge_id, outlet_id, name)
  do update set
    area = excluded.area,
    seats = excluded.seats,
    active = excluded.active,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object('success', true, 'table', to_jsonb(v_row));
end;
$$;

create or replace function public.upsert_pos_tab(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_table_name text := nullif(btrim(coalesce(payload->>'table_name', '')), '');
  v_waiter_name text := nullif(btrim(coalesce(payload->>'waiter_name', '')), '');
  v_status text := lower(coalesce(nullif(payload->>'status', ''), case when v_table_name is null then 'open' else 'running' end));
  v_existing public.pos_tabs%rowtype;
  v_row public.pos_tabs%rowtype;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;
  if v_table_name is not null and v_waiter_name is null then
    return jsonb_build_object('success', false, 'error', 'Waiter name is required before opening a table.');
  end if;
  if v_status not in ('open', 'running', 'ready', 'delivered', 'closed', 'cancelled') then
    v_status := case when v_table_name is null then 'open' else 'running' end;
  end if;

  if v_table_name is not null and v_status in ('open', 'running', 'ready', 'delivered') then
    select *
      into v_existing
      from public.pos_tabs
     where lodge_id = v_lodge_id
       and coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and lower(btrim(table_name)) = lower(v_table_name)
       and status in ('open', 'running', 'ready', 'delivered')
       and id <> v_id
     order by updated_at desc
     limit 1;

    if v_existing.id is not null then
      return jsonb_build_object('success', true, 'already_open', true, 'tab', to_jsonb(v_existing));
    end if;
  end if;

  insert into public.pos_tabs (
    id, lodge_id, outlet_id, table_name, tab_name, customer_name, waiter_name,
    room_id, booking_id, items, notes, status, opened_by, opened_by_name,
    created_at, updated_at, closed_at
  ) values (
    v_id,
    v_lodge_id,
    v_outlet_id,
    v_table_name,
    nullif(btrim(coalesce(payload->>'tab_name', '')), ''),
    nullif(btrim(coalesce(payload->>'customer_name', '')), ''),
    v_waiter_name,
    nullif(payload->>'room_id', '')::uuid,
    nullif(payload->>'booking_id', '')::uuid,
    coalesce(payload->'items', '[]'::jsonb),
    nullif(payload->>'notes', ''),
    v_status,
    nullif(payload->>'opened_by', '')::uuid,
    nullif(payload->>'opened_by_name', ''),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now()),
    now(),
    case when v_status in ('closed', 'cancelled') then now() else null end
  )
  on conflict (id)
  do update set
    outlet_id = excluded.outlet_id,
    table_name = excluded.table_name,
    tab_name = excluded.tab_name,
    customer_name = excluded.customer_name,
    waiter_name = excluded.waiter_name,
    room_id = excluded.room_id,
    booking_id = excluded.booking_id,
    items = excluded.items,
    notes = excluded.notes,
    status = excluded.status,
    updated_at = now(),
    closed_at = excluded.closed_at
  returning * into v_row;

  return jsonb_build_object('success', true, 'tab', to_jsonb(v_row));
end;
$$;

create or replace function public.update_pos_tab_status(
  p_tab_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := lower(coalesce(nullif(p_status, ''), 'closed'));
  v_row public.pos_tabs%rowtype;
begin
  if v_status not in ('open', 'running', 'ready', 'delivered', 'closed', 'cancelled') then
    v_status := 'closed';
  end if;

  update public.pos_tabs
     set status = v_status,
         notes = coalesce(p_notes, notes),
         updated_at = now(),
         closed_at = case when v_status in ('closed', 'cancelled') then now() else closed_at end
   where id = p_tab_id
     and public.app_lodge_access(lodge_id)
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'error', 'Open table tab not found.');
  end if;

  return jsonb_build_object('success', true, 'tab', to_jsonb(v_row));
end;
$$;

grant execute on function public.upsert_pos_table(jsonb) to anon, authenticated, service_role;
grant execute on function public.upsert_pos_tab(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_pos_tab_status(uuid, text, text) to anon, authenticated, service_role;
grant select on public.pos_tabs to anon, authenticated, service_role;
grant select on public.pos_tables to anon, authenticated, service_role;
