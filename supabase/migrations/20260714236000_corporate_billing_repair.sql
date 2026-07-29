-- ── Phase 3: Corporate billing concurrency, locking, and feature gating ──
-- Fixes remaining issues in charge_to_corporate_account and
-- record_corporate_payment after the idempotency-key migration.
--
-- 1. Replace app_require_lodge_role → app_require_feature('corporate_accounts')
-- 2. Idempotency key required (8-128 chars) for every financial mutation
-- 3. Race-free invoice number via advisory lock
-- 4. Row-lock invoices in deterministic ORDER BY against concurrent overpayment
-- 5. Sequential per-invoice allocation against actual outstanding balances
-- 6. Folio settlement failure rolls back the entire transaction

begin;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. charge_to_corporate_account
-- ═════════════════════════════════════════════════════════════════════════

drop function if exists public.charge_to_corporate_account(uuid, uuid, uuid, numeric, text, boolean, text);

create or replace function public.charge_to_corporate_account(
  p_account_id uuid,
  p_lodge_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_description text default '',
  p_settle_booking boolean default true,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invoice_number text;
  v_invoice_id uuid;
  v_corp public.corporate_accounts%rowtype;
  v_booking public.bookings%rowtype;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_balance numeric;
  v_payment_id uuid;
  v_terms integer;
  v_settle numeric;
  v_folio_id uuid;
  v_folio_balance numeric;
  v_credit jsonb;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_claim jsonb;
  v_result jsonb;
  v_hash text;
  v_payment_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'corporate_accounts', array['manager', 'admin', 'super_admin', 'finance']);

  -- Require idempotency key (8-128 chars)
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'Idempotency key must be between 8 and 128 characters');
  end if;

  -- Compute canonical request hash
  v_hash := encode(
    sha256(
      (coalesce(p_account_id::text, '') || '|' ||
       coalesce(p_booking_id::text, '') || '|' ||
       coalesce(v_amount::text, '') || '|' ||
       coalesce(p_description, '') || '|' ||
       coalesce(p_settle_booking::text, ''))::bytea
    ),
    'hex'
  );
  v_claim := public._claim_financial_operation(
    p_lodge_id, v_key, 'charge_to_corporate_account', p_booking_id, v_hash
  );
  if (v_claim->>'success')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'found')::boolean = true then
    return coalesce(v_claim->'operation_result', v_claim);
  end if;

  -- Lock corporate account row and verify
  select * into v_corp
  from public.corporate_accounts
  where id = p_account_id and lodge_id = p_lodge_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Corporate account not found');
  end if;
  if lower(coalesce(v_corp.status, '')) = 'suspended' then
    return jsonb_build_object('success', false, 'error', 'Corporate account is suspended');
  end if;

  -- Lock booking row
  select * into v_booking
  from public.bookings
  where id = p_booking_id and lodge_id = p_lodge_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_balance := greatest(
    0,
    coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0) - coalesce(v_booking.amount_paid, 0)
  );

  if v_amount <= 0 then
    v_amount := v_balance;
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'No amount to charge');
  end if;

  -- Credit limit check (locked account row ensures no race)
  if coalesce(v_corp.credit_limit, 0) > 0 then
    v_credit := public.check_credit_limit_with_pending(p_account_id, p_lodge_id, v_amount);
    if not coalesce((v_credit->>'within_limit')::boolean, false) then
      return jsonb_build_object('success', false, 'error', 'Charge would exceed corporate credit limit', 'credit', v_credit);
    end if;
  end if;

  -- Race-free invoice number: advisory lock per lodge
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('corp_invoice:' || p_lodge_id::text, 0)
  );
  v_terms := greatest(coalesce(v_corp.payment_terms_days, 30), 0);
  v_invoice_number := 'CINV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(
    (select count(*) + 1 from public.corporate_invoice_items where lodge_id = p_lodge_id)::text,
    4, '0'
  );
  v_invoice_id := gen_random_uuid();

  insert into public.corporate_invoice_items (
    id, corporate_account_id, lodge_id, invoice_number, description,
    amount, tax_amount, issue_date, due_date, status, reference_booking_ids
  ) values (
    v_invoice_id, p_account_id, p_lodge_id, v_invoice_number,
    coalesce(nullif(p_description, ''), 'Company charge for booking ' || left(p_booking_id::text, 8)),
    v_amount, 0, current_date,
    current_date + v_terms, 'sent',
    array[p_booking_id]
  );

  update public.bookings
     set corporate_account_id = p_account_id,
         updated_at = now()
   where id = p_booking_id and lodge_id = p_lodge_id;

  -- Optionally settle booking via payment
  if coalesce(p_settle_booking, true) and v_amount > 0 then
    v_settle := least(v_amount, v_balance);
    v_payment_id := gen_random_uuid();

    insert into public.payments (
      id, booking_id, lodge_id, amount, method, type, paid_at, notes
    ) values (
      v_payment_id,
      p_booking_id,
      p_lodge_id,
      v_settle,
      'corporate',
      'payment',
      now(),
      'Corporate invoice ' || v_invoice_number
    );

    update public.bookings b
       set amount_paid = coalesce(b.amount_paid, 0) + v_settle,
           payment_status = case
             when coalesce(b.amount_paid, 0) + v_settle
                  >= coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0)
                  and coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) > 0
               then 'paid'
             when coalesce(b.amount_paid, 0) + v_settle > 0 then 'partial'
             else 'unpaid'
           end,
           payment_method = 'corporate',
           updated_at = now()
     where b.id = p_booking_id and b.lodge_id = p_lodge_id;

    -- Folio settlement: fail entire transaction if it fails
    if to_regclass('public.hotel_folios') is not null then
      select hf.id, hf.balance
        into v_folio_id, v_folio_balance
      from public.hotel_folios hf
      where hf.lodge_id = p_lodge_id
        and hf.booking_id = p_booking_id
        and hf.status = 'open'
        and coalesce(hf.balance, 0) > 0
      order by hf.created_at
      limit 1;

      if v_folio_id is not null and coalesce(v_folio_balance, 0) > 0 then
        v_payment_result := public.add_folio_payment(
          p_lodge_id,
          v_folio_id,
          least(v_settle, v_folio_balance),
          'Corporate invoice ' || v_invoice_number
        );
        if (v_payment_result->>'success')::boolean is not true then
          raise exception 'Folio settlement failed: %', coalesce(v_payment_result->>'error', 'unknown error');
        end if;
      end if;
    end if;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', v_amount,
    'due_date', current_date + v_terms,
    'booking_id', p_booking_id,
    'settled_booking', coalesce(p_settle_booking, true),
    'payment_id', v_payment_id
  );

  perform public._record_financial_operation(
    p_lodge_id, v_key, 'charge_to_corporate_account', p_booking_id, v_hash, v_result
  );

  return v_result;
