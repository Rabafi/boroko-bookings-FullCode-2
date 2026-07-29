-- Route Command Central subscription-request activation through the same
-- operation claim/audit envelope as other privileged commercial mutations.
-- The existing activation RPC remains the authoritative quote/entitlement
-- implementation; this wrapper adds replay safety and removes client-side
-- fallback writes.

create or replace function public.admin_governed_activate_subscription_request(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_request_id uuid := nullif(btrim(coalesce(p_payload->>'request_id', '')), '')::uuid;
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_request public.subscription_package_requests%rowtype;
  v_lodge_id uuid;
  v_license_id uuid := nullif(btrim(coalesce(p_payload->>'license_id', '')), '')::uuid;
  v_product_id text;
  v_reason text := nullif(btrim(coalesce(p_payload->>'activation_reason', p_payload->>'reason', '')), '');
  v_claim jsonb;
  v_contract_result jsonb;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'Subscription activation payload is required');
  end if;
  if v_request_id is null or v_operation_id is null or v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'error', 'A request, stable operation ID, and activation reason are required');
  end if;

  select * into v_request
  from public.subscription_package_requests
  where id = v_request_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Subscription request was not found');
  end if;

  v_lodge_id := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  if v_lodge_id is null then v_lodge_id := v_request.lodge_id; end if;
  if v_request.lodge_id is not null and v_lodge_id is distinct from v_request.lodge_id then
    return jsonb_build_object('success', false, 'error', 'Selected company does not match the subscription request');
  end if;
  v_product_id := lower(nullif(btrim(coalesce(p_payload->>'product_id', v_request.product_id, '')), ''));
  if v_lodge_id is null or v_license_id is null then
    return jsonb_build_object('success', false, 'error', 'A company and selected license are required for activation');
  end if;

  v_claim := public.command_central_claim_operation(
    v_operation_id,
    'subscription_request.activate',
    v_lodge_id,
    v_product_id,
    md5(p_payload::text),
    v_reason,
    nullif(p_payload->>'actor_id', '')::uuid,
    nullif(p_payload->>'actor_email', '')
  );
  if coalesce((v_claim->>'ok')::boolean, false) = false then
    return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim activation operation'));
  end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then
    return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result'));
  end if;

  -- Legacy requests still update their existing contract, but only through
  -- the authoritative RPC and inside this governed transaction. Commercial
  -- requests are fully handled by the catalog-backed activation RPC below.
  if v_request.commercial_package_key is null then
    v_contract_result := public.update_subscription_contract(
      v_license_id,
      jsonb_build_object(
        'subscription_plan', coalesce(p_payload->>'plan', v_request.requested_plan, 'Starter'),
        'payment_status', coalesce(p_payload->>'payment_status', 'active'),
        'notes', coalesce(p_payload->>'notes', 'Activated from a governed Command Central subscription request')
      )
    );
    if coalesce((v_contract_result->>'success')::boolean, false) = false then
      perform public.command_central_fail_operation(v_operation_id, v_contract_result);
      return v_contract_result;
    end if;
  end if;

  v_result := public.activate_subscription_request(
    v_request_id,
    coalesce(nullif(p_payload->>'activated_by', ''), nullif(p_payload->>'actor_email', ''), 'command-central'),
    p_payload - 'operation_id' - 'request_id' - 'actor_id' - 'actor_email'
  );
  if coalesce((v_result->>'success')::boolean, false) = false then
    perform public.command_central_fail_operation(v_operation_id, v_result);
    return v_result;
  end if;

  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(
    operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email,
    reason, before_state, after_state
  ) values (
    v_operation_id, 'subscription_request_activated', v_lodge_id, v_product_id,
    nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''),
    v_reason, jsonb_build_object('request_id', v_request_id, 'status', v_request.status), v_result
  );
  return v_result;
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'error', 'One of the activation identifiers is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', 'Governed subscription activation failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_governed_activate_subscription_request(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_activate_subscription_request(jsonb) to service_role;
notify pgrst, 'reload schema';
