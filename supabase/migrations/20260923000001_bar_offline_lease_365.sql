-- Bar offline lease: 365-day ceiling for Bar-only lodges (owner-approved).
--
-- The desktop Till stops new sales once offline_valid_until passes. The
-- default lease is 7 days and every clamp caps it at 30 days, so a Bar on a
-- long outage stops selling at day 30 even though its login session lasts
-- 60 days and its trading window now accepts old sales. The owner approved
-- selling past 30 days for Bar-only lodges ("Beyond 30").
--
-- Design (Bar-only, everything else unchanged):
--   * public._offline_valid_until absolute ceiling 30 -> 365. Per-caller caps
--     below keep every other product at 30.
--   * public.get_lodge_entitlement(uuid, text): Bar-only lodges read their
--     stored licenses.offline_lease_days capped at 365; all other products
--     stay capped at 30. Trial fallback (hardcoded 30) untouched.
--   * public.admin_assign_commercial_subscription(jsonb): Command Central can
--     store up to 365 for Bar-only hospitality-pos lodges; others stay at 30.
--     The recompute sits after v_operating_profile is resolved.
--   * Legacy public.issue_subscription_contract keeps its 30 cap (retained
--     path only; Command Central is the active writer).
--   * No GRANT/REVOKE in this file: CREATE OR REPLACE preserves ACLs.
--   * No relaunch needed for the server change; desktop lease checks read the
--     entitlement on refresh. Deployment needs operator go-ahead (db:push).

begin;

-- Guard: predecessor functions must exist with the expected 30-day clamps.
do $guard$
begin
  if to_regprocedure('public._offline_valid_until(text, timestamptz, date, integer, integer)') is null then
    raise exception 'Missing predecessor: public._offline_valid_until/5';
  end if;
  if to_regprocedure('public.get_lodge_entitlement(uuid, text)') is null then
    raise exception 'Missing predecessor: public.get_lodge_entitlement/2';
  end if;
  if to_regprocedure('public.admin_assign_commercial_subscription(jsonb)') is null then
    raise exception 'Missing predecessor: public.admin_assign_commercial_subscription/1';
  end if;
end;
$guard$;

