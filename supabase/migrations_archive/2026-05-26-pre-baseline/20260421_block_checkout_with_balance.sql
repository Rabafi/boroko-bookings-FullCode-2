begin;

create or replace function public.update_booking_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_booking_status$
declare
  v_current_status text;
  v_room_id uuid;
  v_allowed boolean := false;
  v_room_status text;
  v_total_amount numeric := 0;
  v_charges_total numeric := 0;
  v_amount_paid numeric := 0;
  v_outstanding numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();

  select status, room_id, total_amount, coalesce(charges_total, 0), coalesce(amount_paid, 0)
    into v_current_status, v_room_id, v_total_amount, v_charges_total, v_amount_paid
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id;

  if v_current_status is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_allowed :=
    p_status = v_current_status
    or (v_current_status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_current_status = 'confirmed' and p_status in ('checked_in', 'cancelled'))
    or (v_current_status = 'checked_in' and p_status in ('checked_out'));

  if not v_allowed then
    return jsonb_build_object('success', false, 'error', format('Cannot transition booking from %s to %s', v_current_status, p_status));
  end if;

  if p_status = 'checked_out' then
    v_outstanding := greatest(0, coalesce(v_total_amount, 0) + coalesce(v_charges_total, 0) - coalesce(v_amount_paid, 0));
    if v_outstanding > 0 then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check out this guest until the full balance is paid. Outstanding balance: %s', round(v_outstanding::numeric, 2))
      );
    end if;
  end if;

  update public.bookings
     set status = p_status,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  v_room_status := case
    when p_status = 'checked_in' then 'occupied'
    when p_status in ('checked_out', 'cancelled') then 'available'
    else null
  end;

  if v_room_status is not null and v_room_id is not null then
    update public.rooms
       set status = v_room_status
     where id = v_room_id
       and lodge_id = p_lodge_id;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'status', p_status);
end;
$update_booking_status$;

notify pgrst, 'reload schema';

commit;
