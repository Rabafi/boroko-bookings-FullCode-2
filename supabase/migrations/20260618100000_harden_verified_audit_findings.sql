-- Harden only audit findings verified against the current schema.

-- Staff management: preserve first-admin setup, then require admin/super_admin.
create or replace function public.create_user(payload jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_email text;
  v_outlet_ids uuid[];
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_role text := lower(coalesce(payload->>'role', 'receptionist'));
  v_status text := lower(coalesce(payload->>'status', 'active'));
  v_auth_user_id uuid := nullif(payload->>'auth_user_id', '')::uuid;
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(payload->>'pwa_password_hash', '');
  v_pwa_disabled_reason text := nullif(payload->>'pwa_disabled_reason', '');
  v_pwa_password_reset_by uuid := nullif(payload->>'pwa_password_reset_by', '')::uuid;
begin
  if exists (
    select 1 from public.users
     where id = (payload->>'id')::uuid
       and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  if exists (select 1 from public.users where lodge_id = v_lodge_id) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'super_admin']);
  end if;

  if v_status not in ('active', 'suspended', 'archived') then
    v_status := 'active';
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1 from public.users
     where lodge_id = v_lodge_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;

  if v_auth_user_id is not null and exists (
    select 1 from public.users
     where lodge_id = v_lodge_id
       and auth_user_id = v_auth_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'That Supabase Auth account is already linked to a user in this lodge.');
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if v_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cashier and supervisor roles require at least one outlet assignment.');
  end if;

  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object('success', false, 'error', 'Only Manager and Admin roles can receive Manager PWA access.');
  end if;

  insert into public.users (
    id, auth_user_id, lodge_id, name, email, password_hash, role, status,
    allowed_outlet_ids, pin_hash, capability_overrides,
    pwa_enabled, pwa_password_hash, pwa_password_set_at,
    pwa_password_reset_by, pwa_disabled_reason
  ) values (
    (payload->>'id')::uuid,
    v_auth_user_id,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    v_role,
    v_status,
    v_outlet_ids,
    nullif(payload->>'pin_hash', ''),
    coalesce(payload->'capability_overrides', '{}'::jsonb),
    v_pwa_enabled,
    v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case when v_pwa_password_hash is not null then v_pwa_password_reset_by else null end,
    case when v_pwa_enabled then null else coalesce(v_pwa_disabled_reason, 'Manager PWA access has been turned off.') end
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'auth_user_id', v_auth_user_id);
end;
$$;

create or replace function public.update_user_profile(p_id uuid, p_lodge_id uuid, payload jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
  v_email text;
  v_outlet_ids uuid[];
  v_current_role text;
  v_current_outlets uuid[];
  v_pin_hash text;
  v_next_status text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);

  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1 from public.users
       where lodge_id = p_lodge_id
         and lower(btrim(email)) = v_email
         and id <> p_id
    ) then
      return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists.', v_email));
    end if;
  end if;

  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[])
      into v_outlet_ids
      from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;
  end if;

  select role, allowed_outlet_ids
    into v_current_role, v_current_outlets
    from public.users
   where id = p_id and lodge_id = p_lodge_id;

  if lower(coalesce(nullif(payload->>'role', ''), v_current_role, '')) in ('cashier', 'supervisor')
     and cardinality(coalesce(case when payload ? 'allowed_outlet_ids' then v_outlet_ids else v_current_outlets end, '{}'::uuid[])) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cashier and supervisor roles require at least one outlet assignment.');
  end if;

  if payload ? 'pin_hash' then
    v_pin_hash := nullif(payload->>'pin_hash', '');
  end if;

  if payload ? 'status' then
    v_next_status := lower(coalesce(payload->>'status', 'active'));
    if v_next_status not in ('active', 'suspended', 'archived') then
      return jsonb_build_object('success', false, 'error', 'Invalid staff status.');
    end if;
  end if;

  update public.users
     set name = coalesce(nullif(payload->>'name', ''), name),
         email = coalesce(v_email, email),
         role = coalesce(nullif(payload->>'role', ''), role),
         status = coalesce(v_next_status, status),
         pin_hash = case when payload ? 'pin_hash' then v_pin_hash else pin_hash end,
         allowed_outlet_ids = case when payload ? 'allowed_outlet_ids' then v_outlet_ids else allowed_outlet_ids end,
         capability_overrides = case when payload ? 'capability_overrides' then coalesce(payload->'capability_overrides', '{}'::jsonb) else capability_overrides end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

