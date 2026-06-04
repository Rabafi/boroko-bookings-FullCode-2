create or replace function public.add_booking_charge(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_description text,
  p_category text default 'other',
  p_quantity numeric default 1,
  p_unit_price numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_charge_id uuid;
  v_amount numeric;
begin
  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = p_booking_id
      and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_amount := coalesce(p_quantity, 1) * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id,
    lodge_id,
    description,
    category,
    quantity,
    unit_price,
    amount
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    coalesce(p_quantity, 1),
    coalesce(p_unit_price, 0),
    v_amount
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id);
end;
$function$;

grant execute on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric) to anon, authenticated;

create or replace function public.delete_booking_charge(
  p_charge_id uuid,
  p_lodge_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  delete from public.booking_charges
  where id = p_charge_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Charge not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_booking_charge(uuid, uuid) to anon, authenticated;
