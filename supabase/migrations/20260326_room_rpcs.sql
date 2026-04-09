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
    description
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'room_number',
    payload->>'room_type',
    coalesce((payload->>'rate_per_night')::numeric, 0),
    coalesce((payload->>'max_occupancy')::integer, 2),
    coalesce(payload->>'status', 'available'),
    coalesce(payload->>'description', '')
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
    description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end
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

create or replace function public.update_room_housekeeping(
  p_id uuid,
  p_lodge_id uuid,
  p_status text,
  p_notes text default ''
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
    housekeeping_status = coalesce(p_status, 'clean'),
    housekeeping_notes = coalesce(p_notes, '')
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_room_housekeeping(uuid, uuid, text, text) to anon, authenticated;

create or replace function public.set_room_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text
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
  set status = p_status
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.set_room_status(uuid, uuid, text) to anon, authenticated;

create or replace function public.delete_room(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  delete from public.rooms
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_room(uuid, uuid) to anon, authenticated;
