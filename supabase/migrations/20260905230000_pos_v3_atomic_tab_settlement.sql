-- Atomic tab settlement inside create_pos_order_v3.
--
-- A tab payment used to be three separate steps (resolve tab, record order,
-- close tab). A crash, timeout, or second Till authorization between those
-- steps left paid tabs open with no durable trace. This forward migration
-- makes settlement one transaction inside create_pos_order_v3:
--
--   * tab_id payments lock and re-validate the tab (lodge/outlet scope,
--     still open) before recording, reusing the existing pre-claim scope
--     and ownership guards;
--   * tab_name-only payments (immediate tab sales) resolve or create the tab
--     through the existing ownership-guarded upsert_pos_tab inside the same
--     transaction, so the Till proof is validated exactly once;
--   * the order row persists tab_id (existing contract);
--   * the tab is closed, versioned, and audited in the same transaction;
--   * idempotent replay returns the stored settled result (with tab fields),
--     so a retry can never duplicate a tab or record a second payment.
--
-- This redefinition inlines every patch currently applied to the live
-- function (promotion repair, operator attribution, tab link, receipt
-- identity, settlement ownership guard, Bar tender entitlement guard in its
-- post-claim position) so no guard is dropped. It refuses to install if the
-- live function has drifted from that known shape.

begin;

