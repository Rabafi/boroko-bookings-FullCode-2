create or replace function public.create_conference_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.conference_bookings (
    lodge_id,
    booking_date,
    start_time,
    end_time,
    client_name,
    company,
    attendees,
    setup_type,
    room_name,
    includes_catering,
    catering_notes,
    total_amount,
    deposit_paid,
    payment_status,
    payment_method,
    notes
  ) values (
    (payload->>'lodge_id')::uuid,
    (payload->>'booking_date')::date,
    payload->>'start_time',
    payload->>'end_time',
    payload->>'client_name',
    nullif(payload->>'company', ''),
    coalesce((payload->>'attendees')::integer, 0),
    coalesce(payload->>'setup_type', 'Theatre'),
    coalesce(payload->>'room_name', 'Conference Room'),
    coalesce((payload->>'includes_catering')::boolean, false),
    nullif(payload->>'catering_notes', ''),
    coalesce((payload->>'total_amount')::numeric, 0),
    coalesce((payload->>'deposit_paid')::numeric, 0),
    coalesce(payload->>'payment_status', 'pending'),
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_conference_booking(jsonb) to anon, authenticated;

create or replace function public.update_conference_booking(
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
  update public.conference_bookings
  set
    booking_date = case when payload ? 'booking_date' then (payload->>'booking_date')::date else booking_date end,
    start_time = case when payload ? 'start_time' then payload->>'start_time' else start_time end,
    end_time = case when payload ? 'end_time' then payload->>'end_time' else end_time end,
    client_name = case when payload ? 'client_name' then payload->>'client_name' else client_name end,
    company = case when payload ? 'company' then nullif(payload->>'company', '') else company end,
    attendees = case when payload ? 'attendees' then coalesce((payload->>'attendees')::integer, 0) else attendees end,
    setup_type = case when payload ? 'setup_type' then coalesce(payload->>'setup_type', 'Theatre') else setup_type end,
    room_name = case when payload ? 'room_name' then coalesce(payload->>'room_name', 'Conference Room') else room_name end,
    includes_catering = case when payload ? 'includes_catering' then coalesce((payload->>'includes_catering')::boolean, false) else includes_catering end,
    catering_notes = case when payload ? 'catering_notes' then nullif(payload->>'catering_notes', '') else catering_notes end,
    total_amount = case when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0) else total_amount end,
    deposit_paid = case when payload ? 'deposit_paid' then coalesce((payload->>'deposit_paid')::numeric, 0) else deposit_paid end,
    payment_status = case when payload ? 'payment_status' then coalesce(payload->>'payment_status', 'pending') else payment_status end,
    payment_method = case when payload ? 'payment_method' then nullif(payload->>'payment_method', '') else payment_method end,
    notes = case when payload ? 'notes' then nullif(payload->>'notes', '') else notes end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_conference_booking(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_conference_booking(
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
  delete from public.conference_bookings
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_conference_booking(uuid, uuid) to anon, authenticated;
