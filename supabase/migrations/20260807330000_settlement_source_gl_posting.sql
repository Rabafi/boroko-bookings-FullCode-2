-- Settlement completion: explicit gross/net/fee evidence, atomic clearing-to-bank
-- posting, durable source coverage, and a governed bank-match link.
-- Forward-only. Existing record_restaurant_settlement(payload) callers remain valid;
-- accounting-enabled lodges now fail closed unless the full settlement payload can post.

begin;

alter table public.restaurant_settlement_reconciliations
  add column if not exists settlement_date date,
  add column if not exists fee_amount numeric(15,2) not null default 0,
  add column if not exists bank_account_id uuid references public.restaurant_bank_accounts(id) on delete restrict,
  add column if not exists journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists operation_id uuid,
  add column if not exists payload_hash text,
  add column if not exists source_version integer not null default 1,
  add column if not exists bank_statement_transaction_id uuid references public.restaurant_bank_transactions(id) on delete restrict,
  add column if not exists bank_match_evidence_ref text,
  add column if not exists bank_matched_by uuid references public.users(id),
  add column if not exists bank_matched_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restaurant_settlement_reconciliations'::regclass
      and conname = 'restaurant_settlement_fee_amount_chk'
  ) then
    alter table public.restaurant_settlement_reconciliations
      add constraint restaurant_settlement_fee_amount_chk check (fee_amount >= 0);
  end if;
end
$$;

create unique index if not exists restaurant_settlement_operation_uidx
  on public.restaurant_settlement_reconciliations(lodge_id, operation_id)
  where operation_id is not null;

create unique index if not exists restaurant_settlement_bank_transaction_uidx
  on public.restaurant_settlement_reconciliations(lodge_id, bank_statement_transaction_id)
  where bank_statement_transaction_id is not null;

