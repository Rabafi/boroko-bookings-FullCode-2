-- Make room_booking_expected_total consult room_rate_overrides.
-- The create_booking RPC uses this function to validate total amounts.
-- Without this, overridden prices are silently rejected at the RPC level.

create or replace function public.room_booking_expected_total(
  p_lodge_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date
) returns numeric
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_rate numeric;
  v_override numeric;
begin
  if p_room_id is null or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return null;
  end if;

  select rate_per_night
    into v_rate
    from public.rooms
   where id = p_room_id
     and lodge_id = p_lodge_id
   limit 1;

  if not found then
    return null;
  end if;

  select rate_per_night
    into v_override
    from public.room_rate_overrides
   where lodge_id = p_lodge_id
     and room_id = p_room_id
     and start_date <= p_check_out
     and end_date >= p_check_in
   order by start_date desc
   limit 1;

  if v_override is not null then
    v_rate := v_override;
  end if;

  return round((coalesce(v_rate, 0) * (p_check_out - p_check_in))::numeric, 2);
end;
$$;

notify pgrst, 'reload schema';
