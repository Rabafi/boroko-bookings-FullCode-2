-- Lodge & Camp release-blocker repair (2026-07-11)
-- Fixes live POS contract regressions, guest-portal tenancy/token defects,
-- missing portal RPCs, and Manager PWA session/auth hardening.
-- Online deposit/hosted checkout work is intentionally excluded.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POS: restore create_pos_order_v3 with station tickets + event folio
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_pos_order_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_snapshot_id uuid := nullif(payload->>'catalog_snapshot_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'id', '')::uuid;
  v_idempotency_key text := nullif(btrim(coalesce(payload->>'create_idempotency_key', '')), '');
  v_client_at timestamptz := nullif(payload->>'client_created_at', '')::timestamptz;
  v_device_id text := nullif(btrim(coalesce(payload->>'source_device_id', '')), '');
  v_payment_method text := lower(coalesce(nullif(payload->>'payment_method', ''), 'cash'));
  v_payment_breakdown jsonb := coalesce(payload->'payment_breakdown', '[]'::jsonb);
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_manual_discount jsonb := coalesce(payload->'manual_discount', '{}'::jsonb);
  v_promotion_id uuid := nullif(payload->>'promotion_id', '')::uuid;
  v_tip_total numeric := round(greatest(0, coalesce(nullif(payload->>'tip_total', '')::numeric, 0)), 2);
  v_booking_id uuid := nullif(payload->>'booking_id', '')::uuid;
  v_room_id uuid := nullif(payload->>'room_id', '')::uuid;
  v_event_booking_id uuid := nullif(payload->>'event_booking_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_operator_id uuid;
  v_actor_role text := lower(coalesce(public.app_current_role(), ''));
  v_snapshot record;
  v_shift record;
  v_offline_hours integer := 72;
  v_request_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_line jsonb;
  v_catalog_item jsonb;
  v_modifier_group jsonb;
  v_modifier_option jsonb;
  v_modifier_id text;
  v_modifier_ids jsonb;
  v_resolved_modifiers jsonb;
  v_priced_items jsonb := '[]'::jsonb;
  v_priced_line jsonb;
  v_menu_item_id uuid;
  v_inventory_item_id uuid;
  v_quantity numeric;
  v_depletion_qty numeric;
  v_base_price numeric;
  v_modifier_total numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_gross_total numeric := 0;
  v_discount_total numeric := 0;
  v_promotion_discount numeric := 0;
  v_manual_discount_amount numeric := 0;
  v_promotion jsonb;
  v_promotion_base numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric := 0;
  v_payment_total numeric := 0;
  v_payment jsonb;
  v_usage record;
  v_stock numeric;
  v_line_count integer;
  v_line_index integer := 0;
  v_discount_allocated numeric := 0;
  v_tax_allocated numeric := 0;
  v_line_discount numeric;
  v_line_tax numeric;
  v_line_net numeric;
  v_order_item_id uuid;
  v_authoritative_items jsonb := '[]'::jsonb;
  v_folio_charge_id uuid;
  v_is_event_folio boolean := false;
  v_station_groups jsonb := '{}'::jsonb;
  v_station_key text;
  v_station_items jsonb;
  v_outlet_type text := '';
  v_default_station text := 'kitchen';
  v_ticket_id uuid;
  v_ticket_items jsonb;
  v_tickets_created jsonb := '[]'::jsonb;
  v_ticket record;
begin
  if v_lodge_id is null or v_order_id is null or v_snapshot_id is null
     or v_shift_id is null or v_idempotency_key is null or v_client_at is null then
    return jsonb_build_object(
      'success', false,
      'error', 'id, lodge_id, catalog_snapshot_id, shift_id, client_created_at and create_idempotency_key are required'
    );
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one POS item is required');
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );
  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  end if;

  v_request_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3', v_order_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return v_claim->'operation_result';
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  select s.*
    into v_snapshot
    from public.pos_catalog_snapshots s
   where s.id = v_snapshot_id
   for share;

  if not found
     or v_snapshot.lodge_id <> v_lodge_id
     or v_snapshot.outlet_id is distinct from v_outlet_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Catalog snapshot is missing or belongs to a different lodge/outlet',
      'code', 'catalog_refresh_required',
      'manual_review_required', true
    );
  end if;

  select coalesce(s.pos_offline_trading_hours, 72)
    into v_offline_hours
    from public.settings s
   where s.lodge_id = v_lodge_id
   limit 1;

  if v_snapshot.created_at > v_client_at
     or v_client_at > now() + interval '5 minutes'
     or now() - v_client_at > make_interval(hours => greatest(1, v_offline_hours)) then
    return jsonb_build_object(
      'success', false,
      'error', 'Catalog snapshot or device timestamp is outside the permitted offline trading window',
      'code', 'catalog_refresh_required',
      'manual_review_required', true
    );
  end if;

  select s.*
    into v_shift
    from public.pos_shifts s
   where s.id = v_shift_id
     and s.lodge_id = v_lodge_id
   for update;

  if not found or lower(v_shift.status) <> 'open' then
    return jsonb_build_object(
      'success', false,
      'error', 'A valid open shift is required',
      'code', 'shift_not_open'
    );
  end if;

  if v_shift.outlet_id is distinct from v_outlet_id then
    return jsonb_build_object('success', false, 'error', 'Shift does not belong to this outlet');
  end if;

  v_operator_id := coalesce(v_actor_id, v_shift.cashier_id);
  if v_operator_id is null then
    return jsonb_build_object('success', false, 'error', 'Authenticated POS operator could not be resolved');
  end if;

  if not public.app_is_service_role()
     and v_shift.cashier_id is not null
     and v_shift.cashier_id <> v_operator_id
     and v_actor_role not in ('supervisor', 'manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'This operator is not assigned to the open shift');
  end if;

  for v_line in select value from jsonb_array_elements(v_items)
  loop
    v_menu_item_id := nullif(v_line->>'menu_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);

    if v_menu_item_id is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      return jsonb_build_object('success', false, 'error', 'Every item requires a menu_item_id and a positive whole quantity');
    end if;

    select value
      into v_catalog_item
      from jsonb_array_elements(coalesce(v_snapshot.payload->'items', '[]'::jsonb))
     where nullif(value->>'id', '')::uuid = v_menu_item_id
     limit 1;

    if v_catalog_item is null or not coalesce((v_catalog_item->>'is_available')::boolean, false) then
      return jsonb_build_object(
        'success', false,
        'error', 'Item is unavailable in the immutable catalog snapshot',
        'code', 'catalog_refresh_required',
        'manual_review_required', true
      );
    end if;

    v_base_price := round(coalesce((v_catalog_item->>'price')::numeric, 0), 2);
    v_inventory_item_id := nullif(v_catalog_item->>'inventory_item_id', '')::uuid;
    v_depletion_qty := public._positive_depletion_qty(
      nullif(v_catalog_item->>'depletion_qty', '')::numeric,
      1
    );
    v_modifier_total := 0;
    v_resolved_modifiers := '[]'::jsonb;
    v_modifier_ids := coalesce(v_line->'modifier_option_ids', '[]'::jsonb);

    if jsonb_typeof(v_modifier_ids) <> 'array' or jsonb_array_length(v_modifier_ids) = 0 then
      select coalesce(jsonb_agg(m->>'id'), '[]'::jsonb)
        into v_modifier_ids
        from jsonb_array_elements(coalesce(v_line->'modifiers', '[]'::jsonb)) m
       where nullif(m->>'id', '') is not null;
    end if;

    for v_modifier_id in select value from jsonb_array_elements_text(v_modifier_ids)
    loop
      v_modifier_option := null;
      for v_modifier_group in
        select value
          from jsonb_array_elements(coalesce(v_snapshot.payload->'modifier_groups', '[]'::jsonb))
      loop
        if coalesce((v_modifier_group->>'active')::boolean, true)
           and (
             jsonb_array_length(coalesce(v_modifier_group->'applies_to_categories', '[]'::jsonb)) = 0
             or exists (
               select 1
                 from jsonb_array_elements_text(v_modifier_group->'applies_to_categories') c
                where lower(c.value) = lower(coalesce(v_catalog_item->>'category', 'Other'))
             )
           ) then
          select value
            into v_modifier_option
            from jsonb_array_elements(coalesce(v_modifier_group->'options', '[]'::jsonb))
           where value->>'id' = v_modifier_id
           limit 1;
          exit when v_modifier_option is not null;
        end if;
      end loop;

      if v_modifier_option is null then
        return jsonb_build_object(
          'success', false,
          'error', 'A selected modifier is not valid for this item',
          'code', 'catalog_refresh_required'
        );
      end if;

      v_modifier_total := v_modifier_total + coalesce((v_modifier_option->>'price_delta')::numeric, 0);
      v_resolved_modifiers := v_resolved_modifiers || jsonb_build_array(v_modifier_option);
    end loop;

    v_unit_price := round(v_base_price + v_modifier_total, 2);
    v_line_gross := round(v_quantity * v_unit_price, 2);
    v_gross_total := v_gross_total + v_line_gross;

    v_priced_items := v_priced_items || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'item_name', v_catalog_item->>'name',
      'category', coalesce(v_catalog_item->>'category', 'Other'),
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'gross_subtotal', v_line_gross,
      'inventory_item_id', v_inventory_item_id,
      'depletion_qty', v_depletion_qty,
      'modifiers', v_resolved_modifiers,
      'item_notes', nullif(v_line->>'item_notes', '')
    ));
  end loop;

  if v_promotion_id is not null then
    select value
      into v_promotion
      from jsonb_array_elements(coalesce(v_snapshot.payload->'promotions', '[]'::jsonb))
     where nullif(value->>'id', '')::uuid = v_promotion_id
       and coalesce((value->>'active')::boolean, true)
     limit 1;

    if v_promotion is null then
      return jsonb_build_object('success', false, 'error', 'Promotion is not valid in this catalog snapshot');
    end if;

    if lower(coalesce(v_promotion->>'applies_to_category', 'all')) = 'all' then
      v_promotion_base := v_gross_total;
    else
      select coalesce(sum((value->>'gross_subtotal')::numeric), 0)
        into v_promotion_base
        from jsonb_array_elements(v_priced_items)
       where lower(value->>'category') = lower(v_promotion->>'applies_to_category');
    end if;

    v_promotion_discount := case lower(coalesce(v_promotion->>'discount_type', 'amount'))
      when 'percent' then round(v_promotion_base * least(100, greatest(0, (v_promotion->>'discount_value')::numeric)) / 100, 2)
      else round(least(v_promotion_base, greatest(0, (v_promotion->>'discount_value')::numeric)), 2)
    end;
  end if;

  if jsonb_typeof(v_manual_discount) = 'object'
     and v_manual_discount <> '{}'::jsonb
     and coalesce((v_manual_discount->>'value')::numeric, 0) > 0 then
    if not public._pos_user_has_capability(v_operator_id, 'pos.discount') then
      return jsonb_build_object('success', false, 'error', 'This operator is not authorized to apply manual discounts');
    end if;
    if nullif(btrim(coalesce(v_manual_discount->>'reason', '')), '') is null then
      return jsonb_build_object('success', false, 'error', 'Manual discount reason is required');
    end if;
    v_manual_discount_amount := case lower(coalesce(v_manual_discount->>'type', 'amount'))
      when 'percent' then round(v_gross_total * least(100, greatest(0, (v_manual_discount->>'value')::numeric)) / 100, 2)
      else round(greatest(0, (v_manual_discount->>'value')::numeric), 2)
    end;
  end if;

  v_discount_total := round(least(v_gross_total, v_promotion_discount + v_manual_discount_amount), 2);
  if coalesce(v_snapshot.vat_enabled, false) and coalesce(v_snapshot.vat_rate, 0) > 0 then
    v_tax_total := round((v_gross_total - v_discount_total) * v_snapshot.vat_rate / 100, 2);
  end if;
  v_total := round(v_gross_total - v_discount_total + v_tax_total + v_tip_total, 2);

  if jsonb_typeof(v_payment_breakdown) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'payment_breakdown must be an array');
  end if;
  for v_payment in select value from jsonb_array_elements(v_payment_breakdown)
  loop
    if coalesce((v_payment->>'amount')::numeric, 0) < 0 then
      return jsonb_build_object('success', false, 'error', 'Payment amounts cannot be negative');
    end if;
    v_payment_total := v_payment_total + coalesce((v_payment->>'amount')::numeric, 0);
  end loop;
  if abs(round(v_payment_total, 2) - v_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format('Authoritative total is %s but submitted tenders total %s', v_total, round(v_payment_total, 2)),
      'code', 'payment_total_mismatch',
      'authoritative_total', v_total,
      'manual_review_required', true
    );
  end if;

  if v_payment_method = 'folio' then
    if v_event_booking_id is not null then
      v_is_event_folio := true;
      perform 1
        from public.conference_bookings cb
       where cb.id = v_event_booking_id
         and cb.lodge_id = v_lodge_id
         and lower(coalesce(cb.status, '')) not in ('cancelled', 'voided')
       for update;
      if not found then
        return jsonb_build_object('success', false, 'error', 'Active event booking not found for folio charge');
      end if;
    elsif v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Folio payment requires booking_id or event_booking_id');
    else
      perform 1
        from public.bookings b
       where b.id = v_booking_id
         and b.lodge_id = v_lodge_id
         and b.status in ('confirmed', 'checked_in')
       for update;
      if not found then
        return jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
      end if;
    end if;
  end if;

  for v_usage in
    select
      nullif(value->>'inventory_item_id', '')::uuid as inventory_item_id,
      sum((value->>'quantity')::numeric * (value->>'depletion_qty')::numeric) as required_stock,
      min(value->>'item_name') as item_name
    from jsonb_array_elements(v_priced_items)
    where nullif(value->>'inventory_item_id', '') is not null
    group by nullif(value->>'inventory_item_id', '')::uuid
  loop
    select i.current_stock
      into v_stock
      from public.inventory_items i
     where i.id = v_usage.inventory_item_id
       and i.lodge_id = v_lodge_id
     for update;
    if not found or coalesce(v_stock, 0) < v_usage.required_stock then
      return jsonb_build_object(
        'success', false,
        'error', format('Insufficient stock for %s', v_usage.item_name),
        'code', 'insufficient_stock'
      );
    end if;
  end loop;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, event_booking_id, walk_in_name, status, total, notes,
    completed_at, payment_method, outlet_id, create_idempotency_key,
    gross_total, discount_total, tax_rate, tax_total, tip_total,
    payment_breakdown, service_mode, table_name, tab_name, waiter_name,
    cashier_id, cashier_name, shift_id, ticket_status, transaction_type,
    catalog_snapshot_id, source_device_id, client_created_at, server_received_at
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id, v_event_booking_id,
    nullif(payload->>'walk_in_name', ''), 'completed', v_total,
    nullif(payload->>'notes', ''), now(), v_payment_method, v_outlet_id,
    v_idempotency_key, v_gross_total, v_discount_total,
    coalesce(v_snapshot.vat_rate, 0), v_tax_total, v_tip_total,
    v_payment_breakdown, nullif(payload->>'service_mode', ''),
    nullif(payload->>'table_name', ''), nullif(payload->>'tab_name', ''),
    nullif(payload->>'waiter_name', ''), v_operator_id,
    (select u.name from public.users u where u.id = v_operator_id),
    v_shift_id, coalesce(nullif(payload->>'ticket_status', ''), 'new'),
    'sale', v_snapshot_id, v_device_id, v_client_at, now()
  );

  v_line_count := jsonb_array_length(v_priced_items);
  for v_priced_line in select value from jsonb_array_elements(v_priced_items)
  loop
    v_line_index := v_line_index + 1;
    v_line_gross := (v_priced_line->>'gross_subtotal')::numeric;
    if v_line_index = v_line_count then
      v_line_discount := v_discount_total - v_discount_allocated;
      v_line_tax := v_tax_total - v_tax_allocated;
    else
      v_line_discount := case when v_gross_total > 0
        then round(v_line_gross * v_discount_total / v_gross_total, 2)
        else 0 end;
      v_line_tax := case when v_gross_total - v_discount_total > 0
        then round((v_line_gross - v_line_discount) * v_tax_total / (v_gross_total - v_discount_total), 2)
        else 0 end;
    end if;
    v_discount_allocated := v_discount_allocated + v_line_discount;
    v_tax_allocated := v_tax_allocated + v_line_tax;
    v_line_net := round(v_line_gross - v_line_discount + v_line_tax, 2);

    insert into public.pos_order_items (
      lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      item_notes, gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_lodge_id, v_order_id,
      nullif(v_priced_line->>'menu_item_id', '')::uuid,
      v_priced_line->>'item_name',
      (v_priced_line->>'quantity')::integer,
      (v_priced_line->>'unit_price')::numeric,
      v_line_net,
      nullif(v_priced_line->>'inventory_item_id', '')::uuid,
      (v_priced_line->>'depletion_qty')::numeric,
      v_priced_line->>'category',
      coalesce(v_priced_line->'modifiers', '[]'::jsonb),
      nullif(v_priced_line->>'item_notes', ''),
      v_line_gross, v_line_discount, v_line_tax, v_line_net
    )
    returning id into v_order_item_id;

    v_authoritative_items := v_authoritative_items || jsonb_build_array(
      v_priced_line || jsonb_build_object(
        'id', v_order_item_id,
        'discount_allocated', v_line_discount,
        'tax_allocated', v_line_tax,
        'net_subtotal', v_line_net
      )
    );
  end loop;

  for v_usage in
    select
      nullif(value->>'inventory_item_id', '')::uuid as inventory_item_id,
      sum((value->>'quantity')::numeric * (value->>'depletion_qty')::numeric) as required_stock
    from jsonb_array_elements(v_priced_items)
    where nullif(value->>'inventory_item_id', '') is not null
    group by nullif(value->>'inventory_item_id', '')::uuid
  loop
    update public.inventory_items
       set current_stock = current_stock - v_usage.required_stock,
           updated_at = now()
     where id = v_usage.inventory_item_id
       and lodge_id = v_lodge_id;
  end loop;

  -- Kitchen station prep tickets (grouped by menu-item station assignment)
  if v_outlet_id is not null then
    select lower(coalesce(o.type, ''))
      into v_outlet_type
      from public.outlets o
     where o.id = v_outlet_id
       and o.lodge_id = v_lodge_id;
    if v_outlet_type in ('beverage', 'bar') then
      v_default_station := 'bar';
    end if;
  end if;

  for v_priced_line in select value from jsonb_array_elements(v_authoritative_items)
  loop
    v_station_key := v_default_station;
    if nullif(v_priced_line->>'menu_item_id', '') is not null then
      select coalesce(s.station_key, v_default_station)
        into v_station_key
        from public.pos_menu_items mi
        left join public.pos_kitchen_stations s
          on s.id = mi.kitchen_station_id
         and s.lodge_id = v_lodge_id
         and s.enabled = true
       where mi.id = (v_priced_line->>'menu_item_id')::uuid
         and mi.lodge_id = v_lodge_id;
    end if;
    if v_station_key is null or v_station_key = '' then
      v_station_key := v_default_station;
    end if;
    v_station_items := coalesce(v_station_groups->v_station_key, '[]'::jsonb);
    v_station_groups := v_station_groups || jsonb_build_object(
      v_station_key,
      v_station_items || jsonb_build_array(v_priced_line)
    );
  end loop;

  for v_station_key in select jsonb_object_keys(v_station_groups)
  loop
    v_ticket_items := v_station_groups->v_station_key;
    v_ticket_id := gen_random_uuid();
    insert into public.pos_prep_tickets (
      id, lodge_id, order_id, outlet_id, station, status,
      table_name, tab_name, waiter_name, room_id, notes, items
    ) values (
      v_ticket_id, v_lodge_id, v_order_id, v_outlet_id,
      v_station_key, 'new',
      nullif(payload->>'table_name', ''),
      nullif(payload->>'tab_name', ''),
      nullif(payload->>'waiter_name', ''),
      v_room_id,
      nullif(payload->>'notes', ''),
      v_ticket_items
    )
    returning * into v_ticket;
    v_tickets_created := v_tickets_created || jsonb_build_array(to_jsonb(v_ticket));
  end loop;

  if v_payment_method = 'folio' then
    if v_is_event_folio then
      insert into public.event_booking_line_items (
        event_booking_id, lodge_id, line_type, description, category,
        quantity, unit_price, subtotal, created_by
      ) values (
        v_event_booking_id, v_lodge_id, 'pos',
        'POS order ' || left(v_order_id::text, 8),
        'pos', 1, v_total, v_total, v_actor_id
      )
      returning id into v_folio_charge_id;

      update public.pos_orders
         set folio_charge_id = v_folio_charge_id
       where id = v_order_id;

      perform public.recalculate_event_totals(v_event_booking_id);
    else
      insert into public.booking_charges (
        lodge_id, booking_id, description, amount, category, quantity,
        outlet_id, source_type, source_id
      ) values (
        v_lodge_id, v_booking_id,
        'POS order ' || left(v_order_id::text, 8),
        v_total, 'pos', 1, v_outlet_id, 'pos_order', v_order_id
      )
      returning id into v_folio_charge_id;

      update public.pos_orders
         set folio_charge_id = v_folio_charge_id
       where id = v_order_id;
    end if;
  end if;

  if v_manual_discount_amount > 0 then
    insert into public.pos_audit_log (
      lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
      device_id, action, entity_type, entity_id, staff_id, amount_delta,
      idempotency_key, client_at, after_snapshot, details
    ) values (
      v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
      v_device_id, 'pos_discount_applied', 'pos_order', v_order_id, v_operator_id,
      -v_manual_discount_amount, v_idempotency_key, v_client_at,
      v_manual_discount, v_manual_discount
    );
  end if;

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    device_id, action, entity_type, entity_id, staff_id, amount_delta,
    idempotency_key, client_at, after_snapshot, details
  ) values (
    v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
    v_device_id, 'pos_order_created', 'pos_order', v_order_id, v_operator_id,
    v_total, v_idempotency_key, v_client_at,
    jsonb_build_object(
      'total', v_total, 'gross_total', v_gross_total,
      'discount_total', v_discount_total, 'tax_total', v_tax_total,
      'tip_total', v_tip_total, 'catalog_snapshot_id', v_snapshot_id,
      'items', v_authoritative_items
    ),
    jsonb_build_object('payment_method', v_payment_method, 'folio_charge_id', v_folio_charge_id)
  );

  v_result := jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_total,
    'gross_total', v_gross_total,
    'discount_total', v_discount_total,
    'tax_rate', coalesce(v_snapshot.vat_rate, 0),
    'tax_total', v_tax_total,
    'tip_total', v_tip_total,
    'payment_method', v_payment_method,
    'payment_breakdown', v_payment_breakdown,
    'catalog_snapshot_id', v_snapshot_id,
    'shift_id', v_shift_id,
    'cashier_id', v_operator_id,
    'folio_charge_id', v_folio_charge_id,
    'event_booking_id', v_event_booking_id,
    'items', v_authoritative_items,
    'prep_tickets', v_tickets_created,
    'server_received_at', now()
  );

  perform public._record_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, v_request_hash, v_result
  );

  return v_result;