create or replace function public.get_restaurant_settlement_bank_accounts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'pos.manage');
  return jsonb_build_object(
    'success', true,
    'data', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'bank_name', b.bank_name,
        'account_type', b.account_type,
        'account_id', b.account_id,
        'account_number_masked', case
          when nullif(btrim(b.account_number), '') is null then null
          else repeat('*', greatest(length(b.account_number) - 4, 0)) || right(b.account_number, 4)
        end
      ) order by b.name, b.id)
      from public.restaurant_bank_accounts b
      where b.lodge_id = p_lodge_id and b.is_active
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.record_restaurant_settlement(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_actor uuid := public.app_current_user_id();
  v_start date := coalesce(nullif(p_payload->>'period_start', '')::date, nullif(p_payload->>'business_date', '')::date, current_date);
  v_end date := coalesce(nullif(p_payload->>'period_end', '')::date, nullif(p_payload->>'business_date', '')::date, current_date);
  v_settlement_date date := coalesce(nullif(p_payload->>'settlement_date', '')::date, v_end);
  v_channel text := lower(nullif(btrim(p_payload->>'channel'), ''));
  v_provider text := nullif(btrim(p_payload->>'provider'), '');
  v_reference text := nullif(btrim(p_payload->>'reference'), '');
  v_notes text := nullif(btrim(p_payload->>'notes'), '');
  v_settled numeric := round(coalesce(nullif(p_payload->>'settled_amount', '')::numeric, 0), 2);
  v_fee numeric := round(coalesce(nullif(p_payload->>'fee_amount', '')::numeric, 0), 2);
  v_expected numeric;
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_operation uuid := case
    when nullif(p_payload->>'operation_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (p_payload->>'operation_id')::uuid
    else gen_random_uuid()
  end;
  v_id uuid := coalesce(nullif(p_payload->>'id', '')::uuid, gen_random_uuid());
  v_inserted_id uuid;
  v_existing public.restaurant_settlement_reconciliations%rowtype;
  v_hash text;
  v_bank_account_id uuid := nullif(p_payload->>'bank_account_id', '')::uuid;
  v_bank_gl_account uuid;
  v_clearing_account uuid;
  v_fee_account uuid;
  v_journal jsonb;
  v_journal_entry uuid;
  v_active boolean := public.restaurant_accounting_is_active(v_lodge_id);
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);
  if v_actor is null or not exists (select 1 from public.users where id = v_actor and lodge_id = v_lodge_id) then
    raise exception 'Your staff session could not be verified. Sign in again before recording a settlement.' using errcode = '42501';
  end if;
  if v_start is null or v_end is null or v_end < v_start or v_settlement_date < v_start then
    raise exception 'Settlement dates must form a valid period and settlement date.' using errcode = '22023';
  end if;
  if v_channel not in ('card', 'mobile_money', 'delivery_platform', 'bank', 'voucher') then
    raise exception 'Choose a supported settlement channel.' using errcode = '22023';
  end if;
  if v_provider is null or v_reference is null then
    raise exception 'Settlement provider and external batch/reference evidence are required.' using errcode = '22023';
  end if;
  if v_key is null or length(v_key) < 8 or v_settled < 0 or v_fee < 0 then
    raise exception 'A stable settlement key and non-negative settled and fee amounts are required.' using errcode = '22023';
  end if;

  select (public.get_restaurant_settlement_expected_total(v_lodge_id, v_start, v_end, v_channel)->>'expected_amount')::numeric
    into v_expected;
  if round(v_expected, 2) <> round(v_settled + v_fee, 2) then
    raise exception 'Settlement gross must equal net deposit plus explicit provider fee. Record the unresolved difference as a governed exception before posting.' using errcode = '23514';
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', v_lodge_id, 'period_start', v_start, 'period_end', v_end,
    'settlement_date', v_settlement_date, 'channel', v_channel, 'provider', v_provider,
    'expected_amount', round(v_expected, 2), 'settled_amount', v_settled,
    'fee_amount', v_fee, 'reference', v_reference, 'notes', v_notes,
    'bank_account_id', v_bank_account_id, 'operation_id', v_operation
  )::text, 'sha256'), 'hex');

  insert into public.restaurant_settlement_reconciliations(
    id, lodge_id, outlet_id, business_date, period_start, period_end,
    settlement_date, channel, provider, expected_amount, settled_amount, fee_amount,
    reference, notes, recorded_by, idempotency_key, operation_id, payload_hash,
    bank_account_id
  ) values (
    v_id, v_lodge_id, nullif(p_payload->>'outlet_id', '')::uuid, v_end, v_start, v_end,
    v_settlement_date,
    v_channel, v_provider, round(v_expected, 2), v_settled, v_fee,
    v_reference, v_notes, v_actor, v_key, v_operation, v_hash, v_bank_account_id
  )
  on conflict (lodge_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select * into v_existing
    from public.restaurant_settlement_reconciliations
    where lodge_id = v_lodge_id and idempotency_key = v_key
    for update;
    if not found then
      raise exception 'Settlement retry could not resolve its original record.' using errcode = '40001';
    end if;
    if (v_existing.payload_hash is not null and v_existing.payload_hash is distinct from v_hash)
       and (v_existing.channel <> v_channel
         or v_existing.provider is distinct from v_provider
         or v_existing.expected_amount <> round(v_expected, 2)
         or v_existing.settled_amount <> v_settled
         or coalesce(v_existing.fee_amount, 0) <> v_fee
         or (v_existing.period_start is not null and v_existing.period_start <> v_start)
         or (v_existing.period_end is not null and v_existing.period_end <> v_end)) then
      raise exception 'Settlement idempotency key was already used with a different payload.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'success', true, 'id', v_existing.id, 'duplicate', true,
      'expected_amount', v_existing.expected_amount, 'settled_amount', v_existing.settled_amount,
      'fee_amount', coalesce(v_existing.fee_amount, 0), 'journal_entry_id', v_existing.journal_entry_id
    );
  end if;
  v_id := v_inserted_id;

  if v_active then
    if v_bank_account_id is null then
      raise exception 'An active bank account is required for an accounting-enabled settlement.' using errcode = '23503';
    end if;
    select ba.account_id into v_bank_gl_account
    from public.restaurant_bank_accounts ba
    join public.restaurant_accounts a on a.id = ba.account_id and a.lodge_id = v_lodge_id and a.is_active and a.account_type = 'asset'
    where ba.id = v_bank_account_id and ba.lodge_id = v_lodge_id and ba.is_active
    for update;
    if v_bank_gl_account is null then
      raise exception 'The selected settlement bank account is missing, inactive, or not linked to an asset account.' using errcode = '23503';
    end if;

    select m.account_id into v_clearing_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id and a.lodge_id = v_lodge_id and a.is_active and a.account_type = 'asset'
    where m.lodge_id = v_lodge_id and m.mapping_type = 'settlement_clearing'
      and m.source_key in (v_channel, 'default')
      and m.effective_from <= v_settlement_date and (m.effective_to is null or m.effective_to >= v_settlement_date)
    order by (m.source_key = v_channel) desc, m.effective_from desc
    limit 1;
    if v_clearing_account is null then
      raise exception 'No effective settlement-clearing asset mapping is configured for %.' , v_channel using errcode = '23503';
    end if;
    if v_fee > 0 then
      select m.account_id into v_fee_account
      from public.restaurant_pos_gl_mappings m
      join public.restaurant_accounts a on a.id = m.account_id and a.lodge_id = v_lodge_id and a.is_active and a.account_type = 'expense'
      where m.lodge_id = v_lodge_id and m.mapping_type = 'settlement_fee'
        and m.source_key in (v_channel, 'default')
        and m.effective_from <= v_settlement_date and (m.effective_to is null or m.effective_to >= v_settlement_date)
      order by (m.source_key = v_channel) desc, m.effective_from desc
      limit 1;
      if v_fee_account is null then
        raise exception 'No effective settlement-fee expense mapping is configured for %.' , v_channel using errcode = '23503';
      end if;
    end if;

    v_journal := public._restaurant_post_journal(
      v_lodge_id, v_settlement_date,
      concat('Settlement ', v_provider, ' ', v_reference), 'settlement', v_id, v_reference,
      concat('settlement:', v_id::text),
      case when v_fee > 0 then jsonb_build_array(
        jsonb_build_object('account_id', v_bank_gl_account, 'debit', v_settled, 'credit', 0, 'memo', 'Net settlement deposit'),
        jsonb_build_object('account_id', v_fee_account, 'debit', v_fee, 'credit', 0, 'memo', 'Provider settlement fee'),
        jsonb_build_object('account_id', v_clearing_account, 'debit', 0, 'credit', v_expected, 'memo', 'Clear POS tender batch')
      ) else jsonb_build_array(
        jsonb_build_object('account_id', v_bank_gl_account, 'debit', v_settled, 'credit', 0, 'memo', 'Settlement deposit'),
        jsonb_build_object('account_id', v_clearing_account, 'debit', 0, 'credit', v_expected, 'memo', 'Clear POS tender batch')
      ) end,
      v_actor, null
    );
    v_journal_entry := (v_journal->'data'->>'entry_id')::uuid;
    update public.restaurant_settlement_reconciliations
       set journal_entry_id = v_journal_entry, status = 'reviewed', updated_at = now()
     where id = v_id and lodge_id = v_lodge_id;
    perform public.record_restaurant_source_posting(
      v_lodge_id, 'settlement', v_id, v_settlement_date, v_journal_entry,
      v_operation, v_hash, 1, null, 'posted'
    );
  end if;

  perform public.log_restaurant_financial_action(
    v_lodge_id, 'settlement.recorded', 'restaurant_settlement_reconciliations', v_id,
    null, jsonb_build_object('expected_amount', v_expected, 'settled_amount', v_settled,
      'fee_amount', v_fee, 'journal_entry_id', v_journal_entry, 'operation_id', v_operation,
      'payload_hash', v_hash), null
  );
  return jsonb_build_object(
    'success', true, 'id', v_id, 'duplicate', false,
    'expected_amount', v_expected, 'settled_amount', v_settled, 'fee_amount', v_fee,
    'journal_entry_id', v_journal_entry, 'accounting_posted', v_active
  );
