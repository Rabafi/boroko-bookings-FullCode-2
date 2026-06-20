-- Customer Credit Ledger + Booking Reschedule
-- Remediated: UUID coalescing, payment type compliance, advisory locks,
--             hardened reversals, read-RPC access checks, constraint tightening.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. customer_credit_ledger table
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.customer_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  entry_type text not null,
  amount numeric(14,2) not null,
  method text,
  reference text,
  notes text not null default '',
  booking_id uuid references public.bookings(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  reverses_entry_id uuid references public.customer_credit_ledger(id) on delete restrict,
  recorded_by uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint customer_credit_amount_positive_chk check (amount > 0),
  constraint customer_credit_entry_type_chk check (
    entry_type in (
      'receipt',
      'booking_allocation',
      'refund',
      'adjustment_in',
      'adjustment_out',
      'reversal_in',
      'reversal_out'
    )
  ),
  constraint customer_credit_idempotency_format_chk check (
    length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint customer_credit_alloc_requires_booking_chk check (
    (entry_type != 'booking_allocation') or (booking_id is not null and payment_id is not null)
  ),
  constraint customer_credit_receipt_refund_requires_method_chk check (
    entry_type not in ('receipt', 'refund') or method is not null
  ),
  constraint customer_credit_reversal_requires_link_chk check (
    entry_type not in ('reversal_in', 'reversal_out') or reverses_entry_id is not null
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Constraints and indexes
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists customer_credit_ledger_lodge_idempotency_uidx
  on public.customer_credit_ledger (lodge_id, idempotency_key);

create index if not exists customer_credit_ledger_customer_created_idx
  on public.customer_credit_ledger (lodge_id, customer_id, created_at desc);

create index if not exists customer_credit_ledger_booking_idx
  on public.customer_credit_ledger (booking_id)
  where booking_id is not null;

create unique index if not exists customer_credit_ledger_reversal_uidx
  on public.customer_credit_ledger (reverses_entry_id)
  where reverses_entry_id is not null;

create or replace function public.enforce_customer_credit_ledger_links()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.booking_id is not null and not exists (
    select 1
      from public.bookings b
     where b.id = new.booking_id
       and b.lodge_id = new.lodge_id
       and b.customer_id = new.customer_id
  ) then
    raise exception 'Credit ledger booking must belong to the same lodge and customer.';
  end if;

  if new.payment_id is not null and not exists (
    select 1
      from public.payments p
     where p.id = new.payment_id
       and p.lodge_id = new.lodge_id
       and (new.booking_id is null or p.booking_id = new.booking_id)
  ) then
    raise exception 'Credit ledger payment must belong to the same lodge and booking.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_customer_credit_ledger_links()
  from public, anon, authenticated;

drop trigger if exists customer_credit_ledger_links_guard on public.customer_credit_ledger;
create trigger customer_credit_ledger_links_guard
before insert or update on public.customer_credit_ledger
for each row execute function public.enforce_customer_credit_ledger_links();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.customer_credit_ledger enable row level security;

revoke all on table public.customer_credit_ledger from public, anon, authenticated;
grant select, insert on table public.customer_credit_ledger to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Extend financial_audit_log.action check constraint
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.financial_audit_log
  DROP CONSTRAINT IF EXISTS financial_audit_log_action_check;

ALTER TABLE public.financial_audit_log
  ADD CONSTRAINT financial_audit_log_action_check CHECK (
    (action = ANY (
      ARRAY[
        'payment_recorded'::text,
        'refund_recorded'::text,
        'charge_added'::text,
        'charge_deleted'::text,
        'booking_total_edited'::text,
        'booking_status_changed'::text,
        'booking_rescheduled'::text,
        'customer_credit_received'::text,
        'customer_credit_allocated'::text,
        'customer_credit_refunded'::text,
        'customer_credit_adjusted'::text,
        'customer_credit_reversed'::text
      ]
    ))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Canonical balance calculation (internal helper, not exposed to clients)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.customer_credit_balance(
  p_lodge_id uuid,
  p_customer_id uuid
)
returns numeric
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(sum(
    case
      when entry_type in ('receipt', 'adjustment_in', 'reversal_in') then amount
      when entry_type in ('booking_allocation', 'refund', 'adjustment_out', 'reversal_out') then -amount
      else 0
    end
  ), 0)::numeric(14,2)
  from public.customer_credit_ledger
  where lodge_id = p_lodge_id
    and customer_id = p_customer_id;
$$;

-- Internal helper only — never expose to anon/authenticated
revoke all on function public.customer_credit_balance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.customer_credit_balance(uuid, uuid)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. record_customer_credit RPC
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.record_customer_credit(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text,
  p_reference text default '',
  p_notes text default '',
  p_recorded_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_claim jsonb;
  v_entry_id uuid;
  v_new_balance numeric;
  v_effective_actor uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  -- Audit identity is always derived from the authenticated server session.
  -- p_recorded_by is retained only for RPC signature compatibility.
  v_effective_actor := v_actor;

  if v_effective_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required.');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Amount must be greater than zero.');
  end if;

  if nullif(btrim(coalesce(p_method, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment method is required.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required.');
  end if;

  if not exists (
    select 1 from public.customers
    where id = p_customer_id and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Customer not found for this lodge.');
  end if;

  -- Customer-level advisory lock to prevent concurrent overspend
  perform pg_advisory_xact_lock(
    hashtextextended(p_lodge_id::text || ':' || p_customer_id::text, 0)
  );

  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'record_customer_credit',
    p_customer_id, md5(round(p_amount,2)::text || ':' || p_method || ':' || coalesce(p_reference, ''))
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  v_entry_id := gen_random_uuid();

  insert into public.customer_credit_ledger (
    id, lodge_id, customer_id, entry_type, amount, method,
    reference, notes, recorded_by, idempotency_key
  ) values (
    v_entry_id, p_lodge_id, p_customer_id, 'receipt', round(p_amount, 2),
    p_method, coalesce(p_reference, ''), coalesce(p_notes, ''), v_effective_actor,
    p_idempotency_key
  );

  v_new_balance := public.customer_credit_balance(p_lodge_id, p_customer_id);

  insert into public.financial_audit_log (
    lodge_id, customer_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key
  ) values (
    p_lodge_id, p_customer_id, 'customer_credit_received',
    v_effective_actor, round(p_amount, 2),
    jsonb_build_object('previous_balance', v_new_balance - p_amount),
    jsonb_build_object('new_balance', v_new_balance, 'entry_id', v_entry_id),
    p_idempotency_key
  );

  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'record_customer_credit',
    p_customer_id, md5(round(p_amount,2)::text || ':' || p_method || ':' || coalesce(p_reference, '')),
    jsonb_build_object('success', true, 'entry_id', v_entry_id, 'balance', v_new_balance)
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'balance', v_new_balance,
    'idempotent', false
  );
end;
$$;

revoke all on function public.record_customer_credit(uuid, uuid, numeric, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_customer_credit(uuid, uuid, numeric, text, text, text, text, uuid)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. apply_customer_credit_to_booking RPC
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.apply_customer_credit_to_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_notes text default '',
  p_recorded_by uuid default null,
  p_expected_booking_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_claim jsonb;
  v_booking public.bookings%rowtype;
  v_available_credit numeric;
  v_outstanding numeric;
  v_allocation numeric;
  v_payment_id uuid;
  v_entry_id uuid;
  v_new_balance numeric;
  v_new_amount_paid numeric;
  v_payment_status text;
  v_effective_actor uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  -- Never trust a client-supplied actor UUID for financial audit identity.
  v_effective_actor := v_actor;

  if v_effective_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required.');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Allocation amount must be greater than zero.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required.');
  end if;

  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'apply_customer_credit',
    p_booking_id, md5(p_customer_id::text || ':' || round(p_amount,2)::text)
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  -- Customer-level advisory lock (must come before booking lock)
  perform pg_advisory_xact_lock(
    hashtextextended(p_lodge_id::text || ':' || p_customer_id::text, 0)
  );

  select * into v_booking
    from public.bookings
   where id = p_booking_id and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found.');
  end if;

  if p_expected_booking_updated_at is not null
     and v_booking.updated_at is distinct from p_expected_booking_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh and try again.',
      'stale', true
    );
  end if;

  if v_booking.customer_id is distinct from p_customer_id then
    return jsonb_build_object('success', false, 'error', 'Customer does not match this booking.');
  end if;

  if v_booking.status in ('cancelled', 'checked_out') then
    return jsonb_build_object('success', false, 'error', 'Cannot allocate credit to a cancelled or checked-out booking.');
  end if;

  v_available_credit := public.customer_credit_balance(p_lodge_id, p_customer_id);
  if v_available_credit <= 0 then
    return jsonb_build_object('success', false, 'error', 'No available customer credit.');
  end if;

  v_outstanding := round(
    greatest(0,
      coalesce(v_booking.total_amount, 0)
      + coalesce(v_booking.charges_total, 0)
      - coalesce(v_booking.amount_paid, 0)
    ), 2
  );

  v_allocation := round(least(p_amount, v_available_credit, v_outstanding), 2);

  if v_allocation <= 0 then
    return jsonb_build_object('success', false, 'error', 'No outstanding amount to allocate against.');
  end if;

  if v_allocation < round(p_amount, 2) then
    return jsonb_build_object(
      'success', false,
      'error', format('Requested %s but only %s can be applied (available credit: %s, outstanding: %s).',
        round(p_amount, 2), v_allocation, v_available_credit, v_outstanding)
    );
  end if;

  v_payment_id := gen_random_uuid();
  v_entry_id := gen_random_uuid();

  -- Insert payment row (type='payment' is valid per payments_type_check)
  insert into public.payments (
    id, booking_id, lodge_id, amount, method, type,
    paid_at, recorded_by, idempotency_key
  ) values (
    v_payment_id, p_booking_id, p_lodge_id, v_allocation, 'customer_credit', 'payment',
    now(), v_effective_actor, p_idempotency_key || ':payment'
  );

  -- Insert ledger entry
  insert into public.customer_credit_ledger (
    id, lodge_id, customer_id, entry_type, amount, method,
    notes, booking_id, payment_id, recorded_by, idempotency_key
  ) values (
    v_entry_id, p_lodge_id, p_customer_id, 'booking_allocation', v_allocation,
    'customer_credit', coalesce(p_notes, ''), p_booking_id, v_payment_id,
    v_effective_actor, p_idempotency_key
  );

  -- Recalculate amount_paid from payments sum (authoritative)
  update public.bookings
     set amount_paid = (select round(coalesce(sum(amount), 0), 2) from public.payments where booking_id = p_booking_id and lodge_id = p_lodge_id),
         payment_status = public.compute_payment_status(
           (select round(coalesce(sum(amount), 0), 2) from public.payments where booking_id = p_booking_id and lodge_id = p_lodge_id),
           total_amount, charges_total
         ),
         updated_at = now()
   where id = p_booking_id and lodge_id = p_lodge_id;

  select amount_paid, payment_status into v_new_amount_paid, v_payment_status
    from public.bookings
   where id = p_booking_id and lodge_id = p_lodge_id;

  v_new_balance := public.customer_credit_balance(p_lodge_id, p_customer_id);

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key
  ) values (
    p_lodge_id, p_booking_id, 'customer_credit_allocated',
    v_effective_actor, v_allocation,
    jsonb_build_object(
      'previous_balance', v_new_balance + v_allocation,
      'previous_amount_paid', coalesce(v_booking.amount_paid, 0),
      'previous_payment_status', v_booking.payment_status
    ),
    jsonb_build_object(
      'new_balance', v_new_balance,
      'new_amount_paid', v_new_amount_paid,
      'payment_status', v_payment_status,
      'entry_id', v_entry_id,
      'payment_id', v_payment_id
    ),
    p_idempotency_key
  );

  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'apply_customer_credit',
    p_booking_id, md5(p_customer_id::text || ':' || round(p_amount,2)::text),
    jsonb_build_object(
      'success', true,
      'entry_id', v_entry_id,
      'payment_id', v_payment_id,
      'balance', v_new_balance,
      'amount_paid', v_new_amount_paid,
      'payment_status', v_payment_status
    )
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'payment_id', v_payment_id,
    'balance', v_new_balance,
    'amount_paid', v_new_amount_paid,
    'payment_status', v_payment_status,
    'idempotent', false
  );
end;
$$;

revoke all on function public.apply_customer_credit_to_booking(uuid, uuid, uuid, numeric, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_customer_credit_to_booking(uuid, uuid, uuid, numeric, text, text, uuid, timestamptz)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. refund_customer_credit RPC
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.refund_customer_credit(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text,
  p_reference text default '',
  p_notes text default '',
  p_requested_by uuid default null,
  p_approved_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_claim jsonb;
  v_available_credit numeric;
  v_entry_id uuid;
  v_new_balance numeric;
  v_effective_actor uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Requested/approved IDs are context only; the authenticated session is the
  -- authoritative actor unless a separate server-verified approval flow is used.
  v_effective_actor := v_actor;

  if v_effective_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required.');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Refund amount must be greater than zero.');
  end if;

  if nullif(btrim(coalesce(p_method, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Refund method is required.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required.');
  end if;

  -- Customer-level advisory lock
  perform pg_advisory_xact_lock(
    hashtextextended(p_lodge_id::text || ':' || p_customer_id::text, 0)
  );

  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'refund_customer_credit',
    p_customer_id, md5(round(p_amount,2)::text || ':' || p_method || ':' || coalesce(p_reference, ''))
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  v_available_credit := public.customer_credit_balance(p_lodge_id, p_customer_id);
  if round(p_amount, 2) > v_available_credit then
    return jsonb_build_object(
      'success', false,
      'error', format('Refund of %s exceeds available credit of %s.', round(p_amount, 2), v_available_credit)
    );
  end if;

  v_entry_id := gen_random_uuid();

  insert into public.customer_credit_ledger (
    id, lodge_id, customer_id, entry_type, amount, method,
    reference, notes, recorded_by, idempotency_key
  ) values (
    v_entry_id, p_lodge_id, p_customer_id, 'refund', round(p_amount, 2),
    p_method, coalesce(p_reference, ''), coalesce(p_notes, ''), v_effective_actor,
    p_idempotency_key
  );

  v_new_balance := public.customer_credit_balance(p_lodge_id, p_customer_id);

  insert into public.financial_audit_log (
    lodge_id, customer_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key
  ) values (
    p_lodge_id, p_customer_id, 'customer_credit_refunded',
    v_effective_actor, -round(p_amount, 2),
    jsonb_build_object('previous_balance', v_new_balance + p_amount),
    jsonb_build_object('new_balance', v_new_balance, 'entry_id', v_entry_id, 'method', p_method),
    p_idempotency_key
  );

  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'refund_customer_credit',
    p_customer_id, md5(round(p_amount,2)::text || ':' || p_method || ':' || coalesce(p_reference, '')),
    jsonb_build_object('success', true, 'entry_id', v_entry_id, 'balance', v_new_balance)
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'balance', v_new_balance,
    'idempotent', false
  );
end;
$$;

revoke all on function public.refund_customer_credit(uuid, uuid, numeric, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_customer_credit(uuid, uuid, numeric, text, text, text, text, uuid, uuid)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. reverse_customer_credit_entry RPC (hardened)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reverse_customer_credit_entry(
  p_lodge_id uuid,
  p_entry_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_recorded_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_claim jsonb;
  v_original public.customer_credit_ledger%rowtype;
  v_reversal_type text;
  v_reversal_entry_id uuid;
  v_new_balance numeric;
  v_new_paid numeric;
  v_payment_status text;
  v_effective_actor uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Never trust renderer-provided audit identity.
  v_effective_actor := v_actor;

  if v_effective_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required.');
  end if;

  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'reverse_customer_credit',
    p_entry_id, md5(p_entry_id::text || ':' || coalesce(p_notes, ''))
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  select * into v_original
    from public.customer_credit_ledger
   where id = p_entry_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Ledger entry not found.');
  end if;

  -- Prevent reversing reversals in v1
  if v_original.entry_type in ('reversal_in', 'reversal_out') then
    return jsonb_build_object('success', false, 'error', 'Reversal entries cannot be reversed.');
  end if;

  if v_original.reverses_entry_id is not null then
    return jsonb_build_object('success', false, 'error', 'This entry has already been reversed.');
  end if;

  if exists (
    select 1 from public.customer_credit_ledger
    where reverses_entry_id = p_entry_id
  ) then
    return jsonb_build_object('success', false, 'error', 'This entry has already been reversed.');
  end if;

  -- Customer-level advisory lock
  perform pg_advisory_xact_lock(
    hashtextextended(p_lodge_id::text || ':' || v_original.customer_id::text, 0)
  );

  case v_original.entry_type
    when 'receipt', 'adjustment_in' then
      v_reversal_type := 'reversal_out';
      -- Check available credit before reversing receipt
      if public.customer_credit_balance(p_lodge_id, v_original.customer_id) < v_original.amount then
        return jsonb_build_object(
          'success', false,
          'error', format('Cannot reverse receipt: only %s credit available but receipt was %s.',
            public.customer_credit_balance(p_lodge_id, v_original.customer_id), v_original.amount)
        );
      end if;
    when 'booking_allocation' then
      v_reversal_type := 'reversal_in';
      -- Lock the booking and reverse the payment
      if v_original.booking_id is not null then
        perform 1
          from public.bookings
         where id = v_original.booking_id
           and lodge_id = p_lodge_id
           and customer_id = v_original.customer_id
         for update;

        if not found then
          return jsonb_build_object('success', false, 'error', 'Linked booking not found for this customer and lodge.');
        end if;

        -- Insert negative payment to reverse the allocation
        insert into public.payments (
          booking_id, lodge_id, amount, method, type,
          paid_at, recorded_by, idempotency_key
        ) values (
          v_original.booking_id, p_lodge_id, -v_original.amount, 'customer_credit', 'refund',
          now(), v_effective_actor, p_idempotency_key || ':payment'
        );

        -- Recalculate amount_paid from authoritative payments
        update public.bookings
           set amount_paid = (select round(coalesce(sum(amount), 0), 2) from public.payments where booking_id = v_original.booking_id and lodge_id = p_lodge_id),
               payment_status = public.compute_payment_status(
                 (select round(coalesce(sum(amount), 0), 2) from public.payments where booking_id = v_original.booking_id and lodge_id = p_lodge_id),
                 total_amount, charges_total
               ),
               updated_at = now()
         where id = v_original.booking_id and lodge_id = p_lodge_id;

        select amount_paid, payment_status into v_new_paid, v_payment_status
          from public.bookings
         where id = v_original.booking_id and lodge_id = p_lodge_id;
      end if;
    when 'refund' then
      v_reversal_type := 'reversal_in';
    when 'adjustment_out' then
      v_reversal_type := 'reversal_in';
    else
      return jsonb_build_object('success', false, 'error', 'This entry type cannot be reversed.');
  end case;

  v_reversal_entry_id := gen_random_uuid();

  insert into public.customer_credit_ledger (
    id, lodge_id, customer_id, entry_type, amount, method,
    reference, notes, booking_id, payment_id,
    reverses_entry_id, recorded_by, idempotency_key
  ) values (
    v_reversal_entry_id, p_lodge_id, v_original.customer_id,
    v_reversal_type, v_original.amount, v_original.method,
    'Reversal of ' || v_original.id, coalesce(p_notes, ''),
    v_original.booking_id, v_original.payment_id,
    p_entry_id, v_effective_actor, p_idempotency_key
  );

  v_new_balance := public.customer_credit_balance(p_lodge_id, v_original.customer_id);

  insert into public.financial_audit_log (
    lodge_id, customer_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key
  ) values (
    p_lodge_id, v_original.customer_id, 'customer_credit_reversed',
    v_effective_actor, case when v_reversal_type = 'reversal_in' then v_original.amount else -v_original.amount end,
    jsonb_build_object('original_entry_id', p_entry_id, 'original_type', v_original.entry_type),
    jsonb_build_object('reversal_entry_id', v_reversal_entry_id, 'new_balance', v_new_balance),
    p_idempotency_key
  );

  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'reverse_customer_credit',
    p_entry_id, md5(p_entry_id::text || ':' || coalesce(p_notes, '')),
    jsonb_build_object('success', true, 'reversal_entry_id', v_reversal_entry_id, 'balance', v_new_balance)
  );

  return jsonb_build_object(
    'success', true,
    'reversal_entry_id', v_reversal_entry_id,
    'balance', v_new_balance,
    'idempotent', false
  );
end;
$$;

revoke all on function public.reverse_customer_credit_entry(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reverse_customer_credit_entry(uuid, uuid, text, text, uuid)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Read RPCs (with access checks and pagination validation)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_customer_credit_balance(
  p_lodge_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.customers where id = p_customer_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Customer not found for this lodge.';
  end if;

  return jsonb_build_object(
    'success', true,
    'balance', public.customer_credit_balance(p_lodge_id, p_customer_id)
  );
end;
$$;

revoke all on function public.get_customer_credit_balance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_customer_credit_balance(uuid, uuid)
  to anon, authenticated, service_role;

create or replace function public.get_customer_credit_history(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  entry_type text,
  amount numeric,
  method text,
  reference text,
  notes text,
  booking_id uuid,
  payment_id uuid,
  reverses_entry_id uuid,
  recorded_by uuid,
  idempotency_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.customers where id = p_customer_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Customer not found for this lodge.';
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  p_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select l.id, l.entry_type, l.amount, l.method, l.reference, l.notes,
         l.booking_id, l.payment_id, l.reverses_entry_id, l.recorded_by,
         l.idempotency_key, l.created_at
    from public.customer_credit_ledger l
   where l.lodge_id = p_lodge_id
     and l.customer_id = p_customer_id
   order by l.created_at desc
   limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_customer_credit_history(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_customer_credit_history(uuid, uuid, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.get_customer_credit_summary(
  p_lodge_id uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  customer_id uuid,
  customer_name text,
  balance numeric,
  total_receipts numeric,
  total_allocations numeric,
  total_refunds numeric,
  last_activity timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  p_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select
    l.customer_id,
    coalesce(c.name, 'Unknown') as customer_name,
    public.customer_credit_balance(p_lodge_id, l.customer_id) as balance,
    coalesce(sum(case when l.entry_type = 'receipt' then l.amount else 0 end), 0) as total_receipts,
    coalesce(sum(case when l.entry_type = 'booking_allocation' then l.amount else 0 end), 0) as total_allocations,
    coalesce(sum(case when l.entry_type = 'refund' then l.amount else 0 end), 0) as total_refunds,
    max(l.created_at) as last_activity
  from public.customer_credit_ledger l
  left join public.customers c on c.id = l.customer_id
  where l.lodge_id = p_lodge_id
    and (p_search is null or c.name ilike '%' || p_search || '%')
  group by l.customer_id, c.name
  having public.customer_credit_balance(p_lodge_id, l.customer_id) > 0
  order by balance desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_customer_credit_summary(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_customer_credit_summary(uuid, text, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.get_customer_credit_cash_flow(
  p_lodge_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table(
  amount numeric,
  method text,
  entry_type text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  if p_start_at is null or p_end_at is null or p_end_at < p_start_at then
    raise exception 'A valid cash-flow date range is required.';
  end if;

  return query
  select l.amount, l.method, l.entry_type, l.created_at
    from public.customer_credit_ledger l
   where l.lodge_id = p_lodge_id
     and l.entry_type in ('receipt', 'refund')
     and l.created_at >= p_start_at
     and l.created_at <= p_end_at
   order by l.created_at;
end;
$$;

revoke all on function public.get_customer_credit_cash_flow(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_customer_credit_cash_flow(uuid, timestamptz, timestamptz)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. reschedule_booking RPC
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reschedule_booking(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_new_room_id uuid,
  p_new_check_in date,
  p_new_check_out date,
  p_reason text,
  p_idempotency_key text,
  p_overpayment_action text default 'reject',
  p_allow_total_override boolean default false,
  p_override_total numeric default null,
  p_expected_updated_at timestamptz default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_claim jsonb;
  v_booking public.bookings%rowtype;
  v_room public.rooms%rowtype;
  v_conflict_count integer;
  v_new_total numeric;
  v_old_total numeric;
  v_amount_paid numeric;
  v_charges_total numeric;
  v_new_owed numeric;
  v_overpayment numeric;
  v_additional_due numeric;
  v_payment_status text;
  v_transfer_entry_id uuid;
  v_transfer_payment_id uuid;
  v_effective_actor uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);

  -- Reschedule audit identity comes from the authenticated session.
  v_effective_actor := v_actor;

  if v_effective_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required.');
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'A reason is required for rescheduling.');
  end if;

  if p_new_check_out <= p_new_check_in then
    return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in.');
  end if;

  if p_overpayment_action not in ('reject', 'transfer_to_customer_credit') then
    return jsonb_build_object('success', false, 'error', 'overpayment_action must be reject or transfer_to_customer_credit.');
  end if;

  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'reschedule_booking',
    p_booking_id, md5(p_new_room_id::text || ':' || p_new_check_in::text || ':' || p_new_check_out::text || ':' || coalesce(p_reason, ''))
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return v_claim;
  end if;

  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;

  select * into v_booking
    from public.bookings
   where id = p_booking_id and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found.');
  end if;

  if p_expected_updated_at is not null
     and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh and try again.',
      'stale', true
    );
  end if;

  if v_booking.status not in ('pending', 'confirmed') then
    return jsonb_build_object(
      'success', false,
      'error', format('Cannot reschedule a booking in status "%s". Only pending or confirmed bookings can be rescheduled.', v_booking.status)
    );
  end if;

  select * into v_room
    from public.rooms
   where id = p_new_room_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found.');
  end if;

  if v_room.status = 'maintenance' then
    return jsonb_build_object('success', false, 'error', 'Selected room is under maintenance.');
  end if;

  -- Room conflict check (exclude current booking)
  select count(*) into v_conflict_count
    from public.bookings
   where room_id = p_new_room_id
     and lodge_id = p_lodge_id
     and status != 'cancelled'
     and id != p_booking_id
     and not (check_out <= p_new_check_in or check_in >= p_new_check_out);

  if v_conflict_count > 0 then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates.');
  end if;

  -- Exclusive event check: if rescheduling an exclusive event, exclude self
  if v_booking.is_exclusive_event then
    -- This IS an exclusive event booking — block any other active booking across the lodge
    if exists (
      select 1 from public.bookings
     where lodge_id = p_lodge_id
       and status != 'cancelled'
       and id != p_booking_id
       and not (check_out <= p_new_check_in or check_in >= p_new_check_out)
    ) then
      return jsonb_build_object('success', false, 'error', 'Cannot reschedule exclusive event: other active bookings exist for these dates.');
    end if;
  else
    -- Normal booking — reject if any exclusive event overlaps
    if exists (
      select 1 from public.bookings
     where lodge_id = p_lodge_id
       and is_exclusive_event = true
       and status != 'cancelled'
       and not (check_out <= p_new_check_in or check_in >= p_new_check_out)
    ) then
      return jsonb_build_object('success', false, 'error', 'The lodge is fully reserved for an exclusive event on these dates.');
    end if;
  end if;

  v_new_total := public.room_booking_expected_total(p_lodge_id, p_new_room_id, p_new_check_in, p_new_check_out);
  if v_new_total is null then
    return jsonb_build_object('success', false, 'error', 'Could not calculate room rate for new dates.');
  end if;

  if p_allow_total_override and p_override_total is not null and p_override_total > 0 then
    perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
    v_new_total := round(p_override_total, 2);
  end if;

  v_old_total := round(coalesce(v_booking.total_amount, 0), 2);
  -- Use authoritative payments sum instead of booking.amount_paid
  select round(coalesce(sum(amount), 0), 2) into v_amount_paid
    from public.payments
   where booking_id = p_booking_id and lodge_id = p_lodge_id;
  v_charges_total := round(coalesce(v_booking.charges_total, 0), 2);
  v_new_owed := round(v_new_total + v_charges_total, 2);
  v_overpayment := round(greatest(0, v_amount_paid - v_new_owed), 2);
  v_additional_due := round(greatest(0, v_new_owed - v_amount_paid), 2);

  if v_overpayment > 0 and p_overpayment_action = 'reject' then
    return jsonb_build_object(
      'success', false,
      'error', format('Reschedule creates an overpayment of %s. Use transfer_to_customer_credit or cancel the reschedule.', v_overpayment),
      'overpayment', v_overpayment
    );
  end if;

  if v_overpayment > 0 and p_overpayment_action = 'transfer_to_customer_credit' then
    v_transfer_payment_id := gen_random_uuid();
    v_transfer_entry_id := gen_random_uuid();

    -- Use type='refund' (valid per payments_type_check) with method='customer_credit_transfer'
    insert into public.payments (
      id, booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, idempotency_key
    ) values (
      v_transfer_payment_id, p_booking_id, p_lodge_id,
      -v_overpayment, 'customer_credit_transfer', 'refund',
      now(), v_effective_actor, p_idempotency_key || ':transfer'
    );

    insert into public.customer_credit_ledger (
      id, lodge_id, customer_id, entry_type, amount, method,
      reference, notes, booking_id, payment_id, recorded_by, idempotency_key
    ) values (
      v_transfer_entry_id, p_lodge_id, v_booking.customer_id,
      'adjustment_in', v_overpayment, 'customer_credit_transfer',
      'Overpayment from reschedule of booking ' || p_booking_id,
      'Transfer from reschedule: ' || p_reason,
      p_booking_id, v_transfer_payment_id, v_effective_actor,
      p_idempotency_key || ':credit'
    );

    v_amount_paid := round(v_amount_paid - v_overpayment, 2);
  end if;

  v_payment_status := public.compute_payment_status(v_amount_paid, v_new_total, v_charges_total);

  update public.bookings
     set room_id = p_new_room_id,
         check_in = p_new_check_in,
         check_out = p_new_check_out,
         total_amount = v_new_total,
         amount_paid = v_amount_paid,
         payment_status = v_payment_status,
         updated_at = now()
   where id = p_booking_id and lodge_id = p_lodge_id;

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key
  ) values (
    p_lodge_id, p_booking_id, 'booking_rescheduled',
    v_effective_actor, round(v_new_total - v_old_total, 2),
    jsonb_build_object(
      'old_room_id', v_booking.room_id,
      'old_check_in', v_booking.check_in,
      'old_check_out', v_booking.check_out,
      'old_total_amount', v_old_total,
      'amount_paid', v_amount_paid + case when v_overpayment > 0 then v_overpayment else 0 end,
      'old_payment_status', v_booking.payment_status
    ),
    jsonb_build_object(
      'new_room_id', p_new_room_id,
      'new_check_in', p_new_check_in,
      'new_check_out', p_new_check_out,
      'new_total_amount', v_new_total,
      'amount_paid', v_amount_paid,
      'payment_status', v_payment_status,
      'overpayment_transferred', v_overpayment,
      'additional_due', v_additional_due,
      'reason', p_reason
    ),
    p_idempotency_key
  );

  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'reschedule_booking',
    p_booking_id, md5(p_new_room_id::text || ':' || p_new_check_in::text || ':' || p_new_check_out::text || ':' || coalesce(p_reason, '')),
    jsonb_build_object(
      'success', true,
      'new_total', v_new_total,
      'amount_paid', v_amount_paid,
      'payment_status', v_payment_status,
      'overpayment_transferred', v_overpayment,
      'additional_due', v_additional_due
    )
  );

  return jsonb_build_object(
    'success', true,
    'new_total', v_new_total,
    'amount_paid', v_amount_paid,
    'payment_status', v_payment_status,
    'overpayment_transferred', v_overpayment,
    'additional_due', v_additional_due,
    'idempotent', false
  );
end;
$$;

revoke all on function public.reschedule_booking(uuid, uuid, uuid, date, date, text, text, text, boolean, numeric, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.reschedule_booking(uuid, uuid, uuid, date, date, text, text, text, boolean, numeric, timestamptz, uuid)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Add customer_id column to financial_audit_log for credit events
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_audit_log' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.financial_audit_log ADD COLUMN customer_id uuid;
  END IF;
END $$;

commit;
