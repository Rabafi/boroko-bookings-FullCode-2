-- ============================================================
-- Room Photos Array
-- Adds photos TEXT[] to rooms, migrates existing single photo,
-- updates create_room, update_room, and get_available_rooms RPCs
-- ============================================================

-- 1. Add photos column
alter table public.rooms
  add column if not exists photos text[] default '{}';

-- 2. Migrate existing single photo into the array (only where photos is still empty)
update public.rooms
set photos = array[photo]
where photo is not null
  and photo <> ''
  and (photos is null or array_length(photos, 1) is null or array_length(photos, 1) = 0);

-- ============================================================
-- 3. Update create_room to accept photos
-- ============================================================
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
    photos
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
    )
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_room(jsonb) to anon, authenticated;

-- ============================================================
-- 4. Update update_room to accept photos
-- ============================================================
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
    room_number  = case when payload ? 'room_number'  then payload->>'room_number'                                   else room_number  end,
    room_type    = case when payload ? 'room_type'     then payload->>'room_type'                                     else room_type    end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0)    else rate_per_night end,
    max_occupancy  = case when payload ? 'max_occupancy'  then coalesce((payload->>'max_occupancy')::integer, 2)     else max_occupancy  end,
    status       = case when payload ? 'status'       then coalesce(payload->>'status', 'available')                 else status       end,
    description  = case when payload ? 'description'  then coalesce(payload->>'description', '')                     else description  end,
    photo        = case when payload ? 'photo'         then coalesce(payload->>'photo', '')                          else photo        end,
    photos       = case
                     when payload ? 'photos' then
                       coalesce(
                         (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
                         '{}'::text[]
                       )
                     else photos
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

-- ============================================================
-- 5. Update get_available_rooms to return photos array
-- ============================================================
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
  v_slug     text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_features jsonb;
  v_enabled  boolean;
  v_rooms    jsonb;
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

  -- Resolve lodge
  select lodge_id
  into v_lodge_id
  from public.settings
  where lower(btrim(coalesce(slug, ''))) = v_slug
    and coalesce(deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  -- Check feature enabled
  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  -- Fetch available rooms (exclude rooms with overlapping non-cancelled bookings)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',             r.id,
      'room_number',    r.room_number,
      'room_type',      r.room_type,
      'rate_per_night', r.rate_per_night,
      'max_occupancy',  r.max_occupancy,
      'description',    r.description,
      'photos',         coalesce(r.photos, case when r.photo is not null and r.photo <> '' then array[r.photo] else '{}'::text[] end),
      'nights',         (p_check_out - p_check_in),
      'total_price',    r.rate_per_night * (p_check_out - p_check_in)
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
    'success',   true,
    'check_in',  p_check_in,
    'check_out', p_check_out,
    'nights',    (p_check_out - p_check_in),
    'rooms',     v_rooms
  );
end;
$function$;

grant execute on function public.get_available_rooms(text, date, date) to anon, authenticated;