end
$$;

create or replace function public.match_restaurant_settlement_to_bank_transaction(
  p_lodge_id uuid,
  p_settlement_id uuid,
  p_bank_transaction_id uuid,
  p_evidence_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  v_settlement public.restaurant_settlement_reconciliations%rowtype;
  v_transaction public.restaurant_bank_transactions%rowtype;
begin
  if nullif(btrim(coalesce(p_evidence_ref, '')), '') is null then
    raise exception 'Bank-match evidence reference is required.' using errcode = '22023';
  end if;
  select * into v_settlement
  from public.restaurant_settlement_reconciliations
  where id = p_settlement_id and lodge_id = p_lodge_id
  for update;
  if not found then raise exception 'Settlement not found.' using errcode = 'P0002'; end if;
  if v_settlement.bank_account_id is null then raise exception 'Settlement has no configured bank destination.' using errcode = '23503'; end if;
  select * into v_transaction
  from public.restaurant_bank_transactions
  where id = p_bank_transaction_id and lodge_id = p_lodge_id
  for update;
  if not found or v_transaction.bank_account_id <> v_settlement.bank_account_id then
    raise exception 'Selected bank statement row does not belong to the settlement bank account.' using errcode = '23503';
  end if;
  if round(coalesce(v_transaction.credit, 0) - coalesce(v_transaction.debit, 0), 2) <> round(v_settlement.settled_amount, 2) then
    raise exception 'Selected bank row amount does not equal the settlement net deposit.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.restaurant_settlement_reconciliations
    where lodge_id = p_lodge_id and bank_statement_transaction_id = p_bank_transaction_id and id <> p_settlement_id
  ) then
    raise exception 'A bank statement row can be matched to only one settlement.' using errcode = '23505';
  end if;
  update public.restaurant_settlement_reconciliations
     set bank_statement_transaction_id = p_bank_transaction_id,
         bank_match_evidence_ref = btrim(p_evidence_ref),
         bank_matched_by = v_actor,
         bank_matched_at = now(),
         status = 'resolved',
         updated_at = now()
   where id = p_settlement_id and lodge_id = p_lodge_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'settlement.bank_matched', 'restaurant_settlement_reconciliations',
    p_settlement_id, null, jsonb_build_object(
      'bank_transaction_id', p_bank_transaction_id, 'evidence_ref', p_evidence_ref
    ), null
  );
  return jsonb_build_object('success', true, 'settlement_id', p_settlement_id, 'bank_transaction_id', p_bank_transaction_id, 'matched_by', v_actor);
