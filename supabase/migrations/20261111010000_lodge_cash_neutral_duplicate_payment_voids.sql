-- Cash-neutral correction for duplicate room receipts on an event invoice.
-- Original payment rows and receipt references remain intact and are marked
-- voided; no refund or cash movement is posted.

begin;

alter table public.payments
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists voided_by uuid,
  add column if not exists voided_as_duplicate_of uuid references public.payments(id),
  add column if not exists void_idempotency_key text,
  add column if not exists void_payload_hash text;

create unique index if not exists payments_void_idempotency_key_uidx
  on public.payments(void_idempotency_key)
  where void_idempotency_key is not null;

create or replace view public.payment_reporting_active as
  select * from public.payments where voided_at is null;
revoke all on public.payment_reporting_active from public, anon, authenticated;

alter table public.payments
  drop constraint if exists payments_void_state_complete_chk;
alter table public.payments
  add constraint payments_void_state_complete_chk check (
    (voided_at is null and void_reason is null and voided_by is null
      and voided_as_duplicate_of is null and void_idempotency_key is null
      and void_payload_hash is null)
    or
    (voided_at is not null and length(btrim(coalesce(void_reason, ''))) >= 8
      and voided_by is not null and voided_as_duplicate_of is not null
      and void_idempotency_key is not null and void_payload_hash is not null)
  );

