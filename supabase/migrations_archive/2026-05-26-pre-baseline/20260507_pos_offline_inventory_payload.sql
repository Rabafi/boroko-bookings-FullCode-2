create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id                uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id                uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id               uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id                 uuid := nullif(payload->>'room_id', '')::uuid;
  v_booking_id              uuid := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name            text := nullif(payload->>'walk_in_name', '');
  v_notes                   text := nullif(payload->>'notes', '');
  v_payment_method          text := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_create_idempotency_key  text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client       timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay               boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id             uuid;
  v_existing_total          numeric;
  v_existing_charge_id      uuid;
  v_item                    jsonb;
  v_menu_item_id            uuid;
  v_inv_item_id             uuid;
  v_depletion_qty           numeric;
  v_quantity                numeric;
  v_db_price                numeric;
  v_unit_price              numeric;
  v_item_name               text;
  v_computed_total          numeric := 0;
  v_is_available            boolean;
  v_required_stock          numeric;
  v_new_stock               numeric;
  v_folio_charge_id         uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  if v_payment_method = 'folio' and v_booking_id is null and v_room_id is not null then
    select b.id
      into v_booking_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.room_id = v_room_id
       and b.status in ('confirmed', 'checked_in')
       and b.check_in <= current_date
       and b.check_out > current_date
     order by b.check_in desc, b.created_at desc
     limit 1;
  end if;

  if v_payment_method = 'folio' then
    if v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Room folio charge requires an active booking');
    end if;

    if not exists (
      select 1
        from public.bookings b
       where b.id = v_booking_id
         and b.lodge_id = v_lodge_id
         and b.status in ('confirmed', 'checked_in')
    ) then
      return jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
    end if;
  end if;

  if v_create_idempotency_key is not null then
    select id, total, folio_charge_id
      into v_existing_id, v_existing_total, v_existing_charge_id
      from public.pos_orders
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_create_idempotency_key
     for update;

    if found then
      if coalesce(v_existing_total, 0) <= 0 then
        return jsonb_build_object('success', false, 'error', 'Existing POS order is incomplete and needs review before replay');
      end if;

      if v_payment_method = 'folio' and v_existing_charge_id is null then
        return jsonb_build_object('success', false, 'error', 'Existing folio POS order is missing its booking charge and needs review');
      end if;

      return jsonb_build_object(
        'success', true,
        'id', v_existing_id,
        'total', coalesce(v_existing_total, 0),
        'idempotent', true,
        'replayed', true
      );
    end if;
  end if;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
        v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
        if v_inv_item_id is null then
          select case when count(*) = 1 then max(id) else null end
            into v_inv_item_id
            from public.inventory_items
           where lodge_id = v_lodge_id
             and name = v_item_name
             and (v_outlet_id is null or outlet_id = v_outlet_id);
        end if;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
      if v_inv_item_id is null then
        select case when count(*) = 1 then max(id) else null end
          into v_inv_item_id
          from public.inventory_items
         where lodge_id = v_lodge_id
           and name = v_item_name
           and (v_outlet_id is null or outlet_id = v_outlet_id);
      end if;
    end if;

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);
  end loop;

  insert into public.pos_orders (
    id,
    lodge_id,
    room_id,
    booking_id,
    walk_in_name,
    total,
    notes,
    payment_method,
    outlet_id,
    status,
    created_at,
    create_idempotency_key,
    folio_charge_id
  ) values (
    v_order_id,
    v_lodge_id,
    v_room_id,
    v_booking_id,
    v_walk_in_name,
    v_computed_total,
    v_notes,
    v_payment_method,
    v_outlet_id,
    'completed',
    coalesce(v_created_at_client, now()),
    v_create_idempotency_key,
    null
  );

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
        v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
        if v_inv_item_id is null then
          select case when count(*) = 1 then max(id) else null end
            into v_inv_item_id
            from public.inventory_items
           where lodge_id = v_lodge_id
             and name = v_item_name
             and (v_outlet_id is null or outlet_id = v_outlet_id);
        end if;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
      if v_inv_item_id is null then
        select case when count(*) = 1 then max(id) else null end
          into v_inv_item_id
          from public.inventory_items
         where lodge_id = v_lodge_id
           and name = v_item_name
           and (v_outlet_id is null or outlet_id = v_outlet_id);
      end if;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item_name,
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price
    );

    if v_inv_item_id is not null then
      v_required_stock := coalesce(v_depletion_qty, 1) * v_quantity;

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) - v_required_stock
       where id = v_inv_item_id
         and lodge_id = v_lodge_id
         and coalesce(current_stock, 0) >= v_required_stock
      returning current_stock into v_new_stock;

      if not found then
        raise exception 'Not enough stock left for %. Refresh the POS and try again.', v_item_name;
      end if;
    end if;
  end loop;

  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      booking_id,
      lodge_id,
      description,
      category,
      quantity,
      amount,
      outlet_id
    ) values (
      v_booking_id,
      v_lodge_id,
      'POS folio charge · order ' || left(v_order_id::text, 8),
      'pos',
      1,
      v_computed_total,
      v_outlet_id
    )
    returning id into v_folio_charge_id;

    update public.pos_orders
       set folio_charge_id = v_folio_charge_id
     where id = v_order_id
       and lodge_id = v_lodge_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_computed_total,
    'booking_id', v_booking_id,
    'folio_charge_id', v_folio_charge_id
  );
end;
$function$;

revoke all on function public.create_pos_order(jsonb) from public;
grant execute on function public.create_pos_order(jsonb) to anon, authenticated;
