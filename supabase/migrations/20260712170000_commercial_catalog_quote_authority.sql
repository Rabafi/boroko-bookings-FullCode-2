-- Product-aware commercial catalogue and authoritative quote workflow.
-- Browser totals are display hints only. This migration owns the canonical
-- package/add-on selection, price, quote snapshot, token, and activation map.

create extension if not exists pgcrypto;

create table if not exists public.commercial_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  currency text not null default 'BWP',
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.commercial_package_prices (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.commercial_catalog_versions(id),
  product_id text not null,
  commercial_package_key text not null,
  display_name text not null,
  internal_plan text not null check (internal_plan in ('Starter', 'Standard', 'Pro', 'Enterprise')),
  billing_basis text not null check (billing_basis in ('annual_license', 'initial_purchase')),
  price_bwp numeric(14,2) not null check (price_bwp >= 0),
  included_features jsonb not null default '[]'::jsonb,
  excluded_features jsonb not null default '[]'::jsonb,
  upgrade_target text,
  eligible_property_types text[] not null default '{}'::text[],
  eligible_operating_profiles text[] not null default '{}'::text[],
  sales_copy text not null default '',
  created_at timestamptz not null default now(),
  unique (catalog_version_id, product_id, commercial_package_key)
);

create table if not exists public.commercial_addon_prices (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.commercial_catalog_versions(id),
  product_id text not null,
  addon_key text not null,
  display_name text not null,
  billing_basis text not null check (billing_basis in ('one_time_addon', 'annual_addon')),
  one_time_price_bwp numeric(14,2) not null default 0 check (one_time_price_bwp >= 0),
  annual_price_bwp numeric(14,2) check (annual_price_bwp is null or annual_price_bwp >= 0),
  eligible_property_types text[] not null default '{}'::text[],
  eligible_operating_profiles text[] not null default '{}'::text[],
  included_features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (catalog_version_id, product_id, addon_key)
);

create table if not exists public.commercial_package_entitlements (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.commercial_catalog_versions(id),
  product_id text not null,
  commercial_package_key text not null,
  feature_key text not null,
  enabled boolean not null default true,
  unique (catalog_version_id, product_id, commercial_package_key, feature_key)
);

create index if not exists commercial_package_prices_lookup_idx
  on public.commercial_package_prices (catalog_version_id, product_id, commercial_package_key);
create index if not exists commercial_addon_prices_lookup_idx
  on public.commercial_addon_prices (catalog_version_id, product_id, addon_key);

alter table public.subscription_package_requests
  add column if not exists product_id text,
  add column if not exists commercial_package_key text,
  add column if not exists operating_profile text,
  add column if not exists commercial_catalog_version text,
  add column if not exists canonical_pricing_snapshot jsonb,
  add column if not exists quote_access_token_hash text,
  add column if not exists quote_access_expires_at timestamptz;

alter table public.licenses
  add column if not exists product_id text,
  add column if not exists commercial_package_key text,
  add column if not exists commercial_catalog_version text,
  add column if not exists commercial_pricing_snapshot jsonb;

create index if not exists subscription_requests_commercial_key_idx
  on public.subscription_package_requests (product_id, commercial_package_key, created_at desc);
create unique index if not exists subscription_requests_quote_token_hash_idx
  on public.subscription_package_requests (quote_access_token_hash)
  where quote_access_token_hash is not null;

insert into public.commercial_catalog_versions (version, currency, is_active)
values ('2026-07-commercial-1', 'BWP', true)
on conflict (version) do update set currency = excluded.currency, is_active = excluded.is_active;

update public.commercial_catalog_versions
set is_active = (version = '2026-07-commercial-1');

with v as (select id from public.commercial_catalog_versions where version = '2026-07-commercial-1')
insert into public.commercial_package_prices (
  catalog_version_id, product_id, commercial_package_key, display_name, internal_plan,
  billing_basis, price_bwp, included_features, excluded_features, upgrade_target,
  eligible_property_types, eligible_operating_profiles, sales_copy
)
select v.id, x.product_id, x.package_key, x.display_name, x.internal_plan,
       x.billing_basis, x.price_bwp, x.included_features, x.excluded_features, x.upgrade_target,
       x.eligible_property_types, x.eligible_operating_profiles, x.sales_copy