end
$$;

-- Re-publish source coverage with activation-date semantics and the two source
-- types that were previously present in the scope matrix but absent from the
-- missing-row detector.
create or replace function public.get_restaurant_financial_source_coverage(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_missing jsonb;
  v_unsupported jsonb;
  v_scope jsonb;
  v_effective_from date;
  v_active boolean := public.restaurant_accounting_is_active(p_lodge_id);
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid source-coverage period is required' using errcode = '22023';
  end if;
  select a.effective_from into v_effective_from
  from public.restaurant_accounting_activation a
  where a.lodge_id = p_lodge_id and a.status in ('active', 'cutover_complete')
  order by a.updated_at desc nulls last
  limit 1;

  select coalesce(jsonb_agg(x order by x.source_type), '[]'::jsonb) into v_rows
  from (
    select s.source_type, count(*) source_count,
      count(*) filter (where s.status = 'posted') posted_count,
      count(*) filter (where s.status <> 'posted' or s.journal_entry_id is null) exception_count,
      min(s.business_date) first_business_date, max(s.business_date) last_business_date
    from public.restaurant_financial_source_postings s
    where s.lodge_id = p_lodge_id and s.business_date between p_start_date and p_end_date
      and (v_effective_from is null or s.business_date >= v_effective_from)
    group by s.source_type
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type', q.source_type, 'source_id', q.source_id,
    'reason', q.reason, 'required', true
  ) order by q.source_type, q.source_id), '[]'::jsonb) into v_missing
  from (
    select o.id source_id, 'pos_order' source_type, 'Completed POS order has no posted financial source record' reason
    from public.pos_orders o
    where v_active and (v_effective_from is null or coalesce(o.business_date, (o.created_at at time zone 'Africa/Gaborone')::date) >= v_effective_from)
      and o.lodge_id = p_lodge_id and coalesce(o.business_date, (o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled')
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='pos_order' and s.source_id=o.id and s.status='posted')
    union all
    select e.id, 'expense', 'Posted expense has no posted financial source record'
    from public.expenses e
    where v_active and (v_effective_from is null or e.date >= v_effective_from)
      and e.lodge_id=p_lodge_id and e.date between p_start_date and p_end_date and e.status in ('posted','paid','reversed')
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='expense' and s.source_id=e.id and s.status='posted')
    union all
    select e.id, 'expense_payment', 'Paid expense has no posted settlement source record'
    from public.expenses e
    where v_active and (v_effective_from is null or coalesce(e.paid_at::date,e.date) >= v_effective_from)
      and e.lodge_id=p_lodge_id and coalesce(e.paid_at::date,e.date) between p_start_date and p_end_date and e.status in ('paid','reversed') and e.payment_journal_entry_id is not null
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='expense_payment' and s.source_id=e.id and s.status='posted')
    union all
    select b.id, 'ap_bill', 'Recognized AP bill has no posted financial source record'
    from public.restaurant_bills b
    where v_active and (v_effective_from is null or b.bill_date >= v_effective_from)
      and b.lodge_id=p_lodge_id and b.bill_date between p_start_date and p_end_date and b.status in ('approved','partially_paid','paid','overdue') and b.accrual_journal_entry_id is not null
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='ap_bill' and s.source_id=b.id and s.status='posted')
    union all
    select bp.id, 'ap_payment', 'AP payment has no posted settlement source record'
    from public.restaurant_bill_payments bp
    where v_active and (v_effective_from is null or bp.payment_date >= v_effective_from)
      and bp.lodge_id=p_lodge_id and bp.payment_date between p_start_date and p_end_date and bp.journal_entry_id is not null
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='ap_payment' and s.source_id=bp.id and s.status='posted')
    union all
    select p.id, 'payroll', 'Posted payroll period has no posted financial source record'
    from public.restaurant_pay_periods p
    where v_active and (v_effective_from is null or p.end_date >= v_effective_from)
      and p.lodge_id=p_lodge_id and p.end_date between p_start_date and p_end_date and p.journal_entry_id is not null
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='payroll' and s.source_id=p.id and s.status='posted')
    union all
    select p.id, 'payroll_settlement', 'Settled payroll period has no posted liability-settlement source record'
    from public.restaurant_pay_periods p
    where v_active and (v_effective_from is null or coalesce(p.paid_at::date,p.end_date) >= v_effective_from)
      and p.lodge_id=p_lodge_id and coalesce(p.paid_at::date,p.end_date) between p_start_date and p_end_date
      and p.settlement_status in ('settled','reconciled') and p.settlement_journal_entry_id is not null
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='payroll_settlement' and s.source_id=p.id and s.status='posted')
    union all
    select ip.id, 'inventory_purchase', 'Inventory receipt has no posted financial source record'
    from public.inventory_purchases ip
    where v_active and (v_effective_from is null or ip.date >= v_effective_from)
      and ip.lodge_id=p_lodge_id and ip.date between p_start_date and p_end_date
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=ip.id and s.status='posted')
    union all
    select st.id, 'inventory_stocktake', 'Posted stocktake has no posted financial source record'
    from public.inventory_stocktakes st
    where v_active and (v_effective_from is null or st.posted_at::date >= v_effective_from)
      and st.lodge_id=p_lodge_id and st.status='posted' and st.posted_at::date between p_start_date and p_end_date
      and exists (select 1 from public.inventory_stocktake_lines sl where sl.stocktake_id=st.id and sl.lodge_id=p_lodge_id and coalesce(sl.variance_cost,0)<>0)
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='inventory_stocktake' and s.source_id=st.id and s.status='posted')
    union all
    select sr.id, 'settlement', 'Settlement reconciliation has no posted clearing-to-bank source record'
    from public.restaurant_settlement_reconciliations sr
    where v_active and (v_effective_from is null or coalesce(sr.settlement_date,sr.business_date) >= v_effective_from)
      and sr.lodge_id=p_lodge_id and coalesce(sr.settlement_date,sr.business_date) between p_start_date and p_end_date
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='settlement' and s.source_id=sr.id and s.status='posted')
  ) q;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.source_type), '[]'::jsonb) into v_scope
  from public.restaurant_financial_source_scope s where s.active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type', s.source_type, 'source_count', s.source_count,
    'posted_count', s.posted_count, 'exception_count', s.exception_count,
    'required_when_present', sc.required_when_present, 'gl_treatment', sc.gl_treatment
  ) order by s.source_type), '[]'::jsonb) into v_unsupported
  from jsonb_to_recordset(v_rows) as s(source_type text, source_count bigint, posted_count bigint, exception_count bigint)
  join public.restaurant_financial_source_scope sc on sc.source_type=s.source_type and sc.active
  where sc.required_when_present and s.exception_count > 0;

  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'period', jsonb_build_object('start_date',p_start_date,'end_date',p_end_date),
    'effective_from', v_effective_from, 'accounting_active', v_active,
    'source_counts', v_rows, 'source_matrix', v_scope, 'missing', v_missing,
    'posting_exceptions', v_unsupported,
    'required_source_types', (select coalesce(jsonb_agg(source_type order by source_type),'[]'::jsonb) from public.restaurant_financial_source_scope where active and required_when_present),
    'complete', jsonb_array_length(v_missing)=0 and jsonb_array_length(v_unsupported)=0,
    'source_mode', 'server_authoritative_post_cutover'
  ));
