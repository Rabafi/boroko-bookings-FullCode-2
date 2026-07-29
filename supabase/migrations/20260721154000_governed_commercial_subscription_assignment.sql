-- Wrap the product-aware subscription assignment in the Command Central
-- operation/audit envelope. The existing assignment RPC remains the canonical
-- entitlement implementation; this wrapper supplies replay safety and evidence.

create or replace function public.admin_governed_assign_commercial_subscription(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product_id text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'activation_reason', p_payload->>'reason', '')), '');
  v_claim jsonb;
  v_before jsonb;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'Subscription assignment payload is required'); end if;
  if v_operation_id is null or v_lodge_id is null or v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then return jsonb_build_object('success', false, 'error', 'A valid operation, company, and product are required'); end if;
  if v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'An assignment reason of at least 8 characters is required'); end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'commercial_subscription.assign', v_lodge_id, v_product_id, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim subscription assignment')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;
  select jsonb_build_object('license_id', id, 'product_id', product_id, 'package_key', commercial_package_key, 'payment_status', payment_status, 'monthly_fee', monthly_fee, 'currency', currency)
    into v_before from public.licenses where lodge_id = v_lodge_id and coalesce(is_active, true) = true order by issued_at desc nulls last limit 1 for update;
  v_result := public.admin_assign_commercial_subscription(p_payload);
  if coalesce((v_result->>'success')::boolean, false) = false then
    perform public.command_central_fail_operation(v_operation_id, v_result);
    return v_result;
  end if;
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'commercial_subscription_assigned', v_lodge_id, v_product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, coalesce(v_before, '{}'::jsonb), v_result);
  return v_result;
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'error', 'One of the assignment identifiers is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', 'Commercial subscription assignment failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_governed_assign_commercial_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_assign_commercial_subscription(jsonb) to service_role;
notify pgrst, 'reload schema';
