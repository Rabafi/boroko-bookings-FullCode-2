alter table public.rooms
  add column if not exists updated_at timestamptz;

update public.rooms
set updated_at = created_at
where updated_at is null;

create or replace function public.create_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.rooms where id = (payload->>'id')::uuid and lodge_id = (payload->>'lodge_id')::uuid) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  insert into public.rooms (
    id, lodge_id, room_number, room_type, rate_per_night, max_occupancy,
    status, description, photo, photos, amenities, updated_at
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
      case when payload->>'photo' is not null and payload->>'photo' <> ''
        then array[payload->>'photo'] else '{}'::text[] end
    ),
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
      '{}'::text[]
    ),
    now()
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.update_room(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
with target as (
  select id, updated_at
    from public.rooms
   where id = p_id
     and lodge_id = p_lodge_id
   for update
), updated as (
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
    end,
    updated_at = now()
  where id = p_id
    and lodge_id = p_lodge_id
    and exists (select 1 from target)
    and (
      p_expected_updated_at is null
      or (select updated_at from target) is not distinct from p_expected_updated_at
    )
  returning id
)
select case
  when not exists (select 1 from target) then
    jsonb_build_object('success', false, 'error', 'Room not found')
  when p_expected_updated_at is not null
    and (select updated_at from target) is distinct from p_expected_updated_at then
    jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    )
  else
    jsonb_build_object('success', true, 'id', (select id from updated limit 1))
end;
$$;

grant execute on function public.update_room(uuid, uuid, jsonb, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
