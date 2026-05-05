-- Conference Booking Payment Collection
-- Enables delta-based payment collection for conference bookings
-- with idempotency, server-derived payment_status, and ledger entries

begin;

-- 1. Extend payments table to support conference bookings
alter table public.payments
  add column if not exists conference_booking_id uuid references public.conference_bookings(id) on delete cascade,
  alter column booking_id drop not null;

-- 2. RPC: update_conference_booking_payment
create or replace function public.update_conference_booking_payment(
  p_id               uuid,
  p_lodge_id         uuid,
  p_amount           numeric,
  p_method           text,
  p_type             text    default 'payment',
  p_idempotency_key  text    default null,
  p_recorded_by      uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_conf_payment$
declare
  v_current    public.conference_bookings%rowtype;
  v_new_deposit numeric;
  v_new_status  text;
  v_actor       uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a payment.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment idempotency key is required');
  end if;

  select *
    into v_current
    from public.conference_bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'deposit_paid', coalesce(v_current.deposit_paid, 0),
      'payment_status', coalesce(v_current.payment_status, 'pending'),
      'idempotent', true
    );
  end if;

  v_new_deposit := round((coalesce(v_current.deposit_paid, 0) + p_amount)::numeric, 2);

  if v_new_deposit < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Adjustment of %s would reduce deposit paid below zero (current: %s).',
        round(p_amount::numeric, 2),
        round(coalesce(v_current.deposit_paid, 0)::numeric, 2)
      )
    );
  end if;

  if v_new_deposit > coalesce(v_current.total_amount, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Payment of %s would overpay this conference booking. Total: %s, already deposited: %s.',
        round(p_amount::numeric, 2),
        coalesce(v_current.total_amount, 0),
        round(coalesce(v_current.deposit_paid, 0)::numeric, 2)
      )
    );
  end if;

  v_new_status := public.compute_conference_payment_status(v_new_deposit, v_current.total_amount);

  update public.conference_bookings
     set deposit_paid = v_new_deposit,
         payment_status = v_new_status,
         payment_method = coalesce(p_method, payment_method)
   where id = p_id
     and lodge_id = p_lodge_id;

  begin
    insert into public.payments (
      conference_booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, idempotency_key
    ) values (
      p_id, p_lodge_id, p_amount, p_method, p_type,
      now(), v_actor, p_idempotency_key
    );
  exception
    when unique_violation then
      select deposit_paid, payment_status
        into v_new_deposit, v_new_status
        from public.conference_bookings
       where id = p_id
         and lodge_id = p_lodge_id;
      return jsonb_build_object(
        'success', true,
        'deposit_paid', coalesce(v_new_deposit, 0),
        'payment_status', coalesce(v_new_status, 'pending'),
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'success', true,
    'deposit_paid', v_new_deposit,
    'payment_status', v_new_status
  );
end;
$update_conf_payment$;

grant execute on function public.update_conference_booking_payment(uuid, uuid, numeric, text, text, text, uuid) to anon, authenticated, service_role;

commit;
