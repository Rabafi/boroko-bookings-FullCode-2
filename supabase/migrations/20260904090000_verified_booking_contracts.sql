-- Verified booking contracts (local migration; deployment is intentionally
-- pending).  This migration closes the remaining client-side booking write
-- paths without changing the established public booking/rate-limit contract.

-- ---------------------------------------------------------------------------
-- Booking status: one idempotent, audited transition with money boundaries.
-- ---------------------------------------------------------------------------
do $$
begin
  -- The existing audit table has a closed action set.  Extend it in-place so
  -- the atomic group operation can leave an auditable record without
  -- weakening the constraint or losing any actions added by prior releases.
  if to_regclass('public.financial_audit_log') is not null then
    alter table public.financial_audit_log
      drop constraint if exists financial_audit_log_action_check;
    alter table public.financial_audit_log
      add constraint financial_audit_log_action_check check (
        action in (
          'payment_recorded','refund_recorded','charge_added','charge_deleted',
          'booking_total_edited','booking_status_changed','booking_rescheduled',
          'customer_credit_received','customer_credit_allocated','customer_credit_refunded',
          'customer_credit_adjusted','customer_credit_reversed',
          'event_created','event_updated','event_cancelled',
          'event_line_item_added','event_line_item_voided',
          'event_room_linked','event_room_unlinked',
          'event_payment_recorded','event_pos_charge_added','event_pos_charge_reversed',
          'booking_group_created'
        )
      );
  end if;
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
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
  v_before public.bookings%rowtype;
  v_after public.bookings%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_outstanding numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if v_status not in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Unsupported booking status');
  end if;

  v_request_hash := md5(jsonb_build_object(
    'booking_id', p_id,
    'status', v_status,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_claim := public._claim_financial_operation(
    p_lodge_id,
    p_idempotency_key,
    'update_booking_status',
    p_id,
    v_request_hash
  );
  if not coalesce((v_claim->>'success')::boolean, false) then return v_claim; end if;
  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  select * into v_before
    from public.bookings
   where id = p_id and lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  -- A cancellation is not a refund.  Paid bookings must go through the
  -- refund/approval ledger workflow before they can be considered settled.
  if v_status = 'cancelled' and coalesce(v_before.amount_paid, 0) > 0.009 then
    return jsonb_build_object(
      'success', false,
      'error', 'Paid bookings cannot be cancelled through status updates. Record and approve the refund first.',
      'code', 'paid_cancellation_requires_refund'
    );
  end if;

  if v_status = 'checked_out' then
    v_outstanding := greatest(
      0,
      coalesce(v_before.total_amount, 0)
        + coalesce(v_before.charges_total, 0)
        - coalesce(v_before.amount_paid, 0)
    );
    if v_outstanding > 0.009 then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check out until the full balance is paid. Outstanding: %s', round(v_outstanding, 2)),
        'code', 'checkout_balance_due',
        'outstanding', round(v_outstanding, 2)
      );
    end if;
  end if;

  -- The four-argument implementation owns the transition matrix, stale-row
  -- check, room status update, and its operational validation.  Keep it as
  -- the single mutation inside this idempotent/audited wrapper.
  v_result := public.update_booking_status(p_id, p_lodge_id, v_status, p_expected_updated_at);
  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;

  select * into v_after
    from public.bookings
   where id = p_id and lodge_id = p_lodge_id;

  if v_before.status is distinct from v_after.status then
    insert into public.financial_audit_log (
      lodge_id, booking_id, action, actor_id, amount_delta,
      before_snapshot, after_snapshot, idempotency_key
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

  v_result := v_result || jsonb_build_object('status', v_after.status);
  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'update_booking_status', p_id,
    v_request_hash, v_result
  );
  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Import row: one transaction for booking + payment ledger + status.
-- ---------------------------------------------------------------------------
create or replace function public.import_booking_row(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_total_amount numeric,
  p_invoice_number text,
  p_notes text,
  p_created_by uuid,
  p_amount_paid numeric,
  p_payment_method text,
  p_target_status text,
  p_booking_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := lower(btrim(coalesce(p_target_status, 'confirmed')));
  v_amount numeric := round(greatest(coalesce(p_amount_paid, 0), 0), 2);
  v_total numeric := round(greatest(coalesce(p_total_amount, 0), 0), 2);
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
  -- A missing booking id remains compatible with older callers, but is
  -- derived from the stable operation key so an ambiguous retry hashes to
  -- the same entity instead of creating a new UUID.
  v_booking_id uuid := coalesce(p_booking_id, md5('import:' || coalesce(nullif(btrim(p_idempotency_key), ''), 'missing-key'))::uuid);
  v_actor uuid := public.app_current_user_id();
  v_created jsonb;
  v_payment jsonb;
  v_status_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Import idempotency key is required');
  end if;

  if v_status not in ('confirmed', 'checked_in', 'checked_out', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Unsupported imported booking status');
  end if;
  if p_customer_id is null or p_room_id is null or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return jsonb_build_object('success', false, 'error', 'Imported booking customer, room, and dates are required');
  end if;
  if coalesce(p_adults, 1) < 1 or coalesce(p_children, 0) < 0 then
    return jsonb_build_object('success', false, 'error', 'Imported booking occupancy is invalid');
  end if;
  if v_total <= 0 then
    return jsonb_build_object('success', false, 'error', 'Imported booking total must be greater than zero');
  end if;
  if coalesce(p_amount_paid, 0) < 0 then
    return jsonb_build_object('success', false, 'error', 'Imported payment cannot be negative');
  end if;
  if v_amount > v_total + 0.009 then
    return jsonb_build_object('success', false, 'error', 'Imported payment cannot exceed the booking total');
  end if;
  if v_status = 'cancelled' and v_amount > 0.009 then
    return jsonb_build_object(
      'success', false,
      'error', 'Paid cancelled rows require a refund ledger workflow and cannot be imported as a direct cancellation',
      'code', 'paid_cancellation_requires_refund'
    );
  end if;
  if v_status = 'checked_out' and v_amount + 0.009 < v_total then
    return jsonb_build_object(
      'success', false,
      'error', 'Checked-out import rows must include payment for the full booking balance',
      'code', 'checkout_balance_due'
    );
  end if;

  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'room_id', p_room_id,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'adults', p_adults,
    'children', p_children,
    'total_amount', v_total,
    'invoice_number', p_invoice_number,
    'notes', p_notes,
    'amount_paid', v_amount,
    'payment_method', p_payment_method,
    'target_status', v_status,
    'booking_id', v_booking_id
  )::text);
  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'import_booking_row', v_booking_id, v_request_hash
  );
  if not coalesce((v_claim->>'success')::boolean, false) then return v_claim; end if;
  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  v_created := public.create_booking(
    p_lodge_id, p_customer_id, p_room_id, p_check_in, p_check_out,
    greatest(coalesce(p_adults, 1), 1), greatest(coalesce(p_children, 0), 0),
    v_total, p_invoice_number, coalesce(p_notes, ''), v_actor,
    0, v_booking_id, p_idempotency_key || ':create', null, true
  );
  if not coalesce((v_created->>'success')::boolean, false) then
    raise exception '%', coalesce(v_created->>'error', 'Imported booking could not be created');
  end if;

  if v_amount > 0 then
    v_payment := public.update_booking_payment(
      p_booking_id => v_booking_id,
      p_lodge_id => p_lodge_id,
      p_amount => v_amount,
      p_method => coalesce(nullif(p_payment_method, ''), 'cash'),
      p_type => 'payment',
      p_idempotency_key => p_idempotency_key || ':payment',
      p_recorded_by => v_actor,
      p_expected_updated_at => null
    );
    if not coalesce((v_payment->>'success')::boolean, false) then
      raise exception '%', coalesce(v_payment->>'error', 'Imported payment could not be recorded');
    end if;
  end if;

  -- The status contract deliberately preserves the normal transition matrix.
  -- A checked-out historical row therefore passes through checked_in first,
  -- with distinct stable keys for each state transition.
  if v_status = 'checked_out' then
    v_status_result := public.update_booking_status(
      v_booking_id, p_lodge_id, 'checked_in', null, p_idempotency_key || ':status:checked-in'
    );
    if not coalesce((v_status_result->>'success')::boolean, false) then
      raise exception '%', coalesce(v_status_result->>'error', 'Imported booking check-in could not be applied');
    end if;
  end if;

  if v_status <> 'confirmed' then
    v_status_result := public.update_booking_status(
      v_booking_id, p_lodge_id, v_status, null, p_idempotency_key || ':status:' || v_status
    );
    if not coalesce((v_status_result->>'success')::boolean, false) then
      raise exception '%', coalesce(v_status_result->>'error', 'Imported booking status could not be applied');
    end if;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'status', v_status,
    'amount_paid', v_amount,
    'payment_status', case when v_amount >= v_total then 'paid' when v_amount > 0 then 'partial' else 'unpaid' end
  );
  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'import_booking_row', v_booking_id, v_request_hash, v_result
  );
  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Accommodation-aware update/reschedule wrappers. The established booking
