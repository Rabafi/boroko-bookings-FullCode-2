-- The historic stock_movements table uses `reference`, not reference_type/id.
-- Keep the auditable location custody detail alongside its legacy fields.
alter table public.stock_movements add column if not exists from_stock_location_id uuid references public.restaurant_stock_locations(id) on delete restrict;
alter table public.stock_movements add column if not exists to_stock_location_id uuid references public.restaurant_stock_locations(id) on delete restrict;
alter table public.stock_movements add column if not exists reference_id uuid;

create or replace function public.create_stock_transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid()); v_from uuid := nullif(payload->>'from_stock_location_id', '')::uuid; v_to uuid := nullif(payload->>'to_stock_location_id', '')::uuid; v_item uuid := nullif(payload->>'inventory_item_id', '')::uuid; v_qty numeric := coalesce((payload->>'quantity')::numeric, 0); v_before numeric; v_after numeric; v_destination numeric; v_actor uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_from is null then select stock_location_id into v_from from public.restaurant_outlet_stock_locations where lodge_id = v_lodge_id and outlet_id = nullif(payload->>'from_outlet_id', '')::uuid; end if;
  if v_to is null then select stock_location_id into v_to from public.restaurant_outlet_stock_locations where lodge_id = v_lodge_id and outlet_id = nullif(payload->>'to_outlet_id', '')::uuid; end if;
  if v_from is null or v_to is null or v_item is null or v_qty <= 0 then return jsonb_build_object('success', false, 'error', 'Source, destination, stock item, and positive quantity are required'); end if;
  if v_from = v_to then return jsonb_build_object('success', false, 'error', 'Source and destination stock locations must be different'); end if;
  if not exists (select 1 from public.restaurant_stock_locations where id = v_from and lodge_id = v_lodge_id and is_active) or not exists (select 1 from public.restaurant_stock_locations where id = v_to and lodge_id = v_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose active stock locations from this business'); end if;
  perform 1 from public.inventory_items where id = v_item and lodge_id = v_lodge_id for update; if not found then return jsonb_build_object('success', false, 'error', 'Stock item does not belong to this business'); end if;
  select quantity into v_before from public.restaurant_stock_location_balances where inventory_item_id = v_item and stock_location_id = v_from for update; if coalesce(v_before, 0) < v_qty then return jsonb_build_object('success', false, 'error', format('Only %s is available at the source stock location', coalesce(v_before, 0))); end if;
  v_after := public.restaurant_apply_stock_location_balance(v_lodge_id, v_item, v_from, -v_qty); v_destination := public.restaurant_apply_stock_location_balance(v_lodge_id, v_item, v_to, v_qty);
  insert into public.stock_movements (lodge_id, inventory_item_id, movement_type, quantity, from_stock_location_id, to_stock_location_id, reference, reference_id, notes, created_by)
  values (v_lodge_id, v_item, 'transfer', v_qty, v_from, v_to, 'stock_location_transfer', v_id, nullif(payload->>'notes', ''), v_actor);
  insert into public.restaurant_stock_transfers (id, lodge_id, inventory_item_id, quantity, status, notes, transferred_by, transferred_at)
  values (v_id, v_lodge_id, v_item, v_qty, 'completed', nullif(payload->>'notes', ''), v_actor, now());
  return jsonb_build_object('success', true, 'transfer_id', v_id, 'source_balance', v_after, 'destination_balance', v_destination);
end;
$$;

grant execute on function public.create_stock_transfer(jsonb) to authenticated, service_role;
