-- Hotel Core entitlement boundary
-- Basic hotel-day modules are included in hotel_core; optional depth remains add-ons.
-- Does not change prices for remaining requestable premium add-ons.

begin;

-- Expand Hotel Core included_features on the active commercial catalog version(s)
update public.commercial_package_prices
set
  included_features = '[
    "bookings","rooms","guests","quotations","invoices","housekeeping","maintenance",
    "reports","expenses","staff","audit","conference","dayuse","import","pwa",
    "online_booking","pos","inventory","supplies","room_supplies",
    "hotel_mode","room_types","physical_inventory","floors_sections","room_attributes",
    "front_desk_dashboard","room_moves","checkin_workflow","early_late_checkout","cancellation_policies",
    "advanced_housekeeping","housekeeping_command_center","maintenance_enterprise",
    "folios","rate_plans","corporate_accounts","night_audit_enterprise","documents",
    "hotel_roles","hotel_kpis","subscription_builder"
  ]'::jsonb,
  sales_copy = 'Hotel-native front desk, reservations, rooms, check-in/out, folios, basic rate plans, corporate settlement, housekeeping, night audit, operational documents, and core reports. Optional services (channels, guest portal, advanced revenue, multi-property) are quoted separately.'
where product_id = 'hotel'
  and commercial_package_key = 'hotel_core';

-- Rebuild package entitlement rows for hotel_core from included_features
delete from public.commercial_package_entitlements e
using public.commercial_package_prices p
where e.catalog_version_id = p.catalog_version_id
  and e.product_id = p.product_id
  and e.commercial_package_key = p.commercial_package_key
  and p.product_id = 'hotel'
  and p.commercial_package_key = 'hotel_core';

insert into public.commercial_package_entitlements (catalog_version_id, product_id, commercial_package_key, feature_key)
select p.catalog_version_id, p.product_id, p.commercial_package_key, jsonb_array_elements_text(p.included_features)
from public.commercial_package_prices p
where p.product_id = 'hotel'
  and p.commercial_package_key = 'hotel_core'
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key) do nothing;

-- Stop selling now-core modules as separate paid add-ons on active catalog versions
update public.commercial_addon_prices
set active = false
where product_id = 'hotel'
  and addon_key in (
    'rate_plans',
    'corporate_accounts',
    'advanced_housekeeping_mobile'
  );

commit;
