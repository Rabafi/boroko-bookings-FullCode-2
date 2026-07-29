-- POS packages remain internally Pro-compatible, but the commercial package
-- key is the authoritative feature boundary. Existing Pro defaults must not
-- leak restaurant Control/Growth workflows into Service or Bar POS.

with v as (
  select id
  from public.commercial_catalog_versions
  where version = '2026-07-commercial-1'
)
update public.commercial_package_prices p
set included_features = p.included_features || '["inventory"]'::jsonb
from v
where p.catalog_version_id = v.id
  and p.product_id = 'hospitality-pos'
  and p.commercial_package_key in ('restaurant_control', 'restaurant_growth')
  and not (p.included_features ? 'inventory');

insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key
)
select p.catalog_version_id, p.product_id, p.commercial_package_key,
       jsonb_array_elements_text(p.included_features)
from public.commercial_package_prices p
where p.catalog_version_id = (
  select id from public.commercial_catalog_versions where version = '2026-07-commercial-1'
)
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key) do nothing;

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
  v_selected_addons jsonb;
  v_addon_key text;
  v_feature_key text;
  v_effective jsonb := '{}'::jsonb;
  v_previous_plan text;
begin
  select * into v_request
  from public.subscription_package_requests
  where id = p_request_id
  for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Request not found'); end if;
  if v_request.status not in ('approved', 'payment_under_review') then
    return jsonb_build_object('success', false, 'error', 'Request must be approved or payment_under_review before activation');
  end if;
  if v_license_id is null or v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'license_id and lodge_id are required for activation');
  end if;

  select * into v_license
  from public.licenses
  where id = v_license_id and lodge_id = v_lodge_id
  for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Selected license does not belong to the selected company'); end if;

  if v_request.commercial_package_key is null then
    update public.subscription_package_requests set
      lodge_id = coalesce(lodge_id, v_lodge_id), existing_license_id = coalesce(existing_license_id, v_license_id),
      status = 'activated', activated_at = now(), activated_by = p_activated_by,
      activation_payload = p_activation_payload, updated_at = now()
    where id = p_request_id;
    return jsonb_build_object('success', true, 'id', p_request_id, 'status', 'activated', 'license_id', v_license_id, 'lodge_id', v_lodge_id);
  end if;

  if v_request.canonical_pricing_snapshot is null
     or v_request.product_id is null
     or v_request.commercial_catalog_version is null then
    return jsonb_build_object('success', false, 'error', 'Commercial quote snapshot is missing');
  end if;
  if p_activation_payload->>'product_id' is not null and p_activation_payload->>'product_id' <> v_request.product_id then
    return jsonb_build_object('success', false, 'error', 'Product does not match the commercial quote');
  end if;

  select property_type, operating_profile into v_settings
  from public.settings where lodge_id = v_lodge_id limit 1;
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

  select * into v_package
  from public.commercial_package_prices
  where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
    and product_id = v_request.product_id
    and commercial_package_key = v_request.commercial_package_key;
  if not found or v_request.canonical_pricing_snapshot->>'catalog_version' <> v_request.commercial_catalog_version then
    return jsonb_build_object('success', false, 'error', 'Quote catalogue snapshot is not valid');
  end if;

  v_selected_addons := coalesce(v_request.requested_addons, '[]'::jsonb);
  for v_addon_key in select distinct jsonb_array_elements_text(v_selected_addons) loop
    select * into v_addon
    from public.commercial_addon_prices
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id
      and addon_key = v_addon_key
      and active = true;
    if not found then return jsonb_build_object('success', false, 'error', 'Selected add-on is not valid for this product'); end if;
  end loop;

  update public.licenses set
    subscription_plan = v_package.internal_plan,
    product_id = v_request.product_id,
    commercial_package_key = v_request.commercial_package_key,
    commercial_catalog_version = v_request.commercial_catalog_version,
    commercial_pricing_snapshot = v_request.canonical_pricing_snapshot,
    payment_status = coalesce(p_activation_payload->>'payment_status', 'active')
  where id = v_license_id;

  -- Reset every feature known to this product catalogue before granting the
  -- selected package. This is what prevents a Pro compatibility plan from
  -- silently granting Service, Control, or Growth workflows.
  for v_feature_key in
    select distinct jsonb_array_elements_text(included_features)
    from public.commercial_package_prices
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, false, 'Commercial package boundary', now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = false, reason = excluded.reason, updated_at = now();
  end loop;

  for v_feature_key in select feature_key from public.commercial_package_entitlements
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id
      and commercial_package_key = v_request.commercial_package_key
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, true, 'Commercial package ' || v_request.commercial_package_key, now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now();
    v_effective := v_effective || jsonb_build_object(v_feature_key, true);
  end loop;

  for v_addon_key in select distinct jsonb_array_elements_text(v_selected_addons) loop
    for v_feature_key in select jsonb_array_elements_text(included_features)
      from public.commercial_addon_prices
      where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
        and product_id = v_request.product_id
        and addon_key = v_addon_key
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
      'product_id', v_request.product_id,
      'commercial_package_key', v_request.commercial_package_key,
      'effective_features', v_effective
    ),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'id', p_request_id,
    'status', 'activated',
    'license_id', v_license_id,
    'lodge_id', v_lodge_id,
    'product_id', v_request.product_id,
    'commercial_package_key', v_request.commercial_package_key,
    'effective_features', v_effective
  );
end;
$$;

revoke all on function public.activate_subscription_request(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_request(uuid, text, jsonb) to service_role;
