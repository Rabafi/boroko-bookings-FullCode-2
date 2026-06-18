-- Close the remaining crash/retry window for booking mutations and make
-- booking total/status changes part of the canonical financial audit trail.

create table if not exists public.financial_operation_idempotency (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  operation_key text not null,
  operation_type text not null,
  entity_id uuid,
  request_hash text not null,
  operation_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint financial_operation_idempotency_key_length_chk
    check (length(operation_key) between 8 and 128),
  constraint financial_operation_idempotency_lodge_key_uidx
    unique (lodge_id, operation_key)
);

create index if not exists financial_operation_idempotency_created_idx
  on public.financial_operation_idempotency (created_at desc);

alter table public.financial_operation_idempotency enable row level security;
revoke all on table public.financial_operation_idempotency from public, anon, authenticated;
grant select, insert on table public.financial_operation_idempotency to service_role;

create or replace function public._claim_financial_operation(
  p_lodge_id uuid,
  p_operation_key text,
  p_operation_type text,
  p_entity_id uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing public.financial_operation_idempotency%rowtype;
begin
  if nullif(btrim(coalesce(p_operation_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required');
  end if;

  if length(p_operation_key) < 8 or length(p_operation_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'Idempotency key must be between 8 and 128 characters');
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_lodge_id::text || ':' || p_operation_key, 0)
  );

  select *
    into v_existing
    from public.financial_operation_idempotency
   where lodge_id = p_lodge_id
     and operation_key = p_operation_key
   limit 1;

  if found then
    if v_existing.operation_type is distinct from p_operation_type
       or v_existing.entity_id is distinct from p_entity_id
       or v_existing.request_hash is distinct from p_request_hash then
      return jsonb_build_object(
        'success', false,
        'error', 'Idempotency key was already used for a different operation'
      );
    end if;

    return jsonb_build_object(
      'success', true,
      'found', true,
      'operation_result', v_existing.operation_result
    );
  end if;

  return jsonb_build_object('success', true, 'found', false);
end;
$$;

create or replace function public._record_financial_operation(
  p_lodge_id uuid,
  p_operation_key text,
  p_operation_type text,
  p_entity_id uuid,
  p_request_hash text,
  p_operation_result jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.financial_operation_idempotency (
    lodge_id,
    operation_key,
    operation_type,
    entity_id,
    request_hash,
    operation_result
  ) values (
    p_lodge_id,
    p_operation_key,
    p_operation_type,
    p_entity_id,
    p_request_hash,
    p_operation_result
  );
end;
$$;

revoke all on function public._claim_financial_operation(uuid, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public._record_financial_operation(uuid, text, text, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.update_booking(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
  v_before public.bookings%rowtype;
  v_after public.bookings%rowtype;
  v_actor uuid := public.app_current_user_id();
begin
  v_request_hash := md5(jsonb_build_object(
    'booking_id', p_id,
    'payload', coalesce(payload, '{}'::jsonb),
    'expected_updated_at', p_expected_updated_at
  )::text);

  v_claim := public._claim_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'update_booking',
    p_id,
    v_request_hash
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  select *
    into v_before
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_result := public.update_booking(
    p_id,
    p_lodge_id,
    coalesce(payload, '{}'::jsonb),
    p_expected_updated_at
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  select *
    into v_after
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id;

  if v_before.total_amount is distinct from v_after.total_amount then
    insert into public.financial_audit_log (
      lodge_id,
      booking_id,
      action,
      actor_id,
      amount_delta,
      before_snapshot,
      after_snapshot,
      idempotency_key
    ) values (
      p_lodge_id,
      p_id,
      'booking_total_edited',
      v_actor,
      round((coalesce(v_after.total_amount, 0) - coalesce(v_before.total_amount, 0))::numeric, 2),
      jsonb_build_object(
        'total_amount', v_before.total_amount,
        'amount_paid', v_before.amount_paid,
        'charges_total', v_before.charges_total,
        'payment_status', v_before.payment_status,
        'room_id', v_before.room_id,
        'check_in', v_before.check_in,
        'check_out', v_before.check_out
      ),
      jsonb_build_object(
        'total_amount', v_after.total_amount,
        'amount_paid', v_after.amount_paid,
        'charges_total', v_after.charges_total,
        'payment_status', v_after.payment_status,
        'room_id', v_after.room_id,
        'check_in', v_after.check_in,
        'check_out', v_after.check_out
      ),
      p_idempotency_key
    );
  end if;

  perform public._record_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'update_booking',
    p_id,
    v_request_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

create or replace function public.update_booking_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
  v_before public.bookings%rowtype;
  v_after public.bookings%rowtype;
  v_actor uuid := public.app_current_user_id();
begin
  v_request_hash := md5(jsonb_build_object(
    'booking_id', p_id,
    'status', p_status,
    'expected_updated_at', p_expected_updated_at
  )::text);

  v_claim := public._claim_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'update_booking_status',
    p_id,
    v_request_hash
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  select *
    into v_before
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_result := public.update_booking_status(
    p_id,
    p_lodge_id,
    p_status,
    p_expected_updated_at
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  select *
    into v_after
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id;

  if v_before.status is distinct from v_after.status then
    insert into public.financial_audit_log (
      lodge_id,
      booking_id,
      action,
      actor_id,
      amount_delta,
      before_snapshot,
      after_snapshot,
      idempotency_key
    ) values (
      p_lodge_id,
      p_id,
      'booking_status_changed',
      v_actor,
      null,
      jsonb_build_object(
        'status', v_before.status,
        'room_id', v_before.room_id,
        'total_amount', v_before.total_amount,
        'amount_paid', v_before.amount_paid,
        'charges_total', v_before.charges_total,
        'payment_status', v_before.payment_status
      ),
      jsonb_build_object(
        'status', v_after.status,
        'room_id', v_after.room_id,
        'total_amount', v_after.total_amount,
        'amount_paid', v_after.amount_paid,
        'charges_total', v_after.charges_total,
        'payment_status', v_after.payment_status
      ),
      p_idempotency_key
    );
  end if;

  perform public._record_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'update_booking_status',
    p_id,
    v_request_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

create or replace function public.add_booking_charge(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_description text,
  p_category text,
  p_quantity numeric,
  p_unit_price numeric,
  p_outlet_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
begin
  v_request_hash := md5(jsonb_build_object(
    'booking_id', p_booking_id,
    'description', p_description,
    'category', p_category,
    'quantity', p_quantity,
    'unit_price', p_unit_price,
    'outlet_id', p_outlet_id,
    'expected_updated_at', p_expected_updated_at
  )::text);

  v_claim := public._claim_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'add_booking_charge',
    p_booking_id,
    v_request_hash
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  v_result := public.add_booking_charge(
    p_booking_id,
    p_lodge_id,
    p_description,
    p_category,
    p_quantity,
    p_unit_price,
    p_outlet_id,
    p_expected_updated_at
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  perform public._record_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'add_booking_charge',
    p_booking_id,
    v_request_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

create or replace function public.approve_booking_refund(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_retained_percent numeric,
  p_method text,
  p_notes text,
  p_requested_by uuid,
  p_approved_by uuid,
  p_proof_reference text,
  p_approval_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
begin
  v_request_hash := md5(jsonb_build_object(
    'booking_id', p_booking_id,
    'retained_percent', p_retained_percent,
    'method', p_method,
    'notes', p_notes,
    'requested_by', p_requested_by,
    'approved_by', p_approved_by,
    'proof_reference', p_proof_reference,
    'approval_note', p_approval_note
  )::text);

  v_claim := public._claim_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'approve_booking_refund',
    p_booking_id,
    v_request_hash
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  v_result := public.approve_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    p_method,
    p_notes,
    p_requested_by,
    p_approved_by,
    p_proof_reference,
    p_approval_note
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  perform public._record_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'approve_booking_refund',
    p_booking_id,
    v_request_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

revoke all on function public.update_booking(uuid, uuid, jsonb, timestamptz, text) from public;
grant execute on function public.update_booking(uuid, uuid, jsonb, timestamptz, text)
  to anon, authenticated, service_role;

revoke all on function public.update_booking_status(uuid, uuid, text, timestamptz, text) from public;
grant execute on function public.update_booking_status(uuid, uuid, text, timestamptz, text)
  to anon, authenticated, service_role;

revoke all on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamptz, text)
  from public;
grant execute on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamptz, text)
  to anon, authenticated, service_role;

revoke all on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text, text)
  from public;
grant execute on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text, text)
  to anon, authenticated, service_role;
