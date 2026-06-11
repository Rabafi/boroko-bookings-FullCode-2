-- ============================================================
-- Booking Site Content Upgrade
-- Richer per-lodge public content for Netlify booking pages
-- Adds hero copy, policies, FAQ, WhatsApp, and room amenities
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Settings fields for public booking pages
-- ------------------------------------------------------------

alter table public.settings
  add column if not exists booking_tagline text,
  add column if not exists booking_description text,
  add column if not exists hero_image text,
  add column if not exists whatsapp_number text,
  add column if not exists booking_check_in_from text,
  add column if not exists booking_check_out_until text,
  add column if not exists booking_cancellation_policy text,
  add column if not exists booking_payment_terms text,
  add column if not exists booking_house_rules text,
  add column if not exists booking_faq jsonb default '[]'::jsonb;

update public.settings
set booking_faq = '[]'::jsonb
where booking_faq is null;

-- ------------------------------------------------------------
-- 2. Room amenities
-- ------------------------------------------------------------

alter table public.rooms
  add column if not exists amenities text[] default '{}';

update public.rooms
set amenities = '{}'
where amenities is null;

-- ------------------------------------------------------------
-- 3. Update room RPCs
-- ------------------------------------------------------------

create or replace function public.create_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.rooms (
    id,
    lodge_id,
    room_number,
    room_type,
    rate_per_night,
    max_occupancy,
    status,
    description,
    photo,
    photos,
    amenities
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'room_number',
    payload->>'room_type',
    coalesce((payload->>'rate_per_night')::numeric, 0),
    coalesce((payload->>'max_occupancy')::integer, 2),
    coalesce(payload->>'status', 'available'),
    coalesce(payload->>'description', ''),
    coalesce(payload->>'photo', ''),
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
      case
        when payload->>'photo' is not null and payload->>'photo' <> ''
        then array[payload->>'photo']
        else '{}'::text[]
      end
    ),
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
      '{}'::text[]
    )
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_room(jsonb) to anon, authenticated;

create or replace function public.update_room(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.rooms
  set
    room_number = case when payload ? 'room_number' then payload->>'room_number' else room_number end,
    room_type = case when payload ? 'room_type' then payload->>'room_type' else room_type end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end,
    max_occupancy = case when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, 2) else max_occupancy end,
    status = case when payload ? 'status' then coalesce(payload->>'status', 'available') else status end,
    description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end,
    photo = case when payload ? 'photo' then coalesce(payload->>'photo', '') else photo end,
    photos = case
      when payload ? 'photos' then
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
          '{}'::text[]
        )
      else photos
    end,
    amenities = case
      when payload ? 'amenities' then
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
          '{}'::text[]
        )
      else amenities
    end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_room(uuid, uuid, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Richer public profile RPC
-- ------------------------------------------------------------

create or replace function public.get_lodge_public_profile(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
begin
  if v_slug = '' then
    return jsonb_build_object('found', false, 'error', 'Slug is required');
  end if;

  select *
  into v_settings
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('found', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('found', false, 'error', 'Online booking not available for this property');
  end if;

  return jsonb_build_object(
    'found', true,
    'lodge_id', v_settings.lodge_id,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'logo', v_settings.logo,
    'currency', coalesce(v_settings.currency, 'P'),
    'city', v_settings.city,
    'country', v_settings.country,
    'phone', v_settings.phone,
    'email', v_settings.email,
    'website', v_settings.website,
    'address', v_settings.address,
    'booking_tagline', coalesce(nullif(v_settings.booking_tagline, ''), 'Direct booking, straight with the property'),
    'booking_description', coalesce(v_settings.booking_description, ''),
    'hero_image', coalesce(v_settings.hero_image, ''),
    'whatsapp_number', coalesce(v_settings.whatsapp_number, ''),
    'booking_check_in_from', coalesce(v_settings.booking_check_in_from, ''),
    'booking_check_out_until', coalesce(v_settings.booking_check_out_until, ''),
    'booking_cancellation_policy', coalesce(v_settings.booking_cancellation_policy, ''),
    'booking_payment_terms', coalesce(v_settings.booking_payment_terms, ''),
    'booking_house_rules', coalesce(v_settings.booking_house_rules, ''),
    'booking_faq', coalesce(v_settings.booking_faq, '[]'::jsonb)
  );
end;
$function$;

grant execute on function public.get_lodge_public_profile(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 5. Available rooms RPC now includes amenities
-- ------------------------------------------------------------

create or replace function public.get_available_rooms(
  p_slug text,
  p_check_in date,
  p_check_out date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_features jsonb;
  v_enabled boolean;
  v_rooms jsonb;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  if p_check_in is null or p_check_out is null then
    return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required');
  end if;

  if p_check_out <= p_check_in then
    return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in');
  end if;

  select lodge_id
  into v_lodge_id
  from public.settings
  where lower(btrim(coalesce(slug, ''))) = v_slug
    and coalesce(deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'room_number', r.room_number,
      'room_type', r.room_type,
      'rate_per_night', r.rate_per_night,
      'max_occupancy', r.max_occupancy,
      'description', r.description,
      'photos', coalesce(r.photos, case when r.photo is not null and r.photo <> '' then array[r.photo] else '{}'::text[] end),
      'amenities', coalesce(r.amenities, '{}'::text[]),
      'nights', (p_check_out - p_check_in),
      'total_price', r.rate_per_night * (p_check_out - p_check_in)
    ) order by r.room_number
  ), '[]'::jsonb)
  into v_rooms
  from public.rooms r
  where r.lodge_id = v_lodge_id
    and r.status not in ('maintenance')
    and not exists (
      select 1
      from public.bookings b
      where b.lodge_id = v_lodge_id
        and b.room_id = r.id
        and b.status not in ('cancelled', 'checked_out')
        and not (b.check_out <= p_check_in or b.check_in >= p_check_out)
    );

  return jsonb_build_object(
    'success', true,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', (p_check_out - p_check_in),
    'rooms', v_rooms
  );
end;
$function$;

grant execute on function public.get_available_rooms(text, date, date) to anon, authenticated;

commit;
