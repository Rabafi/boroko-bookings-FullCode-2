begin;

create or replace function public.get_lodge_public_profile_shell(p_slug text)
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
    'currency', coalesce(v_settings.currency, 'P'),
    'city', v_settings.city,
    'country', v_settings.country,
    'phone', v_settings.phone,
    'email', v_settings.email,
    'website', v_settings.website,
    'address', v_settings.address,
    'whatsapp_number', coalesce(v_settings.whatsapp_number, ''),
    'booking_tagline', coalesce(nullif(v_settings.booking_tagline, ''), 'Reserve your stay'),
    'booking_description', coalesce(v_settings.booking_description, ''),
    'booking_check_in_from', coalesce(v_settings.booking_check_in_from, ''),
    'booking_check_out_until', coalesce(v_settings.booking_check_out_until, ''),
    'booking_cancellation_policy', coalesce(v_settings.booking_cancellation_policy, ''),
    'booking_payment_terms', coalesce(v_settings.booking_payment_terms, ''),
    'booking_house_rules', coalesce(v_settings.booking_house_rules, ''),
    'booking_faq', coalesce(v_settings.booking_faq, '[]'::jsonb),
    'has_logo', coalesce(v_settings.logo, '') <> '',
    'has_hero_image', coalesce(v_settings.hero_image, '') <> ''
  );
end;
$function$;

grant execute on function public.get_lodge_public_profile_shell(text) to anon, authenticated;

create or replace function public.get_lodge_public_media(p_slug text)
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
    'logo', coalesce(v_settings.logo, ''),
    'hero_image', coalesce(v_settings.hero_image, '')
  );
end;
$function$;

grant execute on function public.get_lodge_public_media(text) to anon, authenticated;

create or replace function public.get_available_rooms_summary(
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'room_number', r.room_number,
        'room_type', r.room_type,
        'rate_per_night', r.rate_per_night,
        'max_occupancy', r.max_occupancy,
        'description', r.description,
        'photo', coalesce(
          nullif(
            (
              coalesce(
                r.photos,
                case
                  when r.photo is not null and r.photo <> '' then array[r.photo]
                  else '{}'::text[]
                end
              )
            )[1],
            ''
          ),
          ''
        ),
        'photo_count', coalesce(
          array_length(
            coalesce(
              r.photos,
              case
                when r.photo is not null and r.photo <> '' then array[r.photo]
                else '{}'::text[]
              end
            ),
            1
          ),
          0
        ),
        'amenities', coalesce(r.amenities, '{}'::text[]),
        'nights', (p_check_out - p_check_in),
        'total_price', r.rate_per_night * (p_check_out - p_check_in)
      )
      order by r.room_number
    ),
    '[]'::jsonb
  )
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

grant execute on function public.get_available_rooms_summary(text, date, date) to anon, authenticated;

create or replace function public.get_public_room_media(
  p_slug text,
  p_room_id uuid
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
  v_photos text[];
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  if p_room_id is null then
    return jsonb_build_object('success', false, 'error', 'Room is required');
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

  select coalesce(
           r.photos,
           case
             when r.photo is not null and r.photo <> '' then array[r.photo]
             else '{}'::text[]
           end
         )
    into v_photos
    from public.rooms r
   where r.id = p_room_id
     and r.lodge_id = v_lodge_id
     and r.status not in ('maintenance')
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object(
    'success', true,
    'room_id', p_room_id,
    'photos', coalesce(v_photos, '{}'::text[])
  );
end;
$function$;

grant execute on function public.get_public_room_media(text, uuid) to anon, authenticated;

commit;
