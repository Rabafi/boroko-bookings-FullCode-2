-- Bar entitlement parity: keep the DB catalogue in lockstep with the JS catalogue.
-- JS source: src/shared/commercialEntitlements.js BAR_POS_FEATURES (25 features).
-- DB previously drifted: base bundle lacked staff_basic (and earlier lacked
-- modifiers/tabs/receipts/pwa, later corrected on the active catalogue only),
-- and the 3 Bar add-ons allowed only ['restaurant'] while JS allows
-- ['restaurant','bar'] with normalizePropertyType('bar') === 'bar'.
-- This forward-only correction aligns all catalogue versions (fresh chains and
-- live active rows) without changing prices or historical quote snapshots.

begin;

-- 1. Bar add-ons accept both restaurant and bar property types.
update public.commercial_addon_prices
set eligible_property_types = array['restaurant','bar']::text[]
where product_id = 'hospitality-pos'
  and addon_key in ('bar_stock_purchasing_pro','bar_accounting_workforce','bar_growth_multi_outlet');

-- 2. Bar POS base features match the JS BAR_POS_FEATURES list exactly (25 keys).
-- Canonical order mirrors commercialEntitlements.js for readability; the
-- contract test compares as sets so ordering never causes drift.
update public.commercial_package_prices
set included_features = '["pos","bar_counter_sales","bar_product_list","modifiers","tabs","receipts","bar_pack_stock","inventory","bar_stock_basic","low_stock_alerts","cash_drawer","cash_up","staff","staff_basic","bar_staff_basic","staff_shifts","reports","bar_reports_basic","audit","pwa","customer_display","bar_board","checklists","alerts","incident_log"]'::jsonb
where product_id = 'hospitality-pos'
  and commercial_package_key = 'bar_pos';

-- 3. Keep the authoritative entitlement table in lockstep for every catalogue
-- version (fresh installs seed from the versioned row, live activation reads
-- the active row; both must carry the full 25).
insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select p.catalog_version_id, p.product_id, p.commercial_package_key,
       jsonb_array_elements_text(p.included_features), true
from public.commercial_package_prices p
where p.product_id = 'hospitality-pos'
  and p.commercial_package_key = 'bar_pos'
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = true;

-- 4. Guardrails: fail the migration if parity is not achieved.
do $$
declare
  v_missing_features text;
  v_bad_addons text;
begin
  select string_agg(expected.feature_key, ',')
    into v_missing_features
  from (values ('pos'),('bar_counter_sales'),('bar_product_list'),('modifiers'),('tabs'),('receipts'),('bar_pack_stock'),('inventory'),('bar_stock_basic'),('low_stock_alerts'),('cash_drawer'),('cash_up'),('staff'),('staff_basic'),('bar_staff_basic'),('staff_shifts'),('reports'),('bar_reports_basic'),('audit'),('pwa'),('customer_display'),('bar_board'),('checklists'),('alerts'),('incident_log')) as expected(feature_key)
  where not exists (
    select 1
    from public.commercial_package_prices p
    where p.product_id = 'hospitality-pos'
      and p.commercial_package_key = 'bar_pos'
      and p.included_features ? expected.feature_key
  );
  if v_missing_features is not null then
    raise exception 'Bar POS parity failed: missing base features %', v_missing_features;
  end if;

  select string_agg(a.addon_key, ',')
    into v_bad_addons
  from public.commercial_addon_prices a
  where a.product_id = 'hospitality-pos'
    and a.addon_key in ('bar_stock_purchasing_pro','bar_accounting_workforce','bar_growth_multi_outlet')
    and not (a.eligible_property_types @> array['restaurant','bar']::text[]);
  if v_bad_addons is not null then
    raise exception 'Bar POS parity failed: add-ons missing bar eligibility %', v_bad_addons;
  end if;
end;
$$;

commit;
