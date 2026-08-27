-- Starter Backup & Data Ownership Lite
--
-- Keep the customer-owned support export in the Lodge Starter commercial
-- catalogue. Higher accommodation packages inherit the same data-ownership
-- baseline, so Hotel Core is included; Bar/POS catalogue rows are untouched.

update public.commercial_package_prices package_price
   set included_features = coalesce(package_price.included_features, '[]'::jsonb)
                          || '["starter_backup"]'::jsonb
 where (
     (
       package_price.product_id = 'lodge-camp'
       and package_price.commercial_package_key in ('starter', 'standard', 'pro')
     ) or (
       package_price.product_id = 'hotel'
       and package_price.commercial_package_key = 'hotel_core'
     )
   )
   and not (coalesce(package_price.included_features, '[]'::jsonb) ? 'starter_backup');

insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select package_price.catalog_version_id,
       package_price.product_id,
       package_price.commercial_package_key,
       'starter_backup',
       true
  from public.commercial_package_prices package_price
 where (
     package_price.product_id = 'lodge-camp'
     and package_price.commercial_package_key in ('starter', 'standard', 'pro')
   ) or (
     package_price.product_id = 'hotel'
     and package_price.commercial_package_key = 'hotel_core'
   )
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = excluded.enabled;
