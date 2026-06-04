alter table public.bookings
  add column if not exists vat_enabled boolean,
  add column if not exists vat_rate numeric(8,4);

create or replace function public.apply_booking_vat_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vat_enabled boolean := false;
  v_vat_rate numeric := 0;
begin
  if new.vat_enabled is not null and new.vat_rate is not null then
    return new;
  end if;

  select
    coalesce(s.vat_enabled, false),
    greatest(coalesce(s.vat_rate, 0), 0)
    into v_vat_enabled, v_vat_rate
  from public.settings s
  where s.lodge_id = new.lodge_id
  limit 1;

  new.vat_enabled := coalesce(new.vat_enabled, v_vat_enabled, false);
  new.vat_rate := round(coalesce(new.vat_rate, v_vat_rate, 0)::numeric, 4);
  return new;
end;
$function$;

drop trigger if exists trg_apply_booking_vat_snapshot on public.bookings;

create trigger trg_apply_booking_vat_snapshot
before insert on public.bookings
for each row
execute function public.apply_booking_vat_snapshot();

update public.bookings b
   set vat_enabled = coalesce(b.vat_enabled, s.vat_enabled, false),
       vat_rate = round(coalesce(b.vat_rate, greatest(coalesce(s.vat_rate, 0), 0), 0)::numeric, 4)
  from public.settings s
 where s.lodge_id = b.lodge_id
   and (b.vat_enabled is null or b.vat_rate is null);

update public.bookings
   set vat_enabled = coalesce(vat_enabled, false),
       vat_rate = round(coalesce(vat_rate, 0)::numeric, 4)
 where vat_enabled is null
    or vat_rate is null;

alter table public.bookings
  alter column vat_enabled set default false,
  alter column vat_enabled set not null,
  alter column vat_rate set default 0,
  alter column vat_rate set not null;

alter table public.bookings
  drop constraint if exists chk_bookings_vat_rate_non_negative;

alter table public.bookings
  add constraint chk_bookings_vat_rate_non_negative
  check (vat_rate >= 0);

drop function if exists public.create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, uuid, text, text);
drop function if exists public.create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, uuid, text, text, boolean);

create function public.create_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_total_amount numeric,
  p_invoice_number text default null,
  p_notes text default '',
  p_created_by uuid default null,
  p_deposit_amount numeric default 0,
  p_booking_id uuid default null,
  p_idempotency_key text default null,
  p_deposit_method text default null,
  p_allow_total_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_booking$
declare
  v_conflict int;
  v_existing_id uuid;
  v_id uuid := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result jsonb;
  v_expected_total numeric;
  v_total_amount numeric := round(coalesce(p_total_amount, 0)::numeric, 2);
begin
  perform public.app_reject_pwa_financial_mutation();

  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  v_expected_total := public.room_booking_expected_total(p_lodge_id, p_room_id, p_check_in, p_check_out);
  if v_expected_total is null then
    return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
  end if;

  if abs(v_total_amount - v_expected_total) > 0.01 then
    if p_allow_total_override then
      perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
    else
      return jsonb_build_object(
        'success', false,
        'error', format(
          'Booking total must match the room rate for this stay. Expected %s, received %s.',
          v_expected_total,
          v_total_amount
        )
      );
    end if;
  end if;

  if p_idempotency_key is not null then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.create_idempotency_key = p_idempotency_key
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if p_invoice_number is null and not v_is_existing then
    p_invoice_number := get_next_invoice_number(p_lodge_id);
  end if;

  if not v_is_existing then
    select count(*)
      into v_conflict
      from public.bookings
     where room_id = p_room_id
       and lodge_id = p_lodge_id
       and status != 'cancelled'
       and not (check_out <= p_check_in or check_in >= p_check_out);

    if v_conflict > 0 then
      return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end if;

    insert into public.bookings (
      id, lodge_id, customer_id, room_id,
      check_in, check_out, adults, children,
      total_amount, amount_paid, payment_status,
      status, invoice_number, notes, created_by,
      deposit_amount, payment_method,
      created_at, updated_at, create_idempotency_key
    ) values (
      v_id, p_lodge_id, p_customer_id, p_room_id,
      p_check_in, p_check_out, p_adults, p_children,
      v_total_amount, 0, 'unpaid',
      'confirmed', p_invoice_number, p_notes, p_created_by,
      p_deposit_amount, null,
      now(), now(), p_idempotency_key
    );

    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
    values (v_id, p_lodge_id, p_invoice_number, now())
    on conflict do nothing;
  end if;

  if p_deposit_amount > 0 and p_deposit_method is not null then
    select public.update_booking_payment(
      v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
      'deposit', 'payment:deposit:' || v_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        return jsonb_build_object(
          'success', true,
          'booking_id', v_id,
          'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      end if;

      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$create_booking$;

grant execute on function public.create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, uuid, text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