-- ── Preconditions: refuse to install on a drifted contract ──────────────────
do $pre$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  if position('v_bar_tender_error text;' in v_definition) = 0 then
    raise exception 'Live v3 is missing the Bar tender entitlement guard; refusing atomic rewrite';
  end if;
  if position('v_tab_owner_error text;' in v_definition) = 0 then
    raise exception 'Live v3 is missing the tab settlement ownership guard; refusing atomic rewrite';
  end if;
  if position('v_tab_id uuid' in v_definition) = 0 then
    raise exception 'Live v3 is missing the tab link declaration; refusing atomic rewrite';
  end if;
  if position('''receipt_number'', (' in v_definition) = 0 then
    raise exception 'Live v3 is missing the server receipt identity fields; refusing atomic rewrite';
  end if;
  if position('v_operator_id := coalesce(v_shift.cashier_id, v_actor_id);' in v_definition) = 0 then
    raise exception 'Live v3 is missing the shift-owner attribution repair; refusing atomic rewrite';
  end if;
  if position('Promotion minimum spend is not met' in v_definition) = 0 then
    raise exception 'Live v3 is missing the promotion checkout repair; refusing atomic rewrite';
  end if;
  if (length(v_definition) - length(replace(lower(v_definition), '_claim_financial_operation', ''))) / length('_claim_financial_operation') <> 1 then
    raise exception 'Live v3 financial-claim contract is ambiguous or missing; refusing atomic rewrite';
  end if;
end
$pre$;

-- ── Full redefinition with atomic tab settlement ────────────────────────────
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
  v_bar_tender_error text;
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_manual_discount jsonb := coalesce(payload->'manual_discount', '{}'::jsonb);
  v_promotion_id uuid := nullif(payload->>'promotion_id', '')::uuid;
  v_tip_total numeric := round(greatest(0, coalesce(nullif(payload->>'tip_total', '')::numeric, 0)), 2);
  v_booking_id uuid := nullif(payload->>'booking_id', '')::uuid;
  v_room_id uuid := nullif(payload->>'room_id', '')::uuid;
  v_event_booking_id uuid := nullif(payload->>'event_booking_id', '')::uuid;
  v_tab_id uuid := nullif(payload->>'tab_id', '')::uuid;
  v_tab_operator_proof text := nullif(payload->>'_operator_proof', '');
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
  v_tab_owner_error text;
  v_tab_status text;
  v_settle_tab public.pos_tabs%rowtype;
  v_tab_upsert jsonb;
  v_tab_closed boolean := false;
  v_tab_close_warning text := null;
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
  -- Resolve the settling tab under lock before anything is recorded, so two
  -- concurrent payments for one tab serialize here instead of double
  -- charging it. A tab that is already closed is a hard failure (fail
  -- closed with a clear recovery message), never a second payment.
  if v_tab_id is not null then
    select t.status
      into v_tab_status
      from public.pos_tabs t
     where t.id = v_tab_id
       and t.lodge_id = v_lodge_id
       and t.outlet_id is not distinct from v_outlet_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'The selected open tab is missing or belongs to another lodge/outlet.');
    end if;
    if v_tab_status not in ('open', 'running', 'ready', 'delivered') then
      return jsonb_build_object('success', false, 'code', 'tab_already_settled', 'error', 'This tab is already closed. Refresh open tabs before taking payment.');
    end if;
  end if;
  v_tab_owner_error := public._pos_tab_settlement_owner_error(payload);
  IF v_tab_owner_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', v_tab_owner_error);
  END IF;
  payload := payload - '_operator_proof';

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

  v_bar_tender_error := public.pos_bar_tender_entitlement_error(v_lodge_id, payload);
  if v_bar_tender_error is not null then
    return jsonb_build_object('success', false, 'error', v_bar_tender_error, 'code', 'commercial_entitlement_blocked');
  end if;

  select s.*
    into v_snapshot
    from public.pos_catalog_snapshots s
   where s.id = v_snapshot_id
     and s.lodge_id = v_lodge_id
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

  -- The manager who unlocked a shared Till remains the audit actor, while
  -- the PIN-verified staff member who owns the open shift is the operator.
  v_operator_id := coalesce(v_shift.cashier_id, v_actor_id);
  if v_operator_id is null then
    return jsonb_build_object('success', false, 'error', 'Authenticated POS operator could not be resolved');
  end if;

  -- Do not let a cashier select another staff member's shift. Managers and
  -- supervisors may operate a shared shift after the server has validated it.
  if not public.app_is_service_role()
     and v_shift.cashier_id is not null
     and v_actor_id is not null
     and v_shift.cashier_id <> v_actor_id
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
    select value into v_promotion
      from jsonb_array_elements(coalesce(v_snapshot.payload->'promotions', '[]'::jsonb))
     where nullif(value->>'id', '')::uuid = v_promotion_id
       and coalesce((value->>'active')::boolean, false)
     limit 1;
    if v_promotion is null then
      return jsonb_build_object('success', false, 'error', 'Promotion is not valid in this catalog snapshot');
    end if;
    if nullif(v_promotion->>'starts_at', '') is not null and (v_promotion->>'starts_at')::timestamptz > now()
       or nullif(v_promotion->>'ends_at', '') is not null and (v_promotion->>'ends_at')::timestamptz < now() then
      return jsonb_build_object('success', false, 'error', 'Promotion is outside its scheduled period');
    end if;
    if v_gross_total < coalesce(nullif(v_promotion->>'minimum_spend', '')::numeric, 0) then
      return jsonb_build_object('success', false, 'error', 'Promotion minimum spend is not met');
    end if;
    if nullif(v_promotion->>'customer_segment', '') is not null
       and lower(v_promotion->>'customer_segment') <> lower(coalesce(payload->>'customer_segment', '')) then
      return jsonb_build_object('success', false, 'error', 'Promotion is not available for this customer');
    end if;
    if lower(coalesce(v_promotion->>'applies_to_category', 'all')) = 'all' then
      v_promotion_base := v_gross_total;
    else
      select coalesce(sum((value->>'gross_subtotal')::numeric), 0) into v_promotion_base
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

  -- Resolve-or-create the settling tab inside this same transaction for
  -- tab_name-only payments (immediate tab sales). Resume flows pass tab_id
  -- and skip this: the ownership guard above already validated and locked
  -- that row. Running resolution here (after all validations, before any
  -- writes) keeps failed payments from leaving stray open tabs, and
  -- idempotent replay never re-runs it.
  if v_tab_id is null
     and nullif(btrim(coalesce(payload->>'tab_name', '')), '') is not null then
    v_tab_upsert := public.upsert_pos_tab(jsonb_build_object(
      'lodge_id', v_lodge_id,
      'outlet_id', v_outlet_id,
      'table_name', nullif(payload->>'table_name', ''),
      'tab_name', nullif(btrim(payload->>'tab_name', ''), ''),
      'waiter_id', v_operator_id,
      'waiter_name', coalesce(
        nullif(payload->>'waiter_name', ''),
        (select u.name from public.users u where u.id = v_operator_id)
      ),
      'shift_id', v_shift_id,
      'items', coalesce(payload->'items', '[]'::jsonb),
      '_operator_proof', v_tab_operator_proof
    ));
    if coalesce((v_tab_upsert->>'success')::boolean, false) is not true then
      return jsonb_build_object('success', false,
        'error', coalesce(v_tab_upsert->>'error', 'Could not resolve the open tab'),
        'code', coalesce(v_tab_upsert->>'code', 'tab_not_owned'));
    end if;
    v_tab_id := nullif(v_tab_upsert#>>'{tab,id}', '')::uuid;
    if v_tab_id is null then
      return jsonb_build_object('success', false, 'error', 'Could not resolve the open tab');
    end if;
  end if;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, event_booking_id, walk_in_name, status, total, notes,
    completed_at, payment_method, outlet_id, create_idempotency_key,
    gross_total, discount_total, tax_rate, tax_total, tip_total,
    payment_breakdown, service_mode, table_name, tab_name, tab_id, waiter_name,
    cashier_id, cashier_name, shift_id, ticket_status, transaction_type,
    catalog_snapshot_id, source_device_id, client_created_at, server_received_at
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id, v_event_booking_id,
    nullif(payload->>'walk_in_name', ''), 'completed', v_total,
    nullif(payload->>'notes', ''), now(), v_payment_method, v_outlet_id,
    v_idempotency_key, v_gross_total, v_discount_total,
    coalesce(v_snapshot.vat_rate, 0), v_tax_total, v_tip_total,
    v_payment_breakdown, nullif(payload->>'service_mode', ''),
    nullif(payload->>'table_name', ''), nullif(payload->>'tab_name', ''), v_tab_id,
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

  -- Atomic tab settlement: this order pays v_tab_id, so close it here in the
  -- same transaction. The pre-claim ownership guard already validated the
  -- waiter, shift, and outlet and holds the row lock to transaction end, so
  -- the status cannot have changed underneath this block. A crash between
  -- payment and close is now impossible: both commit or roll back together,
  -- and idempotent replay returns the stored settled result below.
  if v_tab_id is not null then
    select *
      into v_settle_tab
      from public.pos_tabs
     where id = v_tab_id
       and lodge_id = v_lodge_id
     for update;
    if not found or v_settle_tab.status not in ('open', 'running', 'ready', 'delivered') then
      v_tab_close_warning := 'The linked tab changed before settlement completed; the payment was recorded.';
    else
      update public.pos_tabs
         set status = 'closed',
             updated_at = now(),
             closed_at = now(),
             tab_version = tab_version + 1
       where id = v_tab_id
       returning * into v_settle_tab;
      insert into public.pos_audit_log (
        lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
        device_id, action, entity_type, entity_id, staff_id, amount_delta,
        idempotency_key, client_at, after_snapshot, details
      ) values (
        v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
        v_device_id, 'pos_tab_settled', 'pos_tab', v_tab_id, v_operator_id,
        v_total, v_idempotency_key, v_client_at,
        to_jsonb(v_settle_tab),
        jsonb_build_object('order_id', v_order_id, 'settled_by_order', true)
      );
      v_tab_closed := true;
    end if;
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
    'receipt_number', (
      select o.receipt_number
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'order_number', (
      select o.order_number
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'daily_order_number', (
      select o.daily_order_number
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'business_date', (
      select o.business_date
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'total', v_total,
    'gross_total', v_gross_total,
    'discount_total', v_discount_total,
    'tax_rate', coalesce(v_snapshot.vat_rate, 0),
    'tax_total', v_tax_total,
    'tip_total', v_tip_total,
    'payment_method', v_payment_method,
    'payment_breakdown', v_payment_breakdown,
    'tab_id', v_tab_id,
    'tab_closed', v_tab_closed,
    'tab_close_warning', v_tab_close_warning,
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

commit;