-- 1. Absolute ceiling 30 -> 365. Body is otherwise byte-identical to the
-- baseline definition (20260526101632:925-948). OR REPLACE because the
-- baseline created it with plain CREATE (re-running plain CREATE fails
-- with 42723 on push).
CREATE OR REPLACE FUNCTION public._offline_valid_until(p_state text, p_expires_at timestamp with time zone, p_next_due_date date, p_grace_days integer, p_lease_days integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_state text := lower(coalesce(btrim(p_state), 'active'));
  v_lease_days integer := greatest(least(coalesce(p_lease_days, 7), 365), 1);
  v_candidate timestamptz := now() + make_interval(days => v_lease_days);
  v_grace_end timestamptz;
begin
  if v_state not in ('active', 'grace_period') then
    return now();
  end if;
  if p_next_due_date is not null then
    v_grace_end := (p_next_due_date + greatest(coalesce(p_grace_days, 7), 0))::timestamptz + interval '1 day';
    if v_grace_end < v_candidate then
      v_candidate := v_grace_end;
    end if;
  end if;
  if p_expires_at is not null and p_expires_at < v_candidate then
    v_candidate := p_expires_at;
  end if;
  return v_candidate;
end;
$$;

-- 2. Licensed-entitlement reader: Bar-only lodges keep up to 365 days.
-- Body is otherwise identical to 20260829110000:338-528; only the
-- v_lease_days assignment below is new.
create or replace function public.get_lodge_entitlement(
  p_lodge_id uuid,
  p_product_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_settings public.settings%rowtype;
  v_license public.licenses%rowtype;
  v_overrides jsonb := '{}'::jsonb;
  v_override_snapshot jsonb := '{}'::jsonb;
  v_trial_end timestamptz;
  v_days_left integer;
  v_expired boolean;
  v_plan text;
  v_payment_status text;
  v_subscription_state text;
  v_access_allowed boolean;
  v_grace_days integer;
  v_lease_days integer;
  v_grace_ends_at timestamptz;
  v_offline_valid_until timestamptz;
  v_product text := nullif(lower(btrim(coalesce(p_product_id, ''))), '');
  v_effective_features jsonb;
  v_package_features jsonb := '{}'::jsonb;
  v_catalog_version_id uuid;
  v_effective_limits jsonb;
  v_base_limits jsonb;
begin
  if v_product is not null and not public._commercial_valid_product(v_product) then
    return jsonb_build_object('success', false, 'error', 'Unknown commercial product');
  end if;

  select * into v_settings
    from public.settings s
   where s.lodge_id = p_lodge_id
     and coalesce(s.deleted, false) = false
    order by s.updated_at desc nulls last, s.created_at desc nulls last
    limit 1;

  select * into v_license
    from public.licenses l
   where l.lodge_id = p_lodge_id
     and coalesce(l.is_active, true) = true
     and (
       v_product is null
       or coalesce(nullif(lower(btrim(l.product_id)), ''), 'lodge-camp') = v_product
     )
    order by
      case public._subscription_state(l.payment_status, l.next_due_date, l.expires_at, l.is_active, l.grace_period_days)
        when 'active' then 0 when 'grace_period' then 1 when 'suspended' then 2
        when 'expired' then 3 when 'cancelled' then 4 else 5
      end,
      l.expires_at desc nulls last,
      l.issued_at desc nulls last
    limit 1;

  if v_license.id is not null then
    v_plan := public._normalize_subscription_plan(v_license.subscription_plan);
    v_payment_status := lower(coalesce(v_license.payment_status, 'active'));
    v_grace_days := greatest(coalesce(v_license.grace_period_days, 7), 0);
    -- Bar-only lodges keep a 365-day offline lease (owner-approved Beyond 30);
    -- every other product stays capped at 30 days.
    if coalesce(v_settings.operating_profile->>'hospitality_mode', '') = 'bar_only' then
      v_lease_days := greatest(least(coalesce(v_license.offline_lease_days, 7), 365), 1);
    else
      v_lease_days := greatest(least(coalesce(v_license.offline_lease_days, 7), 30), 1);
    end if;
    v_subscription_state := public._subscription_state(v_payment_status, v_license.next_due_date, v_license.expires_at, v_license.is_active, v_grace_days);
    v_access_allowed := public._subscription_access_allowed(v_subscription_state);
    v_grace_ends_at := case when v_license.next_due_date is null then null else (v_license.next_due_date + v_grace_days)::timestamptz + interval '1 day' end;
    v_offline_valid_until := public._offline_valid_until(v_subscription_state, v_license.expires_at, v_license.next_due_date, v_grace_days, v_lease_days);
    v_product := coalesce(nullif(lower(btrim(v_license.product_id)), ''), 'lodge-camp');
    -- lodge_features predates product-aware licensing.  Keep it only for the
    -- Lodge/Camp compatibility path; Hotel and POS must use their own package
    -- catalogue map so a Lodge feature row cannot cross product boundaries.
    if v_product = 'lodge-camp' then
      select coalesce(jsonb_object_agg(lf.feature_name, lf.enabled), '{}'::jsonb)
        into v_overrides
        from public.lodge_features lf
       where lf.lodge_id = p_lodge_id
         and (lf.expires_at is null or lf.expires_at > now());
    end if;
    select cv.id into v_catalog_version_id
      from public.commercial_catalog_versions cv
     where (v_license.commercial_catalog_version is not null and cv.version = v_license.commercial_catalog_version)
        or (v_license.commercial_catalog_version is null and cv.is_active = true)
     order by cv.is_active desc, cv.effective_at desc, cv.created_at desc
     limit 1;
    select coalesce((
             select jsonb_object_agg(feature.feature_key, true)
               from public.commercial_package_prices package_price
              cross join lateral jsonb_array_elements_text(
                case when jsonb_typeof(package_price.included_features) = 'array'
                     then package_price.included_features else '[]'::jsonb end
              ) feature(feature_key)
              where package_price.catalog_version_id = v_catalog_version_id
                and package_price.product_id = v_product
                and package_price.commercial_package_key = v_license.commercial_package_key
           ), '{}'::jsonb)
           || coalesce((
             select jsonb_object_agg(e.feature_key, e.enabled)
               from public.commercial_package_entitlements e
              where e.catalog_version_id = v_catalog_version_id
                and e.product_id = v_product
                and e.commercial_package_key = v_license.commercial_package_key
           ), '{}'::jsonb)
      into v_package_features;
    v_override_snapshot := public._commercial_active_override_snapshot(p_lodge_id, v_product);
    v_base_limits := public._commercial_base_limits(v_product, v_plan);
    v_effective_limits := case when v_access_allowed then v_base_limits || coalesce(v_override_snapshot->'limits', '{}'::jsonb) else '{}'::jsonb end;
    v_effective_features := case
      when v_access_allowed then
        -- Lodge retains the historical plan baseline.  Hotel may use the
        -- Enterprise baseline only when an older licence has no package map;
        -- POS has no plan-limit fallback and must remain package-scoped.
        case when v_product = 'lodge-camp'
                   or (v_product = 'hotel' and v_package_features = '{}'::jsonb)
             then public._license_plan_features(v_plan, false, false)
             else '{}'::jsonb end
        || coalesce(v_package_features, '{}'::jsonb)
        || coalesce(v_overrides, '{}'::jsonb)
        || coalesce(v_override_snapshot->'features', '{}'::jsonb)
      else public._license_plan_features(v_plan, false, true)
    end;

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_access_allowed then 'licensed' else 'expired' end,
      'daysLeft', null,
      'expired', not v_access_allowed,
      'plan', v_plan,
      'product_id', v_product,
      'commercial_package_key', v_license.commercial_package_key,
      'commercial_catalog_version', v_license.commercial_catalog_version,
      'commercial_pricing_snapshot', v_license.commercial_pricing_snapshot,
      'plan_version_code', coalesce(v_license.plan_version_code, '2026.04'),
      'payment_status', v_payment_status,
      'subscription_state', v_subscription_state,
      'monthly_fee', coalesce(v_license.monthly_fee, 0),
      'currency', v_license.currency,
      'next_due_date', v_license.next_due_date,
      'expires_at', v_license.expires_at,
      'grace_period_days', v_grace_days,
      'grace_period_ends_at', v_grace_ends_at,
      'offline_lease_days', v_lease_days,
      'offline_valid_until', v_offline_valid_until,
      'source_license_id', v_license.id,
      'lodge_name', coalesce(v_license.lodge_name, v_settings.lodge_name, v_settings.company_name),
      'base_limits', v_base_limits,
      'effective_limits', v_effective_limits,
      'commercial_overrides', v_override_snapshot,
      'effective_features', v_effective_features
    );
  end if;

  v_trial_end := coalesce(v_settings.trial_started_at, now()) + interval '30 days';
  if v_settings.trial_started_at is null then
    v_days_left := 30;
    v_expired := false;
  else
    v_days_left := greatest(0, ceil(extract(epoch from (v_trial_end - now())) / 86400.0))::integer;
    v_expired := v_days_left <= 0;
  end if;
  return jsonb_build_object(
    'lodge_id', p_lodge_id,
    'status', case when v_expired then 'expired' else 'trial' end,
    'daysLeft', v_days_left,
    'expired', v_expired,
    'plan', case when v_expired then null else 'Trial' end,
    'product_id', v_product,
    'commercial_package_key', null,
    'commercial_catalog_version', null,
    'commercial_pricing_snapshot', null,
    'plan_version_code', 'trial',
    'payment_status', case when v_expired then 'expired' else 'trial' end,
    'monthly_fee', 0,
    'currency', null,
    'next_due_date', null,
    'expires_at', case when v_expired then v_trial_end else null end,
    'grace_period_days', 0,
    'grace_period_ends_at', null,
    'offline_lease_days', 30,
    'offline_valid_until', least(v_trial_end, now() + interval '30 days'),
    'source_license_id', null,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'base_limits', '{}'::jsonb,
    'effective_limits', '{}'::jsonb,
    'commercial_overrides', case when v_product is null then '{}'::jsonb else public._commercial_active_override_snapshot(p_lodge_id, v_product) end,
    'effective_features', public._license_plan_features('Pro', true, v_expired)
  );
end;
$$;

-- 3. Command Central writer: store up to 365 for Bar-only hospitality-pos
-- lodges. Body is otherwise identical to 20260721157000:32-242; only the
-- Bar recompute after v_operating_profile resolution is new.
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
  -- Bar-only lodges may store up to a 365-day offline lease (owner-approved
  -- Beyond 30); every other product keeps the 30-day cap.
  if v_product_id = 'hospitality-pos' and v_operating_profile = 'bar_only' then
    v_offline_lease_days := greatest(least(coalesce(nullif(p_payload->>'offline_lease_days', '')::integer, 7), 365), 1);
  end if;

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

commit;
