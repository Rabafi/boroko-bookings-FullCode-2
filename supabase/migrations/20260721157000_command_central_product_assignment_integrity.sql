-- Forward repair for product-aware Command Central assignments.
-- A company may hold one active assignment per product family. Older versions
-- superseded every active licence for a company when a second product was
-- assigned and the renderer did not send the selected add-ons back to SQL.

with ranked_active as (
  select
    id,
    row_number() over (
      partition by lodge_id, product_id
      order by issued_at desc nulls last, id desc
    ) as row_number
  from public.licenses
  where product_id is not null
    and coalesce(is_active, true) = true
    and lower(coalesce(subscription_state, payment_status, 'active')) not in ('cancelled', 'expired', 'superseded', 'deleted', 'inactive')
)
update public.licenses as l
set is_active = false,
    subscription_state = 'superseded',
    notes = trim(both from concat(coalesce(l.notes, ''), case when coalesce(l.notes, '') = '' then '' else ' ' end, '[Superseded duplicate product assignment]'))
from ranked_active as duplicate
where duplicate.row_number > 1
  and duplicate.id = l.id;

create unique index if not exists licenses_active_lodge_product_unique
  on public.licenses (lodge_id, product_id)
  where product_id is not null
    and coalesce(is_active, true) = true
    and lower(coalesce(subscription_state, payment_status, 'active')) not in ('cancelled', 'expired', 'superseded', 'deleted', 'inactive');

