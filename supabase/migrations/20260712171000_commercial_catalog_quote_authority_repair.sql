-- Repair the first deployed commercial catalogue migration against the linked
-- schema. Keep this as a forward migration so already-applied installations
-- receive the correction without rewriting migration history.

alter table public.settings
  add column if not exists operating_profile jsonb not null default '{}'::jsonb;

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
        'Package: ' || (v_quote->>'package_label'), 'Customer: ' || v_customer_name),
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

revoke all on function public._submit_commercial_quote(jsonb, jsonb, text, uuid) from public;

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
    'included_features', v_package.included_features, 'excluded_features', v_package.excluded_features,
    'operating_profile', v_profile, 'property_type', v_property_type,
    'selection', jsonb_build_object('product_id', v_product_id, 'commercial_package_key', v_package.commercial_package_key,
      'selected_addon_keys', v_addon_keys, 'operating_profile', v_profile, 'property_type', v_property_type),
    'note', 'This quote is a request for manual review. Payment is not collected here and activation occurs only after Boroko approves payment proof.'
  );
end;
$$;

revoke all on function public.calculate_commercial_quote(jsonb) from public;
grant execute on function public.calculate_commercial_quote(jsonb) to anon, authenticated, service_role;