-- RPCs already own concurrency, overlap, ledger, and audit behavior. These
-- wrappers supply the campsite occupancy context required by
-- room_booking_expected_total and persist the corresponding occupancy
-- snapshot in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.update_campsite_booking(
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
  v_booking public.bookings%rowtype;
  v_room public.rooms%rowtype;
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_adults integer;
  v_children integer;
  v_tents integer;
  v_vehicles integer;
  v_expected numeric;
  v_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select * into v_booking
    from public.bookings
   where id = p_id and lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_room_id := coalesce(nullif(v_payload->>'room_id', '')::uuid, v_booking.room_id);
  v_check_in := coalesce(nullif(v_payload->>'check_in', '')::date, v_booking.check_in);
  v_check_out := coalesce(nullif(v_payload->>'check_out', '')::date, v_booking.check_out);
  v_adults := greatest(coalesce(nullif(v_payload->>'adults', '')::integer, v_booking.adults, 1), 1);
  v_children := greatest(coalesce(nullif(v_payload->>'children', '')::integer, v_booking.children, 0), 0);
  v_tents := greatest(coalesce(nullif(v_payload->>'tents', '')::integer, v_booking.tents_count, 0), 0);
  v_vehicles := greatest(coalesce(nullif(v_payload->>'vehicles', '')::integer, v_booking.vehicles_count, 0), 0);

  select * into v_room
    from public.rooms
   where id = v_room_id and lodge_id = p_lodge_id
   for update;
  if not found or public._normalize_accommodation_kind(v_room.accommodation_kind) <> 'campsite' then
    return jsonb_build_object('success', false, 'error', 'Selected accommodation is not a campsite');
  end if;

  v_expected := public.accommodation_booking_expected_total(
    p_lodge_id, v_room_id, v_check_in, v_check_out,
    v_adults, v_children, v_tents, v_vehicles, null
  );
  -- Keep tents/vehicles in the payload even though the legacy inner update
  -- ignores unknown keys: its idempotency hash must still bind the operation
  -- to the exact campsite occupancy supplied by the caller.
  v_payload := v_payload || jsonb_build_object('total_amount', v_expected);

  perform set_config('app.campsite_adults', v_adults::text, true);
  perform set_config('app.campsite_children', v_children::text, true);
  perform set_config('app.campsite_tents', v_tents::text, true);
  perform set_config('app.campsite_vehicles', v_vehicles::text, true);

  v_result := public.update_booking(
    p_id, p_lodge_id, v_payload, p_expected_updated_at, p_idempotency_key
  );
  if not coalesce((v_result->>'success')::boolean, false)
     or coalesce((v_result->>'idempotent')::boolean, false) then
    return v_result;
  end if;

  update public.bookings
     set tents_count = v_tents,
         vehicles_count = v_vehicles,
         accommodation_kind = 'campsite'
   where id = p_id and lodge_id = p_lodge_id;

  insert into public.booking_accommodation_details (
    booking_id, lodge_id, accommodation_kind, adults, children, tents, vehicles,
    rate_mode, pricing_snapshot
  ) values (
    p_id, p_lodge_id, 'campsite', v_adults, v_children, v_tents, v_vehicles,
    public._normalize_rate_mode(v_room.rate_mode),
    jsonb_build_object(
      'nights', v_check_out - v_check_in,
      'site_rate', v_room.rate_per_night,
      'person_rate', v_room.rate_per_person,
      'tent_rate', v_room.rate_per_tent,
      'vehicle_rate', v_room.rate_per_vehicle,
      'people', v_adults + v_children,
      'tents', v_tents,
      'vehicles', v_vehicles,
      'calculated_total', v_expected
    )
  ) on conflict (booking_id) do update set
    lodge_id = excluded.lodge_id,
    accommodation_kind = excluded.accommodation_kind,
    adults = excluded.adults,
    children = excluded.children,
    tents = excluded.tents,
    vehicles = excluded.vehicles,
    rate_mode = excluded.rate_mode,
    pricing_snapshot = excluded.pricing_snapshot;

  return v_result || jsonb_build_object(
    'total_amount', v_expected,
    'accommodation_kind', 'campsite',
    'tents', v_tents,
    'vehicles', v_vehicles
  );
end;
$$;

create or replace function public.reschedule_accommodation_booking(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_new_room_id uuid,
  p_new_check_in date,
  p_new_check_out date,
  p_reason text,
  p_idempotency_key text,
  p_overpayment_action text,
  p_allow_total_override boolean,
  p_override_total numeric,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking public.bookings%rowtype;
  v_room public.rooms%rowtype;
  v_campsite boolean;
  v_adults integer;
  v_children integer;
  v_tents integer;
  v_vehicles integer;
  v_expected numeric;
  v_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin']
  );

  select * into v_booking
    from public.bookings
   where id = p_booking_id and lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;
  select * into v_room
    from public.rooms
   where id = p_new_room_id and lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  v_campsite := public._normalize_accommodation_kind(v_room.accommodation_kind) = 'campsite';
  v_adults := greatest(coalesce(v_booking.adults, 1), 1);
  v_children := greatest(coalesce(v_booking.children, 0), 0);
  v_tents := case when v_campsite then greatest(coalesce(v_booking.tents_count, 0), 0) else 0 end;
  v_vehicles := case when v_campsite then greatest(coalesce(v_booking.vehicles_count, 0), 0) else 0 end;

  perform set_config('app.campsite_adults', v_adults::text, true);
  perform set_config('app.campsite_children', v_children::text, true);
  perform set_config('app.campsite_tents', v_tents::text, true);
  perform set_config('app.campsite_vehicles', v_vehicles::text, true);

  v_result := public.reschedule_booking(
    p_booking_id, p_lodge_id, p_new_room_id, p_new_check_in, p_new_check_out,
    p_reason, p_idempotency_key, p_overpayment_action, p_allow_total_override,
    p_override_total, p_expected_updated_at, p_actor_id
  );
  if not coalesce((v_result->>'success')::boolean, false)
     or coalesce((v_result->>'idempotent')::boolean, false) then
    return v_result;
  end if;

  update public.bookings
     set accommodation_kind = case when v_campsite then 'campsite' else public._normalize_accommodation_kind(v_room.accommodation_kind) end,
         tents_count = v_tents,
         vehicles_count = v_vehicles
   where id = p_booking_id and lodge_id = p_lodge_id;

  if v_campsite then
    v_expected := public.accommodation_booking_expected_total(
      p_lodge_id, p_new_room_id, p_new_check_in, p_new_check_out,
      v_adults, v_children, v_tents, v_vehicles, null
    );
    insert into public.booking_accommodation_details (
      booking_id, lodge_id, accommodation_kind, adults, children, tents, vehicles,
      rate_mode, pricing_snapshot
    ) values (
      p_booking_id, p_lodge_id, 'campsite', v_adults, v_children, v_tents, v_vehicles,
      public._normalize_rate_mode(v_room.rate_mode),
      jsonb_build_object(
        'nights', p_new_check_out - p_new_check_in,
        'site_rate', v_room.rate_per_night,
        'person_rate', v_room.rate_per_person,
        'tent_rate', v_room.rate_per_tent,
        'vehicle_rate', v_room.rate_per_vehicle,
        'people', v_adults + v_children,
        'tents', v_tents,
        'vehicles', v_vehicles,
        'calculated_total', v_expected
      )
    ) on conflict (booking_id) do update set
      lodge_id = excluded.lodge_id,
      accommodation_kind = excluded.accommodation_kind,
      adults = excluded.adults,
      children = excluded.children,
      tents = excluded.tents,
      vehicles = excluded.vehicles,
      rate_mode = excluded.rate_mode,
      pricing_snapshot = excluded.pricing_snapshot;
  else
    delete from public.booking_accommodation_details
     where booking_id = p_booking_id and lodge_id = p_lodge_id;
  end if;

  return v_result || jsonb_build_object(
    'accommodation_kind', case when v_campsite then 'campsite' else public._normalize_accommodation_kind(v_room.accommodation_kind) end,
    'tents', v_tents,
    'vehicles', v_vehicles
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Desktop multi-room booking: one transaction and one replayable intent.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_group_idempotency (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  operation_key text not null,
  group_key text not null,
  request_hash text not null,
  booking_ids uuid[] not null default array[]::uuid[],
  invoice_number text,
  operation_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, operation_key),
  unique (lodge_id, group_key)
);
alter table public.booking_group_idempotency enable row level security;
revoke all on table public.booking_group_idempotency from public, anon, authenticated;

create or replace function public.create_multi_room_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_total_amount numeric,
  p_deposit_amount numeric,
  p_deposit_method text,
  p_notes text,
  p_created_by uuid,
  p_group_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_group_key text := nullif(btrim(coalesce(p_group_key, '')), '');
  v_request_hash text;
  v_canonical_rooms jsonb := '[]'::jsonb;
  v_existing public.booking_group_idempotency%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_line jsonb;
  v_room public.rooms%rowtype;
  v_room_id uuid;
  v_adults integer;
  v_children integer;
  v_tents integer;
  v_vehicles integer;
  v_room_total numeric;
  v_group_total numeric := 0;
  v_deposit numeric := round(greatest(coalesce(p_deposit_amount, 0), 0), 2);
  v_remaining_deposit numeric;
  v_line_deposit numeric;
  v_booking_id uuid;
  v_booking_ids uuid[] := array[]::uuid[];
  v_room_ids uuid[] := array[]::uuid[];
  v_booking_rows jsonb := '[]'::jsonb;
  v_child_result jsonb;
  v_invoice_number text;
  v_group_id uuid;
  v_idx integer := 0;
  v_campsite boolean;
  v_existing_conflict uuid;
  v_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );
  if p_customer_id is null or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return jsonb_build_object('success', false, 'error', 'Customer and valid booking dates are required');
  end if;
  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array' or jsonb_array_length(p_rooms) < 2 or jsonb_array_length(p_rooms) > 50 then
    return jsonb_build_object('success', false, 'error', 'A multi-room booking requires between two and fifty rooms');
  end if;
  if coalesce(p_deposit_amount, 0) < 0 then
    return jsonb_build_object('success', false, 'error', 'Deposit cannot be negative');
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Multi-room idempotency key is required');
  end if;
  if v_group_key is null then v_group_key := 'multi-room:' || p_idempotency_key; end if;

  select coalesce(jsonb_agg(value order by value->>'room_id'), '[]'::jsonb)
    into v_canonical_rooms
    from jsonb_array_elements(p_rooms);
  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'rooms', v_canonical_rooms,
    'total_amount', p_total_amount,
    'deposit_amount', p_deposit_amount,
    'deposit_method', p_deposit_method,
    'notes', p_notes,
    'group_key', v_group_key
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text || ':' || p_idempotency_key, 0));
  select * into v_existing
    from public.booking_group_idempotency
   where lodge_id = p_lodge_id and operation_key = p_idempotency_key
   for update;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then
      return jsonb_build_object('success', false, 'error', 'Multi-room idempotency key was reused with different details', 'code', 'idempotency_conflict');
    end if;
    if v_existing.operation_result is not null then
      return v_existing.operation_result || jsonb_build_object('idempotent', true);
    end if;
  else
    insert into public.booking_group_idempotency (lodge_id, operation_key, group_key, request_hash)
    values (p_lodge_id, p_idempotency_key, v_group_key, v_request_hash);
  end if;

  if (select count(*) from jsonb_array_elements(p_rooms) r where nullif(btrim(coalesce(r->>'room_id', '')), '') is null) > 0 then
    return jsonb_build_object('success', false, 'error', 'Each selected room must have an id');
  end if;

  -- Always acquire room locks in deterministic room-id order to avoid a
  -- deadlock when two operators submit the same rooms in opposite orders.
  for v_line in
    select value
      from jsonb_array_elements(p_rooms) as room_line(value)
     order by value->>'room_id'
  loop
    v_idx := v_idx + 1;
    v_room_id := (v_line->>'room_id')::uuid;
    if coalesce((v_line->>'adults')::integer, 1) < 1
       or coalesce((v_line->>'children')::integer, 0) < 0
       or coalesce((v_line->>'tents')::integer, 0) < 0
       or coalesce((v_line->>'vehicles')::integer, 0) < 0 then
      return jsonb_build_object('success', false, 'error', 'Selected-room occupancy cannot be negative or empty');
    end if;
    v_adults := greatest(coalesce((v_line->>'adults')::integer, 1), 1);
    v_children := greatest(coalesce((v_line->>'children')::integer, 0), 0);
    v_tents := greatest(coalesce((v_line->>'tents')::integer, 0), 0);
    v_vehicles := greatest(coalesce((v_line->>'vehicles')::integer, 0), 0);
    if v_room_id = any(v_room_ids) then
      return jsonb_build_object('success', false, 'error', 'Each room can only be selected once');
    end if;

    select * into v_room
      from public.rooms
     where id = v_room_id and lodge_id = p_lodge_id
     for update;
    if not found then return jsonb_build_object('success', false, 'error', 'A selected room is not available'); end if;
    v_campsite := public._normalize_accommodation_kind(v_room.accommodation_kind) = 'campsite';
    if not v_campsite and v_adults + v_children > coalesce(v_room.max_occupancy, 0) then
      return jsonb_build_object('success', false, 'error', format('Room %s exceeds maximum occupancy', coalesce(v_room.room_number, '')));
    end if;

    select b.id into v_existing_conflict
      from public.bookings b
     where b.lodge_id = p_lodge_id and b.room_id = v_room_id
       and coalesce(b.status, '') not in ('cancelled', 'checked_out')
       and b.check_in < p_check_out and b.check_out > p_check_in
     limit 1;
    if v_existing_conflict is not null then
      return jsonb_build_object('success', false, 'error', format('Room %s is already booked for those dates', coalesce(v_room.room_number, '')));
    end if;

    if v_campsite then
      v_room_total := public.accommodation_booking_expected_total(
        p_lodge_id, v_room_id, p_check_in, p_check_out,
        v_adults, v_children, v_tents, v_vehicles, null
      );
    else
      v_room_total := public.room_booking_expected_total(p_lodge_id, v_room_id, p_check_in, p_check_out, null);
    end if;
    if v_room_total is null or v_room_total <= 0 then
      return jsonb_build_object('success', false, 'error', format('Unable to price room %s for those dates', coalesce(v_room.room_number, '')));
    end if;
    v_group_total := v_group_total + v_room_total;
    v_room_ids := array_append(v_room_ids, v_room_id);
  end loop;

  if p_total_amount is not null and abs(round(p_total_amount, 2) - round(v_group_total, 2)) > 0.01 then
    return jsonb_build_object('success', false, 'error', format('Multi-room total must match the server quote. Expected %s, received %s.', round(v_group_total, 2), round(p_total_amount, 2)), 'code', 'quote_changed');
  end if;
  if v_deposit > v_group_total + 0.009 then
    return jsonb_build_object(
      'success', false,
      'error', format('Deposit cannot exceed the server-priced group total of %s.', round(v_group_total, 2)),
      'code', 'deposit_exceeds_total'
    );
  end if;
  v_remaining_deposit := v_deposit;

  -- Rewalk the locked/quoted lines in input order to create all children in
  -- this transaction.  Any error raises and rolls the group back completely.
  for v_line in select value from jsonb_array_elements(p_rooms) loop
    v_room_id := (v_line->>'room_id')::uuid;
    v_adults := greatest(coalesce((v_line->>'adults')::integer, 1), 1);
    v_children := greatest(coalesce((v_line->>'children')::integer, 0), 0);
    v_tents := greatest(coalesce((v_line->>'tents')::integer, 0), 0);
    v_vehicles := greatest(coalesce((v_line->>'vehicles')::integer, 0), 0);
    select * into v_room from public.rooms where id = v_room_id and lodge_id = p_lodge_id;
    v_campsite := public._normalize_accommodation_kind(v_room.accommodation_kind) = 'campsite';
    if v_campsite then
      v_room_total := public.accommodation_booking_expected_total(
        p_lodge_id, v_room_id, p_check_in, p_check_out,
        v_adults, v_children, v_tents, v_vehicles, null
      );
    else
      v_room_total := public.room_booking_expected_total(p_lodge_id, v_room_id, p_check_in, p_check_out, null);
    end if;
    v_line_deposit := least(v_remaining_deposit, v_room_total);
    v_remaining_deposit := greatest(0, round(v_remaining_deposit - v_line_deposit, 2));
    v_booking_id := gen_random_uuid();
    if v_campsite then
      v_child_result := public.create_campsite_booking(
        p_lodge_id, p_customer_id, v_room_id, p_check_in, p_check_out,
        v_adults, v_children, v_tents, v_vehicles, v_room_total,
        null, p_notes, v_actor, v_line_deposit, v_booking_id,
        p_idempotency_key || ':room:' || v_room_id::text,
        p_deposit_method
      );
    else
      v_child_result := public.create_booking(
        p_lodge_id, p_customer_id, v_room_id, p_check_in, p_check_out,
        v_adults, v_children, v_room_total, null, p_notes, v_actor,
        v_line_deposit, v_booking_id,
        p_idempotency_key || ':room:' || v_room_id::text,
        p_deposit_method, false
      );
    end if;
    if not coalesce((v_child_result->>'success')::boolean, false) then
      raise exception '%', coalesce(v_child_result->>'error', 'A room booking could not be created');
    end if;
    v_booking_ids := array_append(v_booking_ids, v_booking_id);
    v_booking_rows := v_booking_rows || jsonb_build_array(jsonb_build_object(
      'booking_id', v_booking_id,
      'room_id', v_room_id,
      'room_number', v_room.room_number,
      'total_amount', v_room_total,
      'deposit_amount', v_line_deposit,
      'accommodation_kind', case when v_campsite then 'campsite' else 'room' end
    ));
  end loop;

  v_invoice_number := public.get_next_invoice_number(p_lodge_id);
  insert into public.booking_invoice_groups (
    lodge_id, group_key, customer_id, invoice_number, due_date, notes, created_by
  ) values (
    p_lodge_id, v_group_key, p_customer_id, v_invoice_number,
    p_check_in, nullif(p_notes, ''), v_actor
  ) returning id into v_group_id;
  v_idx := 0;
  foreach v_booking_id in array v_booking_ids loop
    v_idx := v_idx + 1;
    insert into public.booking_invoice_group_lines (group_id, booking_id, lodge_id, line_order)
    values (v_group_id, v_booking_id, p_lodge_id, v_idx);
  end loop;

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key
  ) values (
    p_lodge_id,
    v_booking_ids[1],
    'booking_group_created',
    public.app_current_user_id(),
    v_group_total,
    '{}'::jsonb,
    jsonb_build_object(
      'group_key', v_group_key,
      'invoice_number', v_invoice_number,
      'booking_ids', to_jsonb(v_booking_ids),
      'total_amount', v_group_total,
      'deposit_amount', v_deposit
    ),
    p_idempotency_key
  );

  v_result := jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'group_key', v_group_key,
    'invoice_number', v_invoice_number,
    'group_invoice_number', v_invoice_number,
    'booking_ids', to_jsonb(v_booking_ids),
    'bookings', v_booking_rows,
    'total_amount', round(v_group_total, 2),
    'deposit_amount', round(v_deposit, 2)
  );
  update public.booking_group_idempotency
     set booking_ids = v_booking_ids,
         invoice_number = v_invoice_number,
         operation_result = v_result,
         updated_at = now()
   where lodge_id = p_lodge_id and operation_key = p_idempotency_key;
  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'create_multi_room_booking', v_booking_ids[1],
    v_request_hash, v_result
  );
  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public booking idempotency wrapper.  The legacy function remains the
