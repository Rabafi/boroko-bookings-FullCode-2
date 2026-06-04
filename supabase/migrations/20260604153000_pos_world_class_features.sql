-- POS world-class feature support: modifiers, promotions, floor layout, display, audit

alter table public.pos_order_items
  add column if not exists category text,
  add column if not exists modifiers jsonb not null default '[]'::jsonb,
  add column if not exists item_notes text;

create table if not exists public.pos_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  name text not null,
  applies_to_categories text[] not null default '{}',
  options jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_promotions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  name text not null,
  discount_type text not null default 'amount',
  discount_value numeric not null default 0,
  applies_to_category text not null default 'All',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_floor_layouts (
  lodge_id uuid primary key,
  layout jsonb not null default '{"areas":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_customer_display_snapshots (
  lodge_id uuid primary key,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_audit_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  action text not null,
  entity_type text,
  entity_id uuid,
  staff_id uuid,
  staff_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.pos_modifier_groups enable row level security;
alter table public.pos_promotions enable row level security;
alter table public.pos_floor_layouts enable row level security;
alter table public.pos_customer_display_snapshots enable row level security;
alter table public.pos_audit_log enable row level security;

drop policy if exists pos_modifier_groups_lodge_scope_select on public.pos_modifier_groups;
create policy pos_modifier_groups_lodge_scope_select on public.pos_modifier_groups for select using (public.app_lodge_access(lodge_id));

drop policy if exists pos_promotions_lodge_scope_select on public.pos_promotions;
create policy pos_promotions_lodge_scope_select on public.pos_promotions for select using (public.app_lodge_access(lodge_id));

drop policy if exists pos_floor_layouts_lodge_scope_select on public.pos_floor_layouts;
create policy pos_floor_layouts_lodge_scope_select on public.pos_floor_layouts for select using (public.app_lodge_access(lodge_id));

drop policy if exists pos_customer_display_snapshots_lodge_scope_select on public.pos_customer_display_snapshots;
create policy pos_customer_display_snapshots_lodge_scope_select on public.pos_customer_display_snapshots for select using (public.app_lodge_access(lodge_id));

drop policy if exists pos_audit_log_lodge_scope_select on public.pos_audit_log;
create policy pos_audit_log_lodge_scope_select on public.pos_audit_log for select using (public.app_lodge_access(lodge_id));

create or replace function public.append_pos_audit_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_row public.pos_audit_log%rowtype;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;

  insert into public.pos_audit_log (
    id, lodge_id, action, entity_type, entity_id, staff_id, staff_name, details, created_at
  ) values (
    coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid()),
    v_lodge_id,
    coalesce(nullif(payload->>'action', ''), 'pos_event'),
    nullif(payload->>'entity_type', ''),
    nullif(payload->>'entity_id', '')::uuid,
    nullif(payload->>'staff_id', '')::uuid,
    nullif(payload->>'staff_name', ''),
    coalesce(payload->'details', '{}'::jsonb),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now())
  )
  returning * into v_row;

  return jsonb_build_object('success', true, 'event', to_jsonb(v_row));
end;
$$;

grant select on public.pos_modifier_groups to anon, authenticated, service_role;
grant select on public.pos_promotions to anon, authenticated, service_role;
grant select on public.pos_floor_layouts to anon, authenticated, service_role;
grant select on public.pos_customer_display_snapshots to anon, authenticated, service_role;
grant select on public.pos_audit_log to anon, authenticated, service_role;
grant execute on function public.append_pos_audit_log(jsonb) to anon, authenticated, service_role;
