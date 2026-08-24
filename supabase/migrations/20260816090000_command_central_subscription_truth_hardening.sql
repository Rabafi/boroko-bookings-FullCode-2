-- Command Central commercial control-plane hardening.
--
-- This is deliberately a forward migration. It removes an obsolete public
-- activation overload, corrects annual add-on collection in the authoritative
-- quote, and makes the remaining activation path fail closed.

-- There is no current application caller for this one-argument legacy overload.
-- It could mark a request as activated without validating the quote, payment,
-- licence, tenant, entitlement boundary, or Command Central operation record.
drop function if exists public.activate_subscription_request(uuid);

create or replace function public.calculate_commercial_quote(p_selection jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_catalog public.commercial_catalog_versions;
  v_package public.commercial_package_prices;
  v_addon public.commercial_addon_prices;
  v_product_id text := nullif(btrim(coalesce(p_selection->>'product_id', '')), '');
  v_package_key text := nullif(btrim(coalesce(p_selection->>'commercial_package_key', p_selection->>'package_key', '')), '');
  v_profile text := nullif(btrim(coalesce(p_selection->>'operating_profile', '')), '');
  v_property_type text := nullif(btrim(coalesce(p_selection->>'property_type', '')), '');
  v_addon_key text;
  v_addon_due_now numeric;
  v_lines jsonb := '[]'::jsonb;
  v_addon_keys jsonb := coalesce(p_selection->'selected_addon_keys', p_selection->'requested_addons', '[]'::jsonb);
  v_included_features jsonb := '[]'::jsonb;
  v_total_due_now numeric := 0;
  v_one_time_total numeric := 0;
  v_recurring_annual numeric := 0;
begin
  if p_selection is null or jsonb_typeof(p_selection) <> 'object' then raise exception 'Commercial selection must be an object'; end if;
  if v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then raise exception 'Invalid commercial product'; end if;
  if jsonb_typeof(v_addon_keys) <> 'array' then raise exception 'selected_addon_keys must be an array'; end if;
  v_catalog := public._commercial_active_catalog_version();
  if v_catalog.id is null then raise exception 'No active commercial catalogue'; end if;

  select * into v_package from public.commercial_package_prices p
  where p.catalog_version_id = v_catalog.id and p.product_id = v_product_id and p.commercial_package_key = v_package_key;
  if not found then raise exception 'Invalid product/package combination'; end if;
  if cardinality(v_package.eligible_property_types) > 0 and coalesce(v_property_type, '') <> all(v_package.eligible_property_types) then
    raise exception 'Package is not eligible for property type %', coalesce(v_property_type, 'unknown');
  end if;
  if cardinality(v_package.eligible_operating_profiles) > 0 and coalesce(v_profile, '') <> all(v_package.eligible_operating_profiles) then
    raise exception 'Package is not eligible for operating profile %', coalesce(v_profile, 'unknown');
  end if;

  v_included_features := v_package.included_features;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'line_type', 'package', 'key', v_package.commercial_package_key, 'label', v_package.display_name,
    'billing_basis', v_package.billing_basis,
    'one_time_amount', case when v_package.billing_basis = 'initial_purchase' then v_package.price_bwp else 0 end,
    'recurring_amount', case when v_package.billing_basis = 'annual_license' then v_package.price_bwp else 0 end,
    'amount_due_now', v_package.price_bwp));
  v_total_due_now := v_package.price_bwp;
  if v_package.billing_basis = 'initial_purchase' then v_one_time_total := v_package.price_bwp;
  else v_recurring_annual := v_package.price_bwp;
  end if;

  for v_addon_key in select distinct jsonb_array_elements_text(v_addon_keys) loop
    select * into v_addon from public.commercial_addon_prices a
    where a.catalog_version_id = v_catalog.id and a.product_id = v_product_id and a.addon_key = v_addon_key and a.active = true;
    if not found then raise exception 'Invalid add-on % for product %', v_addon_key, v_product_id; end if;
    if cardinality(v_addon.eligible_property_types) > 0 and coalesce(v_property_type, '') <> all(v_addon.eligible_property_types) then
      raise exception 'Add-on % is not eligible for property type %', v_addon_key, coalesce(v_property_type, 'unknown');
    end if;
    if cardinality(v_addon.eligible_operating_profiles) > 0 and coalesce(v_profile, '') <> all(v_addon.eligible_operating_profiles) then
      raise exception 'Add-on % is not eligible for operating profile %', v_addon_key, coalesce(v_profile, 'unknown');
    end if;
    -- Bar annual bundles are payable for their first annual term at
    -- activation, as well as appearing in annual renewal. Hotel recurring
    -- add-ons retain their established deferred recurring contract model.
    v_addon_due_now := coalesce(v_addon.one_time_price_bwp, 0)
      + case when v_product_id = 'hospitality-pos' and v_addon.billing_basis = 'annual_addon' then coalesce(v_addon.annual_price_bwp, 0) else 0 end;
    v_included_features := (
      select coalesce(jsonb_agg(distinct feature_key), '[]'::jsonb)
      from jsonb_array_elements_text(v_included_features || v_addon.included_features) as features(feature_key)
    );
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_type', 'addon', 'key', v_addon.addon_key, 'label', v_addon.display_name,
      'billing_basis', v_addon.billing_basis, 'one_time_amount', v_addon.one_time_price_bwp,
      'recurring_amount', coalesce(v_addon.annual_price_bwp, 0), 'amount_due_now', v_addon_due_now));
    v_total_due_now := v_total_due_now + v_addon_due_now;
    v_one_time_total := v_one_time_total + coalesce(v_addon.one_time_price_bwp, 0);
    v_recurring_annual := v_recurring_annual + coalesce(v_addon.annual_price_bwp, 0);
  end loop;

  return jsonb_build_object(
    'product_id', v_product_id, 'commercial_package_key', v_package.commercial_package_key,
    'package_label', v_package.display_name, 'internal_plan', v_package.internal_plan,
    'billing_basis', v_package.billing_basis, 'catalog_version', v_catalog.version,
    'currency', v_catalog.currency, 'lines', v_lines,
    'totals', jsonb_build_object('total_due_now', v_total_due_now, 'one_time_total', v_one_time_total, 'recurring_annual', v_recurring_annual),
    'included_features', v_included_features, 'excluded_features', v_package.excluded_features,
    'operating_profile', v_profile, 'property_type', v_property_type,
    'selection', jsonb_build_object('product_id', v_product_id, 'commercial_package_key', v_package.commercial_package_key,
      'selected_addon_keys', v_addon_keys, 'operating_profile', v_profile, 'property_type', v_property_type),
    'note', case when v_product_id = 'hospitality-pos'
      then 'The total due now includes the first annual term of the selected Bar package and annual add-ons. Payment is not collected here; activation occurs only after Tsa Bonno approves payment proof.'
      else 'This quote is a request for manual review. Payment is not collected here and activation occurs only after Tsa Bonno approves payment proof.' end
  );