-- implementation of validation/rate limiting/pricing; this wrapper adds a
-- persistent payload-bound request record and a cancelled-booking retry rule.
-- ---------------------------------------------------------------------------
create table if not exists public.public_booking_idempotency (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  effective_idempotency_key text not null,
  booking_ids uuid[] not null default array[]::uuid[],
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, idempotency_key)
);
alter table public.public_booking_idempotency enable row level security;
revoke all on table public.public_booking_idempotency from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.create_online_booking(text,jsonb)') is not null
     and to_regprocedure('public.create_online_booking_legacy(text,jsonb)') is null then
    alter function public.create_online_booking(text, jsonb) rename to create_online_booking_legacy;
  end if;
end;
$$;

create or replace function public.create_online_booking(p_slug text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_client_key_provided boolean := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '') is not null;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_legacy_fallback_key text;
  v_matched_existing_key text;
  v_effective_key text;
  v_hash text;
  v_canonical_payload jsonb := coalesce(payload, '{}'::jsonb) - 'idempotency_key';
  v_rooms jsonb;
  v_existing public.public_booking_idempotency%rowtype;
  v_legacy_ids uuid[];
  v_all_cancelled boolean := false;
  v_result jsonb;
begin
  select s.lodge_id into v_lodge_id
    from public.settings s
   where lower(btrim(coalesce(s.slug, ''))) = v_slug
     and coalesce(s.deleted, false) = false
   limit 1;
  if v_lodge_id is null then return jsonb_build_object('success', false, 'error', 'Lodge not found'); end if;

  if jsonb_typeof(v_canonical_payload->'rooms') = 'array' then
    select coalesce(jsonb_agg(value order by value->>'room_id'), '[]'::jsonb)
      into v_rooms from jsonb_array_elements(v_canonical_payload->'rooms');
    v_canonical_payload := jsonb_set(v_canonical_payload, '{rooms}', v_rooms, true);
  end if;
  v_hash := md5(v_canonical_payload::text);
  if not v_client_key_provided then
    -- Preserve the former key for lookup compatibility, but use the
    -- canonical payload hash for the wrapper record so room-line order does
    -- not turn the same request into a second booking.
    v_legacy_fallback_key := md5(coalesce(payload->>'guest_email', '') || '::' || coalesce(payload->>'booking_type', 'room') || '::' || coalesce(payload->>'check_in', '') || '::' || coalesce(payload->>'check_out', '') || '::' || coalesce(payload->'rooms', payload->'room_id')::text);
    v_key := v_hash;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));

  select * into v_existing
    from public.public_booking_idempotency
   where lodge_id = v_lodge_id and idempotency_key = v_key
   for update;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      return jsonb_build_object('success', false, 'error', 'Public booking idempotency key was reused with different details', 'code', 'idempotency_conflict');
    end if;
    if v_existing.result is not null then
      if coalesce(array_length(v_existing.booking_ids, 1), 0) > 0 then
        select coalesce(bool_and(coalesce(b.status, '') = 'cancelled'), false)
          into v_all_cancelled
          from public.bookings b where b.lodge_id = v_lodge_id and b.id = any(v_existing.booking_ids);
      end if;
      -- An explicit form UUID is a durable identity.  Cancellation changes
      -- booking state, not the meaning of a retry, so it must remain
      -- idempotent forever.  Only the legacy no-key compatibility path may
      -- release a cancelled deterministic fallback key for a fresh intent.
      if v_client_key_provided or not v_all_cancelled then
        return v_existing.result || jsonb_build_object('idempotent', true);
      end if;
      delete from public.public_booking_idempotency where id = v_existing.id;
    end if;
  end if;

  -- Compatibility with bookings created before this table existed: an old
  -- cancelled key is retried under a fresh effective key, while an active key
  -- remains idempotent in the legacy implementation.
  select array_agg(b.id), min(
      case
        when v_legacy_fallback_key is not null
         and (b.create_idempotency_key = v_legacy_fallback_key or b.create_idempotency_key like v_legacy_fallback_key || ':%')
          then v_legacy_fallback_key
        else v_key
      end
    ) into v_legacy_ids, v_matched_existing_key
    from public.bookings b
   where b.lodge_id = v_lodge_id
     and (
       b.create_idempotency_key = v_key or b.create_idempotency_key like v_key || ':%'
       or (v_legacy_fallback_key is not null and (
         b.create_idempotency_key = v_legacy_fallback_key
         or b.create_idempotency_key like v_legacy_fallback_key || ':%'
       ))
     );
  if coalesce(array_length(v_legacy_ids, 1), 0) > 0 then
    select bool_and(coalesce(b.status, '') = 'cancelled') into v_all_cancelled
      from public.bookings b where b.lodge_id = v_lodge_id and b.id = any(v_legacy_ids);
    if v_all_cancelled then
      v_effective_key := left(v_key || ':retry:' || replace(gen_random_uuid()::text, '-', ''), 128);
    else
      v_effective_key := coalesce(v_matched_existing_key, v_key);
    end if;
  else
    v_effective_key := v_key;
  end if;

  insert into public.public_booking_idempotency (
    lodge_id, idempotency_key, request_hash, effective_idempotency_key
  ) values (v_lodge_id, v_key, v_hash, v_effective_key);

  v_result := public.create_online_booking_legacy(
    v_slug,
    jsonb_set(coalesce(payload, '{}'::jsonb), '{idempotency_key}', to_jsonb(v_effective_key), true)
  );
  if not coalesce((v_result->>'success')::boolean, false) then
    delete from public.public_booking_idempotency
     where lodge_id = v_lodge_id and idempotency_key = v_key;
    return v_result;
  end if;

  update public.public_booking_idempotency
     set booking_ids = case
       when jsonb_typeof(v_result->'booking_ids') = 'array'
         then array(select value::text::uuid from jsonb_array_elements_text(v_result->'booking_ids'))
       when nullif(v_result->>'booking_id', '') is not null
         then array[(v_result->>'booking_id')::uuid]
       else array[]::uuid[] end,
         result = v_result,
         updated_at = now()
   where lodge_id = v_lodge_id and idempotency_key = v_key;
  return v_result || jsonb_build_object('idempotent', false);