create or replace function public.recalculate_event_totals(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource_total numeric := 0;
  v_extra_total numeric := 0;
  v_pos_total numeric := 0;
  v_amount_paid numeric := 0;
  v_total numeric := 0;
begin
  select coalesce(sum(subtotal), 0) into v_resource_total
    from public.event_booking_resources where event_booking_id = p_event_id;
  select coalesce(sum(subtotal), 0) into v_extra_total
    from public.event_booking_line_items
   where event_booking_id = p_event_id and voided_at is null and line_type <> 'pos';
  select coalesce(sum(subtotal), 0) into v_pos_total
    from public.event_booking_line_items
   where event_booking_id = p_event_id and voided_at is null and line_type = 'pos';
  select coalesce(sum(case when lower(coalesce(type, '')) = 'refund' then -abs(amount) else amount end), 0)
    into v_amount_paid
    from public.payments
   where conference_booking_id = p_event_id and voided_at is null;

  v_total := round(v_resource_total + v_extra_total + v_pos_total, 2);
  update public.conference_bookings
     set subtotal = v_resource_total,
         extras_total = v_extra_total,
         charges_total = v_pos_total,
         total_amount = v_total,
         amount_paid = v_amount_paid,
         balance_due = greatest(0, v_total - v_amount_paid),
         deposit_paid = v_amount_paid,
         payment_status = case when v_total > 0 and v_amount_paid >= v_total then 'paid'
                               when v_amount_paid > 0 then 'partial' else 'unpaid' end,
         updated_at = now()
   where id = p_event_id;
end;
$$;

create or replace function public.void_duplicate_event_payment(
  p_lodge_id uuid,
  p_event_id uuid,
  p_original_payment_id uuid,
  p_duplicate_payment_id uuid,
  p_expected_amount numeric,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_event public.conference_bookings%rowtype;
  v_original public.payments%rowtype;
  v_duplicate public.payments%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hash text;
  v_replay public.payments%rowtype;
  v_linked boolean := false;
  v_prior_voided numeric := 0;
  v_booking_paid numeric := 0;
  v_before_booking_paid numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated actor is required');
  end if;
  if p_lodge_id is null or p_event_id is null or p_original_payment_id is null or p_duplicate_payment_id is null then
    return jsonb_build_object('success', false, 'error', 'Lodge, event and both receipt IDs are required');
  end if;
  if p_original_payment_id = p_duplicate_payment_id then
    return jsonb_build_object('success', false, 'error', 'An original receipt cannot be voided as its own duplicate');
  end if;
  if p_expected_amount is null or p_expected_amount <= 0 or round(p_expected_amount, 2) <> p_expected_amount then
    return jsonb_build_object('success', false, 'error', 'Expected duplicate amount must be positive with at most two decimals');
  end if;
  if length(coalesce(v_reason, '')) < 8 or length(v_reason) > 500 then
    return jsonb_build_object('success', false, 'error', 'A correction reason of 8 to 500 characters is required');
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 or v_key !~ '^[A-Za-z0-9:_-]+$' then
    return jsonb_build_object('success', false, 'error', 'A valid idempotency key is required');
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id, 'event_id', p_event_id,
    'original_payment_id', p_original_payment_id,
    'duplicate_payment_id', p_duplicate_payment_id,
    'expected_amount', round(p_expected_amount, 2), 'reason', v_reason
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext('event-payment-void:' || v_key));
  select * into v_replay from public.payments where void_idempotency_key = v_key for update;
  if found then
    if v_replay.void_payload_hash is distinct from v_hash
       or v_replay.voided_by is distinct from v_actor then
      return jsonb_build_object('success', false, 'error', 'Correction idempotency key was already used for a different operation');
    end if;
    return jsonb_build_object('success', true, 'idempotent', true,
      'duplicate_payment_id', v_replay.id, 'original_payment_id', v_replay.voided_as_duplicate_of,
      'amount_voided', v_replay.amount, 'cash_movement', 0);
  end if;

  select * into v_event from public.conference_bookings
   where id = p_event_id and lodge_id = p_lodge_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Event booking not found in this lodge');
  end if;

  -- Consistent lock order prevents two corrections from deadlocking.
  perform 1 from public.payments
   where id in (p_original_payment_id, p_duplicate_payment_id)
   order by id for update;
  select * into v_original from public.payments where id = p_original_payment_id;
  select * into v_duplicate from public.payments where id = p_duplicate_payment_id;
  if v_original.id is null or v_duplicate.id is null
     or v_original.lodge_id is distinct from p_lodge_id
     or v_duplicate.lodge_id is distinct from p_lodge_id then
    return jsonb_build_object('success', false, 'error', 'Both receipts must belong to this lodge');
  end if;
  if v_original.conference_booking_id is distinct from p_event_id
     or v_original.booking_id is not null
     or lower(coalesce(v_original.type, '')) <> 'deposit'
     or v_original.amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Source receipt is not a positive event deposit for this event');
  end if;
  if v_duplicate.booking_id is null or v_duplicate.conference_booking_id is not null
     or lower(coalesce(v_duplicate.type, '')) not in ('payment', 'deposit')
     or v_duplicate.amount <= 0
     or round(v_duplicate.amount, 2) <> round(p_expected_amount, 2) then
    return jsonb_build_object('success', false, 'error', 'Duplicate receipt is not the expected positive room payment');
  end if;
  if v_duplicate.voided_at is not null then
    return jsonb_build_object('success', false, 'error', 'Duplicate receipt already has a correction');
  end if;

  select exists (
    select 1 from public.bookings b where b.id = v_duplicate.booking_id
      and b.lodge_id = p_lodge_id and (
        b.id = v_event.exclusive_booking_id
        or exists (select 1 from public.event_booking_rooms r where r.lodge_id = p_lodge_id and r.event_booking_id = p_event_id and r.booking_id = b.id)
        or coalesce(b.notes, '') like '%[EVENT:' || p_event_id::text || ']%'
        or coalesce(b.notes, '') like '%[GROUP:event:' || p_event_id::text || ']%'
        or coalesce(b.notes, '') like '%[GROUP:evt-' || p_event_id::text || ']%'
      )
  ) into v_linked;
  if not v_linked then
    return jsonb_build_object('success', false, 'error', 'Duplicate room receipt is not linked to this event');
  end if;

  select coalesce(sum(amount), 0) into v_prior_voided
    from public.payments
   where voided_as_duplicate_of = p_original_payment_id and voided_at is not null;
  if round(v_prior_voided + v_duplicate.amount, 2) > round(v_original.amount, 2) then
    return jsonb_build_object('success', false, 'error', 'Duplicate corrections would exceed the source event deposit');
  end if;
  if exists (select 1 from public.payments where idempotency_key = v_key) then
    return jsonb_build_object('success', false, 'error', 'Correction key is already used by a payment receipt');
  end if;

  update public.payments
     set voided_at = now(), void_reason = v_reason, voided_by = v_actor,
         voided_as_duplicate_of = p_original_payment_id,
         void_idempotency_key = v_key, void_payload_hash = v_hash
   where id = p_duplicate_payment_id and voided_at is null;

  select coalesce(sum(case when lower(type) = 'refund' then -abs(amount) else amount end), 0)
    into v_booking_paid from public.payments where booking_id = v_duplicate.booking_id and voided_at is null;
  select amount_paid into v_before_booking_paid from public.bookings
   where id = v_duplicate.booking_id and lodge_id = p_lodge_id;
  update public.bookings
     set amount_paid = v_booking_paid,
         payment_status = public.compute_payment_status(v_booking_paid, total_amount, charges_total),
         updated_at = now()
   where id = v_duplicate.booking_id and lodge_id = p_lodge_id;
  perform public.recalculate_event_totals(p_event_id);

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id, amount_delta,
    before_snapshot, after_snapshot, idempotency_key, event_booking_id
  ) values (
    p_lodge_id, v_duplicate.booking_id, 'event_duplicate_payment_voided', v_actor, 0,
    jsonb_build_object('duplicate_payment_id', v_duplicate.id,
      'original_payment_id', v_original.id, 'amount', v_duplicate.amount,
      'booking_amount_paid', v_before_booking_paid,
      'voided_at', null),
    jsonb_build_object('duplicate_payment_id', v_duplicate.id,
      'original_payment_id', v_original.id, 'amount', v_duplicate.amount,
      'reason', v_reason, 'cash_movement', 0,
      'voided_at', (select voided_at from public.payments where id = v_duplicate.id),
      'booking_amount_paid', v_booking_paid),
    v_key, p_event_id
  );

  return jsonb_build_object('success', true, 'idempotent', false,
    'duplicate_payment_id', v_duplicate.id, 'original_payment_id', v_original.id,
    'amount_voided', v_duplicate.amount, 'cash_movement', 0,
    'booking_amount_paid', v_booking_paid);
