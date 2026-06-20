-- Phase 4: POS Event Folio Support
-- Extends create_pos_order_v3 to accept event_booking_id for event folio charges.
-- Also adds event folio void support in approve_pos_void_with_pin.

begin;

-- ─── 1. Update create_pos_order_v3 to accept event_booking_id ─────────────────
-- The column already exists (Phase 1 migration). We now extract, validate, and write it.

CREATE OR REPLACE FUNCTION public.create_pos_order_v3(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := nullif(payload->>'id', '')::uuid;
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_snapshot_id uuid := nullif(payload->>'catalog_snapshot_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_client_at timestamptz := nullif(payload->>'client_created_at', '')::timestamptz;
  v_idempotency_key text := nullif(btrim(coalesce(payload->>'create_idempotency_key', '')), '');
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
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
  v_line_discount numeric := 0;
  v_line_tax numeric := 0;
  v_line_net numeric := 0;
  v_authoritative_items jsonb := '[]'::jsonb;
  v_order_item_id uuid;
  v_folio_charge_id uuid;
  v_is_event_folio boolean := false;
BEGIN
  IF v_order_id IS NULL THEN v_order_id := public.gen_random_uuid(); END IF;
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  IF v_idempotency_key IS NULL OR length(v_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'create_idempotency_key is required (min 8 chars)');
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least one item is required');
  END IF;

  IF v_snapshot_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'catalog_snapshot_id is required');
  END IF;

  IF v_shift_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'shift_id is required');
  END IF;

  IF v_client_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_created_at is required');
  END IF;

  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT role INTO v_actor_role
  FROM public.user_lodge_roles
  WHERE user_id = v_actor_id AND lodge_id = v_lodge_id
  LIMIT 1;

  IF v_actor_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  IF v_actor_role NOT IN ('cashier', 'supervisor', 'manager', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS access requires cashier role or above');
  END IF;

  IF v_outlet_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pos_outlets
      WHERE id = v_outlet_id AND lodge_id = v_lodge_id AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Outlet not found or inactive');
    END IF;
  END IF;

  SELECT public._claim_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, 'order', jsonb_build_object('client_created_at', v_client_at)
  ) INTO v_claim;

  IF (v_claim->>'claimed')::boolean = false THEN
    IF (v_claim->>'expired')::boolean = true THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'Idempotency key has expired. Please retry.',
        'code', 'idempotency_expired', 'manual_review_required', true
      );
    END IF;
    v_result := (v_claim->>'result')::jsonb;
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
    RETURN jsonb_build_object(
      'success', false, 'error', 'Duplicate order detected',
      'code', 'duplicate_order', 'existing_order_id', (v_claim->>'entity_id')::uuid
    );
  END IF;

  SELECT * INTO v_snapshot
  FROM public.pos_catalog_snapshots
  WHERE id = v_snapshot_id
    AND lodge_id = v_lodge_id
    AND outlet_id = v_outlet_id
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Catalog snapshot not found, expired, or outlet mismatch');
  END IF;

  SELECT * INTO v_shift
  FROM public.pos_shifts
  WHERE id = v_shift_id
    AND lodge_id = v_lodge_id
    AND outlet_id = v_outlet_id
    AND status = 'open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Open shift not found for this outlet');
  END IF;

  SELECT user_id INTO v_operator_id
  FROM public.pos_shift_operators
  WHERE shift_id = v_shift_id AND user_id = v_actor_id
  LIMIT 1;

  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_menu_item_id := nullif(v_line->>'menu_item_id', '')::uuid;
    IF v_menu_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Each item must have a menu_item_id');
    END IF;

    v_quantity := COALESCE((v_line->>'quantity')::numeric, 0);
    IF v_quantity <= 0 OR v_quantity != floor(v_quantity) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Quantity must be a positive whole number');
    END IF;

    SELECT mi.* INTO v_catalog_item
    FROM jsonb_array_elements(v_snapshot.items) AS mi
    WHERE (mi->>'id')::uuid = v_menu_item_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Menu item not found in catalog snapshot');
    END IF;

    v_base_price := (v_catalog_item->>'price')::numeric;
    v_inventory_item_id := nullif(v_catalog_item->>'inventory_item_id', '')::uuid;
    v_depletion_qty := COALESCE((v_catalog_item->>'depletion_qty')::numeric, 0);

    v_modifier_total := 0;
    v_modifier_ids := COALESCE(v_line->'modifier_option_ids', '[]'::jsonb);
    v_resolved_modifiers := '[]'::jsonb;

    IF jsonb_array_length(v_modifier_ids) > 0 THEN
      FOR v_modifier_id IN SELECT value FROM jsonb_array_elements(v_modifier_ids)
      LOOP
        SELECT mo.* INTO v_modifier_option
        FROM jsonb_array_elements(v_snapshot.modifier_groups) AS mg,
             jsonb_array_elements(mg->'options') AS mo
        WHERE (mo->>'id')::text = v_modifier_id;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'error', 'Modifier option not found in catalog snapshot');
        END IF;

        v_modifier_total := v_modifier_total + COALESCE((v_modifier_option->>'price')::numeric, 0);
        v_resolved_modifiers := v_resolved_modifiers || jsonb_build_array(v_modifier_option);
      END LOOP;
    END IF;

    v_unit_price := round(v_base_price + v_modifier_total, 2);
    v_line_gross := round(v_unit_price * v_quantity, 2);

    v_priced_items := v_priced_items || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_menu_item_id,
        'item_name', v_catalog_item->>'name',
        'category', v_catalog_item->>'category',
        'quantity', v_quantity,
        'unit_price', v_unit_price,
        'base_price', v_base_price,
        'modifier_total', v_modifier_total,
        'modifiers', v_resolved_modifiers,
        'inventory_item_id', v_inventory_item_id,
        'depletion_qty', v_depletion_qty,
        'item_notes', nullif(v_line->>'item_notes', ''),
        'gross_subtotal', v_line_gross
      )
    );

    v_gross_total := v_gross_total + v_line_gross;
  END LOOP;

  v_gross_total := round(v_gross_total, 2);

  IF v_promotion_id IS NOT NULL THEN
    SELECT pr.* INTO v_promotion
    FROM jsonb_array_elements(v_snapshot.promotions) AS pr
    WHERE (pr->>'id')::uuid = v_promotion_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Promotion not found in catalog snapshot');
    END IF;

    IF (v_promotion->>'starts_at')::timestamptz > now() OR (v_promotion->>'expires_at')::timestamptz < now() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Promotion is not currently active');
    END IF;

    v_promotion_base := v_gross_total;
    IF (v_promotion->>'min_spend')::numeric > 0 AND v_gross_total < (v_promotion->>'min_spend')::numeric THEN
      RETURN jsonb_build_object('success', false, 'error', 'Minimum spend not met for this promotion');
    END IF;

    IF (v_promotion->>'discount_type')::text = 'percentage' THEN
      v_promotion_discount := round(v_gross_total * (v_promotion->>'discount_value')::numeric / 100, 2);
    ELSE
      v_promotion_discount := round(least(v_gross_total, (v_promotion->>'discount_value')::numeric), 2);
    END IF;
  END IF;

  IF v_manual_discount IS NOT NULL AND jsonb_typeof(v_manual_discount) = 'object' AND v_manual_discount != '{}'::jsonb THEN
    IF v_actor_role NOT IN ('supervisor', 'manager', 'admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only supervisors and above can apply manual discounts');
    END IF;

    IF nullif(v_manual_discount->>'reason', '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Manual discount requires a reason');
    END IF;

    v_manual_discount_amount := round(greatest(0, coalesce((v_manual_discount->>'amount')::numeric, 0)), 2);
    IF v_manual_discount_amount > v_gross_total THEN
      v_manual_discount_amount := v_gross_total;
    END IF;
  END IF;

  v_discount_total := round(v_promotion_discount + v_manual_discount_amount, 2);
  v_discount_total := round(least(v_discount_total, v_gross_total), 2);

  v_tax_total := round((v_gross_total - v_discount_total) * coalesce(v_snapshot.vat_rate, 0) / 100, 2);
  v_total := round(v_gross_total - v_discount_total + v_tax_total + v_tip_total, 2);

  v_payment_total := 0;
  IF v_payment_breakdown IS NOT NULL AND jsonb_typeof(v_payment_breakdown) = 'array' THEN
    FOR v_payment IN SELECT value FROM jsonb_array_elements(v_payment_breakdown)
    LOOP
      v_payment_total := v_payment_total + coalesce((v_payment->>'amount')::numeric, 0);
    END LOOP;
  END IF;

  IF abs(v_payment_total - v_total) > 0.01 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Authoritative total is %s but submitted tenders total %s', v_total, round(v_payment_total, 2)),
      'code', 'payment_total_mismatch',
      'authoritative_total', v_total,
      'manual_review_required', true
    );
  END IF;

  -- ─── Event folio validation ────────────────────────────────────────────────
  IF v_event_booking_id IS NOT NULL THEN
    v_is_event_folio := true;
    IF v_payment_method = 'folio' AND v_booking_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot charge to both room folio and event folio');
    END IF;
    IF v_booking_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot provide both event_booking_id and booking_id');
    END IF;
    IF v_room_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Event folio charges do not require room_id');
    END IF;
    PERFORM 1
      FROM public.conference_bookings cb
     WHERE cb.id = v_event_booking_id
       AND cb.lodge_id = v_lodge_id
       AND cb.status NOT IN ('cancelled', 'completed')
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Active event not found for event folio charge');
    END IF;
    -- For event folio, require payment_method = 'folio'
    v_payment_method := 'folio';
  END IF;

  IF v_payment_method = 'folio' AND NOT v_is_event_folio THEN
    IF v_booking_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Folio payment requires booking_id or event_booking_id');
    END IF;
    PERFORM 1
      FROM public.bookings b
     WHERE b.id = v_booking_id
       AND b.lodge_id = v_lodge_id
       AND b.status in ('confirmed', 'checked_in')
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
    END IF;
  END IF;

  FOR v_usage IN
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

  -- ─── Folio charge (room or event) ──────────────────────────────────────────
  if v_payment_method = 'folio' then
    if v_is_event_folio then
      -- Event folio: insert event-level charge and recalculate event totals
      INSERT INTO public.event_booking_line_items (
        event_booking_id, lodge_id, line_type, description, category,
        quantity, unit_price, subtotal, created_by
      ) VALUES (
        v_event_booking_id, v_lodge_id, 'pos', 'POS order ' || left(v_order_id::text, 8),
        'pos', 1, v_total, v_total, v_actor_id
      )
      returning id into v_folio_charge_id;

      -- Link the POS order to the folio charge for void reversal
      update public.pos_orders
         set folio_charge_id = v_folio_charge_id
       where id = v_order_id;

      -- Recalculate event totals
      perform public.recalculate_event_totals(v_event_booking_id);
    else
      -- Room folio: original behavior
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
    jsonb_build_object('payment_method', v_payment_method, 'folio_charge_id', v_folio_charge_id, 'event_booking_id', v_event_booking_id)
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
    'server_received_at', now()
  );

  perform public._record_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, v_request_hash, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.create_pos_order_v3(jsonb) from public;