from v
cross join (values
  ('lodge-camp', 'starter', 'Starter', 'Starter', 'annual_license', 8999::numeric,
    '["bookings","rooms","guests","quotations","invoices","housekeeping","maintenance"]'::jsonb,
    '["reports","expenses","staff","audit","pos","inventory","online_booking"]'::jsonb, 'standard',
    array['guest_house','bnb','lodge','camp','motel']::text[], '{}'::text[], 'Daily lodge operations for bookings, rooms, guests, quotations, and housekeeping.'),
  ('lodge-camp', 'standard', 'Standard', 'Standard', 'annual_license', 12999::numeric,
    '["bookings","rooms","guests","quotations","invoices","housekeeping","maintenance","reports","expenses","staff","audit","conference","dayuse","import"]'::jsonb,
    '["pos","inventory","online_booking","pwa"]'::jsonb, 'pro',
    array['guest_house','bnb','lodge','camp','motel']::text[], '{}'::text[], 'Owner control with reporting, expenses, staff accountability, audit, and broader operations.'),
  ('lodge-camp', 'pro', 'Pro', 'Pro', 'annual_license', 18999::numeric,
    '["bookings","rooms","guests","quotations","invoices","housekeeping","maintenance","reports","expenses","staff","audit","conference","dayuse","import","pwa","online_booking","pos","inventory","supplies","room_supplies"]'::jsonb,
    '["No Lodge & Camp booking, room, or user usage caps","No Lodge & Camp upgrade ladder"]'::jsonb, null,
    array['guest_house','bnb','lodge','camp','motel']::text[], '{}'::text[], 'Full Lodge & Camp commercial operations with mobile oversight, direct booking, POS, and stock control.'),
  ('hotel', 'hotel_core', 'Hotel Core', 'Enterprise', 'initial_purchase', 37998::numeric,
    '["bookings","rooms","guests","quotations","invoices","housekeeping","maintenance","reports","expenses","staff","audit","conference","dayuse","import","pwa","online_booking","pos","inventory","supplies","room_supplies","hotel_mode","room_types","physical_inventory","floors_sections","front_desk_dashboard","room_moves","folios","advanced_housekeeping","hotel_kpis"]'::jsonb,
    '["No Lodge & Camp booking, room, or user usage caps","No Lodge & Camp upgrade ladder"]'::jsonb, null,
    array['hotel','resort']::text[], '{}'::text[], 'Hotel-native front desk, rooms, folios, rates, housekeeping, and night audit. Optional services are quoted separately.'),
  ('hospitality-pos', 'bar_pos', 'Bar POS', 'Pro', 'annual_license', 4500::numeric,
    '["pos","bar_counter_sales","bar_product_list","bar_pack_stock","inventory","low_stock_alerts","cash_drawer","cash_up","staff_shifts","reports","customer_display","bar_board"]'::jsonb,
    '["kitchen","tables","recipes","restaurant_production"]'::jsonb, 'restaurant_service',
    '{}'::text[], array['bar_only']::text[], 'Counter sales, drink products, pack stock, low-stock alerts, cash-up, staff shifts, reports, customer display, and bar board.'),
  ('hospitality-pos', 'restaurant_service', 'Restaurant Service', 'Pro', 'annual_license', 8999::numeric,
    '["pos","menus","modifiers","tables","tabs","receipts","kitchen_tickets","bar_tickets","stations","cash_drawer","cash_up","staff","reports"]'::jsonb,
    '["stock_control","recipes","prep","variance","loyalty","multi_outlet_controls"]'::jsonb, 'restaurant_control',
    '{}'::text[], array['restaurant_bar']::text[], 'POS service with menus, modifiers, tables, tabs, receipts, kitchen and bar tickets, stations, cash-up, and basic staff controls.'),
  ('hospitality-pos', 'restaurant_control', 'Restaurant Control', 'Pro', 'annual_license', 12999::numeric,
    '["pos","menus","modifiers","tables","tabs","receipts","kitchen_tickets","bar_tickets","stations","cash_drawer","cash_up","staff","reports","stock_control","suppliers","purchasing","recipes","prep","variance","performance","owner_digest","checklists","alerts"]'::jsonb,
    '["loyalty","customer_accounts","vouchers","delivery_tracking","multi_outlet_controls"]'::jsonb, 'restaurant_growth',
    '{}'::text[], array['restaurant_bar']::text[], 'Restaurant Service plus stock, suppliers, purchasing, recipes, prep, variance, performance, owner digest, checklists, and alerts.'),
  ('hospitality-pos', 'restaurant_growth', 'Restaurant Growth', 'Pro', 'annual_license', 18999::numeric,
    '["pos","menus","modifiers","tables","tabs","receipts","kitchen_tickets","bar_tickets","stations","cash_drawer","cash_up","staff","reports","stock_control","suppliers","purchasing","recipes","prep","variance","performance","owner_digest","checklists","alerts","loyalty","customer_accounts","vouchers","delivery_tracking","multi_outlet_controls","central_menu_publishing","stock_transfers","owner_mobile_view"]'::jsonb,
    '[]'::jsonb, null,
    '{}'::text[], array['restaurant_bar']::text[], 'Restaurant Control plus loyalty, customer accounts, vouchers, delivery, multi-outlet, central menus, transfers, and owner mobile view.')
) as x(product_id, package_key, display_name, internal_plan, billing_basis, price_bwp, included_features, excluded_features, upgrade_target, eligible_property_types, eligible_operating_profiles, sales_copy)
on conflict (catalog_version_id, product_id, commercial_package_key) do update set
  display_name = excluded.display_name,
  internal_plan = excluded.internal_plan,
  billing_basis = excluded.billing_basis,
  price_bwp = excluded.price_bwp,
  included_features = excluded.included_features,
  excluded_features = excluded.excluded_features,
  upgrade_target = excluded.upgrade_target,
  eligible_property_types = excluded.eligible_property_types,
  eligible_operating_profiles = excluded.eligible_operating_profiles,
  sales_copy = excluded.sales_copy;

