-- Extend create_pos_menu_item and update_pos_menu_item to persist visual cue fields.
-- The column ALTER TABLE already exists from 20260710140000. This migration replaces
-- the two RPC implementations so the INSERT/UPDATE bodies write the new columns.
-- All existing SECURITY DEFINER, SET search_path, app_require_lodge_role, and
-- app_require_pos_outlet_access guards are preserved exactly.

create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  insert into public.pos_menu_items (
    lodge_id, name, category, price, is_available, barcode,
    inventory_item_id, depletion_qty, outlet_id, template_kind, auto_from_inventory,
    dietary_flags, prep_time_minutes, is_popular
  ) values (
    v_lodge_id,
    nullif(btrim(payload->>'name'), ''),
    coalesce(nullif(payload->>'category', ''), 'Other'),
    coalesce(nullif(payload->>'price', '')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case when nullif(payload->>'inventory_item_id', '') is null then null else public._positive_depletion_qty(nullif(payload->>'depletion_qty', '')::numeric, 1) end,
    v_outlet_id,
    coalesce(nullif(payload->>'template_kind', ''), 'standard'),
    false,
    coalesce(payload->'dietary_flags', '[]'::jsonb),
    coalesce((payload->>'prep_time_minutes')::integer, 0),
    coalesce((payload->>'is_popular')::boolean, false)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.update_pos_menu_item(p_id uuid, p_lodge_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
  v_outlet_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_outlet_id := case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else null end;
  perform public.app_require_pos_outlet_access(p_lodge_id, v_outlet_id);

  update public.pos_menu_items
     set name = case when payload ? 'name' then nullif(btrim(payload->>'name'), '') else name end,
         category = case when payload ? 'category' then coalesce(nullif(payload->>'category', ''), 'Other') else category end,
         price = case when payload ? 'price' then coalesce(nullif(payload->>'price', '')::numeric, 0) else price end,
         is_available = case when payload ? 'is_available' then coalesce((payload->>'is_available')::boolean, true) else is_available end,
         barcode = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
         inventory_item_id = case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else inventory_item_id end,
         depletion_qty = case
           when payload ? 'inventory_item_id' and nullif(payload->>'inventory_item_id', '') is null then null
           when payload ? 'depletion_qty' then public._positive_depletion_qty(nullif(payload->>'depletion_qty', '')::numeric, 1)
           else depletion_qty
         end,
         outlet_id = case when payload ? 'outlet_id' then v_outlet_id else outlet_id end,
         dietary_flags = case when payload ? 'dietary_flags' then coalesce(payload->'dietary_flags', '[]'::jsonb) else dietary_flags end,
         prep_time_minutes = case when payload ? 'prep_time_minutes' then coalesce((payload->>'prep_time_minutes')::integer, 0) else prep_time_minutes end,
         is_popular = case when payload ? 'is_popular' then coalesce((payload->>'is_popular')::boolean, false) else is_popular end,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;
