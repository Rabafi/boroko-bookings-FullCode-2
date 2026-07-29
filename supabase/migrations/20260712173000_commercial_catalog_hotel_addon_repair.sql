-- Keep every advertised Hotel add-on available to the authoritative catalog.
with v as (select id from public.commercial_catalog_versions where version = '2026-07-commercial-1')
insert into public.commercial_addon_prices (
  catalog_version_id, product_id, addon_key, display_name, billing_basis,
  one_time_price_bwp, annual_price_bwp, eligible_property_types, eligible_operating_profiles, included_features
)
select v.id, 'hotel', 'multi_outlet_pos', 'Multi-Outlet POS Pro', 'annual_addon',
       4000, 9000, array['hotel','resort']::text[], '{}'::text[], '["multi_outlet_pos"]'::jsonb
from v
on conflict (catalog_version_id, product_id, addon_key) do update set
  display_name = excluded.display_name,
  billing_basis = excluded.billing_basis,
  one_time_price_bwp = excluded.one_time_price_bwp,
  annual_price_bwp = excluded.annual_price_bwp,
  eligible_property_types = excluded.eligible_property_types,
  included_features = excluded.included_features,
  active = true;