end;
$$;

revoke all on function public.void_duplicate_event_payment(uuid, uuid, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.void_duplicate_event_payment(uuid, uuid, uuid, uuid, numeric, text, text) to authenticated, service_role;

drop function if exists public.get_event_invoice_payments(uuid, uuid);
create function public.get_event_invoice_payments(p_lodge_id uuid, p_event_id uuid)
returns table (
  id uuid, booking_id uuid, lodge_id uuid, amount numeric, method text, type text,
  paid_at timestamptz, recorded_by uuid, notes text, created_at timestamptz,
  refund_base_amount numeric, refund_retained_percent numeric, refund_retained_amount numeric,
  event_booking_id uuid, voided_at timestamptz, void_reason text,
  voided_as_duplicate_of uuid, voided_by uuid
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist','finance','manager','admin','super_admin']);
  if p_event_id is null or not exists (
    select 1 from public.conference_bookings e where e.id = p_event_id and e.lodge_id = p_lodge_id
  ) then raise exception 'Event invoice not found in this lodge' using errcode = 'P0002'; end if;
  return query
  select p.id,p.booking_id,p.lodge_id,p.amount,p.method,p.type,p.paid_at,p.recorded_by,
         coalesce(p.notes,''),p.created_at,null::numeric,null::numeric,null::numeric,
         p.conference_booking_id,p.voided_at,p.void_reason,p.voided_as_duplicate_of,p.voided_by
    from public.payments p
   where p.lodge_id=p_lodge_id and (
     p.conference_booking_id=p_event_id
     or p.booking_id=(select e.exclusive_booking_id from public.conference_bookings e where e.id=p_event_id and e.lodge_id=p_lodge_id)
     or exists(select 1 from public.event_booking_rooms r where r.event_booking_id=p_event_id and r.booking_id=p.booking_id and r.lodge_id=p_lodge_id)
     or exists(select 1 from public.bookings b where b.id=p.booking_id and b.lodge_id=p_lodge_id and (
       coalesce(b.notes,'') like '%[EVENT:'||p_event_id::text||']%'
       or coalesce(b.notes,'') like '%[GROUP:event:'||p_event_id::text||']%'
       or coalesce(b.notes,'') like '%[GROUP:evt-'||p_event_id::text||']%'))
   ) order by p.paid_at,p.created_at,p.id;
end;
$$;
revoke all on function public.get_event_invoice_payments(uuid, uuid) from public;
grant execute on function public.get_event_invoice_payments(uuid, uuid) to anon, authenticated, service_role;

-- Keep all existing operational/report consumers on the active payment view.
-- The historical receipt remains in the base table and in the event ledger;
-- totals, counts, method summaries, and reconciliation controls omit voided
-- duplicate receipts. Fail closed if an expected report no longer has its
-- known payment-reader shape.
do $$
declare
  v_signature text;
  v_expected_alias integer;
  v_expected_plain integer;
  v_definition text;
  v_alias_pattern text := 'from public.payments p';
  v_plain_pattern text := 'from public.payments';
  v_alias_count integer;
  v_plain_count integer;
  v_active_alias text := 'from public.payment_reporting_active p';
  v_active_plain text := 'from public.payment_reporting_active';
begin
  for v_signature, v_expected_alias, v_expected_plain in
    select * from (values
      ('public.get_booking_register_report(uuid,date,date)', 1, 0),
      ('public.get_financial_exception_report(uuid,date,date)', 2, 0),
      ('public.get_invoice_register_report(uuid,date,date)', 1, 0),
      ('public.get_invoice_summary(uuid,uuid)', 5, 0),
      ('public.get_outstanding_balance_report(uuid,date,date)', 1, 0),
      ('public.get_payment_transaction_report(uuid,date,date)', 1, 0),
      ('public.get_reconciliation_controls_report(uuid,date,date)', 5, 0),
      ('public.app_get_revenue_by_method(integer)', 0, 1),
      ('public.app_get_revenue_summary(integer)', 0, 1)
    ) expected(signature, alias_count, plain_count)
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Expected payment report function is missing: %', v_signature;
    end if;
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    v_alias_count := (length(lower(v_definition)) - length(replace(lower(v_definition), v_alias_pattern, ''))) / length(v_alias_pattern);
    v_plain_count := (length(lower(v_definition)) - length(replace(lower(v_definition), v_plain_pattern, ''))) / length(v_plain_pattern);
    -- The plain substring includes aliased reads, so subtract those before checking.
    v_plain_count := v_plain_count - v_alias_count;
    if v_alias_count <> v_expected_alias or v_plain_count <> v_expected_plain then
      raise exception 'Unexpected payment-reader shape in %, alias %, plain %', v_signature, v_alias_count, v_plain_count;
    end if;
    v_definition := regexp_replace(v_definition, '(?i)from\s+public\.payments\s+p\b', v_active_alias, 'g');
    v_definition := regexp_replace(v_definition, '(?i)from\s+public\.payments\b', v_active_plain, 'g');
    execute v_definition;
  end loop;
end;
$$;

commit;
