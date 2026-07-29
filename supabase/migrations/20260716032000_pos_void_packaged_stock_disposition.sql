-- A void reverses financial truth.  It only restores physical stock when a
-- packaged item is genuinely returned unopened.  Food, cocktails and recipe
-- ingredients remain consumed: they were prepared and cannot be put back.

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
  v_direct_stock_disposition text := coalesce(nullif(payload->>'direct_stock_disposition', ''), 'return_to_stock');
  v_device_id text := coalesce(nullif(payload->>'device_id', ''), 'unknown');
  v_override_id uuid := coalesce(nullif(payload->>'override_log_id', '')::uuid, gen_random_uuid());
  v_actor_id uuid := public.app_current_user_id();
  v_order record;
  v_restored jsonb := '[]'::jsonb;
begin
  if v_lodge_id is null or v_order_id is null or v_pin is null or v_reason is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id, order_id, PIN and reason are required');
  end if;
  if v_direct_stock_disposition not in ('return_to_stock', 'consumed_or_damaged') then
    return jsonb_build_object('success', false, 'error', 'Choose whether packaged stock was returned or consumed/damaged');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  if exists (select 1 from public.pos_override_log l where l.id = v_override_id and l.lodge_id = v_lodge_id and l.order_id = v_order_id and l.action = 'void') then
    return jsonb_build_object('success', true, 'id', v_order_id, 'override_log_id', v_override_id, 'already_applied', true);
  end if;

  select o.* into v_order from public.pos_orders o where o.id = v_order_id and o.lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Order not found'); end if;
  if v_order.status = 'voided' then return jsonb_build_object('success', false, 'error', 'Order is already voided'); end if;
  if v_order.status = 'settled' then return jsonb_build_object('success', false, 'error', 'Settled orders must be returned in the current shift, not voided'); end if;
  if v_order.outlet_id is not null then perform public.app_require_pos_outlet_access(v_lodge_id, v_order.outlet_id); end if;

  if v_approver_id is null then
    v_approver_id := public._pos_resolve_pin_internal(v_lodge_id, v_pin, 'pos.void', v_device_id);
  elsif not public._pos_validate_pin_internal(v_lodge_id, v_approver_id, v_pin, 'pos.void', v_device_id) then
    v_approver_id := null;
  end if;
  if v_approver_id is null then return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver'); end if;

  -- Direct inventory links are packaged/pre-made stock.  Recipe movements are
  -- deliberately excluded: a mixed cocktail or prepared food cannot return its
  -- consumed ingredients to stock through a financial void.
  if v_direct_stock_disposition = 'return_to_stock' then
    v_restored := public._restore_pos_order_stock(v_order_id, v_lodge_id);
  end if;

  if v_order.event_booking_id is not null and v_order.folio_charge_id is not null then
    update public.event_booking_line_items
       set description = description || ' [VOIDED]', voided_at = now(), void_reason = v_reason
     where id = v_order.folio_charge_id and event_booking_id = v_order.event_booking_id and voided_at is null;
    perform public.recalculate_event_totals(v_order.event_booking_id);
  elsif v_order.folio_charge_id is not null then
    perform public.delete_booking_charge(v_order.folio_charge_id, v_lodge_id, 'Voided with POS order');
  end if;

  update public.pos_orders set status = 'voided', updated_at = now() where id = v_order_id;
  insert into public.pos_override_log (id, lodge_id, order_id, action, requested_by, approved_by, reason, outlet_id, created_at)
  values (v_override_id, v_lodge_id, v_order_id, 'void', v_actor_id, v_approver_id, v_reason, v_order.outlet_id, now());

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id, approver_id,
    device_id, action, entity_type, entity_id, staff_id, amount_delta,
    before_snapshot, after_snapshot, details
  ) values (
    v_lodge_id, v_order.outlet_id, v_order.shift_id, v_order_id, v_actor_id,
    v_order.cashier_id, v_approver_id, v_device_id, 'pos_order_voided',
    'pos_order', v_order_id, v_approver_id, -v_order.total,
    jsonb_build_object('status', v_order.status, 'total', v_order.total),
    jsonb_build_object('status', 'voided'),
    jsonb_build_object(
      'reason', v_reason,
      'direct_stock_disposition', v_direct_stock_disposition,
      'recipe_stock_disposition', 'consumed',
      'restored_direct_stock', v_restored
    )
  );

  return jsonb_build_object(
    'success', true, 'id', v_order_id, 'override_log_id', v_override_id,
    'approved_by', v_approver_id,
    'approver_name', (select u.name from public.users u where u.id = v_approver_id),
    'direct_stock_disposition', v_direct_stock_disposition,
    'restored_stock', v_restored
  );
end;
$$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;
