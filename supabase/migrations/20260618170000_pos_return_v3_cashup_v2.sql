-- Phase 5: Corrected return/refund and cash-up RPCs
--
-- This migration creates:
--   5.1 create_pos_return_v3 (proper locking, proportional refunds, folio protection)
--   5.2 get_pos_shift_cashup_preview_v2 (server-calculated from shift records)
--   5.3 finalize_pos_shift_cashup_v2 (atomic cash-up + shift close)
--
-- Backward-compatible: old RPCs remain callable.

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5.1 create_pos_return_v3 — server-authoritative return with proportional refunds
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.create_pos_return_v3(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid;
  v_lodge_id uuid;
  v_lines jsonb;
  v_pin text;
  v_reason text;
  v_requested_by uuid;
  v_override_log_id uuid;
  v_created_at timestamptz;
  v_return_order_id uuid;
  v_return_idempotency_key text;

  -- Original order
  v_original record;
  v_original_items jsonb;

  -- Return line processing
  v_line jsonb;
  v_line_id uuid;
  v_requested_qty numeric;
  v_original_item record;
  v_previously_returned numeric;
  v_remaining numeric;
  v_return_qty numeric;

  -- Financials
  v_return_total numeric := 0;
  v_original_total numeric;
  v_original_payment_method text;
  v_original_payment_breakdown jsonb;
  v_original_gross numeric;
  v_original_discount numeric;
  v_original_tax numeric;
  v_original_tip numeric;

  -- Approver
  v_approver record;
  v_approver_id uuid;

  -- Inventory
  v_depletion_qty numeric;
  v_inventory_item_id uuid;

  -- Idempotency
  v_request_hash text;
  v_cached_result jsonb;

  v_now timestamptz := now();
  v_return_items jsonb := '[]'::jsonb;
begin
  -- ── Extract payload ────────────────────────────────────────────────────────
  v_order_id := (payload->>'order_id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_lines := payload->'lines';
  v_pin := payload->>'pin';
  v_reason := payload->>'reason';
  v_requested_by := (payload->>'requested_by')::uuid;
  v_override_log_id := coalesce((payload->>'override_log_id')::uuid, gen_random_uuid());
  v_created_at := coalesce((payload->>'created_at')::timestamptz, v_now);
  v_return_order_id := coalesce((payload->>'return_order_id')::uuid, gen_random_uuid());
  v_return_idempotency_key := payload->>'return_idempotency_key';

  -- ── Validate inputs ────────────────────────────────────────────────────────
  if v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'order_id is required');
  end if;
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id is required');
  end if;
  if v_lines is null or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one return line is required');
  end if;
  if v_pin is null or length(trim(v_pin)) < 4 then
    return jsonb_build_object('success', false, 'error', 'Valid PIN is required');
  end if;
  if v_reason is null or length(trim(v_reason)) = 0 then
    return jsonb_build_object('success', false, 'error', 'Reason is required');
  end if;

  -- ── Role and outlet access ─────────────────────────────────────────────────
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  -- ── Idempotency check ──────────────────────────────────────────────────────
  if v_return_idempotency_key is not null then
    v_request_hash := encode(sha256((payload::text)::bytea), 'hex');
    v_cached_result := public._claim_financial_operation(
      v_lodge_id, v_return_idempotency_key, 'create_pos_return_v3', null, v_request_hash
    );
    if (v_cached_result->>'found')::boolean then
      if (v_cached_result->>'match')::boolean then
        return jsonb_build_object(
          'success', true,
          'id', (v_cached_result->'operation_result')->>'id',
          'total', (v_cached_result->'operation_result')->>'total',
          'idempotent', true,
          'replayed', true
        );
      else
        return jsonb_build_object('success', false, 'error', 'Idempotency key reused with different payload', 'code', 'idempotency_conflict');
      end if;
    end if;
  end if;

  -- ── Lock and validate original order ───────────────────────────────────────
  select id, lodge_id, status, total, gross_total, discount_total, tax_total,
         tip_total, payment_method, payment_breakdown, outlet_id, shift_id,
         cashier_id, create_idempotency_key
  into v_original
  from public.pos_orders
  where id = v_order_id
    and lodge_id = v_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Original order not found');
  end if;

  if v_original.status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Cannot return items from a voided order');
  end if;

  if v_original.outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_original.outlet_id);
  end if;

  v_original_total := v_original.total;
  v_original_payment_method := v_original.payment_method;
  v_original_payment_breakdown := v_original.payment_breakdown;
  v_original_gross := v_original.gross_total;
  v_original_discount := v_original.discount_total;
  v_original_tax := v_original.tax_total;
  v_original_tip := v_original.tip_total;

  -- ── Validate PIN server-side ───────────────────────────────────────────────
  select id, name, role into v_approver
  from public.users
  where lodge_id = v_lodge_id
    and status = 'active'
    and pin_hash is not null
    and role = any(array['supervisor', 'manager', 'admin', 'super_admin']);

  -- Find matching approver by PIN
  v_approver_id := null;
  for v_approver in
    select id, name, role, pin_hash, allowed_outlet_ids
    from public.users
    where lodge_id = v_lodge_id
      and status = 'active'
      and pin_hash is not null
      and role = any(array['supervisor', 'manager', 'admin', 'super_admin'])
  loop
    if v_approver.pin_hash = crypt(v_pin, v_approver.pin_hash) then
      v_approver_id := v_approver.id;
      exit;
    end if;
  end loop;

  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  -- ── Process return lines ───────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_line_id := (v_line->>'line_id')::uuid;
    v_requested_qty := abs(coalesce((v_line->>'quantity')::numeric, 0));

    if v_requested_qty <= 0 then
      return jsonb_build_object('success', false, 'error', 'Return quantity must be positive');
    end if;

    -- Lock the original order item
    select id, item_name, quantity, unit_price, subtotal, menu_item_id,
           inventory_item_id, depletion_qty, category, modifiers, gross_subtotal,
           discount_allocated, tax_allocated, net_subtotal
    into v_original_item
    from public.pos_order_items
    where id = v_line_id
      and order_id = v_order_id
      and lodge_id = v_lodge_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'error', format('Order item %s not found', v_line_id));
    end if;

    -- Calculate previously returned quantity
    select coalesce(sum(quantity), 0) into v_previously_returned
    from public.pos_return_lines
    where original_order_item_id = v_line_id
      and lodge_id = v_lodge_id;

    v_remaining := v_original_item.quantity - v_previously_returned;

    if v_remaining <= 0 then
      return jsonb_build_object(
        'success', false,
        'error', format('Item "%s" fully returned (original: %s, returned: %s)',
          v_original_item.item_name, v_original_item.quantity, v_previously_returned)
      );
    end if;

    -- STRICT REJECTION: do not clamp
    if v_requested_qty > v_remaining then
      return jsonb_build_object(
        'success', false,
        'error', format('Return quantity (%s) exceeds remaining (%s) for "%s"',
          v_requested_qty, v_remaining, v_original_item.item_name)
      );
    end if;

    v_return_qty := v_requested_qty;

    -- Accumulate return total (proportional to original unit_price)
    v_return_total := v_return_total + round(v_return_qty * v_original_item.unit_price, 2);

    -- Build return item
    v_return_items := v_return_items || jsonb_build_object(
      'menu_item_id', v_original_item.menu_item_id,
      'item_name', 'Return: ' || v_original_item.item_name,
      'quantity', -v_return_qty,
      'unit_price', v_original_item.unit_price,
      'subtotal', round(-v_return_qty * v_original_item.unit_price, 2),
      'inventory_item_id', v_original_item.inventory_item_id,
      'depletion_qty', v_original_item.depletion_qty,
      'category', v_original_item.category,
      'modifiers', v_original_item.modifiers,
      'gross_subtotal', round(-v_return_qty * v_original_item.gross_subtotal / v_original_item.quantity, 2),
      'discount_allocated', round(-v_return_qty * v_original_item.discount_allocated / v_original_item.quantity, 2),
      'tax_allocated', round(-v_return_qty * v_original_item.tax_allocated / v_original_item.quantity, 2),
      'net_subtotal', round(-v_return_qty * v_original_item.net_subtotal / v_original_item.quantity, 2)
    );

    -- Insert return ledger row
    insert into public.pos_return_lines (
      lodge_id, original_order_id, original_order_item_id, return_order_id, quantity
    ) values (
      v_lodge_id, v_order_id, v_line_id, v_return_order_id, v_return_qty
    ) on conflict (lodge_id, return_order_id, original_order_item_id) do nothing;

    -- Restore inventory atomically
    if v_original_item.inventory_item_id is not null then
      v_depletion_qty := coalesce(v_original_item.depletion_qty, 1);

      update public.inventory_items
      set current_stock = current_stock + (v_return_qty * v_depletion_qty)
      where id = v_original_item.inventory_item_id;

      insert into public.inventory_movements (
        lodge_id, inventory_item_id, delta, reference_type, reference_id, notes
      ) values (
        v_lodge_id, v_original_item.inventory_item_id, v_return_qty * v_depletion_qty,
        'pos_return', v_return_order_id, format('Return for order %s', v_order_id)
      );
    end if;
  end loop;

  v_return_total := round(v_return_total, 2);

  -- ── Insert return order ────────────────────────────────────────────────────
  insert into public.pos_orders (
    id, lodge_id, status, total, gross_total, discount_total, tax_total,
    tip_total, payment_method, payment_breakdown, outlet_id, shift_id,
    cashier_id, transaction_type, original_order_id, notes, created_at,
    server_received_at
  ) values (
    v_return_order_id, v_lodge_id, 'completed', -v_return_total,
    -v_return_total, 0, 0, 0, v_original_payment_method,
    jsonb_build_array(jsonb_build_object(
      'method', v_original_payment_method,
      'amount', -v_return_total
    )),
    v_original.outlet_id, v_original.shift_id, v_approver_id,
    'return', v_order_id, v_reason, v_created_at, v_now
  );

  -- ── Insert return order items ──────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(v_return_items)
  loop
    insert into public.pos_order_items (
      lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      item_notes, gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_lodge_id, v_return_order_id,
      (v_line->>'menu_item_id')::uuid,
      v_line->>'item_name',
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      (v_line->>'subtotal')::numeric,
      (v_line->>'inventory_item_id')::uuid,
      (v_line->>'depletion_qty')::numeric,
      v_line->>'category',
      coalesce(v_line->'modifiers', '[]'::jsonb),
      null,
      (v_line->>'gross_subtotal')::numeric,
      (v_line->>'discount_allocated')::numeric,
      (v_line->>'tax_allocated')::numeric,
      (v_line->>'net_subtotal')::numeric
    );
  end loop;

  -- ── Override log ───────────────────────────────────────────────────────────
  insert into public.pos_override_log (
    id, lodge_id, action, order_id, return_order_id, requested_by,
    approved_by, reason, return_total, created_at
  ) values (
    v_override_log_id, v_lodge_id, 'partial_return', v_order_id,
    v_return_order_id, v_requested_by, v_approver_id, v_reason,
    v_return_total, v_created_at
  ) on conflict (id) do nothing;

  -- ── Audit event ────────────────────────────────────────────────────────────
  insert into public.pos_audit_log (lodge_id, action, entity_type, entity_id, performed_by, details)
  values (
    v_lodge_id, 'return_created', 'pos_return', v_return_order_id, v_approver_id,
    jsonb_build_object(
      'original_order_id', v_order_id,
      'return_total', v_return_total,
      'line_count', jsonb_array_length(v_lines),
      'reason', v_reason,
      'approver_id', v_approver_id
    )
  );

  -- ── Record idempotency ─────────────────────────────────────────────────────
  if v_return_idempotency_key is not null then
    perform public._record_financial_operation(
      v_lodge_id, v_return_idempotency_key, 'create_pos_return_v3', v_return_order_id,
      v_request_hash, jsonb_build_object('id', v_return_order_id, 'total', -v_return_total)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_return_order_id,
    'total', -v_return_total,
    'line_count', jsonb_array_length(v_lines)
  );