end;
$$;;

revoke all on function public.create_pos_order_v3(jsonb) from public;
grant execute on function public.create_pos_order_v3(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. POS: restore catalog publication against real pos_promotions columns
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.publish_pos_catalog_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_modifier_groups jsonb;
  v_promotions jsonb;
  v_vat_enabled boolean := false;
  v_vat_rate numeric := 0;
  v_next_version integer;
  v_snapshot_id uuid;
  v_payload jsonb;
  v_payload_hash text;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_lodge_id::text || ':catalog:' || coalesce(p_outlet_id::text, 'global'),
      0
    )
  );

  select coalesce(s.vat_enabled, false), coalesce(s.vat_rate, 0)
    into v_vat_enabled, v_vat_rate
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'category', m.category,
      'price', m.price,
      'is_available', coalesce(m.is_available, true),
      'inventory_item_id', m.inventory_item_id,
      'depletion_qty', public._positive_depletion_qty(m.depletion_qty, 1),
      'outlet_id', m.outlet_id,
      'barcode', m.barcode,
      'kitchen_station_id', m.kitchen_station_id
    )
    order by m.category, m.name
  ), '[]'::jsonb)
    into v_items
    from public.pos_menu_items m
   where m.lodge_id = p_lodge_id
     and (
       (p_outlet_id is null and m.outlet_id is null)
       or m.outlet_id = p_outlet_id
       or m.outlet_id is null
     );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'applies_to_categories', coalesce(g.applies_to_categories, '{}'::text[]),
      'options', coalesce(g.options, '[]'::jsonb),
      'active', g.active
    )
    order by g.name
  ), '[]'::jsonb)
    into v_modifier_groups
    from public.pos_modifier_groups g
   where g.lodge_id = p_lodge_id
     and g.active = true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'discount_type', p.discount_type,
      'discount_value', p.discount_value,
      'applies_to_category', p.applies_to_category,
      'active', p.active
    )
    order by p.name
  ), '[]'::jsonb)
    into v_promotions
    from public.pos_promotions p
   where p.lodge_id = p_lodge_id
     and p.active = true;

  v_payload := jsonb_build_object(
    'items', v_items,
    'modifier_groups', v_modifier_groups,
    'promotions', v_promotions,
    'vat_enabled', v_vat_enabled,
    'vat_rate', v_vat_rate
  );
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  select coalesce(max(s.version_number), 0) + 1
    into v_next_version
    from public.pos_catalog_snapshots s
   where s.lodge_id = p_lodge_id
     and s.outlet_id is not distinct from p_outlet_id;

  update public.pos_catalog_snapshots
     set retired_at = now()
   where lodge_id = p_lodge_id
     and outlet_id is not distinct from p_outlet_id
     and retired_at is null;

  insert into public.pos_catalog_snapshots (
    lodge_id, outlet_id, version_number, vat_enabled, vat_rate,
    payload, payload_hash
  ) values (
    p_lodge_id, p_outlet_id, v_next_version, v_vat_enabled, v_vat_rate,
    v_payload, v_payload_hash
  )
  returning id into v_snapshot_id;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot_id,
    'version_number', v_next_version,
    'payload_hash', v_payload_hash,
    'item_count', jsonb_array_length(v_items),
    'created_at', now()
  );