end;
$$;

grant execute on function public.charge_to_corporate_account(uuid, uuid, uuid, numeric, text, boolean, text)
  to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. record_corporate_payment
-- ═════════════════════════════════════════════════════════════════════════

drop function if exists public.record_corporate_payment(uuid, uuid, uuid[], numeric, text, text, text);

create or replace function public.record_corporate_payment(
  p_account_id uuid,
  p_lodge_id uuid,
  p_invoice_ids uuid[],
  p_amount numeric,
  p_payment_method text default 'bank_transfer',
  p_reference text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_invoice_id uuid;
  v_invoice record;
  v_remaining numeric;
  v_allocated numeric := 0;
  v_payment_ids uuid[] := '{}';
  v_allocation_details jsonb := '[]'::jsonb;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_claim jsonb;
  v_result jsonb;
  v_hash text;
  v_distinct_count int;
  v_this_allocation numeric;
begin
  perform public.app_require_feature(p_lodge_id, 'corporate_accounts', array['manager', 'admin', 'super_admin', 'finance']);

  -- Require idempotency key (8-128 chars)
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'Idempotency key must be between 8 and 128 characters');
  end if;

  -- Compute canonical request hash
  v_hash := encode(
    sha256(
      (coalesce(p_account_id::text, '') || '|' ||
       coalesce(p_amount::text, '') || '|' ||
       coalesce(p_payment_method, '') || '|' ||
       coalesce(p_reference, '') || '|' ||
       array_to_string((
         select array_agg(i order by i)
         from unnest(p_invoice_ids) i
       ), ','))::bytea
    ),
    'hex'
  );
  v_claim := public._claim_financial_operation(
    p_lodge_id, v_key, 'record_corporate_payment', p_account_id, v_hash
  );
  if (v_claim->>'success')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'found')::boolean = true then
    return coalesce(v_claim->'operation_result', v_claim);
  end if;

  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Payment amount must be positive');
  end if;

  -- Validate nonempty, distinct invoice array
  if p_invoice_ids is null or array_length(p_invoice_ids, 1) is null or array_length(p_invoice_ids, 1) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one invoice must be specified');
  end if;
  select count(*) into v_distinct_count
  from (select distinct unnest(p_invoice_ids)) d;
  if v_distinct_count <> array_length(p_invoice_ids, 1) then
    return jsonb_build_object('success', false, 'error', 'Duplicate invoice IDs are not allowed');
  end if;

  -- Lock all target invoices in deterministic ID order
  -- and confirm every invoice belongs to the account and lodge
  for v_invoice in
    select i.id, i.amount, i.lodge_id, i.corporate_account_id,
           coalesce(sum(cp.amount), 0) as paid_so_far
    from public.corporate_invoice_items i
    left join public.corporate_payments cp on cp.invoice_id = i.id
    where i.id = any(p_invoice_ids)
      and i.corporate_account_id = p_account_id
      and i.lodge_id = p_lodge_id
    group by i.id, i.amount, i.lodge_id, i.corporate_account_id
    order by i.id
    for update of i
  loop
    v_remaining := v_invoice.amount - v_invoice.paid_so_far;
    if v_remaining <= 0 then
      continue;
    end if;

    -- Allocate against this invoice's outstanding balance
    v_payment_id := gen_random_uuid();
    v_this_allocation := least(v_remaining, p_amount - v_allocated);

    insert into public.corporate_payments (
      id, corporate_account_id, lodge_id, invoice_id, amount, payment_date, payment_method, reference
    ) values (
      v_payment_id,
      p_account_id,
      p_lodge_id,
      v_invoice.id,
      v_this_allocation,
      current_date,
      p_payment_method,
      p_reference
    );

    v_allocated := v_allocated + v_this_allocation;
    v_payment_ids := array_append(v_payment_ids, v_payment_id);
    v_allocation_details := v_allocation_details || jsonb_build_object(
      'invoice_id', v_invoice.id,
      'payment_id', v_payment_id,
      'allocated', v_this_allocation
    );

    exit when v_allocated >= p_amount;
  end loop;

  if v_allocated < p_amount then
    raise exception 'Payment allocation incomplete: allocated % of % — some invoices not found or fully paid', v_allocated, p_amount;
  end if;

  -- Update invoice statuses where fully paid
  for v_invoice_id in select distinct unnest(p_invoice_ids)
  loop
    update public.corporate_invoice_items i set
      status = case
        when (select coalesce(sum(cp3.amount), 0)
              from public.corporate_payments cp3
              where cp3.invoice_id = i.id) >= i.amount then 'paid'
        else i.status
      end,
      paid_date = case
        when (select coalesce(sum(cp3.amount), 0)
              from public.corporate_payments cp3
              where cp3.invoice_id = i.id) >= i.amount then current_date
        else paid_date
      end,
      updated_at = now()
    where i.id = v_invoice_id;
  end loop;

  v_result := jsonb_build_object(
    'success', true,
    'payment_ids', v_payment_ids,
    'allocated', v_allocated,
    'allocation', v_allocation_details
  );

  perform public._record_financial_operation(
    p_lodge_id, v_key, 'record_corporate_payment', p_account_id, v_hash, v_result
  );

  return v_result;
end;
$$;

grant execute on function public.record_corporate_payment(uuid, uuid, uuid[], numeric, text, text, text)
  to authenticated;

commit;
