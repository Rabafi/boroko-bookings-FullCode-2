-- POS return/void financial truth correction.
--
-- Keep create_pos_return_v3 as the compatibility contract used by Desktop,
-- Manager/POS replay and Legacy POS, but make the transaction reverse the
-- original line allocations, tender identities, recipe/direct stock and the
-- transaction-time cost snapshot in one transaction.  No current catalogue
-- price, tax rate or cost is consulted to reconstruct a historical return.

begin;

create or replace function public.create_pos_return_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_original_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_return_order_id uuid := nullif(payload->>'return_order_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_approver_id uuid := nullif(payload->>'approver_id', '')::uuid;
  v_actor_id uuid := coalesce(public.app_current_user_id(), nullif(payload->>'requested_by', '')::uuid);
  v_pin text := nullif(btrim(coalesce(payload->>'approval_pin', payload->>'pin', '')), '');
  v_device_id text := coalesce(nullif(payload->>'device_id', ''), 'unknown');
  v_reason text := nullif(btrim(coalesce(payload->>'reason', '')), '');
  v_key text := nullif(btrim(coalesce(payload->>'return_idempotency_key', '')), '');
  v_lines jsonb := coalesce(payload->'lines', '[]'::jsonb);
  v_request_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_original record;
  v_shift record;
  v_original_item record;
  v_line jsonb;
  v_return_item jsonb;
  v_return_items jsonb := '[]'::jsonb;
  v_line_id uuid;
  v_return_item_id uuid;
  v_requested_qty numeric;
  v_original_qty numeric;
  v_previous_qty numeric;
  v_new_qty numeric;
  v_original_gross numeric;
  v_original_discount numeric;
  v_original_tax numeric;
  v_original_net numeric;
  v_refund_gross numeric;
  v_refund_discount numeric;
  v_refund_tax numeric;
  v_refund_net numeric;
  v_total_gross numeric := 0;
  v_total_discount numeric := 0;
  v_total_tax numeric := 0;
  v_total_net numeric := 0;
  v_total_tip numeric := 0;
  v_total_refund numeric := 0;
  v_original_net_base numeric := 0;
  v_tip_already_refunded numeric := 0;
  v_item_count integer := 0;
  v_refund_breakdown jsonb := '[]'::jsonb;
  v_tender jsonb;
  v_tender_count integer := 0;
  v_tender_index integer := 0;
  v_tender_total numeric := 0;
  v_tender_allocated numeric := 0;
  v_tender_amount numeric;
  v_stock_location_id uuid;
  v_restore_qty numeric;
  v_restore_cost numeric;
  v_recipe_cost numeric;
  v_recipe_row record;
  v_direct_unit_cost numeric;
  v_direct_cost numeric;
  v_original_snapshot_cost numeric;
begin
  if v_lodge_id is null or v_original_order_id is null or v_return_order_id is null
     or v_shift_id is null or v_pin is null or v_reason is null or v_key is null then
    return jsonb_build_object('success', false,
      'error', 'order_id, return_order_id, lodge_id, shift_id, approval PIN, reason and idempotency key are required');
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one return line is required');
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if v_approver_id is null then
    v_approver_id := public._pos_resolve_pin_internal(v_lodge_id, v_pin, 'pos.void', v_device_id);
  elsif not public._pos_validate_pin_internal(v_lodge_id, v_approver_id, v_pin, 'pos.void', v_device_id) then
    v_approver_id := null;
  end if;
  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  v_request_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_key, 'create_pos_return_v3', v_return_order_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return v_claim->'operation_result';
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object('success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'), 'code', 'idempotency_conflict');
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lodge_id::text || ':pos-return:' || v_original_order_id::text, 0)
  );

  select o.* into v_original
    from public.pos_orders o
   where o.id = v_original_order_id and o.lodge_id = v_lodge_id
   for update;
  if not found or coalesce(v_original.transaction_type, 'sale') <> 'sale'
     or v_original.status in ('voided', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Original sale is not returnable');
  end if;
  if v_original.outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_original.outlet_id);
  end if;

  select s.* into v_shift
    from public.pos_shifts s
   where s.id = v_shift_id and s.lodge_id = v_lodge_id and s.status = 'open'
   for update;
  if not found or v_shift.outlet_id is distinct from v_original.outlet_id then
    return jsonb_build_object('success', false, 'error', 'Return requires the current open shift for the original outlet');
  end if;

  select coalesce(sum(coalesce(nullif(i.net_subtotal, 0), nullif(i.subtotal, 0),
      coalesce(i.gross_subtotal, i.quantity * i.unit_price) - coalesce(i.discount_allocated, 0))), 0)
    into v_original_net_base
    from public.pos_order_items i
   where i.order_id = v_original_order_id and i.lodge_id = v_lodge_id;
  v_original_net_base := greatest(0, v_original_net_base);
  select coalesce(sum(abs(coalesce(r.tip_total, 0))), 0)
    into v_tip_already_refunded
    from public.pos_orders r
   where r.lodge_id = v_lodge_id and r.original_order_id = v_original_order_id
     and coalesce(r.transaction_type, '') = 'return' and r.status not in ('voided', 'cancelled');

  -- Lock the ledger rows before calculating remaining quantities. The advisory
  -- lock above serializes concurrent return attempts for this original sale.
  perform 1 from public.pos_return_lines r
   where r.lodge_id = v_lodge_id and r.original_order_id = v_original_order_id
   for update;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_requested_qty := abs(coalesce(nullif(v_line->>'quantity', '')::numeric, 0));
    if v_line_id is null or v_requested_qty <= 0 then
      return jsonb_build_object('success', false, 'error', 'Each return line requires a valid line_id and positive quantity');
    end if;

    select i.* into v_original_item
      from public.pos_order_items i
     where i.id = v_line_id and i.order_id = v_original_order_id and i.lodge_id = v_lodge_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Original order line was not found');
    end if;
    v_original_qty := coalesce(v_original_item.quantity, 0);
    if v_original_qty <= 0 then
      return jsonb_build_object('success', false, 'error', 'Only positive sale lines can be returned');
    end if;

    select coalesce(sum(r.quantity), 0) into v_previous_qty
      from public.pos_return_lines r
     where r.lodge_id = v_lodge_id and r.original_order_item_id = v_line_id;
    v_new_qty := v_previous_qty + v_requested_qty;
    if v_new_qty > v_original_qty then
      return jsonb_build_object('success', false,
        'error', format('Return quantity exceeds the remaining quantity for %s', v_original_item.item_name));
    end if;

    v_original_gross := coalesce(nullif(v_original_item.gross_subtotal, 0), v_original_qty * v_original_item.unit_price);
    v_original_discount := coalesce(v_original_item.discount_allocated, 0);
    v_original_tax := coalesce(v_original_item.tax_allocated, 0);
    v_original_net := coalesce(nullif(v_original_item.net_subtotal, 0), nullif(v_original_item.subtotal, 0),
      v_original_gross - v_original_discount);

    -- Difference-of-cumulative-rounding makes repeated partial returns equal
    -- the exact stored line allocation when the final unit is returned.
    v_refund_gross := round(v_original_gross * v_new_qty / v_original_qty, 2)
      - round(v_original_gross * v_previous_qty / v_original_qty, 2);
    v_refund_discount := round(v_original_discount * v_new_qty / v_original_qty, 2)
      - round(v_original_discount * v_previous_qty / v_original_qty, 2);
    v_refund_tax := round(v_original_tax * v_new_qty / v_original_qty, 2)
      - round(v_original_tax * v_previous_qty / v_original_qty, 2);
    v_refund_net := round(v_original_net * v_new_qty / v_original_qty, 2)
      - round(v_original_net * v_previous_qty / v_original_qty, 2);

    v_total_gross := v_total_gross + v_refund_gross;
    v_total_discount := v_total_discount + v_refund_discount;
    v_total_tax := v_total_tax + v_refund_tax;
    v_total_net := v_total_net + v_refund_net;
    v_return_items := v_return_items || jsonb_build_array(jsonb_build_object(
      'original_order_item_id', v_line_id,
      'menu_item_id', v_original_item.menu_item_id,
      'item_name', 'Return: ' || v_original_item.item_name,
      'quantity', -v_requested_qty,
      'unit_price', v_original_item.unit_price,
      'subtotal', -v_refund_gross,
      'inventory_item_id', v_original_item.inventory_item_id,
      'depletion_qty', v_original_item.depletion_qty,
      'category', v_original_item.category,
      'modifiers', v_original_item.modifiers,
      'gross_subtotal', -v_refund_gross,
      'discount_allocated', -v_refund_discount,
      'tax_allocated', -v_refund_tax,
      'net_subtotal', -v_refund_net
    ));
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 or v_total_net <= 0 then
    return jsonb_build_object('success', false, 'error', 'Return value must be greater than zero');
  end if;

  if coalesce(v_original.tip_total, 0) > 0 and v_original_net_base > 0 then
    v_total_tip := greatest(0, round(abs(v_original.tip_total) * v_total_net / v_original_net_base, 2) - v_tip_already_refunded);
  end if;
  v_total_refund := round(v_total_net + v_total_tax + v_total_tip, 2);

  -- Preserve every original tender identity. This is what lets the deferred
  -- POS posting trigger reverse AR and voucher subledgers, not just cash.
  if jsonb_typeof(v_original.payment_breakdown) = 'array'
     and jsonb_array_length(v_original.payment_breakdown) > 0 then
    select count(*) into v_tender_count from jsonb_array_elements(v_original.payment_breakdown);
    select coalesce(sum(abs(coalesce((value->>'amount')::numeric, 0))), 0)
      into v_tender_total from jsonb_array_elements(v_original.payment_breakdown);
    for v_tender in select value from jsonb_array_elements(v_original.payment_breakdown)
    loop
      v_tender_index := v_tender_index + 1;
      if v_tender_index = v_tender_count then
        v_tender_amount := round(v_total_refund - v_tender_allocated, 2);
      elsif v_tender_total > 0 then
        v_tender_amount := round(v_total_refund * abs(coalesce((v_tender->>'amount')::numeric, 0)) / v_tender_total, 2);
      else
        v_tender_amount := 0;
      end if;
      v_tender_allocated := v_tender_allocated + v_tender_amount;
      v_refund_breakdown := v_refund_breakdown || jsonb_build_array(
        (v_tender - 'amount') || jsonb_build_object('amount', -v_tender_amount)
      );
    end loop;
  else
    v_refund_breakdown := jsonb_build_array(jsonb_build_object(
      'method', coalesce(v_original.payment_method, 'cash'), 'amount', -v_total_refund
    ));
  end if;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, status, total, notes,
    completed_at, payment_method, outlet_id, create_idempotency_key,
    gross_total, discount_total, tax_rate, tax_total, tip_total,
    payment_breakdown, cashier_id, cashier_name, shift_id, ticket_status,
    transaction_type, original_order_id, source_device_id,
    client_created_at, server_received_at
  ) values (
    v_return_order_id, v_lodge_id, v_original.room_id, v_original.booking_id,
    'Return: ' || coalesce(v_original.walk_in_name, 'Guest'), 'completed',
    -v_total_refund, v_reason, now(), coalesce(v_original.payment_method, 'cash'),
    v_original.outlet_id, v_key, -v_total_gross, -v_total_discount,
    coalesce(v_original.tax_rate, 0), -v_total_tax, -v_total_tip,
    v_refund_breakdown, coalesce(v_actor_id, v_shift.cashier_id),
    (select u.name from public.users u where u.id = coalesce(v_actor_id, v_shift.cashier_id)),
    v_shift_id, 'new', 'return', v_original_order_id, v_device_id, now(), now()
  );

  select stock_location_id into v_stock_location_id
    from public.restaurant_outlet_stock_locations
   where lodge_id = v_lodge_id and outlet_id is not distinct from v_original.outlet_id;
  v_stock_location_id := coalesce(v_stock_location_id, public.restaurant_default_stock_location(v_lodge_id));

  for v_return_item in select value from jsonb_array_elements(v_return_items)
  loop
    v_return_item_id := gen_random_uuid();
    insert into public.pos_order_items (
      id, lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_return_item_id, v_lodge_id, v_return_order_id,
      nullif(v_return_item->>'menu_item_id', '')::uuid,
      v_return_item->>'item_name', (v_return_item->>'quantity')::numeric,
      (v_return_item->>'unit_price')::numeric, (v_return_item->>'subtotal')::numeric,
      nullif(v_return_item->>'inventory_item_id', '')::uuid,
      coalesce((v_return_item->>'depletion_qty')::numeric, 1),
      nullif(v_return_item->>'category', ''), coalesce(v_return_item->'modifiers', '[]'::jsonb),
      (v_return_item->>'gross_subtotal')::numeric,
      (v_return_item->>'discount_allocated')::numeric,
      (v_return_item->>'tax_allocated')::numeric,
      (v_return_item->>'net_subtotal')::numeric
    );

    insert into public.pos_return_lines (
      lodge_id, original_order_id, original_order_item_id,
      return_order_id, return_order_item_id, quantity
    ) values (
      v_lodge_id, v_original_order_id,
      nullif(v_return_item->>'original_order_item_id', '')::uuid,
      v_return_order_id, v_return_item_id, abs((v_return_item->>'quantity')::numeric)
    );

    -- Restore recipe ingredients from the original movement snapshot. A return
    -- never looks at today's recipe or cost; it reverses the exact sale rows.
    select coalesce(sum(abs(r.quantity)), 0)
      into v_recipe_cost
      from public.restaurant_recipe_stock_movements r
     where r.lodge_id = v_lodge_id
       and r.order_item_id = nullif(v_return_item->>'original_order_item_id', '')::uuid
       and r.order_id = v_original_order_id
       and r.quantity < 0;
    if v_recipe_cost > 0 then
      for v_recipe_row in
        select r.*
          from public.restaurant_recipe_stock_movements r
         where r.lodge_id = v_lodge_id
           and r.order_item_id = nullif(v_return_item->>'original_order_item_id', '')::uuid
           and r.order_id = v_original_order_id
           and r.quantity < 0
      loop
        v_restore_qty := abs(v_recipe_row.quantity)
          * abs((v_return_item->>'quantity')::numeric)
          / nullif((select quantity from public.pos_order_items where id = nullif(v_return_item->>'original_order_item_id', '')::uuid), 0);
        v_restore_cost := abs(coalesce(v_recipe_row.theoretical_cost, 0))
          * abs((v_return_item->>'quantity')::numeric)
          / nullif((select quantity from public.pos_order_items where id = nullif(v_return_item->>'original_order_item_id', '')::uuid), 0);
        update public.inventory_items
           set current_stock = coalesce(current_stock, 0) + v_restore_qty, updated_at = now()
         where id = v_recipe_row.inventory_item_id and lodge_id = v_lodge_id;
        perform public.restaurant_apply_stock_location_balance(
          v_lodge_id, v_recipe_row.inventory_item_id, v_stock_location_id, v_restore_qty
        );
        insert into public.restaurant_recipe_stock_movements (
          lodge_id, recipe_id, order_id, order_item_id, inventory_item_id,
          quantity, unit, movement_reason, recipe_version, theoretical_cost
        ) values (
          v_lodge_id, v_recipe_row.recipe_id, v_return_order_id, v_return_item_id,
          v_recipe_row.inventory_item_id, v_restore_qty, v_recipe_row.unit,
          'pos_return', v_recipe_row.recipe_version, v_restore_cost
        );
        insert into public.inventory_movements (
          lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
          notes, reference_type, reference_id, source, created_by,
          operation_id, payload_hash, source_document_type, source_document_id,
          valuation_method, cost_basis, recorded_at
        ) values (
          v_lodge_id, v_recipe_row.inventory_item_id, 'pos_return', v_restore_qty,
          case when v_restore_qty > 0 then v_restore_cost / v_restore_qty else 0 end,
          v_restore_cost, 'POS return ingredient reversal for ' || v_original_order_id,
          'pos_return', v_return_order_id, 'restaurant_recipe_return', v_actor_id,
          v_return_item_id, v_request_hash, 'pos_return', v_return_order_id,
          'unknown_legacy', v_restore_cost, now()
        );
      end loop;
    elsif nullif(v_return_item->>'inventory_item_id', '') is not null then
      -- Direct items have no recipe subledger. Carry forward the original
      -- movement cost when it exists; otherwise mark the legacy cost basis
      -- explicitly instead of silently using today's catalogue cost as truth.
      select coalesce(sum(abs(m.total_cost)), 0),
             coalesce(sum(abs(m.total_cost)) / nullif(sum(abs(m.quantity)), 0), 0)
        into v_original_snapshot_cost, v_direct_unit_cost
        from public.inventory_movements m
       where m.lodge_id = v_lodge_id
         and m.item_id = nullif(v_return_item->>'inventory_item_id', '')::uuid
         and (m.reference_id = v_original_order_id or exists (
           select 1 from public.pos_order_items oi
            where oi.id = m.reference_id and oi.order_id = v_original_order_id
         ))
         and m.movement_type in ('sale', 'pos_sale', 'recipe_sale');
      v_restore_qty := abs((v_return_item->>'quantity')::numeric)
        * coalesce((v_return_item->>'depletion_qty')::numeric, 1);
      v_direct_cost := round(v_direct_unit_cost * v_restore_qty, 2);
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + v_restore_qty, updated_at = now()
       where id = nullif(v_return_item->>'inventory_item_id', '')::uuid and lodge_id = v_lodge_id;
      perform public.restaurant_apply_stock_location_balance(
        v_lodge_id, nullif(v_return_item->>'inventory_item_id', '')::uuid, v_stock_location_id, v_restore_qty
      );
      insert into public.inventory_movements (
        lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
        notes, reference_type, reference_id, source, created_by,
        operation_id, payload_hash, source_document_type, source_document_id,
        valuation_method, cost_basis, recorded_at
      ) values (
        v_lodge_id, nullif(v_return_item->>'inventory_item_id', '')::uuid, 'pos_return',
        v_restore_qty, v_direct_unit_cost, v_direct_cost,
        case when v_original_snapshot_cost > 0 then 'POS return direct-stock reversal'
          else 'POS return direct-stock reversal; legacy cost basis unavailable' end,
        'pos_return', v_return_order_id, 'restaurant_direct_return', v_actor_id,
        v_return_item_id, v_request_hash, 'pos_return', v_return_order_id,
        case when v_original_snapshot_cost > 0 then 'standard_cost' else 'unknown_legacy' end,
        v_direct_cost, now()
      );
    end if;
  end loop;

  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by,
    reason, outlet_id, created_at, return_order_id, return_total
  ) values (
    coalesce(nullif(payload->>'override_log_id', '')::uuid, gen_random_uuid()),
    v_lodge_id, v_original_order_id, 'partial_return', v_actor_id,
    v_approver_id, v_reason, v_original.outlet_id, now(), v_return_order_id, v_total_refund
  );

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    approver_id, device_id, action, entity_type, entity_id, staff_id,
    amount_delta, idempotency_key, after_snapshot, details
  ) values (
    v_lodge_id, v_original.outlet_id, v_shift_id, v_return_order_id,
    v_actor_id, coalesce(v_actor_id, v_shift.cashier_id), v_approver_id,
    v_device_id, 'pos_return_created', 'pos_return', v_return_order_id,
    v_approver_id, -v_total_refund, v_key,
    jsonb_build_object('original_order_id', v_original_order_id,
      'total', -v_total_refund, 'payment_breakdown', v_refund_breakdown,
      'items', v_return_items), jsonb_build_object('reason', v_reason)
  );

  v_result := jsonb_build_object(
    'success', true, 'id', v_return_order_id, 'original_order_id', v_original_order_id,
    'total', -v_total_refund, 'gross_total', -v_total_gross,
    'discount_total', -v_total_discount, 'tax_total', -v_total_tax,
    'tip_total', -v_total_tip, 'payment_breakdown', v_refund_breakdown,
    'shift_id', v_shift_id, 'approved_by', v_approver_id, 'items', v_return_items
  );
  perform public._record_financial_operation(
    v_lodge_id, v_key, 'create_pos_return_v3', v_return_order_id, v_request_hash, v_result
  );
  return v_result;