create or replace function public.set_user_password(p_id uuid, p_lodge_id uuid, p_password_hash text) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);
  update public.users
     set password_hash = p_password_hash,
         password_updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;
  if v_updated is null then return jsonb_build_object('success', false, 'error', 'User not found'); end if;
  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

create or replace function public.set_user_pwa_access(
  p_id uuid,
  p_lodge_id uuid,
  p_enabled boolean,
  p_password_hash text default null,
  p_disabled_reason text default null,
  p_reset_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user public.users%rowtype;
  v_password_hash text := nullif(btrim(coalesce(p_password_hash, '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);
  select * into v_user from public.users where id = p_id and lodge_id = p_lodge_id limit 1 for update;
  if v_user.id is null then return jsonb_build_object('success', false, 'error', 'User not found'); end if;
  if not public._is_pwa_role_eligible(v_user.role) then return jsonb_build_object('success', false, 'error', 'Only manager and admin roles can receive Manager PWA access.'); end if;
  if p_enabled and coalesce(v_password_hash, nullif(btrim(coalesce(v_user.pwa_password_hash, '')), '')) is null then return jsonb_build_object('success', false, 'error', 'Set a separate Manager PWA password before enabling mobile access.'); end if;

  update public.users
     set pwa_enabled = p_enabled,
         pwa_password_hash = case when v_password_hash is not null then v_password_hash else pwa_password_hash end,
         pwa_password_set_at = case when v_password_hash is not null then now() else pwa_password_set_at end,
         pwa_password_reset_by = case when v_password_hash is not null then p_reset_by else pwa_password_reset_by end,
         pwa_disabled_reason = case when p_enabled then null else coalesce(nullif(btrim(coalesce(p_disabled_reason, '')), ''), 'Manager PWA access disabled.') end
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'pwa_enabled', p_enabled);
end;
$$;

create or replace function public.delete_user(p_id uuid, p_lodge_id uuid) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);
  delete from public.users where id = p_id and lodge_id = p_lodge_id returning id into v_deleted;
  if v_deleted is null then return jsonb_build_object('success', false, 'error', 'User not found'); end if;
  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;

-- Disable the unsafe non-idempotent booking and payment overloads.
create or replace function public.create_booking(
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
  p_deposit_amount numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);
  return jsonb_build_object('success', false, 'error', 'Legacy create_booking overload is disabled. Use the idempotent create_booking overload with booking_id and idempotency_key.');
end;
$$;

create or replace function public.create_booking(
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
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.create_booking(
    p_lodge_id, p_customer_id, p_room_id, p_check_in, p_check_out, p_adults, p_children,
    p_total_amount, p_invoice_number, p_notes, p_created_by, p_deposit_amount,
    p_booking_id, p_idempotency_key, null, false
  );
end;
$$;

create or replace function public.create_booking(
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
  p_deposit_method text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.create_booking(
    p_lodge_id, p_customer_id, p_room_id, p_check_in, p_check_out, p_adults, p_children,
    p_total_amount, p_invoice_number, p_notes, p_created_by, p_deposit_amount,
    p_booking_id, p_idempotency_key, p_deposit_method, false
  );
end;
$$;

create or replace function public.create_booking(
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
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);

  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Booking idempotency key is required');
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
        'error', format('Booking total must match the room rate for this stay. Expected %s, received %s.', v_expected_total, v_total_amount)
      );
    end if;
  end if;

  select b.id into v_existing_id
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.create_idempotency_key = p_idempotency_key
   limit 1;
  if found then
    v_id := v_existing_id;
    v_is_existing := true;
  end if;

  if not v_is_existing then
    select b.id into v_existing_id
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
    p_invoice_number := public.get_next_invoice_number(p_lodge_id);
  end if;

  if not v_is_existing then
    select count(*) into v_conflict
      from public.bookings
     where room_id = p_room_id
       and lodge_id = p_lodge_id
       and status != 'cancelled'
       and not (check_out <= p_check_in or check_in >= p_check_out);

    if v_conflict > 0 then
      return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end if;

    begin
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
    exception
      when exclusion_violation then
        return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
      when unique_violation then
        select b.id into v_existing_id
          from public.bookings b
         where b.lodge_id = p_lodge_id
           and b.create_idempotency_key = p_idempotency_key
         limit 1;
        if found then
          v_id := v_existing_id;
          v_is_existing := true;
        else
          raise;
        end if;
    end;

    if not v_is_existing then
      insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
      values (v_id, p_lodge_id, p_invoice_number, now())
      on conflict do nothing;
    end if;
  end if;

  if p_deposit_amount > 0 and p_deposit_method is not null then
    select public.update_booking_payment(
      v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
      'deposit', 'payment:deposit:' || v_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        return jsonb_build_object('success', true, 'booking_id', v_id, 'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded'));
      end if;

      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$$;

create or replace function public.update_booking_payment(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_amount numeric,
  p_method text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);
  return jsonb_build_object('success', false, 'error', 'Legacy payment overload is disabled. Use update_booking_payment with type and idempotency_key.');
end;
$$;

-- Refund approval no longer writes amount_paid directly; record_booking_refund owns the payment ledger delta.
create or replace function public.approve_booking_refund(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_retained_percent numeric default 0,
  p_method text default 'refund',
  p_notes text default '',
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_proof_reference text default '',
  p_approval_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking public.bookings%rowtype;
  v_after public.bookings%rowtype;
  v_approver_role text;
  v_refund jsonb;
  v_should_cancel boolean := false;
  v_effective_status text;
  v_retained_amount numeric := 0;
  v_settled_total numeric := 0;
  v_final_payment_status text := 'unpaid';
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if p_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval is required');
  end if;

  select role into v_approver_role
    from public.users
   where id = p_approved_by
     and lodge_id = p_lodge_id
   limit 1;

  if coalesce(v_approver_role, '') not in ('manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Approver does not have refund approval rights');
  end if;

  select * into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object('success', false, 'error', 'Refunds are only allowed before check-in or on already-cancelled bookings. Checked-in and checked-out bookings must use a manual finance adjustment workflow.');
  end if;

  v_should_cancel := coalesce(v_booking.status, '') in ('pending', 'confirmed');

  v_refund := public.record_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    p_method,
    trim(both from concat(
      coalesce(nullif(p_notes, ''), ''),
      case when coalesce(nullif(p_proof_reference, ''), '') <> '' then ' | Proof: ' || p_proof_reference else '' end,
      case when coalesce(nullif(p_approval_note, ''), '') <> '' then ' | Approval: ' || p_approval_note else '' end
    )),
    p_requested_by,
    'refund-approval:' || p_booking_id::text || ':' || md5(
      coalesce(p_approved_by::text, '') || ':' ||
      coalesce(p_retained_percent::text, '') || ':' ||
      coalesce(p_method, '') || ':' ||
      coalesce(p_notes, '') || ':' ||
      coalesce(p_proof_reference, '')
    )
  );

  if coalesce((v_refund->>'success')::boolean, false) = false then
    return v_refund;
  end if;

  v_retained_amount := coalesce((v_refund->>'retained_amount')::numeric, 0);
  v_effective_status := case when v_should_cancel or coalesce(v_booking.status, '') = 'cancelled' then 'cancelled' else v_booking.status end;

  if v_effective_status = 'cancelled' then
    v_settled_total := round(greatest(v_retained_amount, 0)::numeric, 2);
    v_final_payment_status := case when v_settled_total > 0 then 'paid' else 'unpaid' end;

    update public.bookings
       set status = 'cancelled',
           total_amount = v_settled_total,
           payment_status = v_final_payment_status,
           updated_at = now()
     where id = p_booking_id
       and lodge_id = p_lodge_id
    returning * into v_after;

    insert into public.financial_audit_log (
      lodge_id, booking_id, action, actor_id, amount_delta, before_snapshot, after_snapshot
    ) values (
      p_lodge_id,
      p_booking_id,
      'booking_total_edited',
      p_approved_by,
      null,
      jsonb_build_object(
        'status', v_booking.status,
        'total_amount', v_booking.total_amount,
        'amount_paid', v_booking.amount_paid,
        'payment_status', v_booking.payment_status
      ),
      jsonb_build_object(
        'status', v_after.status,
        'total_amount', v_after.total_amount,
        'amount_paid', v_after.amount_paid,
        'payment_status', v_after.payment_status,
        'reason', 'refund_retained_settlement'
      )
    );
  end if;

  insert into public.refund_approval_log (
    lodge_id, booking_id, approved_by, requested_by, refund_amount, retained_amount,
    retained_percent, method, notes, proof_reference, approval_note
  ) values (
    p_lodge_id,
    p_booking_id,
    p_approved_by,
    p_requested_by,
    coalesce((v_refund->>'refund_amount')::numeric, 0),
    v_retained_amount,
    coalesce((v_refund->>'retained_percent')::numeric, 0),
    coalesce(nullif(p_method, ''), 'refund'),
    nullif(p_notes, ''),
    nullif(p_proof_reference, ''),
    nullif(p_approval_note, '')
  );

  return v_refund || jsonb_build_object(
    'approved_by', p_approved_by,
    'booking_status', v_effective_status,
    'retained_settlement_total', v_settled_total,
    'settlement_payment_status', v_final_payment_status
  );
end;
$$;

-- Replace dynamic maintenance SQL with typed statements and role checks.
create or replace function public.create_maintenance_ticket(payload jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  insert into public.maintenance_tickets (
    lodge_id, room_id, title, description, priority, status, reported_date,
    notes, labour_cost, parts_cost, total_cost, vendor_name, cost_notes
  ) values (
    v_lodge_id,
    nullif(payload->>'room_id', '')::uuid,
    coalesce(nullif(payload->>'title', ''), nullif(payload->>'issue', ''), 'Maintenance ticket'),
    coalesce(payload->>'description', ''),
    coalesce(nullif(payload->>'priority', ''), 'medium'),
    coalesce(nullif(payload->>'status', ''), 'open'),
    coalesce(nullif(payload->>'reported_date', '')::date, current_date),
    coalesce(payload->>'notes', payload->>'description', ''),
    coalesce(nullif(payload->>'labour_cost', '')::numeric, 0),
    coalesce(nullif(payload->>'parts_cost', '')::numeric, 0),
    coalesce(nullif(payload->>'total_cost', '')::numeric, 0),
    nullif(payload->>'vendor_name', ''),
    nullif(payload->>'cost_notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.update_maintenance_ticket(p_id text, p_lodge_id text, payload jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
  v_lodge_id uuid := p_lodge_id::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  update public.maintenance_tickets
     set title = case when payload ? 'title' then coalesce(nullif(payload->>'title', ''), title) else title end,
         description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end,
         notes = case when payload ? 'notes' then payload->>'notes' else notes end,
         status = case when payload ? 'status' then coalesce(nullif(payload->>'status', ''), status) else status end,
         priority = case when payload ? 'priority' then coalesce(nullif(payload->>'priority', ''), priority) else priority end,
         reported_date = case when payload ? 'reported_date' and nullif(payload->>'reported_date', '') is not null then (payload->>'reported_date')::date else reported_date end,
         labour_cost = case when payload ? 'labour_cost' then coalesce(nullif(payload->>'labour_cost', '')::numeric, 0) else labour_cost end,
         parts_cost = case when payload ? 'parts_cost' then coalesce(nullif(payload->>'parts_cost', '')::numeric, 0) else parts_cost end,
         total_cost = case when payload ? 'total_cost' then coalesce(nullif(payload->>'total_cost', '')::numeric, 0) else total_cost end,
         vendor_name = case when payload ? 'vendor_name' then nullif(payload->>'vendor_name', '') else vendor_name end,
         cost_notes = case when payload ? 'cost_notes' then nullif(payload->>'cost_notes', '') else cost_notes end
   where id = p_id::uuid
     and lodge_id = v_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Maintenance ticket not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

revoke all on function public.update_booking_payment(uuid, uuid, numeric, text) from public;
grant execute on function public.update_booking_payment(uuid, uuid, numeric, text) to anon, authenticated, service_role;
