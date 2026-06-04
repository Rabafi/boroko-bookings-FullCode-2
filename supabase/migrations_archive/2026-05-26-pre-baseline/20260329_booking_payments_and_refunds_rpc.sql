create or replace function public.get_booking_payments(
  p_booking_id uuid,
  p_lodge_id uuid
) returns table (
  id uuid,
  booking_id uuid,
  lodge_id uuid,
  amount numeric,
  method text,
  type text,
  paid_at timestamptz,
  recorded_by uuid,
  notes text,
  created_at timestamptz,
  refund_base_amount numeric,
  refund_retained_percent numeric,
  refund_retained_amount numeric
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    p.id,
    p.booking_id,
    p.lodge_id,
    p.amount,
    p.method,
    p.type,
    p.paid_at,
    p.recorded_by,
    coalesce(p.notes, '') as notes,
    p.created_at,
    null::numeric as refund_base_amount,
    null::numeric as refund_retained_percent,
    null::numeric as refund_retained_amount
  from public.payments p
  where p.booking_id = p_booking_id
    and p.lodge_id = p_lodge_id
  order by p.paid_at desc, p.created_at desc;
$function$;

grant execute on function public.get_booking_payments(uuid, uuid) to anon, authenticated, service_role;

create or replace function public.record_booking_refund(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_retained_percent numeric default 0,
  p_method text default 'refund',
  p_notes text default '',
  p_recorded_by uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_paid numeric;
  v_retained_percent numeric;
  v_refund_amount numeric;
  v_retained_amount numeric;
  v_new_paid numeric;
  v_status text;
begin
  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
    and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_idempotency_key is not null then
    if exists (
      select 1
      from public.payments
      where idempotency_key = p_idempotency_key
    ) then
      return jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'amount_paid', coalesce(v_booking.amount_paid, 0),
        'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
        'idempotent', true
      );
    end if;
  end if;

  v_paid := greatest(coalesce(v_booking.amount_paid, 0), 0);
  if v_paid <= 0 then
    return jsonb_build_object('success', false, 'error', 'There is no paid balance available to refund');
  end if;

  v_retained_percent := greatest(0, least(100, coalesce(p_retained_percent, 0)));
  v_refund_amount := round((v_paid * ((100 - v_retained_percent) / 100.0))::numeric, 2);
  v_retained_amount := round((v_paid - v_refund_amount)::numeric, 2);

  if v_refund_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Retained percentage leaves nothing to refund');
  end if;

  v_new_paid := round(greatest(v_paid - v_refund_amount, 0)::numeric, 2);
  v_status := case
    when v_new_paid >= coalesce(v_booking.total_amount, 0) then 'paid'
    when v_new_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.bookings
  set amount_paid = v_new_paid,
      payment_status = v_status,
      payment_method = coalesce(nullif(p_method, ''), payment_method),
      updated_at = now()
  where id = p_booking_id
    and lodge_id = p_lodge_id;

  insert into public.payments (
    booking_id,
    lodge_id,
    amount,
    method,
    type,
    paid_at,
    recorded_by,
    notes,
    idempotency_key
  ) values (
    p_booking_id,
    p_lodge_id,
    -v_refund_amount,
    coalesce(nullif(p_method, ''), 'refund'),
    'refund',
    now(),
    p_recorded_by,
    concat(
      'Refunded ',
      v_refund_amount,
      ' | Retained ',
      v_retained_amount,
      ' (',
      v_retained_percent,
      '%)',
      case when coalesce(p_notes, '') <> '' then ' | ' || p_notes else '' end
    ),
    p_idempotency_key
  );

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'refund_amount', v_refund_amount,
    'retained_amount', v_retained_amount,
    'retained_percent', v_retained_percent,
    'amount_paid', v_new_paid,
    'payment_status', v_status
  );
end;
$function$;

grant execute on function public.record_booking_refund(uuid, uuid, numeric, text, text, uuid, text) to anon, authenticated, service_role;