with v as (select id from public.commercial_catalog_versions where version = '2026-07-commercial-1')
insert into public.commercial_addon_prices (
  catalog_version_id, product_id, addon_key, display_name, billing_basis,
  one_time_price_bwp, annual_price_bwp, eligible_property_types, eligible_operating_profiles, included_features
)
select v.id, x.product_id, x.addon_key, x.display_name, x.billing_basis,
       x.one_time_price_bwp, x.annual_price_bwp, x.eligible_property_types, '{}'::text[], x.included_features
from v
cross join (values
  ('hotel','payment_gateway','Online Payment Gateway','annual_addon',6000::numeric,9000::numeric,array['hotel','resort']::text[],'["payment_gateway"]'::jsonb),
  ('hotel','rate_plans','Rate Plans','annual_addon',0::numeric,9000::numeric,array['hotel','resort']::text[],'["rate_plans"]'::jsonb),
  ('hotel','corporate_accounts','Corporate Accounts','annual_addon',3000::numeric,9000::numeric,array['hotel','resort']::text[],'["corporate_accounts"]'::jsonb),
  ('hotel','advanced_housekeeping_mobile','Advanced Housekeeping Mobile','annual_addon',2500::numeric,7000::numeric,array['hotel','resort']::text[],'["advanced_housekeeping"]'::jsonb),
  ('hotel','guest_portal','Guest Portal','annual_addon',5000::numeric,9000::numeric,array['hotel','resort']::text[],'["guest_portal"]'::jsonb),
  ('hotel','multi_property','Multi-Property Dashboard','annual_addon',12000::numeric,18000::numeric,array['hotel','resort']::text[],'["multi_property"]'::jsonb),
  ('hotel','advanced_rates','Advanced Rate Engine','annual_addon',5000::numeric,12000::numeric,array['hotel','resort']::text[],'["advanced_rates","rate_calendar"]'::jsonb)
) as x(product_id, addon_key, display_name, billing_basis, one_time_price_bwp, annual_price_bwp, eligible_property_types, included_features)
on conflict (catalog_version_id, product_id, addon_key) do update set
  display_name = excluded.display_name,
  billing_basis = excluded.billing_basis,
  one_time_price_bwp = excluded.one_time_price_bwp,
  annual_price_bwp = excluded.annual_price_bwp,
  eligible_property_types = excluded.eligible_property_types,
  included_features = excluded.included_features,
  active = true;

