-- Require server-side supervisor PIN proof for POS void approvals.

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by uuid := nullif(payload->>'approved_by', '')::uuid;
  v_pin text := nullif(btrim(coalesce(payload->>'pin', '')), '');
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

  if v_pin is null or not exists (
    select 1
      from public.users u
     where u.id = v_approved_by
       and u.lodge_id = v_lodge_id
       and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
       and u.pin_hash is not null
       and extensions.crypt(v_pin, u.pin_hash) = u.pin_hash
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
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
$$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;