end;
$$;;

revoke all on function public.publish_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.publish_pos_catalog_snapshot(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. POS: restore void approval (users.pin_hash helpers + event folio reverse)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_approver_id uuid := nullif(payload->>'approved_by', '')::uuid;
  v_pin text := nullif(btrim(coalesce(payload->>'pin', '')), '');
  v_reason text := nullif(btrim(coalesce(payload->>'reason', '')), '');
  v_device_id text := coalesce(nullif(payload->>'device_id', ''), 'unknown');
  v_override_id uuid := coalesce(nullif(payload->>'override_log_id', '')::uuid, gen_random_uuid());
  v_actor_id uuid := public.app_current_user_id();
  v_order record;
  v_restored jsonb := '[]'::jsonb;
begin
  if v_lodge_id is null or v_order_id is null or v_pin is null or v_reason is null then
    return jsonb_build_object(
      'success', false,
      'error', 'lodge_id, order_id, PIN and reason are required'
    );
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  if exists (
    select 1
      from public.pos_override_log l
     where l.id = v_override_id
       and l.lodge_id = v_lodge_id
       and l.order_id = v_order_id
       and l.action = 'void'
  ) then
    return jsonb_build_object(
      'success', true,
      'id', v_order_id,
      'override_log_id', v_override_id,
      'already_applied', true
    );
  end if;

  select o.*
    into v_order
    from public.pos_orders o
   where o.id = v_order_id
     and o.lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;
  if v_order.status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;
  if v_order.status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Settled orders must be returned in the current shift, not voided');
  end if;

  if v_order.outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_order.outlet_id);
  end if;

  if v_approver_id is null then
    v_approver_id := public._pos_resolve_pin_internal(
      v_lodge_id, v_pin, 'pos.void', v_device_id
    );
  elsif not public._pos_validate_pin_internal(
    v_lodge_id, v_approver_id, v_pin, 'pos.void', v_device_id
  ) then
    v_approver_id := null;
  end if;
  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  v_restored := public._restore_pos_order_stock(v_order_id, v_lodge_id);

  if v_order.event_booking_id is not null and v_order.folio_charge_id is not null then
    update public.event_booking_line_items
       set description = description || ' [VOIDED]',
           voided_at = now(),
           void_reason = v_reason
     where id = v_order.folio_charge_id
       and event_booking_id = v_order.event_booking_id
       and voided_at is null;
    perform public.recalculate_event_totals(v_order.event_booking_id);
  elsif v_order.folio_charge_id is not null then
    perform public.delete_booking_charge(
      v_order.folio_charge_id, v_lodge_id, 'Voided with POS order'
    );
  end if;

  update public.pos_orders
     set status = 'voided',
         updated_at = now()
   where id = v_order_id;

  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by,
    reason, outlet_id, created_at
  ) values (
    v_override_id, v_lodge_id, v_order_id, 'void', v_actor_id,
    v_approver_id, v_reason, v_order.outlet_id, now()
  );

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    approver_id, device_id, action, entity_type, entity_id, staff_id,
    amount_delta, before_snapshot, after_snapshot, details
  ) values (
    v_lodge_id, v_order.outlet_id, v_order.shift_id, v_order_id,
    v_actor_id, v_order.cashier_id, v_approver_id, v_device_id,
    'pos_order_voided', 'pos_order', v_order_id, v_approver_id,
    -v_order.total,
    jsonb_build_object('status', v_order.status, 'total', v_order.total),
    jsonb_build_object('status', 'voided'),
    jsonb_build_object('reason', v_reason, 'restored_stock', v_restored)
  );

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'override_log_id', v_override_id,
    'approved_by', v_approver_id,
    'approver_name', (select u.name from public.users u where u.id = v_approver_id),
    'restored_stock', v_restored
  );