create or replace function public.admin_assign_commercial_subscription(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_license_id uuid := nullif(btrim(coalesce(p_payload->>'license_id', '')), '')::uuid;
  v_product_id text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_package_key text := lower(btrim(coalesce(p_payload->>'commercial_package_key', '')));
  v_payment_status text := lower(btrim(coalesce(p_payload->>'payment_status', 'active')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'activation_reason', '')), '');
  v_addon_keys jsonb := coalesce(p_payload->'selected_addon_keys', '[]'::jsonb);
  v_settings public.settings%rowtype;
  v_license public.licenses%rowtype;
  v_package public.commercial_package_prices%rowtype;
  v_quote jsonb;
  v_catalog public.commercial_catalog_versions%rowtype;
  v_property_type text;
  v_operating_profile text;
  v_previous_plan text;
  v_previous_product text;
  v_previous_addons jsonb := '[]'::jsonb;
  v_effective jsonb := '{}'::jsonb;
  v_feature_key text;
  v_grace_days integer := greatest(coalesce(nullif(p_payload->>'grace_period_days', '')::integer, 7), 0);
  v_offline_lease_days integer := greatest(least(coalesce(nullif(p_payload->>'offline_lease_days', '')::integer, 7), 30), 1);
  v_monthly_fee numeric := coalesce(nullif(p_payload->>'monthly_fee', '')::numeric, 0);
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'Subscription assignment payload is required');
  end if;
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'Select a company before assigning a subscription');
  end if;
  if v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'error', 'Add a clear assignment reason of at least 8 characters');
  end if;
  if v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    return jsonb_build_object('success', false, 'error', 'Select one of the three supported app families');
  end if;
  if v_payment_status not in ('active', 'free', 'trial', 'overdue', 'suspended', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Invalid payment status');
  end if;
  if v_monthly_fee < 0 then
    return jsonb_build_object('success', false, 'error', 'Contracted monthly fee cannot be negative');
  end if;
  if jsonb_typeof(v_addon_keys) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'selected_addon_keys must be an array');
  end if;

  select * into v_settings from public.settings where lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Company settings were not found'); end if;
  v_property_type := public.normalize_settings_property_type(coalesce(v_settings.property_type, v_settings.business_type, 'lodge'));
  if public.resolve_product_family(v_property_type) <> v_product_id then
    return jsonb_build_object('success', false, 'error', 'The selected app family does not match this company type', 'expected_product_id', public.resolve_product_family(v_property_type));
  end if;
  v_operating_profile := nullif(btrim(coalesce(v_settings.operating_profile->>'hospitality_mode', p_payload->>'operating_profile', '')), '');
  if v_product_id = 'hospitality-pos' and v_operating_profile is null then v_operating_profile := 'restaurant_bar'; end if;

  v_quote := public.calculate_commercial_quote(jsonb_build_object(
    'product_id', v_product_id,
    'commercial_package_key', v_package_key,
    'selected_addon_keys', v_addon_keys,
    'property_type', v_property_type,
    'operating_profile', v_operating_profile
  ));
  v_catalog := public._commercial_active_catalog_version();
  select * into v_package from public.commercial_package_prices
  where catalog_version_id = v_catalog.id and product_id = v_product_id and commercial_package_key = v_package_key;
  if not found then return jsonb_build_object('success', false, 'error', 'The selected package is not in the active commercial catalogue'); end if;

  if v_license_id is not null then
    select * into v_license from public.licenses
    where id = v_license_id and lodge_id = v_lodge_id and product_id = v_product_id for update;
    if not found then return jsonb_build_object('success', false, 'error', 'Selected license does not belong to the selected company and product'); end if;
  else
    select * into v_license from public.licenses
    where lodge_id = v_lodge_id and product_id = v_product_id
      and coalesce(is_active, true) = true
      and lower(coalesce(subscription_state, payment_status, 'active')) not in ('cancelled', 'expired', 'superseded', 'deleted', 'inactive')
    order by issued_at desc nulls last limit 1 for update;
  end if;

  v_previous_plan := v_license.subscription_plan;
  v_previous_product := v_license.product_id;
  v_previous_addons := coalesce(v_license.commercial_pricing_snapshot->'selection'->'selected_addon_keys', '[]'::jsonb);

  if v_license.id is null then
    update public.licenses
    set is_active = false,
        subscription_state = 'superseded',
        notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded by Command Central product assignment]'))
    where lodge_id = v_lodge_id and product_id = v_product_id
      and coalesce(is_active, true) = true;

    insert into public.licenses (
      lodge_id, license_key, lodge_name, business_type, expires_at, notes,
      subscription_plan, payment_status, monthly_fee, currency, next_due_date,
      last_payment_date, is_active, plan_version_code, grace_period_days,
      offline_lease_days, activated_at, subscription_state, product_id,
      commercial_package_key, commercial_catalog_version, commercial_pricing_snapshot
    ) values (
      v_lodge_id, public._generate_license_key(),
      coalesce(nullif(p_payload->>'lodge_name', ''), v_settings.lodge_name, v_settings.company_name, ''),
      v_property_type, nullif(p_payload->>'expires_at', '')::timestamptz,
      nullif(p_payload->>'notes', ''), v_package.internal_plan, v_payment_status,
      v_monthly_fee, coalesce(nullif(p_payload->>'currency', ''), v_catalog.currency, 'BWP'),
      nullif(p_payload->>'next_due_date', '')::date,
      nullif(p_payload->>'last_payment_date', '')::date, true, '2026.07',
      v_grace_days, v_offline_lease_days, now(),
      public._subscription_state(v_payment_status, nullif(p_payload->>'next_due_date', '')::date, nullif(p_payload->>'expires_at', '')::timestamptz, true, v_grace_days),
      v_product_id, v_package_key, v_catalog.version, v_quote
    ) returning * into v_license;
  else
    update public.licenses set
      lodge_name = coalesce(nullif(p_payload->>'lodge_name', ''), lodge_name),
      business_type = v_property_type,
      expires_at = nullif(p_payload->>'expires_at', '')::timestamptz,
      notes = nullif(p_payload->>'notes', ''),
      subscription_plan = v_package.internal_plan,
      payment_status = v_payment_status,
      monthly_fee = v_monthly_fee,
      currency = coalesce(nullif(p_payload->>'currency', ''), v_catalog.currency, currency, 'BWP'),
      next_due_date = nullif(p_payload->>'next_due_date', '')::date,
      last_payment_date = coalesce(nullif(p_payload->>'last_payment_date', '')::date, last_payment_date),
      is_active = true,
      plan_version_code = '2026.07',
      grace_period_days = v_grace_days,
      offline_lease_days = v_offline_lease_days,
      activated_at = coalesce(activated_at, now()),
      subscription_state = public._subscription_state(v_payment_status, nullif(p_payload->>'next_due_date', '')::date, nullif(p_payload->>'expires_at', '')::timestamptz, true, v_grace_days),
      product_id = v_product_id,
      commercial_package_key = v_package_key,
      commercial_catalog_version = v_catalog.version,
      commercial_pricing_snapshot = v_quote
    where id = v_license.id returning * into v_license;
  end if;

  -- Reset only catalogue-managed rows for this product. Other product
  -- assignments on the same company remain active and untouched.
  for v_feature_key in
    select distinct feature_key from (
      select jsonb_array_elements_text(p.included_features) as feature_key
      from public.commercial_package_prices p
      where p.catalog_version_id = v_catalog.id and p.product_id = v_product_id
      union
      select jsonb_array_elements_text(a.included_features) as feature_key
      from public.commercial_addon_prices a
      where a.catalog_version_id = v_catalog.id and a.product_id = v_product_id
    ) managed_features
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, false, 'Commercial package boundary', now(), now())
    on conflict (lodge_id, feature_name) do update
      set enabled = false, reason = excluded.reason, updated_at = now()
      where public.lodge_features.reason is null
         or public.lodge_features.reason like 'Commercial package%'
         or public.lodge_features.reason like 'Commercial add-on%';
  end loop;

  for v_feature_key in
    select feature_key from public.commercial_package_entitlements
    where catalog_version_id = v_catalog.id and product_id = v_product_id and commercial_package_key = v_package_key
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, true, 'Commercial package ' || v_package_key, now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now()
      where public.lodge_features.reason is null
         or public.lodge_features.reason like 'Commercial package%'
         or public.lodge_features.reason like 'Commercial add-on%';
  end loop;

  for v_feature_key in
    select distinct jsonb_array_elements_text(a.included_features)
    from public.commercial_addon_prices a
    where a.catalog_version_id = v_catalog.id and a.product_id = v_product_id
      and a.addon_key in (select jsonb_array_elements_text(v_addon_keys)) and a.active = true
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, true, 'Commercial add-on assignment', now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now()
      where public.lodge_features.reason is null
         or public.lodge_features.reason like 'Commercial package%'
         or public.lodge_features.reason like 'Commercial add-on%';
  end loop;

  select coalesce(jsonb_object_agg(feature_name, enabled), '{}'::jsonb) into v_effective
  from public.lodge_features where lodge_id = v_lodge_id;

  insert into public.activation_audit_log (
    license_id, lodge_id, action, previous_plan, new_plan, previous_addons,
    new_addons, effective_features, activated_by, activation_reason
  ) values (
    v_license.id, v_lodge_id, 'command_central_subscription_assigned',
    v_previous_plan, v_package.internal_plan, v_previous_addons, v_addon_keys,
    v_effective, coalesce(nullif(p_payload->>'activated_by', ''), 'command-central'), v_reason
  );

  return jsonb_build_object(
    'success', true, 'license_id', v_license.id, 'license_key', v_license.license_key,
    'product_id', v_product_id, 'commercial_package_key', v_package_key,
    'commercial_catalog_version', v_catalog.version, 'commercial_pricing_snapshot', v_quote,
    'effective_features', v_effective
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    return jsonb_build_object('success', false, 'error', 'One of the supplied identifiers or dates is invalid');
end;
$$;

revoke all on function public.admin_assign_commercial_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.admin_assign_commercial_subscription(jsonb) to service_role;
notify pgrst, 'reload schema';
