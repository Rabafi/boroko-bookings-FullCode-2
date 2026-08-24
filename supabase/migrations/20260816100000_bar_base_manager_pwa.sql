-- Bar POS Base includes the browser-based Manager PWA. This is an entitlement
-- expansion only: the Bar POS price and the Growth-only Owner View boundary do
-- not change. Historical quote snapshots remain immutable.

begin;

-- Keep the live catalogue's package description and feature payload aligned
-- with the shared client catalogue. The quote function reads this active row,
-- so future Bar POS quotes disclose the Manager PWA without changing price.
update public.commercial_package_prices package_price
set
  included_features = (
    select jsonb_agg(feature_key order by feature_key)
    from (
      select distinct feature_key
      from jsonb_array_elements_text(package_price.included_features || '["pwa"]'::jsonb) as feature(feature_key)
    ) features
  ),
  sales_copy = 'Counter sales, drink products, pack stock, low-stock alerts, cash-up, staff shifts, reports, Manager mobile oversight, customer display, and bar board.'
from public.commercial_catalog_versions catalog
where package_price.catalog_version_id = catalog.id
  and catalog.is_active = true
  and package_price.product_id = 'hospitality-pos'
  and package_price.commercial_package_key = 'bar_pos';

-- Activation recomputes package boundaries from this table. Upsert rather than
-- append-only insert in case a controlled catalogue correction is replayed.
insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select
  package_price.catalog_version_id,
  package_price.product_id,
  package_price.commercial_package_key,
  'pwa',
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
  if not exists (
    select 1
    from public.commercial_package_entitlements entitlement
    join public.commercial_catalog_versions catalog
      on catalog.id = entitlement.catalog_version_id
    where catalog.is_active = true
      and entitlement.product_id = 'hospitality-pos'
      and entitlement.commercial_package_key = 'bar_pos'
      and entitlement.feature_key = 'pwa'
      and entitlement.enabled = true
  ) then
    raise exception 'Active Bar POS catalogue must include the Manager PWA entitlement';
  end if;
end;
$$;

-- Existing Bar POS licences previously depended on their legacy Pro-plan
-- inheritance for PWA access. Persist the new package grant where there is no
-- explicit lodge-level override. A pre-existing row is intentionally left
-- untouched so a Command Central disablement remains authoritative.
with eligible_bar_licences as (
  select distinct l.lodge_id
  from public.licenses l
  where l.product_id = 'hospitality-pos'
    and l.commercial_package_key = 'bar_pos'
    and coalesce(l.is_active, true) = true
    and public._subscription_access_allowed(
      public._subscription_state(
        l.payment_status,
        l.next_due_date,
        l.expires_at,
        l.is_active,
        l.grace_period_days
      )
    )
), granted_lodges as (
  insert into public.lodge_features (
    lodge_id, feature_name, enabled, reason, granted_at, updated_at
  )
  select
    lodge_id,
    'pwa',
    true,
    'Commercial package bar_pos: Manager mobile app included',
    now(),
    now()
  from eligible_bar_licences
  on conflict (lodge_id, feature_name) do nothing
  returning lodge_id
), source_licences as (
  select
    granted_lodges.lodge_id,
    (
      select l.id
      from public.licenses l
      where l.lodge_id = granted_lodges.lodge_id
        and l.product_id = 'hospitality-pos'
        and l.commercial_package_key = 'bar_pos'
        and coalesce(l.is_active, true) = true
      order by l.activated_at desc nulls last, l.issued_at desc nulls last, l.id desc
      limit 1
    ) as license_id,
    (
      select l.subscription_plan
      from public.licenses l
      where l.lodge_id = granted_lodges.lodge_id
        and l.product_id = 'hospitality-pos'
        and l.commercial_package_key = 'bar_pos'
        and coalesce(l.is_active, true) = true
      order by l.activated_at desc nulls last, l.issued_at desc nulls last, l.id desc
      limit 1
    ) as subscription_plan
  from granted_lodges
)
insert into public.activation_audit_log (
  license_id,
  lodge_id,
  action,
  previous_plan,
  new_plan,
  previous_addons,
  new_addons,
  effective_features,
  activated_by,
  activation_reason
)
select
  license_id,
  lodge_id,
  'commercial_entitlement_backfill',
  subscription_plan,
  subscription_plan,
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object('pwa', true),
  'system:migration',
  'Bar POS Base now includes Manager mobile app access'
from source_licences
where license_id is not null;

commit;
