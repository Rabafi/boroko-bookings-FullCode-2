-- Fix get_lodge_public_profile_shell to return logo and hero_image URLs
-- The baseline migration created this function without returning the actual image URLs,
-- causing the booking site to never show logo/hero images because get_lodge_public_media
-- may not have anon grants deployed.

create or replace function public.get_lodge_public_profile_shell(p_slug text) returns jsonb
    language plpgsql security definer
    set search_path to 'public'
    as $$
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
    'logo', coalesce(v_settings.logo, ''),
    'hero_image', coalesce(v_settings.hero_image, '')
  );
end;
$$;

-- Re-apply grants after function recreation
revoke all on function public.get_lodge_public_profile_shell(text) from public;
grant execute on function public.get_lodge_public_profile_shell(text) to anon, authenticated;
