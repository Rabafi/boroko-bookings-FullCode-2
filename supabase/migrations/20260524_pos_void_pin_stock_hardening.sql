-- POS void hardening:
-- - preserve inventory links on POS order lines, including virtual inventory-backed items
-- - restore stock from those line links when a PIN-approved void succeeds
-- - stop the legacy direct void RPC from bypassing manager/supervisor PIN approval

alter table public.pos_order_items
  add column if not exists inventory_item_id uuid references public.inventory_items(id),
  add column if not exists depletion_qty numeric not null default 1;

create or replace function public.populate_pos_order_item_inventory_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_outlet_id uuid;
  v_inventory_item_id uuid;
  v_depletion_qty numeric;
begin
  if new.inventory_item_id is not null then
    new.depletion_qty := greatest(1, coalesce(new.depletion_qty, 1));
    return new;
  end if;

  if new.menu_item_id is not null then
    select pmi.inventory_item_id,
           coalesce(pmi.depletion_qty, 1)
      into v_inventory_item_id,
           v_depletion_qty
      from public.pos_menu_items pmi
     where pmi.id = new.menu_item_id
       and pmi.lodge_id = new.lodge_id;
  end if;

  if v_inventory_item_id is null and nullif(btrim(coalesce(new.item_name, '')), '') is not null then
    select po.outlet_id
      into v_outlet_id
      from public.pos_orders po
     where po.id = new.order_id
       and po.lodge_id = new.lodge_id;

    select ii.id
      into v_inventory_item_id
      from public.inventory_items ii
     where ii.lodge_id = new.lodge_id
       and lower(ii.name) = lower(new.item_name)
       and (v_outlet_id is null or ii.outlet_id = v_outlet_id or ii.outlet_id is null)
     order by case when ii.outlet_id = v_outlet_id then 0 else 1 end,
              ii.name
     limit 1;

    v_depletion_qty := 1;
  end if;

  if v_inventory_item_id is not null then
    new.inventory_item_id := v_inventory_item_id;
    new.depletion_qty := greatest(1, coalesce(v_depletion_qty, new.depletion_qty, 1));
  else
    new.depletion_qty := greatest(1, coalesce(new.depletion_qty, 1));
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_populate_pos_order_item_inventory_link on public.pos_order_items;
create trigger trg_populate_pos_order_item_inventory_link
before insert or update of menu_item_id, item_name, inventory_item_id, depletion_qty
on public.pos_order_items
for each row
execute function public.populate_pos_order_item_inventory_link();

update public.pos_order_items poi
   set inventory_item_id = coalesce(poi.inventory_item_id, pmi.inventory_item_id),
       depletion_qty = greatest(1, coalesce(nullif(poi.depletion_qty, 0), pmi.depletion_qty, 1))
  from public.pos_menu_items pmi
 where poi.menu_item_id = pmi.id
   and poi.lodge_id = pmi.lodge_id
   and pmi.inventory_item_id is not null
   and (poi.inventory_item_id is null or poi.depletion_qty is null or poi.depletion_qty <= 0);

with inferred_links as (
  select poi.id as line_id,
         ii.id as inventory_item_id
    from public.pos_order_items poi
    join public.pos_orders po
      on po.id = poi.order_id
     and po.lodge_id = poi.lodge_id
    join lateral (
      select i.id
        from public.inventory_items i
       where i.lodge_id = poi.lodge_id
         and lower(i.name) = lower(poi.item_name)
         and (po.outlet_id is null or i.outlet_id = po.outlet_id or i.outlet_id is null)
       order by case when i.outlet_id = po.outlet_id then 0 else 1 end,
                i.name
       limit 1
    ) ii on true
   where poi.inventory_item_id is null
     and nullif(btrim(coalesce(poi.item_name, '')), '') is not null
     and coalesce(po.status, '') <> 'voided'
)
update public.pos_order_items poi
   set inventory_item_id = inferred_links.inventory_item_id,
       depletion_qty = greatest(1, coalesce(nullif(poi.depletion_qty, 0), 1))
  from inferred_links
 where poi.id = inferred_links.line_id;

create or replace function public._restore_pos_order_stock(
  p_order_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line record;
  v_restored jsonb := '[]'::jsonb;
  v_delta numeric;
  v_new_stock numeric;
begin
  for v_line in
    select
      poi.quantity,
      coalesce(poi.inventory_item_id, pmi.inventory_item_id) as inventory_item_id,
      greatest(1, coalesce(poi.depletion_qty, pmi.depletion_qty, 1)) as depletion_qty
    from public.pos_order_items poi
    left join public.pos_menu_items pmi
      on pmi.id = poi.menu_item_id
     and pmi.lodge_id = p_lodge_id
    where poi.order_id = p_order_id
      and poi.lodge_id = p_lodge_id
  loop
    if v_line.inventory_item_id is not null then
      v_delta := greatest(0, coalesce(v_line.quantity, 0)) * greatest(1, coalesce(v_line.depletion_qty, 1));

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + v_delta
       where id = v_line.inventory_item_id
         and lodge_id = p_lodge_id
       returning current_stock into v_new_stock;

      v_restored := v_restored || jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_line.inventory_item_id,
        'restored_qty', v_delta,
        'new_stock', v_new_stock
      ));
    end if;
  end loop;

  return v_restored;
end;
$function$;

revoke all on function public._restore_pos_order_stock(uuid, uuid) from public;

create or replace function public.void_pos_order(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return jsonb_build_object(
    'success', false,
    'error', 'POS voids require supervisor, manager, or admin PIN approval.'
  );
end;
$function$;

revoke all on function public.void_pos_order(uuid, uuid) from public;
grant execute on function public.void_pos_order(uuid, uuid) to anon, authenticated, service_role;

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by uuid := nullif(payload->>'approved_by', '')::uuid;
  v_reason text := nullif(payload->>'reason', '');
  v_payload_outlet uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_override_log_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_created_at timestamptz := coalesce(nullif(payload->>'created_at', '')::timestamptz, now());
  v_order_outlet_id uuid;
  v_folio_charge_id uuid;
  v_status text;
  v_restored jsonb := '[]'::jsonb;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id, folio_charge_id
    into v_status, v_order_outlet_id, v_folio_charge_id
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_override_log_id is not null
     and exists (
       select 1
         from public.pos_override_log pol
        where pol.id = v_override_log_id
          and pol.lodge_id = v_lodge_id
          and pol.order_id = v_order_id
          and pol.action = 'void'
     ) then
    return jsonb_build_object(
      'success', true,
      'id', v_order_id,
      'override_log_id', v_override_log_id,
      'already_applied', true,
      'restored_stock', v_restored
    );
  end if;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_order_outlet_id, v_payload_outlet));

  if not exists (
    select 1
      from public.users u
     where u.id = v_approved_by
       and u.lodge_id = v_lodge_id
       and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid approver');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  v_restored := public._restore_pos_order_stock(v_order_id, v_lodge_id);

  if v_folio_charge_id is not null then
    perform public.delete_booking_charge(v_folio_charge_id, v_lodge_id, 'Voided with POS order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  insert into public.pos_override_log (
    id,
    lodge_id,
    order_id,
    action,
    requested_by,
    approved_by,
    reason,
    outlet_id,
    created_at
  ) values (
    coalesce(v_override_log_id, gen_random_uuid()),
    v_lodge_id,
    v_order_id,
    'void',
    v_requested_by,
    v_approved_by,
    v_reason,
    coalesce(v_order_outlet_id, v_payload_outlet),
    v_created_at
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'override_log_id', v_override_log_id,
    'restored_stock', v_restored
  );
end;
$function$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;
