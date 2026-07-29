-- Campsite accommodation model (Phase 1 + pricing/capacity fields)
-- Extends rooms inventory with accommodation_kind and campsite-specific rates/capacity.
-- Public availability and booking offers gain campsite awareness.
-- One campsite row remains one reservable unit for conflict checking (existing booking rules).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Schema: rooms campsite fields + booking occupancy snapshot
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.rooms
  add column if not exists accommodation_kind text not null default 'room',
  add column if not exists capacity_adults integer,
  add column if not exists capacity_children integer,
  add column if not exists max_tents integer,
  add column if not exists max_vehicles integer,
  add column if not exists is_powered boolean not null default false,
  add column if not exists site_surface text,
  add column if not exists shared_facilities boolean not null default false,
  add column if not exists rate_mode text not null default 'site',
  add column if not exists rate_per_person numeric(12,2) not null default 0,
  add column if not exists rate_per_tent numeric(12,2) not null default 0,
  add column if not exists rate_per_vehicle numeric(12,2) not null default 0;

-- Backfill capacity from max_occupancy for existing rows
update public.rooms
   set capacity_adults = coalesce(capacity_adults, max_occupancy, 2)
 where capacity_adults is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_accommodation_kind_check'
  ) then
    alter table public.rooms
      add constraint rooms_accommodation_kind_check
      check (accommodation_kind in ('room', 'unit', 'tent', 'campsite'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_rate_mode_check'
  ) then
    alter table public.rooms
      add constraint rooms_rate_mode_check
      check (rate_mode in ('site', 'person', 'tent', 'vehicle', 'composite'));
  end if;
end $$;

create index if not exists rooms_lodge_kind_status_idx
  on public.rooms (lodge_id, accommodation_kind, status);

alter table public.bookings
  add column if not exists tents_count integer not null default 0,
  add column if not exists vehicles_count integer not null default 0,
  add column if not exists accommodation_kind text;

alter table public.settings
  add column if not exists public_offer_campsites boolean not null default true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Pricing helper
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.compute_accommodation_stay_total(
  p_room public.rooms,
  p_nights integer,
  p_adults integer default null,
  p_children integer default null,
  p_tents integer default null,
  p_vehicles integer default null
)
returns numeric
language plpgsql
stable
as $$
declare
  v_nights integer := greatest(coalesce(p_nights, 1), 1);
  v_people integer := greatest(coalesce(p_adults, 0), 0) + greatest(coalesce(p_children, 0), 0);
  v_tents integer := greatest(coalesce(p_tents, 0), 0);
  v_vehicles integer := greatest(coalesce(p_vehicles, 0), 0);
  v_mode text := lower(coalesce(p_room.rate_mode, 'site'));
  v_site numeric := greatest(coalesce(p_room.rate_per_night, 0), 0);
  v_person numeric := greatest(coalesce(p_room.rate_per_person, 0), 0);
  v_tent numeric := greatest(coalesce(p_room.rate_per_tent, 0), 0);
  v_vehicle numeric := greatest(coalesce(p_room.rate_per_vehicle, 0), 0);
  v_total numeric := 0;
begin
  -- Default people for person-based campsite quotes when guest count is unknown.
  if v_people <= 0 and v_mode in ('person', 'composite') then
    v_people := greatest(coalesce(p_room.capacity_adults, p_room.max_occupancy, 2), 1);
  end if;
  if v_tents <= 0 and v_mode in ('tent', 'composite') and lower(coalesce(p_room.accommodation_kind, 'room')) = 'campsite' then
    v_tents := 1;
  end if;
  if v_vehicles <= 0 and v_mode = 'vehicle' then
    v_vehicles := 1;
  end if;

  v_total := case v_mode
    when 'person' then v_person * v_people * v_nights
    when 'tent' then v_tent * greatest(v_tents, 1) * v_nights
    when 'vehicle' then v_vehicle * greatest(v_vehicles, 1) * v_nights
    when 'composite' then
      (v_site * v_nights)
      + (v_person * v_people * v_nights)
      + (v_tent * v_tents * v_nights)
      + (v_vehicle * v_vehicles * v_nights)
    else v_site * v_nights -- site (default)
  end;

  return round(greatest(v_total, 0), 2);
end;
$$;

create or replace function public._normalize_accommodation_kind(p_kind text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_kind, 'room')))
    when 'campsite' then 'campsite'
    when 'site' then 'campsite'
    when 'camp site' then 'campsite'
    when 'tent' then 'tent'
    when 'unit' then 'unit'
    when 'cabin' then 'unit'
    when 'chalet' then 'unit'
    else 'room'
  end;