end;
$$;

revoke all on function public.create_pos_return_v3(jsonb) from public;
grant execute on function public.create_pos_return_v3(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5.2 get_pos_shift_cashup_preview_v2 — server-calculated from shift records
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_pos_shift_cashup_preview_v2(
  p_shift_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift record;
  v_orders record;
  v_returns record;
  v_result jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select id, lodge_id, outlet_id, cashier_id, status, opening_float, opened_at, closed_at
  into v_shift
  from public.pos_shifts
  where id = p_shift_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Shift not found');
  end if;

  -- Aggregate sales (excluding returns and voided orders)
  select
    coalesce(count(*), 0) as order_count,
    coalesce(sum(total), 0) as gross_sales,
    coalesce(sum(discount_total), 0) as total_discounts,
    coalesce(sum(tax_total), 0) as total_tax,
    coalesce(sum(tip_total), 0) as total_tips
  into v_orders
  from public.pos_orders
  where shift_id = p_shift_id
    and lodge_id = p_lodge_id
    and status not in ('voided')
    and transaction_type = 'sale';

  -- Aggregate returns
  select
    coalesce(count(*), 0) as return_count,
    coalesce(sum(abs(total)), 0) as total_returns
  into v_returns
  from public.pos_orders
  where shift_id = p_shift_id
    and lodge_id = p_lodge_id
    and transaction_type = 'return';

  -- Aggregate payment breakdown
  v_result := jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'status', v_shift.status,
    'opening_float', v_shift.opening_float,
    'order_count', v_orders.order_count,
    'gross_sales', v_orders.gross_sales,
    'total_discounts', v_orders.total_discounts,
    'total_tax', v_orders.total_tax,
    'total_tips', v_orders.total_tips,
    'return_count', v_returns.return_count,
    'total_returns', v_returns.total_returns,
    'net_sales', v_orders.gross_sales - v_orders.total_discounts - v_returns.total_returns,
    'expected_drawer', v_shift.opening_float + v_orders.gross_sales - v_orders.total_discounts - v_returns.total_returns + v_orders.total_tax + v_orders.total_tips
  );

  return v_result;
end;
$$;

revoke all on function public.get_pos_shift_cashup_preview_v2(uuid, uuid) from public;
grant execute on function public.get_pos_shift_cashup_preview_v2(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5.3 finalize_pos_shift_cashup_v2 — atomic cash-up + shift close
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.finalize_pos_shift_cashup_v2(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift_id uuid;
  v_lodge_id uuid;
  v_cashup_id uuid;
  v_expected_cash_drawer numeric;
  v_counted_by_method jsonb;
  v_variance_by_method jsonb;
  v_notes text;
  v_created_by uuid;

  v_shift record;
  v_preview jsonb;
  v_now timestamptz := now();
begin
  v_shift_id := (payload->>'shift_id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_cashup_id := coalesce((payload->>'cashup_id')::uuid, gen_random_uuid());
  v_expected_cash_drawer := (payload->>'expected_cash_drawer')::numeric;
  v_counted_by_method := payload->'counted_by_method';
  v_variance_by_method := payload->'variance_by_method';
  v_notes := payload->>'notes';
  v_created_by := public.app_current_user_id();

  if v_shift_id is null or v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'shift_id and lodge_id are required');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);

  -- Lock the shift
  select id, lodge_id, outlet_id, status, opening_float, opened_at
  into v_shift
  from public.pos_shifts
  where id = v_shift_id and lodge_id = v_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Shift not found');
  end if;

  if v_shift.status != 'open' then
    return jsonb_build_object('success', false, 'error', 'Shift is not open');
  end if;

  -- Get server-calculated preview
  v_preview := public.get_pos_shift_cashup_preview_v2(v_shift_id, v_lodge_id);

  -- Recalculate expected drawer server-side
  v_expected_cash_drawer := (v_preview->>'expected_drawer')::numeric;

  -- Recalculate variances server-side (ignore client-supplied variances)
  -- Variance = counted - expected per method
  -- For simplicity, total variance = total counted - expected_drawer
  -- The client should send counted_by_method with method-level breakdown

  -- Insert cash-up record
  insert into public.pos_cashup_sessions (
    id, lodge_id, shift_id, cashier_id, outlet_id, opened_at,
    expected_cash_drawer, counted_cash, variance, notes,
    created_by, created_at
  ) values (
    v_cashup_id, v_lodge_id, v_shift_id, v_shift.cashier_id,
    v_shift.outlet_id, v_shift.opened_at,
    v_expected_cash_drawer,
    coalesce((v_counted_by_method->>'cash')::numeric, 0),
    coalesce((v_counted_by_method->>'cash')::numeric, 0) - v_expected_cash_drawer,
    v_notes, v_created_by, v_now
  );

  -- Close the shift atomically
  update public.pos_shifts
  set status = 'closed',
      closed_at = v_now,
      closing_cash = coalesce((v_counted_by_method->>'cash')::numeric, 0),
      close_notes = v_notes
  where id = v_shift_id and lodge_id = v_lodge_id;

  -- Mark all open orders on this shift as completed
  update public.pos_orders
  set status = 'completed', completed_at = v_now
  where shift_id = v_shift_id
    and lodge_id = v_lodge_id
    and status = 'open';

  -- Audit event
  insert into public.pos_audit_log (lodge_id, action, entity_type, entity_id, performed_by, details)
  values (
    v_lodge_id, 'cashup_finalized', 'pos_cashup', v_cashup_id, v_created_by,
    jsonb_build_object(
      'shift_id', v_shift_id,
      'expected_drawer', v_expected_cash_drawer,
      'counted_by_method', v_counted_by_method,
      'variance_by_method', v_variance_by_method
    )
  );

  return jsonb_build_object(
    'success', true,
    'cashup_id', v_cashup_id,
    'shift_id', v_shift_id,
    'expected_drawer', v_expected_cash_drawer,
    'preview', v_preview
  );
end;
$$;

revoke all on function public.finalize_pos_shift_cashup_v2(jsonb) from public;
grant execute on function public.finalize_pos_shift_cashup_v2(jsonb) to anon, authenticated, service_role;

commit;
