-- Authoritative Bar POS bundle catalogue. The desktop catalogue mirrors these
-- rows, but quotes and activation must continue to derive price and features
-- from PostgreSQL.

do $$
declare
  v_catalog_id uuid;
begin
  select id into v_catalog_id
  from public.commercial_catalog_versions
  where version = '2026-07-commercial-1';

  if v_catalog_id is null then
    raise exception 'Commercial catalogue 2026-07-commercial-1 is required';
  end if;

  update public.commercial_package_prices
  set included_features = '["pos","bar_counter_sales","bar_product_list","bar_pack_stock","inventory","bar_stock_basic","low_stock_alerts","cash_drawer","cash_up","staff","bar_staff_basic","staff_shifts","reports","bar_reports_basic","audit","customer_display","bar_board","checklists","alerts","incident_log"]'::jsonb,
      excluded_features = '["kitchen","tables","recipes","restaurant_production"]'::jsonb,
      sales_copy = 'Counter sales, drink products, pack stock, low-stock alerts, cash-up, basic staff access, reports, customer display, bar board, incidents, and access audit.'
  where catalog_version_id = v_catalog_id
    and product_id = 'hospitality-pos'
    and commercial_package_key = 'bar_pos';

  insert into public.commercial_addon_prices (
    catalog_version_id, product_id, addon_key, display_name, billing_basis,
    one_time_price_bwp, annual_price_bwp, eligible_property_types,
    eligible_operating_profiles, included_features, active
  ) values
    (v_catalog_id, 'hospitality-pos', 'bar_stock_purchasing_pro', 'Stock & Purchasing Pro', 'annual_addon',
      0, 3000, array['restaurant']::text[], array['bar_only']::text[],
      '["inventory_advanced","stock_control","suppliers","purchasing","purchase_suggestions","lots_expiry","recipes","prep","variance","wastage","stock_valuation","advanced_margin"]'::jsonb, true),
    (v_catalog_id, 'hospitality-pos', 'bar_accounting_workforce', 'Accounting & Workforce', 'annual_addon',
      0, 6000, array['restaurant']::text[], array['bar_only']::text[],
      '["restaurant_accounting","workforce_management","workforce_scheduling","staff_performance","performance","payroll","tips_payouts","expenses"]'::jsonb, true),
    (v_catalog_id, 'hospitality-pos', 'bar_growth_multi_outlet', 'Growth & Multi-Outlet', 'annual_addon',
      0, 5000, array['restaurant']::text[], array['bar_only']::text[],
      '["bar_crm","customer_accounts","loyalty","promotions","vouchers","multi_outlet_controls","multi_outlet_pos","central_menu_publishing","stock_transfers","owner_mobile_view","advanced_reports"]'::jsonb, true)
  on conflict (catalog_version_id, product_id, addon_key) do update set
    display_name = excluded.display_name,
    billing_basis = excluded.billing_basis,
    one_time_price_bwp = excluded.one_time_price_bwp,
    annual_price_bwp = excluded.annual_price_bwp,
    eligible_property_types = excluded.eligible_property_types,
    eligible_operating_profiles = excluded.eligible_operating_profiles,
    included_features = excluded.included_features,
    active = true;

  insert into public.commercial_package_entitlements (
    catalog_version_id, product_id, commercial_package_key, feature_key, enabled
  )
  select p.catalog_version_id, p.product_id, p.commercial_package_key,
         jsonb_array_elements_text(p.included_features), true
  from public.commercial_package_prices p
  where p.catalog_version_id = v_catalog_id
    and p.product_id = 'hospitality-pos'
    and p.commercial_package_key = 'bar_pos'
  on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
  do update set enabled = true;
end;
$$;

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
    v_included_features := (
      select coalesce(jsonb_agg(distinct feature_key), '[]'::jsonb)
      from jsonb_array_elements_text(v_included_features || v_addon.included_features) as features(feature_key)
    );
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_type', 'addon', 'key', v_addon.addon_key, 'label', v_addon.display_name,
      'billing_basis', v_addon.billing_basis, 'one_time_amount', v_addon.one_time_price_bwp,
      'recurring_amount', coalesce(v_addon.annual_price_bwp, 0), 'amount_due_now', v_addon.one_time_price_bwp));
    v_total_due_now := v_total_due_now + v_addon.one_time_price_bwp;
    v_one_time_total := v_one_time_total + v_addon.one_time_price_bwp;
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
    'note', 'This quote is a request for manual review. Payment is not collected here and activation occurs only after Tsa Bonno approves payment proof.'
  );
end;
$$;

revoke all on function public.calculate_commercial_quote(jsonb) from public;
grant execute on function public.calculate_commercial_quote(jsonb) to anon, authenticated, service_role;
