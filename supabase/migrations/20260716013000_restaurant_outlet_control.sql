-- Restaurant & Bar outlet configuration is an online, manager-authorised control.
-- It creates the outlet scope used by reporting, stock custody and POS operations;
-- it is deliberately not an offline queue action.

alter table public.outlets
  add column if not exists created_by uuid references public.users(id),
  add column if not exists updated_by uuid references public.users(id),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.restaurant_outlet_control_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  action text not null check (action in ('created', 'updated', 'activated', 'deactivated')),
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists restaurant_outlet_control_audit_lodge_created_idx
  on public.restaurant_outlet_control_audit (lodge_id, created_at desc);

alter table public.restaurant_outlet_control_audit enable row level security;

create or replace function public.get_restaurant_outlet_controls(p_lodge_id uuid)
returns table (
  id uuid,
  name text,
  type text,
  is_active boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.app_get_lodge_role_of_user(p_lodge_id, array['manager', 'admin', 'super_admin']);
  return query
    select o.id, o.name, o.type, o.is_active, o.sort_order, o.created_at, o.updated_at
    from public.outlets o
    where o.lodge_id = p_lodge_id
    order by o.is_active desc, o.sort_order, o.name;
end;
$$;

create or replace function public.create_restaurant_outlet(p_lodge_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor_id uuid := public.app_current_user_id();
  v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_type text := lower(nullif(btrim(coalesce(p_payload->>'type', '')), ''));
  v_sort_order integer := coalesce(nullif(p_payload->>'sort_order', '')::integer, 0);
  v_outlet public.outlets%rowtype;
begin
  perform public.app_get_lodge_role_of_user(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_actor_id is null then raise exception 'You must be signed in to create an outlet'; end if;
  if v_name is null or length(v_name) > 100 then raise exception 'Outlet name is required and must be 100 characters or fewer'; end if;
  if v_type not in ('food', 'beverage', 'accommodation') then raise exception 'Choose Restaurant, Bar, or Other service outlet'; end if;
  if v_sort_order < 0 or v_sort_order > 9999 then raise exception 'Sort order must be between 0 and 9999'; end if;

  insert into public.outlets (lodge_id, name, type, is_active, sort_order, created_by, updated_by, updated_at)
  values (p_lodge_id, v_name, v_type, true, v_sort_order, v_actor_id, v_actor_id, now())
  returning * into v_outlet;

  insert into public.restaurant_outlet_control_audit (lodge_id, outlet_id, actor_id, action, after_state)
  values (p_lodge_id, v_outlet.id, v_actor_id, 'created', to_jsonb(v_outlet));
  return jsonb_build_object('success', true, 'outlet', jsonb_build_object('id', v_outlet.id, 'name', v_outlet.name, 'type', v_outlet.type, 'is_active', v_outlet.is_active));
exception when unique_violation then
  raise exception 'An outlet named "%" already exists for this business', v_name;
end;
$$;

create or replace function public.update_restaurant_outlet(p_lodge_id uuid, p_outlet_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor_id uuid := public.app_current_user_id();
  v_before public.outlets%rowtype;
  v_after public.outlets%rowtype;
  v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_type text := lower(nullif(btrim(coalesce(p_payload->>'type', '')), ''));
  v_is_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  v_sort_order integer := coalesce(nullif(p_payload->>'sort_order', '')::integer, 0);
  v_active_count integer;
  v_action text;
begin
  perform public.app_get_lodge_role_of_user(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_actor_id is null then raise exception 'You must be signed in to update an outlet'; end if;
  if v_name is null or length(v_name) > 100 then raise exception 'Outlet name is required and must be 100 characters or fewer'; end if;
  if v_type not in ('food', 'beverage', 'accommodation') then raise exception 'Choose Restaurant, Bar, or Other service outlet'; end if;
  if v_sort_order < 0 or v_sort_order > 9999 then raise exception 'Sort order must be between 0 and 9999'; end if;

  perform 1 from public.outlets where lodge_id = p_lodge_id for update;
  select * into v_before from public.outlets where id = p_outlet_id and lodge_id = p_lodge_id for update;
  if not found then raise exception 'Outlet does not belong to this business'; end if;
  select count(*) into v_active_count from public.outlets where lodge_id = p_lodge_id and is_active;
  if v_before.is_active and not v_is_active and v_active_count <= 1 then
    raise exception 'Keep at least one active outlet for this business';
  end if;

  update public.outlets
  set name = v_name, type = v_type, is_active = v_is_active, sort_order = v_sort_order, updated_by = v_actor_id, updated_at = now()
  where id = p_outlet_id and lodge_id = p_lodge_id
  returning * into v_after;
  v_action := case when v_before.is_active and not v_after.is_active then 'deactivated' when not v_before.is_active and v_after.is_active then 'activated' else 'updated' end;
  insert into public.restaurant_outlet_control_audit (lodge_id, outlet_id, actor_id, action, before_state, after_state)
  values (p_lodge_id, v_after.id, v_actor_id, v_action, to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('success', true, 'outlet', jsonb_build_object('id', v_after.id, 'name', v_after.name, 'type', v_after.type, 'is_active', v_after.is_active));
exception when unique_violation then
  raise exception 'An outlet named "%" already exists for this business', v_name;
end;
$$;

revoke all on function public.get_restaurant_outlet_controls(uuid) from public;
revoke all on function public.create_restaurant_outlet(uuid, jsonb) from public;
revoke all on function public.update_restaurant_outlet(uuid, uuid, jsonb) from public;
grant execute on function public.get_restaurant_outlet_controls(uuid) to authenticated, service_role;
grant execute on function public.create_restaurant_outlet(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_restaurant_outlet(uuid, uuid, jsonb) to authenticated, service_role;
