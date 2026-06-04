create or replace function public.create_room_rate_override(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.room_rate_overrides (
    lodge_id,
    room_id,
    name,
    start_date,
    end_date,
    rate_per_night
  ) values (
    (payload->>'lodge_id')::uuid,
    nullif(payload->>'room_id', '')::uuid,
    payload->>'name',
    (payload->>'start_date')::date,
    (payload->>'end_date')::date,
    coalesce((payload->>'rate_per_night')::numeric, 0)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_room_rate_override(jsonb) to anon, authenticated;

create or replace function public.update_room_rate_override(
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
  update public.room_rate_overrides
  set
    room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
    name = case when payload ? 'name' then payload->>'name' else name end,
    start_date = case when payload ? 'start_date' then (payload->>'start_date')::date else start_date end,
    end_date = case when payload ? 'end_date' then (payload->>'end_date')::date else end_date end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Rate override not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_room_rate_override(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_room_rate_override(
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
  delete from public.room_rate_overrides
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Rate override not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_room_rate_override(uuid, uuid) to anon, authenticated;
