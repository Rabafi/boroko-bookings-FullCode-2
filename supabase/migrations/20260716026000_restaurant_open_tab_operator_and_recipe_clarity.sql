-- Open checks are operational and cash-up records. They must be attributed to
-- the staff member whose active Till shift owns them; a UI-only unlock is not
-- an authorization boundary.
alter table public.pos_tabs
  add column if not exists waiter_id uuid references public.users(id) on delete set null,
  add column if not exists shift_id uuid references public.pos_shifts(id) on delete set null;

create index if not exists idx_pos_tabs_lodge_shift_active
  on public.pos_tabs (lodge_id, shift_id, status)
  where status in ('open', 'running', 'ready', 'delivered');

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
  v_waiter_id uuid := nullif(payload->>'waiter_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_status text := lower(coalesce(nullif(payload->>'status', ''), case when v_table_name is null then 'open' else 'running' end));
  v_existing public.pos_tabs%rowtype;
  v_row public.pos_tabs%rowtype;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  if v_status not in ('open', 'running', 'ready', 'delivered', 'closed', 'cancelled') then
    v_status := case when v_table_name is null then 'open' else 'running' end;
  end if;

  if v_status in ('open', 'running', 'ready', 'delivered') then
    if v_waiter_id is null or v_waiter_name is null or v_shift_id is null then
      return jsonb_build_object('success', false, 'error', 'Unlock Till with the serving staff PIN and start their shift before holding an open check.');
    end if;
    if not exists (
      select 1
        from public.pos_shifts s
       where s.id = v_shift_id
         and s.lodge_id = v_lodge_id
         and s.outlet_id is not distinct from v_outlet_id
         and s.cashier_id = v_waiter_id
         and s.status = 'open'
         and s.closed_at is null
    ) then
      return jsonb_build_object('success', false, 'error', 'The selected staff member does not have an active Till shift for this outlet. Unlock Till with their PIN and try again.');
    end if;
  end if;

  if v_table_name is not null and v_status in ('open', 'running', 'ready', 'delivered') then
    select * into v_existing
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
    id, lodge_id, outlet_id, table_name, tab_name, customer_name, waiter_name, waiter_id, shift_id,
    room_id, booking_id, items, notes, status, opened_by, opened_by_name, created_at, updated_at, closed_at
  ) values (
    v_id, v_lodge_id, v_outlet_id, v_table_name,
    nullif(btrim(coalesce(payload->>'tab_name', '')), ''),
    nullif(btrim(coalesce(payload->>'customer_name', '')), ''),
    v_waiter_name, v_waiter_id, v_shift_id,
    nullif(payload->>'room_id', '')::uuid, nullif(payload->>'booking_id', '')::uuid,
    coalesce(payload->'items', '[]'::jsonb), nullif(payload->>'notes', ''), v_status,
    coalesce(nullif(payload->>'opened_by', '')::uuid, public.app_current_user_id()),
    nullif(payload->>'opened_by_name', ''), coalesce(nullif(payload->>'created_at', '')::timestamptz, now()), now(),
    case when v_status in ('closed', 'cancelled') then now() else null end
  )
  on conflict (id) do update set
    outlet_id = excluded.outlet_id, table_name = excluded.table_name, tab_name = excluded.tab_name,
    customer_name = excluded.customer_name, waiter_name = excluded.waiter_name, waiter_id = excluded.waiter_id,
    shift_id = excluded.shift_id, room_id = excluded.room_id, booking_id = excluded.booking_id,
    items = excluded.items, notes = excluded.notes, status = excluded.status, updated_at = now(), closed_at = excluded.closed_at
  returning * into v_row;

  insert into public.pos_audit_log (lodge_id, outlet_id, actor_id, action, entity_type, entity_id, after_snapshot)
  values (v_lodge_id, v_outlet_id, public.app_current_user_id(), 'tab_saved', 'pos_tab', v_row.id, to_jsonb(v_row));

  return jsonb_build_object('success', true, 'tab', to_jsonb(v_row));
end;
$$;

create or replace function public.get_restaurant_recipes(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_recipes jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'menu_item_id', r.menu_item_id, 'menu_item_name', mi.name, 'selling_price', mi.price,
    'name', r.name, 'version', r.version, 'serving_size', r.serving_size, 'active', r.active, 'created_at', r.created_at,
    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ri.id, 'inventory_item_id', ri.inventory_item_id, 'inventory_item_name', ii.name,
        'quantity', ri.quantity, 'unit', ri.unit, 'waste_percent', ri.waste_percent,
        'sort_order', ri.sort_order, 'latest_unit_cost', ii.latest_unit_cost
      ) order by ri.sort_order)
      from public.restaurant_recipe_ingredients ri
      left join public.inventory_items ii on ii.id = ri.inventory_item_id and ii.lodge_id = r.lodge_id
      where ri.recipe_id = r.id and ri.lodge_id = p_lodge_id
    ), '[]'::jsonb)
  ) order by r.name), '[]'::jsonb)
  into v_recipes
  from public.restaurant_recipes r
  left join public.pos_menu_items mi on mi.id = r.menu_item_id and mi.lodge_id = r.lodge_id
  where r.lodge_id = p_lodge_id;
  return coalesce(v_recipes, '[]'::jsonb);
end;
$$;

revoke all on function public.upsert_pos_tab(jsonb) from public;
grant execute on function public.upsert_pos_tab(jsonb) to authenticated, service_role;
revoke all on function public.get_restaurant_recipes(uuid) from public;
grant execute on function public.get_restaurant_recipes(uuid) to authenticated, service_role;