end
$$;

create or replace function public.get_restaurant_ledger_export_v2(
  p_lodge_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_entries jsonb;
  v_sorted jsonb;
  v_hash text;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_base := public.get_restaurant_ledger_workspace_v2(p_lodge_id, p_start_date, p_end_date, p_account_id);
  v_entries := coalesce(v_base->'data'->'entries', '[]'::jsonb);
  select coalesce(jsonb_agg(e order by (e->>'entry_date')::date desc, (e->>'created_at')::timestamptz desc, (e->>'id')::uuid desc), '[]'::jsonb)
    into v_sorted
  from jsonb_array_elements(v_entries) e;
  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id, 'start_date', p_start_date, 'end_date', p_end_date,
    'account_id', p_account_id, 'entries', v_sorted
  )::text, 'sha256'), 'hex');
  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'entries', v_sorted,
      'source', 'get_restaurant_ledger_workspace_v2',
      'complete', true,
      'returned_count', jsonb_array_length(v_sorted),
      'export_version', 'restaurant-ledger-v2-complete-deterministic',
      'source_watermark', now(), 'export_hash', v_hash
    )
  );
end
$$;

revoke all on function public.get_restaurant_settlement_bank_accounts(uuid), public.match_restaurant_settlement_to_bank_transaction(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.get_restaurant_settlement_bank_accounts(uuid), public.match_restaurant_settlement_to_bank_transaction(uuid,uuid,uuid,text) to authenticated, service_role;
revoke all on function public.record_restaurant_settlement(jsonb) from public, anon;
grant execute on function public.record_restaurant_settlement(jsonb) to authenticated, service_role;
revoke all on function public.get_restaurant_financial_source_coverage(uuid,date,date) from public, anon;
grant execute on function public.get_restaurant_financial_source_coverage(uuid,date,date) to authenticated, service_role;
revoke all on function public.get_restaurant_ledger_export_v2(uuid,date,date,uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_ledger_export_v2(uuid,date,date,uuid) to authenticated, service_role;

commit;