grant execute on function public.create_pos_order_v3(jsonb)
  to anon, authenticated, service_role;

-- ─── 2. Update approve_pos_void_with_pin to handle event folio reversals ──────
-- When voiding an event folio POS order, reverse the event line item and recalculate.

CREATE OR REPLACE FUNCTION public.approve_pos_void_with_pin(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_pin text := payload->>'pin';
  v_reason text := nullif(btrim(coalesce(payload->>'reason', '')), '');
  v_requesting_user uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by uuid := nullif(payload->>'approved_by', '')::uuid;
  v_approver_role text;
  v_approver_name text;
  v_order record;
  v_actor_id uuid := public.app_current_user_id();
  v_override_log_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_device_id text := nullif(btrim(coalesce(payload->>'device_id', '')), '');
  v_folio_charge_id uuid;
  v_event_booking_id uuid;
BEGIN
  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_id is required');
  END IF;
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Void reason is required (min 3 chars)');
  END IF;
  IF v_pin IS NULL OR length(v_pin) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN is required');
  END IF;

  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_order
  FROM public.pos_orders
  WHERE id = v_order_id AND lodge_id = v_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  IF v_order.status = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order is already voided');
  END IF;

  IF v_order.status != 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only completed orders can be voided');
  END IF;

  IF v_approved_by IS NOT NULL THEN
    SELECT role INTO v_approver_role
    FROM public.user_lodge_roles
    WHERE user_id = v_approved_by AND lodge_id = v_lodge_id
    LIMIT 1;

    IF v_approver_role NOT IN ('supervisor', 'manager', 'admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Approval must come from a supervisor or above');
    END IF;

    SELECT u.name INTO v_approver_name
    FROM public.users u WHERE u.id = v_approved_by;
  ELSE
    SELECT role INTO v_approver_role
    FROM public.user_lodge_roles
    WHERE user_id = v_actor_id AND lodge_id = v_lodge_id
    LIMIT 1;

    IF v_approver_role NOT IN ('supervisor', 'manager', 'admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Void requires supervisor approval');
    END IF;

    IF NOT public.verify_pin(v_actor_id, v_pin) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
    END IF;

    v_approved_by := v_actor_id;
    SELECT u.name INTO v_approver_name
    FROM public.users u WHERE u.id = v_approved_by;
  END IF;

  IF v_requesting_user IS NOT NULL AND v_requesting_user != v_approved_by THEN
    IF NOT public.verify_pin(v_requesting_user, v_pin) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PIN does not match the requesting user');
    END IF;
  END IF;

  UPDATE public.pos_orders
     SET status = 'voided', updated_at = now()
   WHERE id = v_order_id;

  -- ─── Reverse event folio charge if applicable ──────────────────────────────
  v_event_booking_id := v_order.event_booking_id;
  v_folio_charge_id := v_order.folio_charge_id;

  IF v_event_booking_id IS NOT NULL AND v_folio_charge_id IS NOT NULL THEN
    -- Preserve the original financial row and void it. The event totals
    -- routine excludes voided rows, so this reverses the charge exactly once
    -- without violating non-negative line-item constraints.
    UPDATE public.event_booking_line_items
       SET description = description || ' [VOIDED]',
           voided_at = now(),
           void_reason = v_reason
     WHERE id = v_folio_charge_id
       AND event_booking_id = v_event_booking_id
       AND voided_at IS NULL;

    -- Recalculate event totals after reversal
    PERFORM public.recalculate_event_totals(v_event_booking_id);
  END IF;

  IF v_order.folio_charge_id IS NOT NULL AND v_order.event_booking_id IS NULL THEN
    UPDATE public.booking_charges
       SET description = description || ' [VOIDED]',
           amount = -amount
     WHERE id = v_order.folio_charge_id;
  END IF;

  INSERT INTO public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    device_id, action, entity_type, entity_id, staff_id, amount_delta,
    idempotency_key, client_at, after_snapshot, details
  ) VALUES (
    v_lodge_id, v_order.outlet_id, v_order.shift_id, v_order_id, v_actor_id, v_approved_by,
    v_device_id, 'pos_void_approved', 'pos_order', v_order_id, v_approved_by,
    -v_order.total, coalesce(nullif(payload->>'override_log_id', ''), public.gen_random_uuid())::text,
    now(),
    jsonb_build_object('total', v_order.total, 'reason', v_reason),
    jsonb_build_object('approver_name', v_approver_name, 'reason', v_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'approved_by', v_approved_by,
    'approver_name', v_approver_name,
    'override_log_id', v_override_log_id
  );
END;
$$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb)
  to anon, authenticated, service_role;

commit;
