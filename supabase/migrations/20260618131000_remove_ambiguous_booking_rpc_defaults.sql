-- The baseline kept default values on overloads that coexist with shorter
-- signatures. PostgreSQL can treat internal calls as ambiguous. Keep the
-- signatures, but require the concurrency argument explicitly.

drop function if exists public.update_booking(uuid, uuid, jsonb, timestamptz);

create or replace function public.update_booking(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.update_booking(
    p_id,
    p_lodge_id,
    case
      when p_expected_updated_at is null then coalesce(payload, '{}'::jsonb)
      else coalesce(payload, '{}'::jsonb) || jsonb_build_object('expected_updated_at', p_expected_updated_at)
    end
  );
end;
$$;

drop function if exists public.update_booking_status(uuid, uuid, text, timestamptz);

create or replace function public.update_booking_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking public.bookings%rowtype;
  v_allowed boolean := false;
  v_room_status text;
  v_outstanding numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_booking
    from public.bookings
   where id::text = p_id::text
     and lodge_id::text = p_lodge_id::text
   for update;

  if v_booking.id is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  v_allowed :=
    p_status = v_booking.status
    or (v_booking.status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_booking.status = 'confirmed' and p_status in ('checked_in', 'cancelled'))
    or (v_booking.status = 'checked_in' and p_status in ('checked_out'));

  if not v_allowed then
    return jsonb_build_object(
      'success', false,
      'error', format('Cannot transition booking from %s to %s', v_booking.status, p_status)
    );
  end if;

  if p_status = 'checked_in' then
    if v_booking.check_in > current_date then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check in before the check-in date (%s).', v_booking.check_in)
      );
    end if;
    perform public.app_check_room_maintenance(p_lodge_id, v_booking.room_id);
  end if;

  if p_status = 'checked_out' then
    v_outstanding := greatest(
      0,
      coalesce(v_booking.total_amount, 0)
        + coalesce(v_booking.charges_total, 0)
        - coalesce(v_booking.amount_paid, 0)
    );
    if v_outstanding > 0 then
      return jsonb_build_object(
        'success', false,
        'error', format(
          'Cannot check out this guest until the full balance is paid. Outstanding balance: %s',
          round(v_outstanding::numeric, 2)
        )
      );
    end if;
  end if;

  update public.bookings
     set status = p_status,
         updated_at = now()
   where id::text = p_id::text
     and lodge_id::text = p_lodge_id::text;

  v_room_status := case
    when p_status = 'checked_in' then 'occupied'
    when p_status in ('checked_out', 'cancelled') then 'available'
    else null
  end;

  if v_room_status is not null and v_booking.room_id is not null then
    update public.rooms
       set status = v_room_status
     where id::text = v_booking.room_id::text
       and lodge_id::text = p_lodge_id::text;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'status', p_status);
end;
$$;

revoke all on function public.update_booking(uuid, uuid, jsonb, timestamptz) from public;
grant execute on function public.update_booking(uuid, uuid, jsonb, timestamptz)
  to anon, authenticated, service_role;

revoke all on function public.update_booking_status(uuid, uuid, text, timestamptz) from public;
grant execute on function public.update_booking_status(uuid, uuid, text, timestamptz)
  to anon, authenticated, service_role;