end;
$$;

revoke all on function public.update_booking_status(uuid, uuid, text, timestamptz, text) from public;
grant execute on function public.update_booking_status(uuid, uuid, text, timestamptz, text) to authenticated, service_role;
revoke all on function public.import_booking_row(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, text, text, uuid, text) from public;
grant execute on function public.import_booking_row(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, text, text, uuid, text) to authenticated, service_role;
revoke all on function public.update_campsite_booking(uuid, uuid, jsonb, timestamptz, text) from public;
grant execute on function public.update_campsite_booking(uuid, uuid, jsonb, timestamptz, text) to authenticated, service_role;
revoke all on function public.reschedule_accommodation_booking(uuid, uuid, uuid, date, date, text, text, text, boolean, numeric, timestamptz, uuid) from public;
grant execute on function public.reschedule_accommodation_booking(uuid, uuid, uuid, date, date, text, text, text, boolean, numeric, timestamptz, uuid) to authenticated, service_role;
revoke all on function public.create_multi_room_booking(uuid, uuid, date, date, jsonb, numeric, numeric, text, text, uuid, text, text) from public;
grant execute on function public.create_multi_room_booking(uuid, uuid, date, date, jsonb, numeric, numeric, text, text, uuid, text, text) to authenticated, service_role;
revoke all on function public.create_online_booking(text, jsonb) from public;
grant execute on function public.create_online_booking(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
