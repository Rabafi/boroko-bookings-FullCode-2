-- First-time company setup must create a settings row before any staff user
-- exists for that lodge_id. Direct inserts through the anon/authenticated
-- client are blocked by settings_lodge_scope_insert (app_lodge_access).
--
-- create_user already supports a SECURITY DEFINER first-admin bootstrap.
-- This RPC is the matching bootstrap for the settings row so multi-product
-- / multi-company setup (including same email across products) can complete.

create or replace function public.bootstrap_company_settings(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_existing public.settings%rowtype;
  v_row public.settings%rowtype;
  v_property_type text := lower(btrim(coalesce(
    nullif(p_payload->>'property_type', ''),
    nullif(p_payload->>'business_type', ''),
    'lodge'
  )));
  v_business_type text := lower(btrim(coalesce(
    nullif(p_payload->>'business_type', ''),
    nullif(p_payload->>'property_type', ''),
    'lodge'
  )));
begin
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id is required to bootstrap company settings.');
  end if;

  select * into v_existing
  from public.settings
  where lodge_id = v_lodge_id
  for update;

  if found and coalesce(v_existing.setup_complete, false) = true then
    return jsonb_build_object(
      'success', false,
      'code', 'remote_lodge_already_exists',
      'error', 'This company is already set up. Sign in to it instead of running setup again.'
    );
  end if;

  -- Normalize product property taxonomy to accepted values when present.
  if v_property_type in ('pos_only') then
    v_property_type := 'restaurant';
    v_business_type := 'restaurant';
  elsif v_property_type in ('campsite', 'camping') then
    v_property_type := 'camp';
  elsif v_property_type in ('guesthouse') then
    v_property_type := 'guest_house';
  elsif v_property_type in ('bed_and_breakfast') then
    v_property_type := 'bnb';
  end if;

  insert into public.settings (
    lodge_id,
    lodge_name,
    company_name,
    address,
    city,
    country,
    phone,
    email,
    website,
    vat_number,
    vat_enabled,
    vat_rate,
    currency,
    logo,
    business_type,
    property_type,
    assistant_enabled,
    slug,
    booking_tagline,
    booking_description,
    hero_image,
    whatsapp_number,
    booking_check_in_from,
    booking_check_out_until,
    booking_cancellation_policy,
    booking_payment_terms,
    booking_house_rules,
    booking_faq,
    public_offer_rooms,
    public_offer_multi_room,
    public_offer_full_lodge,
    public_offer_day_use,
    public_offer_events,
    setup_complete,
    trial_started_at,
    updated_at
  ) values (
    v_lodge_id,
    coalesce(nullif(p_payload->>'lodge_name', ''), 'New property'),
    coalesce(nullif(p_payload->>'company_name', ''), ''),
    coalesce(nullif(p_payload->>'address', ''), ''),
    coalesce(nullif(p_payload->>'city', ''), ''),
    coalesce(nullif(p_payload->>'country', ''), 'Botswana'),
    coalesce(nullif(p_payload->>'phone', ''), ''),
    coalesce(nullif(p_payload->>'email', ''), ''),
    coalesce(nullif(p_payload->>'website', ''), ''),
    coalesce(nullif(p_payload->>'vat_number', ''), ''),
    coalesce((p_payload->>'vat_enabled')::boolean, false),
    coalesce(nullif(p_payload->>'vat_rate', '')::numeric, 0),
    coalesce(nullif(p_payload->>'currency', ''), 'P'),
    coalesce(nullif(p_payload->>'logo', ''), ''),
    v_business_type,
    v_property_type,
    coalesce((p_payload->>'assistant_enabled')::boolean, false),
    nullif(p_payload->>'slug', ''),
    coalesce(nullif(p_payload->>'booking_tagline', ''), ''),
    coalesce(nullif(p_payload->>'booking_description', ''), ''),
    coalesce(nullif(p_payload->>'hero_image', ''), ''),
    coalesce(nullif(p_payload->>'whatsapp_number', ''), ''),
    coalesce(nullif(p_payload->>'booking_check_in_from', ''), ''),
    coalesce(nullif(p_payload->>'booking_check_out_until', ''), ''),
    coalesce(nullif(p_payload->>'booking_cancellation_policy', ''), ''),
    coalesce(nullif(p_payload->>'booking_payment_terms', ''), ''),
    coalesce(nullif(p_payload->>'booking_house_rules', ''), ''),
    coalesce(p_payload->'booking_faq', '[]'::jsonb),
    coalesce((p_payload->>'public_offer_rooms')::boolean, true),
    coalesce((p_payload->>'public_offer_multi_room')::boolean, true),
    coalesce((p_payload->>'public_offer_full_lodge')::boolean, false),
    coalesce((p_payload->>'public_offer_day_use')::boolean, false),
    coalesce((p_payload->>'public_offer_events')::boolean, false),
    true,
    coalesce(v_existing.trial_started_at, now()),
    now()
  )
  on conflict (lodge_id) do update set
    lodge_name = excluded.lodge_name,
    company_name = excluded.company_name,
    address = excluded.address,
    city = excluded.city,
    country = excluded.country,
    phone = excluded.phone,
    email = excluded.email,
    website = excluded.website,
    vat_number = excluded.vat_number,
    vat_enabled = excluded.vat_enabled,
    vat_rate = excluded.vat_rate,
    currency = excluded.currency,
    logo = excluded.logo,
    business_type = excluded.business_type,
    property_type = excluded.property_type,
    assistant_enabled = excluded.assistant_enabled,
    slug = excluded.slug,
    booking_tagline = excluded.booking_tagline,
    booking_description = excluded.booking_description,
    hero_image = excluded.hero_image,
    whatsapp_number = excluded.whatsapp_number,
    booking_check_in_from = excluded.booking_check_in_from,
    booking_check_out_until = excluded.booking_check_out_until,
    booking_cancellation_policy = excluded.booking_cancellation_policy,
    booking_payment_terms = excluded.booking_payment_terms,
    booking_house_rules = excluded.booking_house_rules,
    booking_faq = excluded.booking_faq,
    public_offer_rooms = excluded.public_offer_rooms,
    public_offer_multi_room = excluded.public_offer_multi_room,
    public_offer_full_lodge = excluded.public_offer_full_lodge,
    public_offer_day_use = excluded.public_offer_day_use,
    public_offer_events = excluded.public_offer_events,
    setup_complete = true,
    trial_started_at = coalesce(public.settings.trial_started_at, excluded.trial_started_at),
    updated_at = now()
  where coalesce(public.settings.setup_complete, false) = false
  returning * into v_row;

  if not found then
    -- Conflict row was already complete, or update target disappeared.
    select * into v_row from public.settings where lodge_id = v_lodge_id;
    if coalesce(v_row.setup_complete, false) = true then
      return jsonb_build_object(
        'success', false,
        'code', 'remote_lodge_already_exists',
        'error', 'This company is already set up. Sign in to it instead of running setup again.'
      );
    end if;
    return jsonb_build_object('success', false, 'error', 'Could not bootstrap company settings.');
  end if;

  return jsonb_build_object(
    'success', true,
    'settings', to_jsonb(v_row)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'error', sqlerrm,
      'code', sqlstate
    );
end;
$$;

revoke all on function public.bootstrap_company_settings(jsonb) from public;
grant execute on function public.bootstrap_company_settings(jsonb) to anon, authenticated, service_role;

comment on function public.bootstrap_company_settings(jsonb) is
  'SECURITY DEFINER first-time company settings bootstrap for desktop setup. Refuses completed companies.';
