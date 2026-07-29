-- Expired batches are quarantined lot-by-lot.  A manager confirms the actual
-- spoiled quantity; the same atomic action reduces stock and writes the ledger.

begin;

create table if not exists public.restaurant_inventory_lot_writeoffs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  lot_id uuid not null references public.restaurant_inventory_lots(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  reason text not null,
  written_off_by uuid not null references public.users(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (lodge_id, idempotency_key)
);
alter table public.restaurant_inventory_lot_writeoffs enable row level security;
create policy restaurant_inventory_lot_writeoffs_scope on public.restaurant_inventory_lot_writeoffs for all
  using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));

create or replace function public.write_off_expired_restaurant_inventory_lot(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_lot_id uuid := nullif(p_payload->>'lot_id', '')::uuid;
  v_quantity numeric := coalesce(nullif(p_payload->>'quantity', '')::numeric, 0);
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_lot public.restaurant_inventory_lots%rowtype;
  v_stock public.inventory_items%rowtype;
  v_writeoff_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);
  if v_actor_id is null or not exists (select 1 from public.users u where u.id = v_actor_id and u.lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign out and sign in again before writing off this lot.');
  end if;
  if v_lot_id is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'Lot and stable write-off reference are required.');
  end if;
  if length(v_key) > 128 then return jsonb_build_object('success', false, 'error', 'Write-off reference is invalid.'); end if;
  select id into v_writeoff_id from public.restaurant_inventory_lot_writeoffs
   where lodge_id = v_lodge_id and idempotency_key = v_key;
  if found then return jsonb_build_object('success', true, 'id', v_writeoff_id, 'duplicate', true); end if;

  select * into v_lot from public.restaurant_inventory_lots where id = v_lot_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Lot was not found for this business.'); end if;
  if v_lot.expires_on is null or v_lot.expires_on >= current_date then
    return jsonb_build_object('success', false, 'error', 'This lot is not yet expired. Lots expiring today remain visible for preparation and must be reviewed tomorrow.');
  end if;
  if v_quantity <= 0 or v_quantity > v_lot.remaining_quantity then
    return jsonb_build_object('success', false, 'error', 'Enter the physical expired quantity, up to the lot remaining quantity.');
  end if;
  if v_reason is null then return jsonb_build_object('success', false, 'error', 'Enter why this expired stock is being written off.'); end if;

  select * into v_stock from public.inventory_items where id = v_lot.inventory_item_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'The linked stock item was not found for this business.'); end if;
  if coalesce(v_stock.current_stock, 0) < v_quantity then
    return jsonb_build_object('success', false, 'error', 'Recorded on-hand stock is lower than this write-off. Run a physical stocktake before writing off the lot.');
  end if;

  insert into public.restaurant_inventory_lot_writeoffs (lodge_id, lot_id, quantity, reason, written_off_by, idempotency_key)
  values (v_lodge_id, v_lot_id, v_quantity, v_reason, v_actor_id, v_key) returning id into v_writeoff_id;
  update public.restaurant_inventory_lots set remaining_quantity = remaining_quantity - v_quantity where id = v_lot_id;
  update public.inventory_items set current_stock = current_stock - v_quantity, updated_at = now() where id = v_stock.id and lodge_id = v_lodge_id;
  insert into public.inventory_movements (lodge_id, item_id, movement_type, quantity, unit_cost, total_cost, notes, reference_type, reference_id, source, created_by)
  values (v_lodge_id, v_stock.id, 'expiry_write_off', -v_quantity, coalesce(v_lot.unit_cost, v_stock.latest_unit_cost, 0), -v_quantity * coalesce(v_lot.unit_cost, v_stock.latest_unit_cost, 0),
    'Expired lot write-off (' || v_lot.lot_code || '): ' || v_reason, 'restaurant_inventory_lot', v_lot_id, 'restaurant_expiry', v_actor_id);
  return jsonb_build_object('success', true, 'id', v_writeoff_id, 'quantity_written_off', v_quantity, 'new_stock', v_stock.current_stock - v_quantity);
end;
$$;

revoke all on function public.write_off_expired_restaurant_inventory_lot(jsonb) from public;
grant execute on function public.write_off_expired_restaurant_inventory_lot(jsonb) to authenticated, service_role;

commit;