end;
$$;;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Guest portal: hashed tokens, lodge-scoped session creation, booking refs

-- Drop legacy 2-arg portal session mint (cross-tenant) in favor of lodge-scoped 3-arg contract.
drop function if exists public.create_guest_portal_session(text, text);

-- ═══════════════════════════════════════════════════════════════════════════

alter table public.guest_portal_sessions
  add column if not exists token_hash text;

-- Backfill hash for any legacy plaintext tokens still present.
update public.guest_portal_sessions
   set token_hash = public.app_hash_token(token)
 where token_hash is null
   and nullif(token, '') is not null
   and token is distinct from 'hashed';

create unique index if not exists guest_portal_sessions_token_hash_uidx
  on public.guest_portal_sessions(token_hash)
  where token_hash is not null;

create or replace function public._guest_portal_hash_token(p_token text)
returns text
language sql
stable
as $$
  select public.app_hash_token(p_token);
$$;

create or replace function public._guest_portal_resolve_session(p_token text)
returns public.guest_portal_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_hash text := public._guest_portal_hash_token(p_token);
begin
  if v_hash is null then
    return null;
  end if;

  select s.*
    into v_session
    from public.guest_portal_sessions s
   where (
          s.token_hash = v_hash
          or (s.token_hash is null and s.token = btrim(p_token))
        )
     and s.expires_at >= now()
   limit 1;

  return v_session;