$$;

create or replace function public._normalize_rate_mode(p_mode text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_mode, 'site')))
    when 'person' then 'person'
    when 'per_person' then 'person'
    when 'tent' then 'tent'
    when 'per_tent' then 'tent'
    when 'vehicle' then 'vehicle'
    when 'per_vehicle' then 'vehicle'
    when 'composite' then 'composite'
    else 'site'
  end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. create_room / update_room with campsite fields
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.create_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_room_type_id uuid := nullif(payload->>'room_type_id', '')::uuid;
  v_floor_section_id uuid := nullif(payload->>'floor_section_id', '')::uuid;
  v_status text := coalesce(nullif(payload->>'status', ''), 'available');
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Accommodation created under maintenance');
  v_existing boolean;
  v_kind text := public._normalize_accommodation_kind(payload->>'accommodation_kind');
  v_rate_mode text := public._normalize_rate_mode(payload->>'rate_mode');
  v_max_occ integer := coalesce((payload->>'max_occupancy')::integer, (payload->>'capacity_adults')::integer, 2);
  v_cap_adults integer := coalesce((payload->>'capacity_adults')::integer, v_max_occ, 2);
  v_cap_children integer := greatest(coalesce((payload->>'capacity_children')::integer, 0), 0);
  v_max_tents integer := nullif(payload->>'max_tents', '')::integer;
  v_max_vehicles integer := nullif(payload->>'max_vehicles', '')::integer;
begin
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id is required');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if nullif(btrim(coalesce(payload->>'room_number', '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Site/room number is required');
  end if;

  if v_max_occ < 1 or v_cap_adults < 1 then
    return jsonb_build_object('success', false, 'error', 'Capacity must be at least 1 adult');
  end if;

  if v_room_type_id is not null and not exists (
    select 1 from public.room_types rt
    where rt.id = v_room_type_id and rt.lodge_id = v_lodge_id and rt.active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid room type for this lodge');
  end if;

  if v_floor_section_id is not null and not exists (
    select 1 from public.floor_sections fs
    where fs.id = v_floor_section_id and fs.lodge_id = v_lodge_id and fs.active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid floor or section for this lodge');
  end if;

  if v_kind = 'campsite' then
    v_max_tents := coalesce(v_max_tents, 1);
    v_max_vehicles := coalesce(v_max_vehicles, 1);
  end if;

  select exists (
    select 1 from public.rooms r where r.id = v_id and r.lodge_id = v_lodge_id
  ) into v_existing;

  if not v_existing then
    insert into public.rooms (
      id, lodge_id, room_number, room_type, room_type_id, floor_section_id,
      rate_per_night, max_occupancy, status, description, photo, photos, amenities,
      accommodation_kind, capacity_adults, capacity_children, max_tents, max_vehicles,
      is_powered, site_surface, shared_facilities, rate_mode,
      rate_per_person, rate_per_tent, rate_per_vehicle, updated_at
    ) values (
      v_id, v_lodge_id, payload->>'room_number', payload->>'room_type', v_room_type_id, v_floor_section_id,
      coalesce((payload->>'rate_per_night')::numeric, 0),
      v_max_occ,
      v_status,
      coalesce(payload->>'description', ''),
      coalesce(payload->>'photo', ''),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
        case when payload->>'photo' is not null and payload->>'photo' <> ''
          then array[payload->>'photo'] else '{}'::text[] end
      ),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
        '{}'::text[]
      ),
      v_kind,
      v_cap_adults,
      v_cap_children,
      v_max_tents,
      v_max_vehicles,
      coalesce((payload->>'is_powered')::boolean, false),
      nullif(btrim(coalesce(payload->>'site_surface', '')), ''),
      coalesce((payload->>'shared_facilities')::boolean, false),
      v_rate_mode,
      coalesce((payload->>'rate_per_person')::numeric, 0),
      coalesce((payload->>'rate_per_tent')::numeric, 0),
      coalesce((payload->>'rate_per_vehicle')::numeric, 0),
      now()
    );
  end if;

  if v_status = 'maintenance' and not exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = v_lodge_id and mt.room_id = v_id and mt.status <> 'resolved'
  ) then
    insert into public.maintenance_tickets (
      id, lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) values (
      v_ticket_id, v_lodge_id, v_id, v_issue,
      coalesce(payload->>'maintenance_description', ''),
      coalesce(nullif(payload->>'maintenance_priority', ''), 'medium'),
      'open', current_date, coalesce(payload->>'maintenance_description', ''), 0, 0, 0
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'maintenance_ticket_id', case when v_status = 'maintenance' then v_ticket_id else null end,
    'idempotent', v_existing
  );