end;
$$;

-- The return function above writes explicit `pos_return` inventory rows. Keep
-- direct POS stock movement evidence in the same source transaction so a sale
-- has a transaction-time cost snapshot available for a later return.
create or replace function public.restaurant_apply_direct_pos_stock_location_depletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet_id uuid;
  v_location_id uuid;
  v_required numeric;
  v_after numeric;
  v_unit_cost numeric;
begin
  if new.inventory_item_id is null or coalesce(new.quantity, 0) <= 0 then
    return new;
  end if;
  if exists (
    select 1 from public.restaurant_recipes r
    where r.lodge_id = new.lodge_id and r.menu_item_id = new.menu_item_id and r.active
  ) then
    return new;
  end if;
  select o.outlet_id into v_outlet_id
    from public.pos_orders o where o.id = new.order_id and o.lodge_id = new.lodge_id;
  select s.stock_location_id into v_location_id
    from public.restaurant_outlet_stock_locations s
   where s.lodge_id = new.lodge_id and s.outlet_id is not distinct from v_outlet_id;
  v_location_id := coalesce(v_location_id, public.restaurant_default_stock_location(new.lodge_id));
  v_required := new.quantity * public._positive_depletion_qty(new.depletion_qty, 1);
  select coalesce(ii.current_stock, 0), coalesce(ii.latest_unit_cost, 0)
    into v_after, v_unit_cost
    from public.inventory_items ii
   where ii.id = new.inventory_item_id and ii.lodge_id = new.lodge_id;
  perform public.restaurant_apply_stock_location_balance(new.lodge_id, new.inventory_item_id, v_location_id, -v_required);
  insert into public.inventory_movements (
    lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
    notes, reference_type, reference_id, source, created_by,
    operation_id, source_document_type, source_document_id, valuation_method,
    quantity_after, cost_basis, recorded_at
  ) values (
    new.lodge_id, new.inventory_item_id, 'pos_sale', -v_required, v_unit_cost,
    -v_required * v_unit_cost, 'Direct POS stock depletion', 'pos_order_item', new.id,
    'pos', public.app_current_user_id(), new.id, 'pos_order_item', new.id,
    'standard_cost', v_after, abs(v_required * v_unit_cost), now()
  ) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_restaurant_direct_pos_stock_location_depletion on public.pos_order_items;