end;
$$;

create or replace function public.create_guest_portal_session(
  p_customer_email text,
  p_booking_reference text,
  p_lodge_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer record;
  v_booking record;
  v_lodge_id uuid := p_lodge_id;
  v_token text;
  v_token_hash text;
  v_session_id uuid;
  v_ref text := nullif(btrim(coalesce(p_booking_reference, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_customer_email, '')), ''));
begin
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id is required');
  end if;

  -- Staff-only creation; guests never mint tokens for arbitrary customers.
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['receptionist', 'manager', 'admin', 'owner', 'super_admin']
  );

  if v_email is null then
    return jsonb_build_object('success', false, 'error', 'Customer email is required');
  end if;

  select c.id, c.name, c.lodge_id, c.email
    into v_customer
    from public.customers c
   where c.lodge_id = v_lodge_id
     and lower(btrim(coalesce(c.email, ''))) = v_email
   order by c.updated_at desc nulls last, c.created_at desc nulls last
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'No customer found with this email at this lodge');
  end if;

  if v_ref is not null then
    select b.id, b.check_in, b.check_out, b.status, b.booking_number, b.invoice_number, b.online_confirmation_token
      into v_booking
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.customer_id = v_customer.id
       and (
         b.id::text = v_ref
         or b.online_confirmation_token = v_ref
         or b.invoice_number = v_ref
         or b.booking_number::text = v_ref
         or ('BK-' || b.booking_number::text) = upper(v_ref)
       )
     order by b.created_at desc
     limit 1;
  else
    select b.id, b.check_in, b.check_out, b.status, b.booking_number, b.invoice_number, b.online_confirmation_token
      into v_booking
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.customer_id = v_customer.id
       and b.status in ('pending', 'confirmed', 'checked_in')
     order by b.check_in desc nulls last, b.created_at desc
     limit 1;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := public._guest_portal_hash_token(v_token);

  insert into public.guest_portal_sessions (
    lodge_id, customer_id, booking_id, token, token_hash, expires_at, last_activity_at
  )
  values (
    v_lodge_id,
    v_customer.id,
    v_booking.id,
    -- Store a non-secret placeholder; only the hash is used for validation.
    'hashed',
    v_token_hash,
    now() + interval '7 days',
    now()
  )
  returning id into v_session_id;

  return jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'token', v_token,
    'expires_at', (now() + interval '7 days')::text,
    'customer_name', v_customer.name,
    'lodge_id', v_lodge_id,
    'booking_id', v_booking.id
  );
