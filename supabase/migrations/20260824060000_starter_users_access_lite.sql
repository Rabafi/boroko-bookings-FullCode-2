-- Starter Users & Access Lite
--
-- Starter includes a small, safe account surface rather than the full Staff
-- module. The client UI is intentionally narrow, but these restrictions also
-- apply to SECURITY DEFINER RPCs and direct table writes so a caller cannot
-- turn a Starter lodge into an unrestricted workforce account set.

-- Keep every catalogue version aligned with the shared entitlement map. The
-- accommodation catalogue explicitly includes the baseline account surface on
-- Lodge Starter/Standard/Pro and Hotel Core. Every package that already carries
-- full `staff` (including Hospitality POS packages) must retain `staff_basic`
-- because the shared staff.view/manage capabilities depend on that boundary.
update public.commercial_package_prices package_price
   set included_features = coalesce(package_price.included_features, '[]'::jsonb) || '["staff_basic"]'::jsonb
 where not (coalesce(package_price.included_features, '[]'::jsonb) ? 'staff_basic')
   and (
     coalesce(package_price.included_features, '[]'::jsonb) ? 'staff'
     or (
       package_price.product_id = 'lodge-camp'
       and package_price.commercial_package_key in ('starter', 'standard', 'pro')
     )
     or (
       package_price.product_id = 'hotel'
       and package_price.commercial_package_key = 'hotel_core'
     )
   );

insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select package_price.catalog_version_id,
       package_price.product_id,
       package_price.commercial_package_key,
       'staff_basic',
       true
  from public.commercial_package_prices package_price
 where package_price.included_features ? 'staff_basic'
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = excluded.enabled;

-- Commercial subscription activation, governed assignment, contract updates,
-- and the documented legacy fallbacks all converge on public.licenses. Guard
-- that authoritative table so no activation path can downgrade around the
-- Starter account contract.
create or replace function public.enforce_starter_license_user_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- Do not use the legacy _normalize_subscription_plan helper here: its
  -- historical fallback maps newer Enterprise/Hotel names to Starter.
  v_new_is_starter boolean := lower(btrim(coalesce(new.subscription_plan, ''))) in ('starter', 'basic')
    and coalesce(nullif(lower(btrim(coalesce(new.product_id, ''))), ''), 'lodge-camp') = 'lodge-camp'
    and coalesce(new.is_active, true) = true;
  v_user_count integer := 0;
  v_admin_count integer := 0;
  v_active_admin_count integer := 0;
  v_unsafe_role_count integer := 0;
  v_override_count integer := 0;
  v_pwa_count integer := 0;
  v_outlet_scope_count integer := 0;
begin
  if not v_new_is_starter then
    return new;
  end if;

  if new.lodge_id is null then
    raise exception 'Cannot activate Starter without a valid lodge. Select the company before assigning the Starter package.';
  end if;

  -- CREATE TRIGGER does not scan or rewrite historical rows, so deployment
  -- deliberately preserves any already-active, noncompliant Starter licence.
  -- Its next assignment, reactivation, or guarded plan write must satisfy the
  -- current contract; ordinary billing/note updates do not fire this trigger.

  -- Serialize against Starter user creation. The matching public.users trigger
  -- takes the same transaction-scoped key before accepting an account insert.
  perform pg_advisory_xact_lock(hashtextextended('starter-users:' || new.lodge_id::text, 0));

  select
    count(*),
    count(*) filter (where lower(coalesce(role, '')) = 'admin'),
    count(*) filter (where lower(coalesce(role, '')) = 'admin' and lower(coalesce(status, 'active')) = 'active'),
    count(*) filter (where lower(coalesce(role, '')) not in ('admin', 'receptionist', 'operations')),
    count(*) filter (where coalesce(capability_overrides, '{}'::jsonb) <> '{}'::jsonb),
    count(*) filter (where coalesce(pwa_enabled, false)),
    count(*) filter (where cardinality(coalesce(allowed_outlet_ids, '{}'::uuid[])) > 0)
  into
    v_user_count,
    v_admin_count,
    v_active_admin_count,
    v_unsafe_role_count,
    v_override_count,
    v_pwa_count,
    v_outlet_scope_count
  from public.users
  where lodge_id = new.lodge_id;

  -- Zero users is the supported company-setup state; the first subsequent user
  -- is independently required to be Admin by the public.users trigger.
  if v_user_count = 0 then
    return new;
  end if;

  if v_user_count > 2 then
    raise exception 'Cannot activate Starter: this lodge has % user accounts, but Starter allows 2 total. Remove extra accounts before downgrading or keep Standard.', v_user_count;
  end if;

  if v_admin_count <> 1 or v_active_admin_count <> 1 then
    raise exception 'Cannot activate Starter: keep exactly one active Admin owner account. Reactivate the owner and change any other privileged accounts to Receptionist or Operations first.';
  end if;

  if v_unsafe_role_count > 0 then
    raise exception 'Cannot activate Starter: every account other than the single Admin owner must use the Receptionist or Operations role template.';
  end if;

  if v_override_count > 0 then
    raise exception 'Cannot activate Starter while custom permission exceptions exist. Clear the overrides before downgrading or keep Standard.';
  end if;

  if v_pwa_count > 0 then
    raise exception 'Cannot activate Starter while Manager mobile access is enabled. Disable mobile access before downgrading or keep Pro.';
  end if;

  if v_outlet_scope_count > 0 then
    raise exception 'Cannot activate Starter while outlet-scoped user access exists. Clear outlet assignments before downgrading or keep the current package.';
  end if;

  return new;
