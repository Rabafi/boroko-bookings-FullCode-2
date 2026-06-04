create or replace function public.update_booking(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_booking$
declare
  v_current public.bookings%rowtype;
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_new_total numeric;
  v_new_status text;
  v_conflict uuid;
  v_total_owed numeric;
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_expected_total numeric;
  v_total_relevant_changed boolean := (payload ? 'total_amount') or (payload ? 'room_id') or (payload ? 'check_in') or (payload ? 'check_out');
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_next_updated_at timestamptz := coalesce(nullif(payload->>'updated_at', '')::timestamptz, now());
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_current
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if v_expected_updated_at is not null and v_current.updated_at is distinct from v_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was modified on another device. Refresh and try again.',
      'code', 'BOOKING_CONFLICT',
      'current_updated_at', v_current.updated_at
    );
  end if;

  v_room_id := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  v_new_total := round((
    case
      when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0)
      else v_current.total_amount
    end
  )::numeric, 2);

  if v_new_total < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  if v_total_relevant_changed and not coalesce(v_current.is_exclusive_event, false) then
    v_expected_total := public.room_booking_expected_total(p_lodge_id, v_room_id, v_check_in, v_check_out);
    if v_expected_total is null then
      return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
    end if;

    if abs(v_new_total - v_expected_total) > 0.01 then
      if v_allow_total_override then
        perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
      else
        return jsonb_build_object(
          'success', false,
          'error', format(
            'Booking total must match the room rate for this stay. Expected %s, received %s.',
            v_expected_total,
            v_new_total
          )
        );
      end if;
    end if;
  end if;

  v_total_owed := v_new_total + coalesce(v_current.charges_total, 0);
  if v_total_owed < coalesce(v_current.amount_paid, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Cannot reduce booking total to %s: guest has already paid %s. Record a refund first, then adjust the total.',
        round(v_new_total::numeric, 2),
        round(coalesce(v_current.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  select b.id
    into v_conflict
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.room_id = v_room_id
     and b.id <> p_id
     and b.status <> 'cancelled'
     and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
   limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  v_new_status := public.compute_payment_status(
    coalesce(v_current.amount_paid, 0),
    v_new_total,
    coalesce(v_current.charges_total, 0)
  );

  update public.bookings
     set customer_id = coalesce((payload->>'customer_id')::uuid, customer_id),
         room_id = v_room_id,
         check_in = v_check_in,
         check_out = v_check_out,
         adults = case when payload ? 'adults' then coalesce((payload->>'adults')::int, 1) else adults end,
         children = case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else children end,
         total_amount = v_new_total,
         payment_status = v_new_status,
         notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         updated_at = v_next_updated_at
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status, 'updated_at', v_next_updated_at);
end;
$update_booking$;

notify pgrst, 'reload schema';
