-- Exact, immutable replay receipt for the shared Restaurant & Bar POS void RPC.
-- The receipt commits with the stock, ledger, order and audit effects below.
begin;

create table public.pos_void_operation_receipts (
  override_log_id uuid primary key references public.pos_override_log(id) on delete restrict,
  lodge_id uuid not null,
  order_id uuid not null,
  outlet_id uuid,
  actor_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check ((result ->> 'success') = 'true'),
  created_at timestamptz not null default now()
);

comment on table public.pos_void_operation_receipts is
  'Immutable exact-replay receipts for approve_pos_void_with_pin; payload hash excludes the PIN secret.';

alter table public.pos_void_operation_receipts enable row level security;
revoke all on table public.pos_void_operation_receipts from public, anon, authenticated, service_role;

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
  v_override_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_actor_id uuid;
  v_receipt_outlet_id uuid;
  v_payload_hash text;
  v_receipt public.pos_void_operation_receipts%rowtype;
  v_order record;
  v_restored jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_lodge_id is null or v_order_id is null or v_override_id is null or v_pin is null or v_reason is null then
    return jsonb_build_object('success', false, 'code', 'operation_key_required', 'error', 'lodge_id, order_id, stable override_log_id, PIN and reason are required');
  end if;
  if v_direct_stock_disposition not in ('return_to_stock', 'consumed_or_damaged') then
    return jsonb_build_object('success', false, 'error', 'Choose whether packaged stock was returned or consumed/damaged');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  v_actor_id := public.app_current_user_id();
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'code', 'actor_required', 'error', 'An authenticated operator is required. Sign in, preserve the original void key, and ask a manager to review the result.');
  end if;

  -- A transaction-scoped lock makes same-key retries deterministic, including
  -- callers replaying from different POS processes at the same time.
  perform pg_advisory_xact_lock(hashtextextended('pos-void:' || v_override_id::text, 0));
  v_payload_hash := encode(public.digest((payload - 'pin')::text, 'sha256'), 'hex');

  select r.* into v_receipt
    from public.pos_void_operation_receipts r
   where r.override_log_id = v_override_id;
  if found then
    if v_receipt.lodge_id <> v_lodge_id
       or v_receipt.order_id <> v_order_id
       or v_receipt.actor_id <> v_actor_id
       or v_receipt.payload_hash <> v_payload_hash then
      return jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'error', 'This POS void key is already bound to a different actor, scope or request. Preserve the original item for manager review; do not re-key or repeat the void.');
    end if;
    select o.outlet_id into v_receipt_outlet_id
      from public.pos_orders o
     where o.id = v_receipt.order_id and o.lodge_id = v_receipt.lodge_id;
    if not found or v_receipt_outlet_id is distinct from v_receipt.outlet_id then
      return jsonb_build_object('success', false, 'code', 'idempotency_receipt_unavailable', 'error', 'The saved POS void outlet scope is no longer verifiable. Keep this item for manager review.');
    end if;
    if v_receipt.outlet_id is not null then
      perform public.app_require_pos_outlet_access(v_lodge_id, v_receipt.outlet_id);
    end if;
    return v_receipt.result || jsonb_build_object('already_applied', true);
  end if;

  -- Rows committed before this receipt contract cannot be safely paired with
  -- a retry because their immutable request envelope was not retained.
  if exists (select 1 from public.pos_override_log l where l.id = v_override_id) then
    return jsonb_build_object('success', false, 'code', 'idempotency_receipt_unavailable', 'error', 'This POS void predates exact retry evidence. Keep it for manager review; do not re-key or repeat the void.');
  end if;

  select o.* into v_order
    from public.pos_orders o
   where o.id = v_order_id
     and o.lodge_id = v_lodge_id
   for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Order not found'); end if;
  if v_order.status = 'voided' then return jsonb_build_object('success', false, 'error', 'Order is already voided; no exact operation receipt matched. Keep this item for manager review.'); end if;
  if v_order.status = 'settled' then return jsonb_build_object('success', false, 'error', 'Settled orders must be returned in the current shift, not voided'); end if;
  if nullif(payload->>'outlet_id', '') is not null and v_order.outlet_id is distinct from nullif(payload->>'outlet_id', '')::uuid then
    return jsonb_build_object('success', false, 'code', 'outlet_scope_conflict', 'error', 'The requested outlet does not match this order. Keep the original item for manager review.');
  end if;
  if v_order.outlet_id is not null then perform public.app_require_pos_outlet_access(v_lodge_id, v_order.outlet_id); end if;

  if v_approver_id is null then
    v_approver_id := public._pos_resolve_pin_internal(v_lodge_id, v_pin, 'pos.void', v_device_id);
  elsif not public._pos_validate_pin_internal(v_lodge_id, v_approver_id, v_pin, 'pos.void', v_device_id) then
    v_approver_id := null;
  end if;
  if v_approver_id is null then return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver'); end if;

  -- Preserve the existing atomic void contract: stock, folio charge, order,
  -- override record, audit and the exact replay receipt commit together.
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

  v_result := jsonb_build_object(
    'success', true, 'id', v_order_id, 'override_log_id', v_override_id,
    'approved_by', v_approver_id,
    'approver_name', (select u.name from public.users u where u.id = v_approver_id),
    'direct_stock_disposition', v_direct_stock_disposition,
    'restored_stock', v_restored
  );
  insert into public.pos_void_operation_receipts (
    override_log_id, lodge_id, order_id, outlet_id, actor_id, payload_hash, result
  ) values (
    v_override_id, v_lodge_id, v_order_id, v_order.outlet_id, v_actor_id, v_payload_hash, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;

commit;