end;
$$;

create or replace function public.validate_guest_portal_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_customer_name text;
  v_customer_email text;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  select c.name, c.email
    into v_customer_name, v_customer_email
    from public.customers c
   where c.id = v_session.customer_id
     and c.lodge_id = v_session.lodge_id;

  update public.guest_portal_sessions
     set last_activity_at = now(),
         token_hash = coalesce(token_hash, public._guest_portal_hash_token(p_token)),
         token = case when token is distinct from 'hashed' then 'hashed' else token end
   where id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'customer_id', v_session.customer_id,
    'customer_name', v_customer_name,
    'customer_email', v_customer_email,
    'booking_id', v_session.booking_id,
    'lodge_id', v_session.lodge_id,
    'expires_at', v_session.expires_at::text
  );
end;
$$;

create or replace function public.submit_guest_portal_request(
  p_token text,
  p_request_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_request_id uuid;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  insert into public.enterprise_guest_portal_requests (
    lodge_id, booking_id, customer_id, request_type, status, payload
  )
  values (
    v_session.lodge_id,
    v_session.booking_id,
    v_session.customer_id,
    nullif(btrim(coalesce(p_request_type, '')), ''),
    'new',
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_request_id;

  return jsonb_build_object('success', true, 'request_id', v_request_id, 'status', 'new');
end;
$$;

create or replace function public.get_guest_portal_booking_details(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_data jsonb;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  if v_session.booking_id is null then
    return jsonb_build_object('success', false, 'error', 'No booking linked to this session');
  end if;

  select jsonb_build_object(
    'booking_id', b.id,
    'customer_id', b.customer_id,
    'customer_name', c.name,
    'room_number', r.room_number,
    'room_type', r.room_type,
    'check_in', b.check_in,
    'check_out', b.check_out,
    'status', b.status,
    'total_amount', b.total_amount,
    'amount_paid', b.amount_paid,
    'balance', greatest(0, coalesce(b.total_amount, 0) - coalesce(b.amount_paid, 0)),
    'booking_reference', coalesce(
      nullif(b.invoice_number, ''),
      case when b.booking_number is not null then 'BK-' || b.booking_number::text else null end,
      left(b.id::text, 8)
    ),
    'booking_number', b.booking_number,
    'invoice_number', b.invoice_number
  ) into v_data
    from public.bookings b
    join public.customers c on c.id = b.customer_id
    left join public.rooms r on r.id = b.room_id
   where b.id = v_session.booking_id
     and b.lodge_id = v_session.lodge_id
     and b.customer_id = v_session.customer_id;

  if v_data is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found for this session');
  end if;

  return jsonb_build_object('success', true, 'booking', v_data);
end;
$$;

create or replace function public.get_guest_portal_documents(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_docs jsonb;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'document_type', d.document_type,
      'document_number', d.document_number,
      'status', d.status,
      'created_at', d.created_at
    ) order by d.created_at desc
  ) into v_docs
    from public.enterprise_documents d
   where d.lodge_id = v_session.lodge_id
     and (
       (v_session.customer_id is not null and d.subject_type = 'customer' and d.subject_id = v_session.customer_id)
       or
       (v_session.booking_id is not null and d.subject_type = 'booking' and d.subject_id = v_session.booking_id)
     )
     and d.status = 'final';

  return jsonb_build_object('success', true, 'documents', coalesce(v_docs, '[]'::jsonb));
end;
$$;

-- Guest-facing portal RPCs expected by booking-site UI
create or replace function public.get_guest_messages(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_messages jsonb;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'message', coalesce(m.payload->>'message', m.payload->>'body', m.payload->>'content', ''),
      'content', coalesce(m.payload->>'message', m.payload->>'body', m.payload->>'content', ''),
      'sender_type', coalesce(m.payload->>'sender_type', case when m.channel = 'guest_portal' then 'guest' else 'staff' end),
      'sender', coalesce(m.payload->>'sender_name', m.payload->>'sender', ''),
      'created_at', m.created_at,
      'status', m.status
    )
    order by m.created_at asc
  ), '[]'::jsonb)
    into v_messages
    from public.enterprise_guest_messages m
   where m.lodge_id = v_session.lodge_id
     and (
       (v_session.booking_id is not null and m.booking_id = v_session.booking_id)
       or (m.customer_id = v_session.customer_id)
     );

  return jsonb_build_object('success', true, 'messages', v_messages);