insert into public.commercial_package_entitlements (catalog_version_id, product_id, commercial_package_key, feature_key)
select p.catalog_version_id, p.product_id, p.commercial_package_key, jsonb_array_elements_text(p.included_features)
from public.commercial_package_prices p
where p.catalog_version_id = (select id from public.commercial_catalog_versions where version = '2026-07-commercial-1')
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key) do nothing;

create or replace function public._commercial_active_catalog_version()
returns public.commercial_catalog_versions
language sql
stable
security definer
set search_path = public
as $$
  select * from public.commercial_catalog_versions
  where is_active = true
  order by effective_at desc, created_at desc
  limit 1
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
  v_total_due_now numeric := 0;
  v_one_time_total numeric := 0;
  v_recurring_annual numeric := 0;
begin
  if p_selection is null or jsonb_typeof(p_selection) <> 'object' then
    raise exception 'Commercial selection must be an object';
  end if;
  if v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    raise exception 'Invalid commercial product';
  end if;
  if jsonb_typeof(v_addon_keys) <> 'array' then
    raise exception 'selected_addon_keys must be an array';
  end if;

  v_catalog := public._commercial_active_catalog_version();
  if v_catalog.id is null then raise exception 'No active commercial catalogue'; end if;

  select * into v_package
  from public.commercial_package_prices p
  where p.catalog_version_id = v_catalog.id
    and p.product_id = v_product_id
    and p.commercial_package_key = v_package_key;
  if not found then raise exception 'Invalid product/package combination'; end if;
  if cardinality(v_package.eligible_property_types) > 0
     and coalesce(v_property_type, '') <> all(v_package.eligible_property_types) then
    raise exception 'Package is not eligible for property type %', coalesce(v_property_type, 'unknown');
  end if;
  if cardinality(v_package.eligible_operating_profiles) > 0
     and coalesce(v_profile, '') <> all(v_package.eligible_operating_profiles) then
    raise exception 'Package is not eligible for operating profile %', coalesce(v_profile, 'unknown');
  end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'line_type', 'package',
    'key', v_package.commercial_package_key,
    'label', v_package.display_name,
    'billing_basis', v_package.billing_basis,
    'one_time_amount', case when v_package.billing_basis = 'initial_purchase' then v_package.price_bwp else 0 end,
    'recurring_amount', case when v_package.billing_basis = 'annual_license' then v_package.price_bwp else 0 end,
    'amount_due_now', v_package.price_bwp
  ));
  v_total_due_now := v_package.price_bwp;
  if v_package.billing_basis = 'initial_purchase' then v_one_time_total := v_package.price_bwp;
  else v_recurring_annual := v_package.price_bwp;
  end if;

  for v_addon_key in select distinct jsonb_array_elements_text(v_addon_keys) loop
    select * into v_addon
    from public.commercial_addon_prices a
    where a.catalog_version_id = v_catalog.id
      and a.product_id = v_product_id
      and a.addon_key = v_addon_key
      and a.active = true;
    if not found then raise exception 'Invalid add-on % for product %', v_addon_key, v_product_id; end if;
    if cardinality(v_addon.eligible_property_types) > 0
       and coalesce(v_property_type, '') <> all(v_addon.eligible_property_types) then
      raise exception 'Add-on % is not eligible for property type %', v_addon_key, coalesce(v_property_type, 'unknown');
    end if;
    if cardinality(v_addon.eligible_operating_profiles) > 0
       and coalesce(v_profile, '') <> all(v_addon.eligible_operating_profiles) then
      raise exception 'Add-on % is not eligible for operating profile %', v_addon_key, coalesce(v_profile, 'unknown');
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_type', 'addon',
      'key', v_addon.addon_key,
      'label', v_addon.display_name,
      'billing_basis', v_addon.billing_basis,
      'one_time_amount', v_addon.one_time_price_bwp,
      'recurring_amount', coalesce(v_addon.annual_price_bwp, 0),
      'amount_due_now', v_addon.one_time_price_bwp
    ));
    v_total_due_now := v_total_due_now + v_addon.one_time_price_bwp;
    v_one_time_total := v_one_time_total + v_addon.one_time_price_bwp;
    v_recurring_annual := v_recurring_annual + coalesce(v_addon.annual_price_bwp, 0);
  end loop;

  return jsonb_build_object(
    'product_id', v_product_id,
    'commercial_package_key', v_package.commercial_package_key,
    'package_label', v_package.display_name,
    'internal_plan', v_package.internal_plan,
    'billing_basis', v_package.billing_basis,
    'catalog_version', v_catalog.version,
    'currency', v_catalog.currency,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'total_due_now', v_total_due_now,
      'one_time_total', v_one_time_total,
      'recurring_annual', v_recurring_annual
    ),
    'included_features', v_package.included_features,
    'excluded_features', v_package.excluded_features,
    'operating_profile', v_profile,
    'property_type', v_property_type,
    'selection', jsonb_build_object(
      'product_id', v_product_id,
      'commercial_package_key', v_package.commercial_package_key,
      'selected_addon_keys', v_addon_keys,
      'operating_profile', v_profile,
      'property_type', v_property_type
    ),
    'note', 'This quote is a request for manual review. Payment is not collected here and activation occurs only after Boroko approves payment proof.'
  );