end;
$$;

create or replace function public.activate_subscription_request(
  p_request_id uuid,
  p_activated_by text default 'admin',
  p_activation_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.subscription_package_requests;
  v_license public.licenses;
  v_settings public.settings;
  v_package public.commercial_package_prices;
  v_addon public.commercial_addon_prices;
  v_license_id uuid := nullif(p_activation_payload->>'license_id', '')::uuid;
  v_lodge_id uuid := nullif(p_activation_payload->>'lodge_id', '')::uuid;
  v_payment_status text := lower(btrim(coalesce(p_activation_payload->>'payment_status', 'active')));
  v_selected_addons jsonb;
  v_addon_key text;
  v_feature_key text;
  v_effective jsonb := '{}'::jsonb;
  v_previous_plan text;
begin
  select * into v_request from public.subscription_package_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Request not found'); end if;
  if v_request.status <> 'approved' then
    return jsonb_build_object('success', false, 'error', 'Request must be approved before activation');
  end if;
  if v_license_id is null or v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'license_id and lodge_id are required for activation');
  end if;
  if v_payment_status not in ('active', 'free', 'trial', 'overdue', 'suspended', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Invalid payment status for activation');
  end if;

  select * into v_license from public.licenses where id = v_license_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Selected license does not belong to the selected company'); end if;

  if v_request.commercial_package_key is null then
    update public.subscription_package_requests set
      lodge_id = coalesce(lodge_id, v_lodge_id), existing_license_id = coalesce(existing_license_id, v_license_id),
      status = 'activated', activated_at = now(), activated_by = p_activated_by,
      activation_payload = p_activation_payload, updated_at = now()
    where id = p_request_id;
    return jsonb_build_object('success', true, 'id', p_request_id, 'status', 'activated', 'license_id', v_license_id, 'lodge_id', v_lodge_id);
  end if;

  if v_request.canonical_pricing_snapshot is null or v_request.product_id is null or v_request.commercial_catalog_version is null then
    return jsonb_build_object('success', false, 'error', 'Commercial quote snapshot is missing');
  end if;
  if p_activation_payload->>'product_id' is not null and p_activation_payload->>'product_id' <> v_request.product_id then
    return jsonb_build_object('success', false, 'error', 'Product does not match the commercial quote');
  end if;

  select property_type, operating_profile into v_settings from public.settings where lodge_id = v_lodge_id limit 1;
  if v_request.product_id = 'hotel' and coalesce(v_settings.property_type, v_license.business_type, '') not in ('hotel', 'resort') then
    return jsonb_build_object('success', false, 'error', 'Hotel quote cannot be activated for a non-Hotel company');
  elsif v_request.product_id = 'hospitality-pos' and coalesce(v_settings.property_type, v_license.business_type, '') <> 'restaurant' then
    return jsonb_build_object('success', false, 'error', 'POS quote cannot be activated for a non-restaurant company');
  elsif v_request.product_id = 'lodge-camp' and coalesce(v_settings.property_type, v_license.business_type, '') in ('hotel', 'resort', 'restaurant') then
    return jsonb_build_object('success', false, 'error', 'Lodge quote cannot be activated for this company product');
  end if;
  if v_license.product_id is not null and v_license.product_id <> v_request.product_id then
    return jsonb_build_object('success', false, 'error', 'Licence product does not match the commercial quote');
  end if;
  v_previous_plan := v_license.subscription_plan;

  select * into v_package from public.commercial_package_prices
  where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
    and product_id = v_request.product_id and commercial_package_key = v_request.commercial_package_key;
  if not found or v_request.canonical_pricing_snapshot->>'catalog_version' <> v_request.commercial_catalog_version then
    return jsonb_build_object('success', false, 'error', 'Quote catalogue snapshot is not valid');
  end if;

  v_selected_addons := coalesce(v_request.requested_addons, '[]'::jsonb);
  for v_addon_key in select distinct jsonb_array_elements_text(v_selected_addons) loop
    select * into v_addon from public.commercial_addon_prices
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id and addon_key = v_addon_key and active = true;
    if not found then return jsonb_build_object('success', false, 'error', 'Selected add-on is not valid for this product'); end if;
    if v_request.product_id = 'hospitality-pos' and v_addon.billing_basis = 'annual_addon' and coalesce((
      select (line->>'amount_due_now')::numeric
      from jsonb_array_elements(coalesce(v_request.canonical_pricing_snapshot->'lines', '[]'::jsonb)) line
      where line->>'line_type' = 'addon' and line->>'key' = v_addon_key
      limit 1
    ), 0) < coalesce(v_addon.annual_price_bwp, 0) then
      return jsonb_build_object('success', false, 'error', 'This quote predates annual add-on billing correction. Issue a replacement quote and invoice before activation.');
    end if;
  end loop;

  update public.licenses set
    subscription_plan = v_package.internal_plan,
    product_id = v_request.product_id,
    commercial_package_key = v_request.commercial_package_key,
    commercial_catalog_version = v_request.commercial_catalog_version,
    commercial_pricing_snapshot = v_request.canonical_pricing_snapshot,
    payment_status = v_payment_status,
    is_active = true,
    activated_at = now(),
    subscription_state = public._subscription_state(v_payment_status, next_due_date, expires_at, true, coalesce(grace_period_days, 7))
  where id = v_license_id;

  for v_feature_key in
    select distinct jsonb_array_elements_text(included_features) from public.commercial_package_prices
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, false, 'Commercial package boundary', now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = false, reason = excluded.reason, updated_at = now();
  end loop;

  for v_feature_key in select feature_key from public.commercial_package_entitlements
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id and commercial_package_key = v_request.commercial_package_key
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, true, 'Commercial package ' || v_request.commercial_package_key, now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now();
    v_effective := v_effective || jsonb_build_object(v_feature_key, true);
  end loop;

  for v_addon_key in select distinct jsonb_array_elements_text(v_selected_addons) loop
    for v_feature_key in select jsonb_array_elements_text(included_features) from public.commercial_addon_prices
      where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
        and product_id = v_request.product_id and addon_key = v_addon_key
    loop
      insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
      values (v_lodge_id, v_feature_key, true, 'Commercial add-on ' || v_addon_key, now(), now())
      on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now();
      v_effective := v_effective || jsonb_build_object(v_feature_key, true);
    end loop;
  end loop;

  insert into public.activation_audit_log (
    license_id, lodge_id, action, previous_plan, new_plan, previous_addons, new_addons,
    effective_features, activated_by, activation_reason, related_request_id
  ) values (
    v_license_id, v_lodge_id, 'subscription_activated', v_previous_plan, v_package.internal_plan,
    coalesce(v_license.commercial_pricing_snapshot->'selection'->'selected_addon_keys', '[]'::jsonb),
    v_selected_addons, v_effective, p_activated_by, 'Commercial quote activation', p_request_id
  );

  update public.subscription_package_requests set
    lodge_id = v_lodge_id, existing_license_id = v_license_id, status = 'activated',
    activated_at = now(), activated_by = p_activated_by,
    activation_payload = coalesce(p_activation_payload, '{}'::jsonb) || jsonb_build_object(
      'product_id', v_request.product_id, 'commercial_package_key', v_request.commercial_package_key,
      'effective_features', v_effective
    ), updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true, 'id', p_request_id, 'status', 'activated', 'license_id', v_license_id,
    'lodge_id', v_lodge_id, 'product_id', v_request.product_id,
    'commercial_package_key', v_request.commercial_package_key, 'effective_features', v_effective
  );
end;
$$;

-- Keep the operation audit's before state product-scoped. Multi-product
-- customers must never have the other product's licence represented as the
-- previous state of this assignment.
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
  v_result := jsonb_build_object('success', false, 'error', 'Commercial subscription assignment failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.calculate_commercial_quote(jsonb) from public;
grant execute on function public.calculate_commercial_quote(jsonb) to anon, authenticated, service_role;
revoke all on function public.activate_subscription_request(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_request(uuid, text, jsonb) to service_role;
revoke all on function public.admin_governed_assign_commercial_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_assign_commercial_subscription(jsonb) to service_role;
notify pgrst, 'reload schema';