end;
$$;

create or replace function public.send_guest_message(p_token text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id uuid;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;
  if v_message is null then
    return jsonb_build_object('success', false, 'error', 'Message is required');
  end if;
  if length(v_message) > 2000 then
    return jsonb_build_object('success', false, 'error', 'Message is too long (max 2000 characters)');
  end if;

  insert into public.enterprise_guest_messages (
    lodge_id, booking_id, customer_id, channel, status, payload
  ) values (
    v_session.lodge_id,
    v_session.booking_id,
    v_session.customer_id,
    'guest_portal',
    'received',
    jsonb_build_object(
      'message', v_message,
      'sender_type', 'guest',
      'sender_name', 'Guest',
      'source', 'guest_portal'
    )
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'message_id', v_id);
end;
$$;

create or replace function public.get_guest_requests(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_requests jsonb;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'request_type', r.request_type,
      'status', r.status,
      'payload', r.payload,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    )
    order by r.created_at desc
  ), '[]'::jsonb)
    into v_requests
    from public.enterprise_guest_portal_requests r
   where r.lodge_id = v_session.lodge_id
     and r.customer_id = v_session.customer_id
     and (v_session.booking_id is null or r.booking_id is null or r.booking_id = v_session.booking_id);

  return jsonb_build_object('success', true, 'requests', v_requests);
end;
$$;

create or replace function public.get_guest_payment_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
  v_payments jsonb;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;
  if v_session.booking_id is null then
    return jsonb_build_object('success', true, 'payments', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'amount', p.amount,
      'method', p.method,
      'status', case when coalesce(p.amount, 0) < 0 then 'refund' else 'completed' end,
      'description', coalesce(p.notes, p.type, 'Payment'),
      'created_at', coalesce(p.paid_at, p.created_at)
    )
    order by coalesce(p.paid_at, p.created_at) desc
  ), '[]'::jsonb)
    into v_payments
    from public.payments p
   where p.lodge_id = v_session.lodge_id
     and p.booking_id = v_session.booking_id;

  return jsonb_build_object('success', true, 'payments', v_payments);
end;
$$;

-- Online payment-link generation is intentionally not implemented here.
-- Surface a clear unavailable response so the portal does not hard-fail.
create or replace function public.request_payment_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.guest_portal_sessions%rowtype;
begin
  v_session := public._guest_portal_resolve_session(p_token);
  if v_session.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  return jsonb_build_object(
    'success', false,
    'error', 'Online payment links are not enabled for this property yet. Please pay at the property or contact the front desk.',
    'code', 'online_payments_unavailable'
  );
end;
$$;

-- 2-arg mint is dropped above; only revoke the lodge-scoped 3-arg contract.
revoke all on function public.create_guest_portal_session(text, text, uuid) from public;
revoke all on function public.validate_guest_portal_session(text) from public;
revoke all on function public.submit_guest_portal_request(text, text, jsonb) from public;
revoke all on function public.get_guest_portal_booking_details(text) from public;
revoke all on function public.get_guest_portal_documents(text) from public;
revoke all on function public.get_guest_messages(text) from public;
revoke all on function public.send_guest_message(text, text) from public;
revoke all on function public.get_guest_requests(text) from public;
revoke all on function public.get_guest_payment_history(text) from public;
revoke all on function public.request_payment_link(text) from public;

