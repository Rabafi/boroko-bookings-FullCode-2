-- Isolated-database proof for Bar add-on quote -> approval -> activation.
--
-- Run only against a disposable test database that already has the repository
-- migrations applied. The whole proof runs in one transaction and rolls back.
--
-- The repository baseline's settings_property_type_check predates the hosted
-- Bar profile. The transaction temporarily admits 'bar' so the activation
-- contract can be exercised with a real bar company fixture.

begin;

alter table public.settings drop constraint if exists settings_property_type_check;
alter table public.settings add constraint settings_property_type_check
  check (property_type in (
    'guest_house','bnb','lodge','camp','motel','hotel','resort','restaurant','bar',
    'apartment_hotel','hostel','serviced_apartments'
  ));

do $test$
declare
  v_lodge_id uuid;
  v_license_id uuid;
  v_request_id uuid;
  v_quote jsonb;
  v_result jsonb;
  v_activation jsonb;
  v_error text;
  v_version text;
  v_count integer;
begin
  select version into v_version from public.commercial_catalog_versions where is_active = true;
  if v_version is null then raise exception 'No active commercial catalogue'; end if;

  ---------------------------------------------------------------------------
  -- 1. Bar property type: quote -> approval -> activation.
  ---------------------------------------------------------------------------
  v_lodge_id := gen_random_uuid();
  v_license_id := gen_random_uuid();
  insert into public.settings (lodge_id, lodge_name, company_name, business_type, property_type, operating_profile)
  values (v_lodge_id, 'Bar Activation Test', 'Bar Activation Test', 'bar', 'bar', '{"mode":"bar_only"}'::jsonb);
  insert into public.licenses (id, lodge_id, license_key, lodge_name, business_type, product_id, subscription_plan)
  values (v_license_id, v_lodge_id, 'TEST-BAR-' || replace(v_lodge_id::text, '-', ''), 'Bar Activation Test', 'bar', null, 'Starter');

  v_result := public._submit_commercial_quote(
    jsonb_build_object(
      'product_id', 'hospitality-pos',
      'commercial_package_key', 'bar_pos',
      'operating_profile', 'bar_only',
      'property_type', 'bar',
      'selected_addon_keys', jsonb_build_array('bar_stock_purchasing_pro', 'bar_accounting_workforce')
    ),
    '{"company_name":"Bar Activation Test","property_name":"Bar Activation Test"}'::jsonb,
    'desktop_app',
    v_lodge_id
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'Bar quote failed: %', v_result;
  end if;
  v_request_id := (v_result->>'id')::uuid;
  v_quote := v_result->'quote_payload';
  if (v_quote->'totals'->>'recurring_annual')::numeric <> 10500 then
    raise exception 'Bar quote annual total expected 10500, got %', v_quote->'totals'->>'recurring_annual';
  end if;
  if (v_quote->'totals'->>'total_due_now')::numeric <> 10500 then
    raise exception 'Bar quote due-now total expected 10500, got %', v_quote->'totals'->>'total_due_now';
  end if;

  v_result := public.update_subscription_request_status(v_request_id, 'approved', 'isolated-test', null);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'Bar quote approval failed: %', v_result;
  end if;

  v_activation := public.activate_subscription_request(
    v_request_id,
    'isolated-test',
    jsonb_build_object('license_id', v_license_id, 'lodge_id', v_lodge_id, 'product_id', 'hospitality-pos', 'payment_status', 'active')
  );
  if coalesce((v_activation->>'success')::boolean, false) is not true then
    raise exception 'Bar activation failed: %', v_activation;
  end if;
  if (select commercial_package_key from public.licenses where id = v_license_id) <> 'bar_pos' then
    raise exception 'Bar activation did not update the licence package';
  end if;
  select count(*) into v_count from public.lodge_features
  where lodge_id = v_lodge_id and enabled = true
    and feature_name in ('inventory_advanced', 'restaurant_accounting', 'purchasing', 'workforce_management');
  if v_count <> 4 then
    raise exception 'Bar activation expected 4 add-on features, got %', v_count;
  end if;

  ---------------------------------------------------------------------------
  -- 2. Restaurant property type: the same POS package can activate.
  ---------------------------------------------------------------------------
  v_lodge_id := gen_random_uuid();
  v_license_id := gen_random_uuid();
  insert into public.settings (lodge_id, lodge_name, company_name, business_type, property_type, operating_profile)
  values (v_lodge_id, 'Restaurant Activation Test', 'Restaurant Activation Test', 'restaurant', 'restaurant', '{"mode":"bar_only"}'::jsonb);
  insert into public.licenses (id, lodge_id, license_key, lodge_name, business_type, product_id, subscription_plan)
  values (v_license_id, v_lodge_id, 'TEST-REST-' || replace(v_lodge_id::text, '-', ''), 'Restaurant Activation Test', 'restaurant', null, 'Starter');

  v_result := public._submit_commercial_quote(
    jsonb_build_object(
      'product_id', 'hospitality-pos',
      'commercial_package_key', 'bar_pos',
      'operating_profile', 'bar_only',
      'property_type', 'restaurant',
      'selected_addon_keys', jsonb_build_array('bar_stock_purchasing_pro', 'bar_accounting_workforce')
    ),
    '{"company_name":"Restaurant Activation Test","property_name":"Restaurant Activation Test"}'::jsonb,
    'desktop_app',
    v_lodge_id
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'Restaurant quote failed: %', v_result;
  end if;
  v_request_id := (v_result->>'id')::uuid;
  v_result := public.update_subscription_request_status(v_request_id, 'approved', 'isolated-test', null);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'Restaurant approval failed: %', v_result;
  end if;
  v_activation := public.activate_subscription_request(
    v_request_id,
    'isolated-test',
    jsonb_build_object('license_id', v_license_id, 'lodge_id', v_lodge_id, 'product_id', 'hospitality-pos', 'payment_status', 'active')
  );
  if coalesce((v_activation->>'success')::boolean, false) is not true then
    raise exception 'Restaurant activation failed: %', v_activation;
  end if;

  ---------------------------------------------------------------------------
  -- 3. A new Accounting-only selection is rejected before a quote exists.
  ---------------------------------------------------------------------------
  v_error := null;
  begin
    perform public.calculate_commercial_quote(jsonb_build_object(
      'product_id', 'hospitality-pos',
      'commercial_package_key', 'bar_pos',
      'operating_profile', 'bar_only',
      'property_type', 'bar',
      'selected_addon_keys', jsonb_build_array('bar_accounting_workforce')
    ));
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or v_error not like '%Accounting & Workforce requires Stock & Purchasing Pro%' then
    raise exception 'Accounting-only quote was not rejected correctly: %', coalesce(v_error, 'no error');
  end if;

  ---------------------------------------------------------------------------
  -- 4. A historical Accounting-only quote is rejected at activation.
  ---------------------------------------------------------------------------
  v_lodge_id := gen_random_uuid();
  v_license_id := gen_random_uuid();
  v_request_id := gen_random_uuid();
  insert into public.settings (lodge_id, lodge_name, company_name, business_type, property_type, operating_profile)
  values (v_lodge_id, 'Historical Reject Test', 'Historical Reject Test', 'bar', 'bar', '{"mode":"bar_only"}'::jsonb);
  insert into public.licenses (id, lodge_id, license_key, lodge_name, business_type, product_id, subscription_plan)
  values (v_license_id, v_lodge_id, 'TEST-HIST-REJECT-' || replace(v_lodge_id::text, '-', ''), 'Historical Reject Test', 'bar', null, 'Starter');
  insert into public.subscription_package_requests (
    id, source, request_type, lodge_id, existing_license_id, company_name, property_name,
    property_type, operating_profile, product_id, commercial_package_key,
    commercial_catalog_version, requested_plan, requested_addons, canonical_pricing_snapshot,
    pricing_snapshot, quote_payload, status, submitted_at, reviewed_at, reviewed_by
  ) values (
    v_request_id, 'desktop_app', 'plan_upgrade', v_lodge_id, v_license_id, 'Historical Reject Test', 'Historical Reject Test',
    'bar', 'bar_only', 'hospitality-pos', 'bar_pos', v_version, 'Pro',
    '["bar_accounting_workforce"]'::jsonb,
    jsonb_build_object('catalog_version', v_version, 'selection', jsonb_build_object('selected_addon_keys', jsonb_build_array('bar_accounting_workforce')), 'lines', jsonb_build_array(
      jsonb_build_object('line_type', 'package', 'key', 'bar_pos', 'amount_due_now', 4500),
      jsonb_build_object('line_type', 'addon', 'key', 'bar_accounting_workforce', 'amount_due_now', 6000)
    )),
    '{}'::jsonb, '{}'::jsonb, 'approved', now(), now(), 'isolated-test'
  );
  v_activation := public.activate_subscription_request(
    v_request_id,
    'isolated-test',
    jsonb_build_object('license_id', v_license_id, 'lodge_id', v_lodge_id, 'product_id', 'hospitality-pos', 'payment_status', 'active')
  );
  if coalesce((v_activation->>'success')::boolean, true) is not false then
    raise exception 'Historical Accounting-only activation unexpectedly succeeded: %', v_activation;
  end if;
  if coalesce(v_activation->>'error', '') not like '%Accounting & Workforce requires Stock & Purchasing Pro%'
     or coalesce(v_activation->>'error', '') not like '%replacement quote%' then
    raise exception 'Historical Accounting-only activation error was not actionable: %', v_activation;
  end if;

  ---------------------------------------------------------------------------
  -- 5. A historical quote with the required add-ons still activates.
  ---------------------------------------------------------------------------
  v_lodge_id := gen_random_uuid();
  v_license_id := gen_random_uuid();
  v_request_id := gen_random_uuid();
  insert into public.settings (lodge_id, lodge_name, company_name, business_type, property_type, operating_profile)
  values (v_lodge_id, 'Historical Accept Test', 'Historical Accept Test', 'bar', 'bar', '{"mode":"bar_only"}'::jsonb);
  insert into public.licenses (id, lodge_id, license_key, lodge_name, business_type, product_id, subscription_plan)
  values (v_license_id, v_lodge_id, 'TEST-HIST-ACCEPT-' || replace(v_lodge_id::text, '-', ''), 'Historical Accept Test', 'bar', null, 'Starter');
  insert into public.subscription_package_requests (
    id, source, request_type, lodge_id, existing_license_id, company_name, property_name,
    property_type, operating_profile, product_id, commercial_package_key,
    commercial_catalog_version, requested_plan, requested_addons, canonical_pricing_snapshot,
    pricing_snapshot, quote_payload, status, submitted_at, reviewed_at, reviewed_by
  ) values (
    v_request_id, 'desktop_app', 'plan_upgrade', v_lodge_id, v_license_id, 'Historical Accept Test', 'Historical Accept Test',
    'bar', 'bar_only', 'hospitality-pos', 'bar_pos', v_version, 'Pro',
    '["bar_stock_purchasing_pro","bar_accounting_workforce"]'::jsonb,
    jsonb_build_object('catalog_version', v_version, 'selection', jsonb_build_object('selected_addon_keys', jsonb_build_array('bar_stock_purchasing_pro', 'bar_accounting_workforce')), 'lines', jsonb_build_array(
      jsonb_build_object('line_type', 'package', 'key', 'bar_pos', 'amount_due_now', 4500),
      jsonb_build_object('line_type', 'addon', 'key', 'bar_stock_purchasing_pro', 'amount_due_now', 3000),
      jsonb_build_object('line_type', 'addon', 'key', 'bar_accounting_workforce', 'amount_due_now', 6000)
    )),
    '{}'::jsonb, '{}'::jsonb, 'approved', now(), now(), 'isolated-test'
  );
  v_result := public.update_subscription_request_status(v_request_id, 'approved', 'isolated-test', null);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'Historical valid approval failed: %', v_result;
  end if;
  v_activation := public.activate_subscription_request(
    v_request_id,
    'isolated-test',
    jsonb_build_object('license_id', v_license_id, 'lodge_id', v_lodge_id, 'product_id', 'hospitality-pos', 'payment_status', 'active')
  );
  if coalesce((v_activation->>'success')::boolean, false) is not true then
    raise exception 'Historical valid quote activation failed: %', v_activation;
  end if;

  raise notice 'All Bar add-on activation scenarios passed.';
end;
$test$;

rollback;