create trigger trg_restaurant_direct_pos_stock_location_depletion
after insert on public.pos_order_items
for each row execute function public.restaurant_apply_direct_pos_stock_location_depletion();

-- Include explicit return movements in the same typed COGS/inventory control
-- account calculation. This is the latest effective-mapping implementation of
-- the helper; the only behavioral extension is the `pos_return` movement type.
create or replace function public._restaurant_post_pos_order_to_gl_v2(p_lodge_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  p_lodge uuid := p_lodge_id;
  o public.pos_orders%rowtype; p jsonb; m record; a uuid; lines jsonb:='[]'::jsonb;
  tender_total numeric:=0; tender_amount numeric; gross numeric; disc numeric; tax numeric; tips numeric; total numeric; category_total numeric:=0;
  is_return boolean; business_date date; journal jsonb; operation_id uuid; payload_hash text; customer uuid; voucher uuid;
  account_balance numeric; credit_limit numeric; remaining numeric; cost numeric; cogs uuid; inventory_account uuid; actor uuid;
begin
  if not public.restaurant_accounting_is_active(p_lodge) then return jsonb_build_object('success',true,'skipped',true,'reason','accounting_not_active'); end if;
  select * into o from public.pos_orders where id=p_order_id and lodge_id=p_lodge for update;
  if not found or o.status not in('completed','settled') then raise exception 'Only completed POS orders can be posted' using errcode='22023'; end if;
  select * into m from public.restaurant_financial_source_postings where lodge_id=p_lodge and source_type='pos_order' and source_id=p_order_id and status='posted' for share;
  if found then return jsonb_build_object('success',true,'replayed',true,'journal_entry_id',m.journal_entry_id); end if;
  actor:=coalesce(public.app_current_user_id(),o.cashier_id); operation_id:=p_order_id;
  payload_hash:=encode(digest(to_jsonb(o)::text||coalesce(o.payment_breakdown,'[]'::jsonb)::text,'sha256'),'hex');
  is_return:=coalesce(o.transaction_type,'sale')='return';
  gross:=abs(round(coalesce(nullif(o.gross_total,0),o.total),2)); disc:=abs(round(coalesce(o.discount_total,0),2)); tax:=abs(round(coalesce(o.tax_total,0),2)); tips:=abs(round(coalesce(o.tip_total,0),2)); total:=abs(round(o.total,2));
  business_date:=coalesce(o.business_date,(o.completed_at at time zone coalesce((select nullif(timezone,'') from public.settings where lodge_id=p_lodge),'Africa/Gaborone'))::date,public.get_lodge_business_date(p_lodge));
  for m in select lower(coalesce(nullif(btrim(i.category),''),'uncategorized')) category,round(sum(abs(coalesce(nullif(i.gross_subtotal,0),i.unit_price*i.quantity))),2) amount from public.pos_order_items i where i.order_id=p_order_id and i.lodge_id=p_lodge group by lower(coalesce(nullif(btrim(i.category),''),'uncategorized')) loop
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='revenue' where x.lodge_id=p_lodge and x.mapping_type='category' and x.source_key=m.category and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    if a is null then raise exception 'No active GL revenue mapping for POS category %',m.category using errcode='23503'; end if;
    category_total:=category_total+m.amount;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when is_return then m.amount else 0 end,'credit',case when is_return then 0 else m.amount end,'memo','POS revenue '||m.category));
  end loop;
  if round(category_total,2)<>gross then raise exception 'POS item gross does not reconcile to order gross' using errcode='23514'; end if;
  for p in select value from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' and jsonb_array_length(o.payment_breakdown)>0 then o.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(o.payment_method,'cash'),'amount',o.total)) end) loop
    if coalesce((p->>'amount')::numeric,0)=0 then raise exception 'POS tender amount must be non-zero' using errcode='22023'; end if;
    tender_amount:=abs(round((p->>'amount')::numeric,2)); tender_total:=tender_total+tender_amount; customer:=nullif(p->>'customer_id','')::uuid; voucher:=nullif(p->>'voucher_id','')::uuid;
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active where x.lodge_id=p_lodge and x.mapping_type='tender' and x.source_key=lower(btrim(coalesce(p->>'method',o.payment_method,'cash'))) and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date) and ((lower(p->>'method')='voucher' and ac.account_type='liability') or lower(p->>'method')<>'voucher' and ac.account_type='asset');
    if a is null and lower(p->>'method')='account' then select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='asset' where x.lodge_id=p_lodge and x.mapping_type='tender' and x.source_key in('account','ar') and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date) order by case when x.source_key='account' then 0 else 1 end limit 1; end if;
    if a is null then raise exception 'No active GL tender mapping for %',lower(coalesce(p->>'method',o.payment_method,'cash')) using errcode='23503'; end if;
    if lower(p->>'method')='account' then
      if customer is null then raise exception 'Account tender requires customer_id' using errcode='22023'; end if;
      perform 1 from public.restaurant_customers where id=customer and lodge_id=p_lodge and account_status='active' for update;
      if not found then raise exception 'Customer account is missing or suspended' using errcode='42501'; end if;
      select coalesce(sum(amount),0) into account_balance from public.restaurant_account_ledger where lodge_id=p_lodge and customer_id=customer and reversed_at is null;
      select credit_limit into credit_limit from public.restaurant_customers where id=customer and lodge_id=p_lodge;
      if not is_return and credit_limit is not null and account_balance+tender_amount>credit_limit then raise exception 'Customer credit limit would be exceeded' using errcode='55000'; end if;
      insert into public.restaurant_account_ledger(lodge_id,customer_id,order_id,amount,reason,description,source_version,operation_id,payload_hash,balance_after) values(p_lodge,customer,p_order_id,case when is_return then -tender_amount else tender_amount end,case when is_return then 'return' else 'charge' end,'POS order '||p_order_id,1,operation_id,payload_hash,case when is_return then account_balance-tender_amount else account_balance+tender_amount end) on conflict do nothing;
    elsif lower(p->>'method')='voucher' then
      if voucher is null then voucher:=(select id from public.restaurant_vouchers where lodge_id=p_lodge and lower(code)=lower(p->>'code') and status='active' limit 1); end if;
      select remaining_value into remaining from public.restaurant_vouchers where id=voucher and lodge_id=p_lodge and status='active' for update;
      if not found or (not is_return and remaining<tender_amount) then raise exception 'Voucher is missing, inactive, or has insufficient balance' using errcode='55000'; end if;
      insert into public.restaurant_voucher_ledger(lodge_id,voucher_id,order_id,operation_id,amount,balance_after,reason,created_by) values(p_lodge,voucher,p_order_id,operation_id,case when is_return then tender_amount else -tender_amount end,case when is_return then remaining+tender_amount else remaining-tender_amount end,case when is_return then 'return' else 'redeem' end,actor) on conflict(lodge_id,operation_id) do nothing;
      update public.restaurant_vouchers
         set remaining_value=case when is_return then remaining_value+tender_amount else remaining_value-tender_amount end,
             status=case
               when is_return and remaining_value+tender_amount > 0 then 'active'
               when not is_return and remaining_value-tender_amount<=0 then 'redeemed'
               else status
             end,
             updated_at=now()
       where id=voucher and lodge_id=p_lodge;
    end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when is_return then 0 else tender_amount end,'credit',case when is_return then tender_amount else 0 end,'memo','POS tender '||lower(coalesce(p->>'method',o.payment_method,'cash'))));
  end loop;
  if round(tender_total,2)<>total then raise exception 'POS tender breakdown does not reconcile to order total' using errcode='23514'; end if;
  for m in select * from(values('discount',disc),('tax',tax),('tips',tips))q(mapping_type,amount) where amount>0 loop
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active where x.lodge_id=p_lodge and x.mapping_type=m.mapping_type and x.source_key='default' and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    if a is null then raise exception 'No active default GL mapping for %',m.mapping_type using errcode='23503'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when m.mapping_type='discount' and not is_return then m.amount when m.mapping_type<>'discount' and is_return then m.amount else 0 end,'credit',case when m.mapping_type='discount' and is_return then m.amount when m.mapping_type<>'discount' and not is_return then m.amount else 0 end,'memo','POS '||m.mapping_type));
  end loop;
  select coalesce(sum(abs(mv.total_cost)),0) into cost
    from public.inventory_movements mv
   where mv.lodge_id=p_lodge
     and (mv.reference_id=p_order_id or mv.source_document_id=p_order_id or exists (
       select 1 from public.pos_order_items oi
        where oi.id = mv.reference_id and oi.order_id = p_order_id
     ))
     and mv.movement_type in('recipe_sale','sale','pos_sale','pos_return');
  if cost>0 then
    select x.account_id into cogs from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='expense' where x.lodge_id=p_lodge and x.mapping_type='cogs' and x.source_key='default' and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    select x.account_id into inventory_account from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='asset' where x.lodge_id=p_lodge and x.mapping_type='inventory' and x.source_key='default' and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    if cogs is null or inventory_account is null then raise exception 'Typed COGS and inventory mappings are required before POS activation' using errcode='23503'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',case when is_return then inventory_account else cogs end,'debit',case when is_return then 0 else cost end,'credit',case when is_return then cost else 0 end,'memo','POS COGS'),jsonb_build_object('account_id',case when is_return then cogs else inventory_account end,'debit',case when is_return then cost else 0 end,'credit',case when is_return then 0 else cost end,'memo','POS inventory movement'));
  end if;
  journal:=public._restaurant_post_journal(p_lodge,business_date,'POS '||coalesce(o.transaction_type,'sale')||' '||coalesce(o.receipt_number,p_order_id::text),'pos_'||coalesce(o.transaction_type,'sale'),p_order_id,o.receipt_number,'pos-order:'||p_order_id::text,lines,actor,null);
  perform public.record_restaurant_source_posting(p_lodge,'pos_order',p_order_id,business_date,(journal->'data'->>'entry_id')::uuid,operation_id,payload_hash,1,o.outlet_id,'posted');
  return jsonb_build_object('success',true,'journal_entry_id',(journal->'data'->>'entry_id')::uuid,'replayed',coalesce((journal->'data'->>'replayed')::boolean,false),'source_posting',true);
end
$$;

revoke all on function public.create_pos_return_v3(jsonb) from public;
grant execute on function public.create_pos_return_v3(jsonb) to anon, authenticated, service_role;
revoke all on function public.restaurant_apply_direct_pos_stock_location_depletion() from public;
grant execute on function public.restaurant_apply_direct_pos_stock_location_depletion() to service_role;

commit;
