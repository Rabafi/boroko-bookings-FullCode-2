-- Forward guardrails for Users & Access subscription transitions.
--
-- Standard does not include the Manager Mobile App (PWA). Keep that boundary
-- authoritative for every active Standard assignment, including trial ->
-- Standard activation and deactivate/insert transitions with no old Pro row.
-- This guard never rewrites users.

create or replace function public.enforce_pro_standard_pwa_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_standard boolean := lower(btrim(coalesce(new.subscription_plan, ''))) = 'standard'
    and coalesce(nullif(lower(btrim(coalesce(new.product_id, ''))), ''), 'lodge-camp') = 'lodge-camp'
    and coalesce(new.is_active, true) = true;
  v_pwa_user_count integer := 0;
  v_active_pwa_session_count integer := 0;
begin
  if not v_target_standard or new.lodge_id is null then
    return new;
  end if;

  select count(*)
    into v_pwa_user_count
    from public.users
   where lodge_id = new.lodge_id
     and coalesce(pwa_enabled, false) = true;

  select count(*)
    into v_active_pwa_session_count
    from public.app_sessions
   where lodge_id = new.lodge_id
     and session_type = 'pwa'
     and revoked_at is null
     and expires_at > now();

  if v_pwa_user_count > 0 or v_active_pwa_session_count > 0 then
    raise exception 'Cannot activate Standard: % user account(s) still have Manager mobile access enabled and % active mobile session(s) remain. Disable every Manager mobile account before retrying, or keep Pro.',
      v_pwa_user_count, v_active_pwa_session_count;
  end if;

  return new;
end;
$$;

drop trigger if exists aaa_pro_standard_pwa_transition_guard on public.licenses;
create trigger aaa_pro_standard_pwa_transition_guard
before insert or update of lodge_id, product_id, subscription_plan, is_active on public.licenses
for each row execute function public.enforce_pro_standard_pwa_transition();

revoke all on function public.enforce_pro_standard_pwa_transition() from public;
grant execute on function public.enforce_pro_standard_pwa_transition() to service_role;

-- Every caller may enable PWA only when the authoritative entitlement includes
-- it. Disabling remains available for cleanup and revokes all PWA sessions for
-- that user immediately.
create or replace function public.set_user_pwa_access(
  p_id uuid,
  p_lodge_id uuid,
  p_enabled boolean,
  p_password_hash text default null,
  p_disabled_reason text default null,
  p_reset_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user public.users%rowtype;
  v_password_hash text := nullif(btrim(coalesce(p_password_hash, '')), '');
  v_entitlement jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);
  select * into v_user
    from public.users
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1
   for update;
  if v_user.id is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  if p_enabled and not public._is_pwa_role_eligible(v_user.role) then
    return jsonb_build_object('success', false, 'error', 'Only manager and admin roles can receive Manager PWA access.');
  end if;

  if p_enabled then
    v_entitlement := public.get_lodge_entitlement(p_lodge_id);
    if not coalesce((v_entitlement->'effective_features'->>'pwa')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'Manager mobile app access is not included in this subscription. Upgrade to Pro for mobile access.');
    end if;
  end if;

  if p_enabled and coalesce(v_password_hash, nullif(btrim(coalesce(v_user.pwa_password_hash, '')), '')) is null then
    return jsonb_build_object('success', false, 'error', 'Set a separate Manager PWA password before enabling mobile access.');
  end if;

  update public.users
     set pwa_enabled = p_enabled,
         pwa_password_hash = case when v_password_hash is not null then v_password_hash else pwa_password_hash end,
         pwa_password_set_at = case when v_password_hash is not null then now() else pwa_password_set_at end,
         pwa_password_reset_by = case when v_password_hash is not null then p_reset_by else pwa_password_reset_by end,
         pwa_disabled_reason = case when p_enabled then null else coalesce(nullif(btrim(coalesce(p_disabled_reason, '')), ''), 'Manager PWA access disabled.') end
   where id = p_id
     and lodge_id = p_lodge_id;

  if not p_enabled then
    update public.app_sessions
       set revoked_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'revoked_by_pwa_access_update', true,
             'revoked_reason', coalesce(nullif(btrim(coalesce(p_disabled_reason, '')), ''), 'Manager PWA access disabled.')
           )
     where user_id = p_id
       and lodge_id = p_lodge_id
       and session_type = 'pwa'
       and revoked_at is null;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'pwa_enabled', p_enabled);
end;
$$;

-- Preserve the actionable transition error through the idempotent Command
-- Central wrapper instead of replacing it with a generic assignment failure.
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
    into v_before from public.licenses
    where lodge_id = v_lodge_id and product_id = v_product_id and coalesce(is_active, true) = true
    order by issued_at desc nulls last limit 1 for update;
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
  v_result := jsonb_build_object(
    'success', false,
    'error', case when sqlerrm like 'Cannot activate Starter:%' or sqlerrm like 'Cannot activate Standard:%' then sqlerrm else 'Commercial subscription assignment failed' end
  );
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

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
  v_result := jsonb_build_object(
    'success', false,
    'error', case when sqlerrm like 'Cannot activate Starter:%' or sqlerrm like 'Cannot activate Standard:%' then sqlerrm else 'Governed subscription activation failed' end
  );
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_governed_assign_commercial_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_assign_commercial_subscription(jsonb) to service_role;
revoke all on function public.admin_governed_activate_subscription_request(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_activate_subscription_request(jsonb) to service_role;
notify pgrst, 'reload schema';