end;
$$;

create or replace function public._submit_commercial_quote(
  p_selection jsonb,
  p_customer jsonb,
  p_source text,
  p_lodge_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote jsonb;
  v_quote_number text;
  v_token text;
  v_request_id uuid;
  v_now timestamptz := now();
  v_product_id text := p_selection->>'product_id';
  v_package_key text := coalesce(p_selection->>'commercial_package_key', p_selection->>'package_key');
  v_property_type text := coalesce(p_selection->>'property_type', p_customer->>'property_type', 'lodge');
  v_customer_name text := coalesce(p_customer->>'company_name', p_customer->>'property_name', '');
begin
  if p_source not in ('public_website', 'desktop_app') then raise exception 'Invalid commercial quote source'; end if;
  v_quote := public.calculate_commercial_quote(p_selection || jsonb_build_object('property_type', v_property_type));
  if p_source = 'public_website'
     and nullif(btrim(coalesce(p_customer->>'company_name', p_customer->>'property_name', '')), '') is null then
    raise exception 'Company or property name is required';
  end if;
  if p_source = 'public_website'
     and nullif(btrim(coalesce(p_customer->>'contact_email', p_customer->>'contact_phone', '')), '') is null then
    raise exception 'Email or phone is required';
  end if;

  v_quote_number := 'QT-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('public.seq_document_number')::text, 6, '0');
  v_token := encode(gen_random_bytes(32), 'hex');
  v_quote := v_quote || jsonb_build_object(
    'document_type', 'quote',
    'document_number', v_quote_number,
    'issued_at', v_now,
    'status', 'quoted',
    'quote_access_expires_at', v_now + interval '24 hours'
  );

  insert into public.subscription_package_requests (
    source, request_type, lodge_id, company_name, property_name, contact_name, contact_email,
    contact_phone, country, property_type, operating_profile, product_id, commercial_package_key,
    commercial_catalog_version, current_plan, requested_plan, requested_addons,
    pricing_snapshot, canonical_pricing_snapshot, quote_payload, quote_number,
    quote_access_token_hash, quote_access_expires_at, notes, status, submitted_at, reviewed_at,
    reviewed_by, created_at, updated_at
  ) values (
    p_source, case when p_source = 'public_website' then 'new_subscription' else 'plan_upgrade' end,
    p_lodge_id, coalesce(p_customer->>'company_name', ''), coalesce(p_customer->>'property_name', ''),
    coalesce(p_customer->>'contact_name', ''), coalesce(p_customer->>'contact_email', ''),
    coalesce(p_customer->>'contact_phone', ''), coalesce(p_customer->>'country', ''), v_property_type,
    p_selection->>'operating_profile', v_product_id, v_package_key, v_quote->>'catalog_version',
    p_selection->>'current_plan', v_quote->>'internal_plan',
    coalesce(p_selection->'selected_addon_keys', '[]'::jsonb), v_quote, v_quote, v_quote, v_quote_number,
    encode(digest(v_token, 'sha256'), 'hex'), v_now + interval '24 hours',
    coalesce(p_customer->>'notes', ''), 'quoted', v_now, v_now, 'commercial-catalog', v_now, v_now
  ) returning id into v_request_id;

  if to_regclass('public.admin_notifications') is not null then
    insert into public.admin_notifications (title, body, type, entity_type, entity_id, lodge_id, lodge_name, created_at)
    values (
      'New commercial quotation request',
      concat_ws(E'\n', 'Quote: ' || v_quote_number, 'Product: ' || v_product_id,
        'Package: ' || v_quote->>'package_label', 'Customer: ' || v_customer_name),
      'action_required', 'subscription_package_request', v_request_id::text,
      p_lodge_id::text, nullif(v_customer_name, ''), v_now
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_request_id,
    'quote_number', v_quote_number,
    'catalog_version', v_quote->>'catalog_version',
    'quote_payload', v_quote,
    'download_token', v_token,
    'download_expires_at', v_now + interval '24 hours'
  );
end;
$$;

create or replace function public.submit_public_commercial_quote_request(
  p_selection jsonb,
  p_customer jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._submit_commercial_quote(p_selection, coalesce(p_customer, '{}'::jsonb), 'public_website', null);
end;
$$;

create or replace function public.submit_authenticated_commercial_quote_request(p_selection jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(p_selection->>'lodge_id', '')::uuid;
  v_customer jsonb := coalesce(p_selection->'customer', '{}'::jsonb);
begin
  if v_lodge_id is null then raise exception 'lodge_id is required for an authenticated commercial quote'; end if;
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  return public._submit_commercial_quote(p_selection, v_customer, 'desktop_app', v_lodge_id);
end;
$$;

create or replace function public.get_public_quote_download(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  select id, quote_number, quote_payload, canonical_pricing_snapshot,
         product_id, commercial_package_key, commercial_catalog_version, quote_access_expires_at
  into v_request
  from public.subscription_package_requests
  where quote_access_token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and quote_access_expires_at > now()
    and status not in ('rejected', 'expired');
  if not found then
    return jsonb_build_object('success', false, 'error', 'Quote download is unavailable or expired');
  end if;
  return jsonb_build_object(
    'success', true,
    'id', v_request.id,
    'quote_number', v_request.quote_number,
    'product_id', v_request.product_id,
    'commercial_package_key', v_request.commercial_package_key,
    'commercial_catalog_version', v_request.commercial_catalog_version,
    'quote_payload', v_request.quote_payload,
    'canonical_pricing_snapshot', v_request.canonical_pricing_snapshot,
    'expires_at', v_request.quote_access_expires_at
  );
end;
$$;

create or replace function public.prevent_commercial_quote_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.canonical_pricing_snapshot is not null and (
    new.canonical_pricing_snapshot is distinct from old.canonical_pricing_snapshot
    or new.commercial_catalog_version is distinct from old.commercial_catalog_version
    or new.product_id is distinct from old.product_id
    or new.commercial_package_key is distinct from old.commercial_package_key
    or new.quote_number is distinct from old.quote_number
  ) then
    raise exception 'Canonical commercial quote data is immutable after submission';
  end if;
  return new;
end;
$$;

drop trigger if exists subscription_package_requests_commercial_quote_immutable on public.subscription_package_requests;
create trigger subscription_package_requests_commercial_quote_immutable
before update on public.subscription_package_requests
for each row execute function public.prevent_commercial_quote_snapshot_mutation();

-- Activation is the only server-approved path that maps a commercial package to
-- a licence and feature entitlements. Legacy requests without a commercial key
-- retain the existing activation compatibility behaviour.
create or replace function public.activate_subscription_request(
  p_request_id uuid,
  p_activated_by text default 'admin',
  p_activation_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_license record;
  v_settings record;
  v_package record;
  v_addon record;
  v_license_id uuid := nullif(p_activation_payload->>'license_id', '')::uuid;
  v_lodge_id uuid := nullif(p_activation_payload->>'lodge_id', '')::uuid;
  v_selected_addons jsonb;
  v_addon_key text;
  v_feature_key text;
  v_effective jsonb := '{}'::jsonb;
  v_previous_plan text;
begin
  select * into v_request from public.subscription_package_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Request not found'); end if;
  if v_request.status not in ('approved', 'payment_under_review') then
    return jsonb_build_object('success', false, 'error', 'Request must be approved or payment_under_review before activation');
  end if;
  if v_license_id is null or v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'license_id and lodge_id are required for activation');
  end if;

  select * into v_license from public.licenses where id = v_license_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Selected license does not belong to the selected company'); end if;

  -- Existing requests/licences predate the product-aware catalogue. Keep their
  -- current access unless an admin explicitly activates a new commercial quote.
  if v_request.commercial_package_key is null then
    update public.subscription_package_requests set
      lodge_id = coalesce(lodge_id, v_lodge_id), existing_license_id = coalesce(existing_license_id, v_license_id),
      status = 'activated', activated_at = now(), activated_by = p_activated_by,
      activation_payload = p_activation_payload, updated_at = now()
    where id = p_request_id;
    return jsonb_build_object('success', true, 'id', p_request_id, 'status', 'activated', 'license_id', v_license_id, 'lodge_id', v_lodge_id);
  end if;

  if v_request.canonical_pricing_snapshot is null
     or v_request.product_id is null
     or v_request.commercial_catalog_version is null then
    return jsonb_build_object('success', false, 'error', 'Commercial quote snapshot is missing');
  end if;
  if p_activation_payload->>'product_id' is not null and p_activation_payload->>'product_id' <> v_request.product_id then
    return jsonb_build_object('success', false, 'error', 'Product does not match the commercial quote');
  end if;

  select property_type, operating_profile into v_settings
  from public.settings where lodge_id = v_lodge_id limit 1;
  if v_request.product_id = 'hotel' and coalesce(v_settings.property_type, v_license.business_type, '') not in ('hotel', 'resort') then
    return jsonb_build_object('success', false, 'error', 'Hotel quote cannot be activated for a non-Hotel company');
  elsif v_request.product_id = 'hospitality-pos' and coalesce(v_settings.property_type, v_license.business_type, '') <> 'restaurant' then
    return jsonb_build_object('success', false, 'error', 'POS quote cannot be activated for a non-restaurant company');
  elsif v_request.product_id = 'lodge-camp' and coalesce(v_settings.property_type, v_license.business_type, '') in ('hotel', 'resort', 'restaurant') then
    return jsonb_build_object('success', false, 'error', 'Lodge quote cannot be activated for this company product');
  end if;
  if v_license.product_id is not null and v_license.product_id <> v_request.product_id then
    return jsonb_build_object('success', false, 'error', 'Licence product does not match the commercial quote');
  end if;
  v_previous_plan := v_license.subscription_plan;

  select * into v_package from public.commercial_package_prices
  where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
    and product_id = v_request.product_id and commercial_package_key = v_request.commercial_package_key;
  if not found or v_request.canonical_pricing_snapshot->>'catalog_version' <> v_request.commercial_catalog_version then
    return jsonb_build_object('success', false, 'error', 'Quote catalogue snapshot is not valid');
  end if;
  v_selected_addons := coalesce(v_request.requested_addons, '[]'::jsonb);
  for v_addon_key in select distinct jsonb_array_elements_text(v_selected_addons) loop
    select * into v_addon from public.commercial_addon_prices
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id and addon_key = v_addon_key and active = true;
    if not found then return jsonb_build_object('success', false, 'error', 'Selected add-on is not valid for this product'); end if;
  end loop;

  update public.licenses set
    subscription_plan = v_package.internal_plan,
    product_id = v_request.product_id,
    commercial_package_key = v_request.commercial_package_key,
    commercial_catalog_version = v_request.commercial_catalog_version,
    commercial_pricing_snapshot = v_request.canonical_pricing_snapshot,
    payment_status = coalesce(p_activation_payload->>'payment_status', 'active')
  where id = v_license_id;

  for v_feature_key in select feature_key from public.commercial_package_entitlements
    where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
      and product_id = v_request.product_id and commercial_package_key = v_request.commercial_package_key
  loop
    insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
    values (v_lodge_id, v_feature_key, true, 'Commercial package ' || v_request.commercial_package_key, now(), now())
    on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now();
    v_effective := v_effective || jsonb_build_object(v_feature_key, true);
  end loop;
  for v_addon_key in select distinct jsonb_array_elements_text(v_selected_addons) loop
    for v_feature_key in select jsonb_array_elements_text(included_features)
      from public.commercial_addon_prices
      where catalog_version_id = (select id from public.commercial_catalog_versions where version = v_request.commercial_catalog_version)
        and product_id = v_request.product_id and addon_key = v_addon_key
    loop
      insert into public.lodge_features (lodge_id, feature_name, enabled, reason, granted_at, updated_at)
      values (v_lodge_id, v_feature_key, true, 'Commercial add-on ' || v_addon_key, now(), now())
      on conflict (lodge_id, feature_name) do update set enabled = true, reason = excluded.reason, updated_at = now();
      v_effective := v_effective || jsonb_build_object(v_feature_key, true);
    end loop;
  end loop;

  insert into public.activation_audit_log (
    license_id, lodge_id, action, previous_plan, new_plan, previous_addons, new_addons,
    effective_features, activated_by, activation_reason, related_request_id
  ) values (
    v_license_id, v_lodge_id, 'subscription_activated', v_previous_plan, v_package.internal_plan,
    coalesce(v_license.commercial_pricing_snapshot->'selection'->'selected_addon_keys', '[]'::jsonb),
    v_selected_addons, v_effective, p_activated_by, 'Commercial quote activation', p_request_id
  );

  update public.subscription_package_requests set
    lodge_id = v_lodge_id, existing_license_id = v_license_id, status = 'activated',
    activated_at = now(), activated_by = p_activated_by,
    activation_payload = coalesce(p_activation_payload, '{}'::jsonb) || jsonb_build_object(
      'product_id', v_request.product_id, 'commercial_package_key', v_request.commercial_package_key,
      'effective_features', v_effective), updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true, 'id', p_request_id, 'status', 'activated',
    'license_id', v_license_id, 'lodge_id', v_lodge_id, 'product_id', v_request.product_id,
    'commercial_package_key', v_request.commercial_package_key, 'effective_features', v_effective);
end;
$$;

revoke all on function public.calculate_commercial_quote(jsonb) from public;
revoke all on function public._submit_commercial_quote(jsonb, jsonb, text, uuid) from public;
revoke all on function public.submit_authenticated_commercial_quote_request(jsonb) from public, anon;
revoke all on function public.get_public_quote_download(text) from public;
grant execute on function public.calculate_commercial_quote(jsonb) to anon, authenticated, service_role;
grant execute on function public.submit_public_commercial_quote_request(jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.submit_authenticated_commercial_quote_request(jsonb) to authenticated, service_role;
grant execute on function public.get_public_quote_download(text) to anon, authenticated, service_role;
revoke all on function public.activate_subscription_request(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_request(uuid, text, jsonb) to service_role;