end;
$$;

drop trigger if exists aaa_starter_license_user_transition_guard on public.licenses;
create trigger aaa_starter_license_user_transition_guard
before insert or update of lodge_id, product_id, subscription_plan, is_active on public.licenses
for each row execute function public.enforce_starter_license_user_transition();

revoke all on function public.enforce_starter_license_user_transition() from public;
grant execute on function public.enforce_starter_license_user_transition() to service_role;

-- The governed Command Central wrappers historically replace all unexpected
-- database messages with a generic failure. Preserve only this deliberately
-- actionable Starter-transition message; unrelated internals remain hidden.
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
    'error', case when sqlerrm like 'Cannot activate Starter:%' then sqlerrm else 'Commercial subscription assignment failed' end
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
    'error', case when sqlerrm like 'Cannot activate Starter:%' then sqlerrm else 'Governed subscription activation failed' end
  );
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_governed_assign_commercial_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_assign_commercial_subscription(jsonb) to service_role;
revoke all on function public.admin_governed_activate_subscription_request(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_activate_subscription_request(jsonb) to service_role;

create or replace function public.enforce_starter_users_access_lite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_starter boolean := false;
  v_existing_count integer := 0;
  v_role text := lower(coalesce(new.role, ''));
begin
  select exists (
    select 1
      from public.licenses license
     where license.lodge_id = new.lodge_id
       and coalesce(license.is_active, true) = true
       and lower(btrim(coalesce(license.subscription_plan, ''))) in ('starter', 'basic')
       and coalesce(nullif(lower(btrim(coalesce(license.product_id, ''))), ''), 'lodge-camp') = 'lodge-camp'
  ) into v_is_starter;

  if not v_is_starter then
    return new;
  end if;

  -- Serialize the count check with the existing usage-limit trigger so two
  -- concurrent invitations cannot both observe the same free Starter slot.
  perform pg_advisory_xact_lock(hashtextextended('starter-users:' || new.lodge_id::text, 0));

  if tg_op = 'INSERT' then
    select count(*) into v_existing_count
      from public.users
     where lodge_id = new.lodge_id;

    if v_existing_count >= 2 then
      raise exception 'Starter Users & Access allows up to 2 total users. Upgrade to Standard to add more users.';
    end if;

    if v_existing_count = 0 and v_role <> 'admin' then
      raise exception 'The first lodge user must use the Admin role template.';
    end if;

    -- Preserve the initial owner/admin setup path. Every additional account
    -- must use one of these fixed, low-risk operating roles.
    if v_existing_count > 0 and v_role not in ('receptionist', 'operations') then
      raise exception 'Starter additional users must use the Receptionist or Operations role template.';
    end if;
  elsif tg_op = 'UPDATE' then
    -- An existing Starter owner may retain the admin role, but a second user
    -- cannot be elevated into an admin/manager/finance account.
    if v_role <> lower(coalesce(old.role, ''))
       and v_role not in ('receptionist', 'operations')
       and not (lower(coalesce(old.role, '')) = 'admin' and v_role = 'admin') then
      raise exception 'Starter additional users must use the Receptionist or Operations role template.';
    end if;
  end if;

  if coalesce(new.capability_overrides, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'Starter uses fixed role templates. Custom permission exceptions require Standard.';
  end if;

  if coalesce(new.pwa_enabled, false) then
    raise exception 'Manager mobile access is not included in Starter. Upgrade to Pro for mobile access.';
  end if;

  if cardinality(coalesce(new.allowed_outlet_ids, '{}'::uuid[])) > 0 then
    raise exception 'Outlet-scoped access is not included in Starter Users & Access.';
  end if;

  return new;
end;
$$;

drop trigger if exists aaa_starter_users_access_lite_guard on public.users;
create trigger aaa_starter_users_access_lite_guard
before insert or update on public.users
for each row execute function public.enforce_starter_users_access_lite();

revoke all on function public.enforce_starter_users_access_lite() from public;
grant execute on function public.enforce_starter_users_access_lite() to service_role;