-- Session validation and guest actions are public (token is the secret).
grant execute on function public.validate_guest_portal_session(text) to anon, authenticated, service_role;
grant execute on function public.submit_guest_portal_request(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.get_guest_portal_booking_details(text) to anon, authenticated, service_role;
grant execute on function public.get_guest_portal_documents(text) to anon, authenticated, service_role;
grant execute on function public.get_guest_messages(text) to anon, authenticated, service_role;
grant execute on function public.send_guest_message(text, text) to anon, authenticated, service_role;
grant execute on function public.get_guest_requests(text) to anon, authenticated, service_role;
grant execute on function public.get_guest_payment_history(text) to anon, authenticated, service_role;
grant execute on function public.request_payment_link(text) to anon, authenticated, service_role;

-- Staff minting only (no anon)
grant execute on function public.create_guest_portal_session(text, text, uuid) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Manager PWA: shorter sessions + legacy password auth throttling
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.manager_auth_rate_limits (
  key text primary key,
  hit_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.manager_auth_rate_limits enable row level security;

create or replace function public._check_manager_auth_rate_limit(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'manager:' || lower(btrim(coalesce(p_email, '')));
  v_now timestamptz := now();
  v_window interval := interval '15 minutes';
  v_max_hits integer := 8;
  v_block interval := interval '30 minutes';
  v_row public.manager_auth_rate_limits%rowtype;
begin
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    return 'Email is required';
  end if;

  insert into public.manager_auth_rate_limits(key, hit_count, window_started_at, updated_at)
  values (v_key, 0, v_now, v_now)
  on conflict (key) do nothing;

  select * into v_row
    from public.manager_auth_rate_limits
   where key = v_key
   for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return 'Too many login attempts. Try again later.';
  end if;

  if v_row.window_started_at <= (v_now - v_window) then
    update public.manager_auth_rate_limits
       set hit_count = 1,
           window_started_at = v_now,
           blocked_until = null,
           updated_at = v_now
     where key = v_key;
    return null;
  end if;

  if v_row.hit_count + 1 > v_max_hits then
    update public.manager_auth_rate_limits
       set hit_count = v_row.hit_count + 1,
           blocked_until = v_now + v_block,
           updated_at = v_now
     where key = v_key;
    return 'Too many login attempts. Try again later.';
  end if;

  update public.manager_auth_rate_limits
     set hit_count = v_row.hit_count + 1,
         updated_at = v_now
   where key = v_key;

  return null;
end;
$$;

create or replace function public.app_session_ttl(p_session_type text)
returns interval
language sql
immutable
as $$
  select case
    when lower(coalesce(btrim(p_session_type), '')) = 'pwa' then interval '14 days'
    else interval '7 days'
  end;
$$;

-- Keep refresh_pwa_app_session but tighten the max age window from 365 days to 14.
create or replace function public.refresh_pwa_app_session(p_session_token text default null::text)
returns table (
  contract_version integer,
  authenticated boolean,
  session_type text,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := public.app_request_session_token(p_session_token);
  v_session public.app_sessions%rowtype;
  v_expires_at timestamptz;
begin
  if v_token is null then
    return;
  end if;

  select s.*
    into v_session
    from public.app_sessions s
    join public.users u
      on u.id = s.user_id
     and u.lodge_id = s.lodge_id
    left join lateral (
      select public.get_lodge_entitlement(s.lodge_id) as entitlement
    ) ent on true
   where s.token_hash = public.app_hash_token(v_token)
     and s.revoked_at is null
     and s.session_type = 'pwa'
     and s.created_at > now() - interval '14 days'
     and public._is_pwa_role_eligible(u.role)
     and coalesce(u.pwa_enabled, false) = true
     and coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) = true
   limit 1;

  if v_session.id is null then
    return;
  end if;

  v_expires_at := now() + public.app_session_ttl('pwa');

  update public.app_sessions
     set expires_at = v_expires_at,
         last_seen_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('trusted_device_refreshed_at', now())
   where app_sessions.id = v_session.id;

  return query
  select
    2 as contract_version,
    true as authenticated,
    'pwa'::text as session_type,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
    v_token as session_token,
    v_expires_at as session_expires_at
  from public.users u
  left join lateral (
    select settings.lodge_name, settings.company_name
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(u.lodge_id) as entitlement
  ) ent on true
  where u.id = v_session.user_id
    and u.lodge_id = v_session.lodge_id
  limit 1;
end;
$$;

-- Wrap authenticate_manager with rate limiting by replacing it via a temporary
-- save/restore pattern is hard without the full body. Instead, create a
-- security gate RPC and rely on client + alter of grants where possible.
-- We recreate authenticate_manager using the existing function via SQL rewrite:

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.authenticate_manager(text,text,uuid)'::regprocedure)
    into v_def;
  if v_def is null then
    raise notice 'authenticate_manager not found; skip rate-limit wrap';
    return;
  end if;
exception
  when undefined_function then
    raise notice 'authenticate_manager not found; skip rate-limit wrap';
    return;
end $$;

-- Re-create authenticate_manager with rate limiting while preserving
-- the established password/session contract.
create or replace function public.authenticate_manager(
  p_email text,
  p_password text default null,
  p_lodge_id uuid default null
)
returns table (
  contract_version integer,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_limit_error text;
  v_match_count integer := 0;
begin
  v_limit_error := public._check_manager_auth_rate_limit(p_email);
  if v_limit_error is not null then
    raise exception '%', v_limit_error using errcode = 'P0001';
  end if;

  if nullif(coalesce(p_password, ''), '') is null then
    return;
  end if;

  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
    from public.users u
    left join lateral (
      select settings.lodge_name, settings.company_name
      from public.settings settings
      where settings.lodge_id = u.lodge_id
        and coalesce(settings.deleted, false) = false
      order by settings.updated_at desc nulls last, settings.created_at desc nulls last
      limit 1
    ) s on true
    left join lateral (
      select public.get_lodge_entitlement(u.lodge_id) as entitlement
    ) ent on true
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select count(*)
    into v_match_count
  from candidates
  where password_ok;

  if v_match_count = 0 then
    return;
  end if;

  return query
  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
    from public.users u
    left join lateral (
      select settings.lodge_name, settings.company_name
      from public.settings settings
      where settings.lodge_id = u.lodge_id
        and coalesce(settings.deleted, false) = false
      order by settings.updated_at desc nulls last, settings.created_at desc nulls last
      limit 1
    ) s on true
    left join lateral (
      select public.get_lodge_entitlement(u.lodge_id) as entitlement
    ) ent on true
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select
    2 as contract_version,
    issued.session_token is not null as authenticated,
    c.id,
    c.name,
    c.email,
    c.role,
    c.lodge_id,
    c.lodge_display_name,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    issued.session_token,
    issued.session_expires_at
  from candidates c
  left join lateral (
    select
      issued_row.session_token,
      issued_row.session_expires_at
    from public.issue_app_session(
      c.id,
      c.lodge_id,
      c.role,
      'pwa',
      jsonb_build_object('email', c.email)
    ) as issued_row(session_token, session_expires_at)
    where c.password_ok
      and c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
  where c.password_ok
  order by c.lodge_display_name;
end;
$$;

-- Remove anonymous execute on legacy password RPC.
-- Prefer Supabase Auth + authenticate_manager_from_supabase on clients.
revoke all on function public.authenticate_manager(text, text, uuid) from public, anon;
grant execute on function public.authenticate_manager(text, text, uuid) to authenticated, service_role;


commit;