end;
$$;

create or replace function public.update_room(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current public.rooms%rowtype;
  v_room_type_id uuid := nullif(payload->>'room_type_id', '')::uuid;
  v_floor_section_id uuid := nullif(payload->>'floor_section_id', '')::uuid;
  v_status text;
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Accommodation marked under maintenance');
  v_kind text;
  v_rate_mode text;
begin
  if p_id is null or p_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  end if;

  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select * into v_current
  from public.rooms r
  where r.id = p_id and r.lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;
  if p_expected_updated_at is not null and v_current.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false, 'error', 'conflict', 'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  if v_room_type_id is not null and not exists (
    select 1 from public.room_types rt
    where rt.id = v_room_type_id and rt.lodge_id = p_lodge_id and rt.active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid room type for this lodge');
  end if;

  if v_floor_section_id is not null and not exists (
    select 1 from public.floor_sections fs
    where fs.id = v_floor_section_id and fs.lodge_id = p_lodge_id and fs.active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid floor or section for this lodge');
  end if;

  v_status := case
    when payload ? 'status' then coalesce(nullif(payload->>'status', ''), 'available')
    else v_current.status
  end;

  if v_status <> 'maintenance' and exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_id and mt.status <> 'resolved'
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Resolve the open maintenance ticket before changing this room status.'
    );
  end if;

  v_kind := case
    when payload ? 'accommodation_kind'
      then public._normalize_accommodation_kind(payload->>'accommodation_kind')
    else v_current.accommodation_kind
  end;
  v_rate_mode := case
    when payload ? 'rate_mode'
      then public._normalize_rate_mode(payload->>'rate_mode')
    else v_current.rate_mode
  end;

  update public.rooms
  set room_number = case when payload ? 'room_number' then payload->>'room_number' else room_number end,
      room_type = case when payload ? 'room_type' then payload->>'room_type' else room_type end,
      room_type_id = case when payload ? 'room_type_id' then v_room_type_id else room_type_id end,
      floor_section_id = case when payload ? 'floor_section_id' then v_floor_section_id else floor_section_id end,
      rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end,
      max_occupancy = case when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, 2) else max_occupancy end,
      status = v_status,
      description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end,
      photo = case when payload ? 'photo' then coalesce(payload->>'photo', '') else photo end,
      photos = case when payload ? 'photos' then coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x), '{}'::text[]
      ) else photos end,
      amenities = case when payload ? 'amenities' then coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x), '{}'::text[]
      ) else amenities end,
      accommodation_kind = v_kind,
      capacity_adults = case
        when payload ? 'capacity_adults' then coalesce((payload->>'capacity_adults')::integer, max_occupancy)
        when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, max_occupancy)
        else capacity_adults
      end,
      capacity_children = case when payload ? 'capacity_children' then greatest(coalesce((payload->>'capacity_children')::integer, 0), 0) else capacity_children end,
      max_tents = case when payload ? 'max_tents' then nullif(payload->>'max_tents', '')::integer else max_tents end,
      max_vehicles = case when payload ? 'max_vehicles' then nullif(payload->>'max_vehicles', '')::integer else max_vehicles end,
      is_powered = case when payload ? 'is_powered' then coalesce((payload->>'is_powered')::boolean, false) else is_powered end,
      site_surface = case when payload ? 'site_surface' then nullif(btrim(coalesce(payload->>'site_surface', '')), '') else site_surface end,
      shared_facilities = case when payload ? 'shared_facilities' then coalesce((payload->>'shared_facilities')::boolean, false) else shared_facilities end,
      rate_mode = v_rate_mode,
      rate_per_person = case when payload ? 'rate_per_person' then coalesce((payload->>'rate_per_person')::numeric, 0) else rate_per_person end,
      rate_per_tent = case when payload ? 'rate_per_tent' then coalesce((payload->>'rate_per_tent')::numeric, 0) else rate_per_tent end,
      rate_per_vehicle = case when payload ? 'rate_per_vehicle' then coalesce((payload->>'rate_per_vehicle')::numeric, 0) else rate_per_vehicle end,
      updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if v_status = 'maintenance' and not exists (
    select 1 from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id and mt.room_id = p_id and mt.status <> 'resolved'
  ) then
    insert into public.maintenance_tickets (
      id, lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) values (
      v_ticket_id, p_lodge_id, p_id, v_issue,
      coalesce(payload->>'maintenance_description', ''),
      coalesce(nullif(payload->>'maintenance_priority', ''), 'medium'),
      'open', current_date, coalesce(payload->>'maintenance_description', ''), 0, 0, 0
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', p_id,
    'maintenance_ticket_id', case when v_status = 'maintenance' then v_ticket_id else null end
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Public availability includes campsite metadata + pricing modes
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_available_rooms(p_slug text, p_check_in date, p_check_out date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
  v_rooms jsonb;
  v_campsites jsonb;
  v_nights integer;
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

  select *
    into v_settings
  from public.settings
  where lower(btrim(coalesce(slug, ''))) = v_slug
    and coalesce(deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_lodge_id := v_settings.lodge_id;
  v_nights := p_check_out - p_check_in;
  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);
  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.room_number), '[]'::jsonb)
    into v_rooms
  from (
    select
      r.id,
      r.room_number,
      r.room_type,
      r.rate_per_night,
      r.max_occupancy,
      r.description,
      coalesce(r.photos, case when r.photo is not null and r.photo <> '' then array[r.photo] else '{}'::text[] end) as photos,
      coalesce(r.amenities, '{}'::text[]) as amenities,
      v_nights as nights,
      public.compute_accommodation_stay_total(r, v_nights) as total_price,
      coalesce(r.accommodation_kind, 'room') as accommodation_kind,
      coalesce(r.capacity_adults, r.max_occupancy) as capacity_adults,
      coalesce(r.capacity_children, 0) as capacity_children,
      r.max_tents,
      r.max_vehicles,
      coalesce(r.is_powered, false) as is_powered,
      r.site_surface,
      coalesce(r.shared_facilities, false) as shared_facilities,
      coalesce(r.rate_mode, 'site') as rate_mode,
      coalesce(r.rate_per_person, 0) as rate_per_person,
      coalesce(r.rate_per_tent, 0) as rate_per_tent,
      coalesce(r.rate_per_vehicle, 0) as rate_per_vehicle
    from public.rooms r
    where r.lodge_id = v_lodge_id
      and r.status not in ('maintenance')
      and coalesce(r.accommodation_kind, 'room') <> 'campsite'
      and coalesce(v_settings.public_offer_rooms, true) = true
      and not exists (
        select 1
        from public.bookings b
        where b.lodge_id = v_lodge_id
          and b.room_id = r.id
          and b.status not in ('cancelled', 'checked_out')
          and not (b.check_out <= p_check_in or b.check_in >= p_check_out)
      )
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.room_number), '[]'::jsonb)
    into v_campsites
  from (
    select
      r.id,
      r.room_number,
      r.room_type,
      r.rate_per_night,
      r.max_occupancy,
      r.description,
      coalesce(r.photos, case when r.photo is not null and r.photo <> '' then array[r.photo] else '{}'::text[] end) as photos,
      coalesce(r.amenities, '{}'::text[]) as amenities,
      v_nights as nights,
      public.compute_accommodation_stay_total(r, v_nights) as total_price,
      'campsite'::text as accommodation_kind,
      coalesce(r.capacity_adults, r.max_occupancy) as capacity_adults,
      coalesce(r.capacity_children, 0) as capacity_children,
      r.max_tents,
      r.max_vehicles,
      coalesce(r.is_powered, false) as is_powered,
      r.site_surface,
      coalesce(r.shared_facilities, false) as shared_facilities,
      coalesce(r.rate_mode, 'site') as rate_mode,
      coalesce(r.rate_per_person, 0) as rate_per_person,
      coalesce(r.rate_per_tent, 0) as rate_per_tent,
      coalesce(r.rate_per_vehicle, 0) as rate_per_vehicle
    from public.rooms r
    where r.lodge_id = v_lodge_id
      and r.status not in ('maintenance')
      and coalesce(r.accommodation_kind, 'room') = 'campsite'
      and coalesce(v_settings.public_offer_campsites, true) = true
      and not exists (
        select 1
        from public.bookings b
        where b.lodge_id = v_lodge_id
          and b.room_id = r.id
          and b.status not in ('cancelled', 'checked_out')
          and not (b.check_out <= p_check_in or b.check_in >= p_check_out)
      )
  ) x;

  return jsonb_build_object(
    'success', true,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', v_nights,
    'rooms', v_rooms,
    'campsites', v_campsites,
    -- Backward-compatible combined list for older clients
    'units', coalesce(v_rooms, '[]'::jsonb) || coalesce(v_campsites, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_available_rooms_summary(p_slug text, p_check_in date, p_check_out date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.get_available_rooms(p_slug, p_check_in, p_check_out);
end;
$$;

create or replace function public.get_public_booking_offers(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
  v_day_use public.day_use_config%rowtype;
  v_event_resources jsonb := '[]'::jsonb;
  v_has_campsites boolean := false;
  v_has_rooms boolean := false;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  select *
    into v_settings
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);
  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking is not available for this property');
  end if;

  select *
    into v_day_use
  from public.day_use_config duc
  where duc.lodge_id = v_settings.lodge_id
  limit 1;

  select exists (
    select 1 from public.rooms r
    where r.lodge_id = v_settings.lodge_id
      and coalesce(r.accommodation_kind, 'room') = 'campsite'
  ) into v_has_campsites;

  select exists (
    select 1 from public.rooms r
    where r.lodge_id = v_settings.lodge_id
      and coalesce(r.accommodation_kind, 'room') <> 'campsite'
  ) into v_has_rooms;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', resource_key,
    'name', resource_name_snapshot,
    'type', resource_type_snapshot
  ) order by resource_name_snapshot), '[]'::jsonb)
    into v_event_resources
  from (
    select distinct on (lower(resource_key))
      resource_key,
      coalesce(nullif(resource_name_snapshot, ''), resource_key) as resource_name_snapshot,
      coalesce(nullif(resource_type_snapshot, ''), 'venue') as resource_type_snapshot
    from public.event_booking_resources
    where lodge_id = v_settings.lodge_id
      and nullif(btrim(coalesce(resource_key, '')), '') is not null
    order by lower(resource_key), created_at desc
  ) resources;

  return jsonb_build_object(
    'success', true,
    'offers', jsonb_build_object(
      'rooms', coalesce(v_settings.public_offer_rooms, true) and v_has_rooms,
      'campsites', coalesce(v_settings.public_offer_campsites, true) and v_has_campsites,
      'multi_room', coalesce(v_settings.public_offer_multi_room, true),
      'full_lodge', coalesce(v_settings.public_offer_full_lodge, false),
      'day_use', coalesce(v_settings.public_offer_day_use, false)
        and coalesce(jsonb_array_length(coalesce(v_day_use.templates, '[]'::jsonb)), 0) > 0,
      'events', coalesce(v_settings.public_offer_events, false)
    ),
    'day_use', jsonb_build_object(
      'templates', coalesce(v_day_use.templates, '[]'::jsonb),
      'resources', coalesce(v_day_use.resources, '[]'::jsonb)
    ),
    'events', jsonb_build_object(
      'resources', v_event_resources
    )
  );
end;
$$;

revoke all on function public.create_room(jsonb) from public;
revoke all on function public.update_room(uuid, uuid, jsonb, timestamptz) from public;
revoke all on function public.get_available_rooms(text, date, date) from public;
revoke all on function public.get_available_rooms_summary(text, date, date) from public;
revoke all on function public.get_public_booking_offers(text) from public;

grant execute on function public.create_room(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_room(uuid, uuid, jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function public.get_available_rooms(text, date, date) to anon, authenticated, service_role;
grant execute on function public.get_available_rooms_summary(text, date, date) to anon, authenticated, service_role;
grant execute on function public.get_public_booking_offers(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
