-- Align the live Bar POS Base catalogue with the existing counter workflow.
-- This forward-only correction documents modifiers, open tabs, and receipts
-- without changing the Bar POS price, add-on boundaries, or historical quotes.

begin;

update public.commercial_package_prices package_price
set
  included_features = (
    select jsonb_agg(feature_key order by feature_key)
    from (
      select distinct feature_key
      from jsonb_array_elements_text(
        package_price.included_features || '["modifiers","tabs","receipts"]'::jsonb
      ) as feature(feature_key)
    ) features
  ),
  sales_copy = 'Counter sales with modifiers, open tabs and receipts; drink products, pack stock, low-stock alerts, cash-up, staff shifts, reports, Manager mobile oversight, customer display, and bar board.'
from public.commercial_catalog_versions catalog
where package_price.catalog_version_id = catalog.id
  and catalog.is_active = true
  and package_price.product_id = 'hospitality-pos'
  and package_price.commercial_package_key = 'bar_pos';

-- Keep the authoritative entitlement table in lockstep with the package row.
insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select
  package_price.catalog_version_id,
  package_price.product_id,
  package_price.commercial_package_key,
  jsonb_array_elements_text(package_price.included_features),
  true
from public.commercial_package_prices package_price
join public.commercial_catalog_versions catalog
  on catalog.id = package_price.catalog_version_id
where catalog.is_active = true
  and package_price.product_id = 'hospitality-pos'
  and package_price.commercial_package_key = 'bar_pos'
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = true;

do $$
begin
  if exists (
    select 1
    from (values ('modifiers'), ('tabs'), ('receipts')) expected(feature_key)
    where not exists (
      select 1
      from public.commercial_package_entitlements entitlement
      join public.commercial_catalog_versions catalog
        on catalog.id = entitlement.catalog_version_id
      where catalog.is_active = true
        and entitlement.product_id = 'hospitality-pos'
        and entitlement.commercial_package_key = 'bar_pos'
        and entitlement.feature_key = expected.feature_key
        and entitlement.enabled = true
    )
  ) then
    raise exception 'Active Bar POS Base catalogue is missing a core counter feature';
  end if;
end;
$$;

commit;
