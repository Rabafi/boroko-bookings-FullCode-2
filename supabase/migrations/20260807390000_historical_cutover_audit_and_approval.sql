-- Historical cutover evidence and maker-checker approval.
-- This migration is deliberately forward-only. It never rewrites historical
-- source rows; it classifies them and requires an independently reviewed batch
-- before Accounting activation can apply the cutover.

begin;

alter table public.restaurant_historical_cutover_batches
  add column if not exists source_manifest jsonb not null default '{}'::jsonb,
  add column if not exists source_manifest_hash text,
  add column if not exists review_notes text,
  add column if not exists opening_postings jsonb not null default '[]'::jsonb;

create or replace function public.get_restaurant_historical_cutover_audit(
  p_lodge_id uuid,
  p_cutover_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manifest jsonb;
  v_counts jsonb;
  v_hash text;
  v_control record;
  v_control_totals jsonb;
  v_missing_configuration bigint;
  v_unpostable bigint;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_cutover_date is null then
    raise exception 'A historical cutover date is required' using errcode = '22023';
  end if;

  -- Every branch is a source that can exist before the accounting effective
  -- date. `already_posted` means an identity row exists (including reversed or
  -- exception rows); `posted` means a balanced journal-backed source exists.
  -- This distinction lets the operator distinguish safe replay from missing
  -- historical work without treating an absent row as zero.
  with candidates as (
    select 'pos_order'::text source_type, o.id source_id, round(coalesce(o.total, 0), 2) amount,
      exists (
        select 1 from public.pos_order_items i
        where i.order_id = o.id and i.lodge_id = p_lodge_id
      ) has_evidence,
      not exists (
        select 1 from public.restaurant_pos_gl_mappings m
        join public.restaurant_accounts a on a.id = m.account_id
          and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'revenue'
        where m.lodge_id = p_lodge_id and m.mapping_type = 'category'
          and m.effective_from <= coalesce(o.business_date, (o.created_at at time zone 'Africa/Gaborone')::date)
          and (m.effective_to is null or m.effective_to >= coalesce(o.business_date, (o.created_at at time zone 'Africa/Gaborone')::date))
      ) missing_configuration
    from public.pos_orders o
    where o.lodge_id = p_lodge_id
      and coalesce(o.business_date, (o.created_at at time zone 'Africa/Gaborone')::date) < p_cutover_date
      and o.status in ('completed', 'settled')

    union all

    select 'expense', e.id, round(coalesce(e.amount, 0), 2),
      (lower(coalesce(e.source_kind, 'direct')) <> 'direct'
        or nullif(btrim(coalesce(e.evidence_ref, '')), '') is not null),
      not exists (
        select 1 from public.restaurant_pos_gl_mappings m
        join public.restaurant_accounts a on a.id = m.account_id
          and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'expense'
        where m.lodge_id = p_lodge_id and m.mapping_type = 'expense_category'
          and m.source_key = lower(coalesce(e.category, 'other'))
          and m.effective_from <= e.date
          and (m.effective_to is null or m.effective_to >= e.date)
      ) and (e.expense_account_id is null or not exists (
        select 1 from public.restaurant_accounts a
        where a.id = e.expense_account_id and a.lodge_id = p_lodge_id
          and a.is_active and a.account_type = 'expense'
      ))
    from public.expenses e
    where e.lodge_id = p_lodge_id and e.date < p_cutover_date
      and e.status in ('posted', 'paid', 'reversed')

    union all

    select 'ap_bill', b.id, round(coalesce(b.total, 0), 2),
      nullif(btrim(coalesce(b.bill_number, '')), '') is not null
        and exists (select 1 from public.restaurant_bill_items i where i.bill_id = b.id),
      not exists (select 1 from public.restaurant_ap_gl_settings s where s.lodge_id = p_lodge_id)
    from public.restaurant_bills b
    where b.lodge_id = p_lodge_id and b.bill_date < p_cutover_date
      and b.status in ('approved', 'partially_paid', 'paid', 'overdue')
      and b.accrual_journal_entry_id is not null

    union all

    select 'ap_payment', p.id, round(coalesce(p.amount, 0), 2),
      nullif(btrim(coalesce(p.reference, '')), '') is not null,
      not exists (select 1 from public.restaurant_ap_gl_settings s where s.lodge_id = p_lodge_id)
    from public.restaurant_bill_payments p
    where p.lodge_id = p_lodge_id and p.payment_date < p_cutover_date
      and p.journal_entry_id is not null

    union all

    select 'payroll', p.id, round(coalesce((select sum(r.gross_pay) from public.restaurant_employee_pay_records r where r.pay_period_id = p.id), 0), 2),
      exists (select 1 from public.restaurant_employee_pay_records r where r.pay_period_id = p.id),
      not exists (select 1 from public.restaurant_payroll_gl_settings s where s.lodge_id = p_lodge_id)
    from public.restaurant_pay_periods p
    where p.lodge_id = p_lodge_id and p.end_date < p_cutover_date
      and p.journal_entry_id is not null

    union all

    select 'payroll_settlement', p.id, round(coalesce((select sum(r.net_pay + r.paye_tax + r.other_deductions) from public.restaurant_employee_pay_records r where r.pay_period_id = p.id), 0), 2),
      p.settlement_status in ('settled', 'reconciled') and p.settlement_journal_entry_id is not null,
      not exists (select 1 from public.restaurant_payroll_gl_settings s where s.lodge_id = p_lodge_id)
    from public.restaurant_pay_periods p
    where p.lodge_id = p_lodge_id
      and coalesce(p.paid_at::date, p.end_date) < p_cutover_date
      and p.settlement_status in ('settled', 'reconciled')
      and p.settlement_journal_entry_id is not null

    union all

    select 'inventory_purchase', p.id, round(coalesce(p.total_cost, 0), 2),
      nullif(btrim(coalesce(p.evidence_ref, '')), '') is not null,
      not exists (
        select 1 from public.restaurant_pos_gl_mappings m
        join public.restaurant_accounts a on a.id = m.account_id
          and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'asset'
        where m.lodge_id = p_lodge_id and m.mapping_type = 'inventory'
          and m.source_key = 'default' and m.effective_from <= p.date
          and (m.effective_to is null or m.effective_to >= p.date)
      ) or not exists (
        select 1 from public.restaurant_pos_gl_mappings m
        join public.restaurant_accounts a on a.id = m.account_id
          and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'liability'
        where m.lodge_id = p_lodge_id and m.mapping_type = 'expense_payable'
          and m.source_key in ('inventory_purchase', 'default')
          and m.effective_from <= p.date
          and (m.effective_to is null or m.effective_to >= p.date)
      )
    from public.inventory_purchases p
    where p.lodge_id = p_lodge_id and p.date < p_cutover_date

    union all

    select 'inventory_stocktake', st.id, round(abs(coalesce((select sum(l.variance_cost) from public.inventory_stocktake_lines l where l.stocktake_id = st.id and l.lodge_id = p_lodge_id), 0)), 2),
      exists (select 1 from public.inventory_stocktake_lines l where l.stocktake_id = st.id and l.lodge_id = p_lodge_id),
      not exists (
        select 1 from public.restaurant_pos_gl_mappings m
        join public.restaurant_accounts a on a.id = m.account_id
          and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'expense'
        where m.lodge_id = p_lodge_id and m.mapping_type = 'cogs' and m.source_key = 'default'
      ) or not exists (
        select 1 from public.restaurant_pos_gl_mappings m
        join public.restaurant_accounts a on a.id = m.account_id
          and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'asset'
        where m.lodge_id = p_lodge_id and m.mapping_type = 'inventory' and m.source_key = 'default'
      )
    from public.inventory_stocktakes st
    where st.lodge_id = p_lodge_id and st.status = 'posted'
      and st.posted_at::date < p_cutover_date
      and exists (select 1 from public.inventory_stocktake_lines l where l.stocktake_id = st.id and l.lodge_id = p_lodge_id and coalesce(l.variance_cost, 0) <> 0)

    union all

    select 'settlement', s.id, round(coalesce(s.settled_amount, 0), 2),
      nullif(btrim(coalesce(s.reference, '')), '') is not null,
      not exists (select 1 from public.restaurant_pos_gl_mappings m where m.lodge_id = p_lodge_id and m.mapping_type = 'settlement_clearing' and m.source_key = 'default')
        or not exists (select 1 from public.restaurant_pos_gl_mappings m where m.lodge_id = p_lodge_id and m.mapping_type = 'settlement_fee' and m.source_key = 'default')
    from public.restaurant_settlement_reconciliations s
    where s.lodge_id = p_lodge_id and s.business_date < p_cutover_date

    union all

    select 'cashup', c.id, round(abs(coalesce(c.cash_over_short, 0)), 2),
      jsonb_typeof(coalesce(c.counted_by_method, '{}'::jsonb)) = 'object'
        and coalesce(c.counted_by_method, '{}'::jsonb) <> '{}'::jsonb,
      not exists (select 1 from public.restaurant_pos_gl_mappings m where m.lodge_id = p_lodge_id and m.mapping_type = 'tender' and m.source_key = 'cash')
        or (c.cash_over_short > 0 and not exists (select 1 from public.restaurant_pos_gl_mappings m where m.lodge_id = p_lodge_id and m.mapping_type = 'cash_variance' and m.source_key = 'over'))
        or (c.cash_over_short < 0 and not exists (select 1 from public.restaurant_pos_gl_mappings m where m.lodge_id = p_lodge_id and m.mapping_type = 'cash_variance' and m.source_key = 'short'))
    from public.pos_cashup_sessions c
    where c.lodge_id = p_lodge_id and c.date < p_cutover_date
      and coalesce(c.cash_over_short, 0) <> 0
  ),
  scored as (
    select c.*,
      exists (
        select 1 from public.restaurant_financial_source_postings s
        where s.lodge_id = p_lodge_id and s.source_type = c.source_type and s.source_id = c.source_id
      ) already_posted,
      exists (
        select 1 from public.restaurant_financial_source_postings s
        where s.lodge_id = p_lodge_id and s.source_type = c.source_type and s.source_id = c.source_id
          and s.status = 'posted' and s.journal_entry_id is not null
      ) posted,
      exists (
        select 1 from public.restaurant_financial_source_postings s
        join public.restaurant_journal_entries e on e.id = s.journal_entry_id and e.is_posted
        where s.lodge_id = p_lodge_id and s.source_type = c.source_type and s.source_id = c.source_id
          and s.status = 'posted'
      ) reversible
    from candidates c
  ),
  detail as (
    select source_type, source_id, amount, has_evidence, missing_configuration,
      already_posted, posted, reversible
    from scored
  )
  select coalesce(jsonb_agg(to_jsonb(d) order by d.source_type, d.source_id), '[]'::jsonb)
    into v_manifest
  from detail d;

  v_hash := encode(digest(v_manifest::text, 'sha256'), 'hex');

  with detail as (
    select * from jsonb_to_recordset(v_manifest) as x(
      source_type text, source_id uuid, amount numeric, has_evidence boolean,
      missing_configuration boolean, already_posted boolean, posted boolean,
      reversible boolean
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type', source_type,
    'candidate_count', candidate_count,
    'candidate_total', round(candidate_total, 2),
    'posted_count', posted_count,
    'posted_total', round(posted_total, 2),
    'already_posted_count', already_posted_count,
    'already_posted_total', round(already_posted_total, 2),
    'reversible_count', reversible_count,
    'reversible_total', round(reversible_total, 2),
    'missing_configuration_count', missing_configuration_count,
    'missing_configuration_total', round(missing_configuration_total, 2),
    'unpostable_without_evidence_count', unpostable_without_evidence_count,
    'unpostable_without_evidence_total', round(unpostable_without_evidence_total, 2)
  ) order by source_type), '[]'::jsonb)
    into v_counts
  from (
    select source_type,
      count(*) candidate_count,
      coalesce(sum(amount), 0) candidate_total,
      count(*) filter (where posted) posted_count,
      coalesce(sum(amount) filter (where posted), 0) posted_total,
      count(*) filter (where already_posted) already_posted_count,
      coalesce(sum(amount) filter (where already_posted), 0) already_posted_total,
      count(*) filter (where reversible) reversible_count,
      coalesce(sum(amount) filter (where reversible), 0) reversible_total,
      count(*) filter (where missing_configuration) missing_configuration_count,
      coalesce(sum(amount) filter (where missing_configuration), 0) missing_configuration_total,
      count(*) filter (where not has_evidence) unpostable_without_evidence_count,
      coalesce(sum(amount) filter (where not has_evidence), 0) unpostable_without_evidence_total
    from detail
    group by source_type
  ) summary;

  select coalesce(sum((x->>'candidate_count')::numeric), 0) candidate_count,
         coalesce(sum((x->>'candidate_total')::numeric), 0) candidate_total,
         coalesce(sum((x->>'posted_count')::numeric), 0) posted_count,
         coalesce(sum((x->>'posted_total')::numeric), 0) posted_total,
         coalesce(sum((x->>'already_posted_count')::numeric), 0) already_posted_count,
         coalesce(sum((x->>'already_posted_total')::numeric), 0) already_posted_total,
         coalesce(sum((x->>'reversible_count')::numeric), 0) reversible_count,
         coalesce(sum((x->>'reversible_total')::numeric), 0) reversible_total,
         coalesce(sum((x->>'missing_configuration_count')::numeric), 0) missing_configuration_count,
         coalesce(sum((x->>'unpostable_without_evidence_count')::numeric), 0) unpostable_without_evidence_count
    into v_control
  from jsonb_array_elements(v_counts) x;

  v_missing_configuration := coalesce(v_control.missing_configuration_count, 0);
  v_unpostable := coalesce(v_control.unpostable_without_evidence_count, 0);
  v_control_totals := jsonb_build_object(
    'candidate_count', v_control.candidate_count,
    'candidate_total', v_control.candidate_total,
    'posted_count', v_control.posted_count,
    'posted_total', v_control.posted_total,
    'already_posted_count', v_control.already_posted_count,
    'already_posted_total', v_control.already_posted_total,
    'reversible_count', v_control.reversible_count,
    'reversible_total', v_control.reversible_total,
    'missing_configuration_count', v_missing_configuration,
    'unpostable_without_evidence_count', v_unpostable
  );

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'schema_version', 'historical-cutover-audit-v1',
      'lodge_id', p_lodge_id,
      'cutover_date', p_cutover_date,
      'source_counts', v_counts,
      'source_manifest', v_manifest,
      'source_manifest_hash', v_hash,
      'control_totals', jsonb_build_object(
        'candidate_count', coalesce(v_control.candidate_count, 0),
        'candidate_total', round(coalesce(v_control.candidate_total, 0), 2),
        'posted_count', coalesce(v_control.posted_count, 0),
        'posted_total', round(coalesce(v_control.posted_total, 0), 2),
        'already_posted_count', coalesce(v_control.already_posted_count, 0),
        'already_posted_total', round(coalesce(v_control.already_posted_total, 0), 2),
        'reversible_count', coalesce(v_control.reversible_count, 0),
        'reversible_total', round(coalesce(v_control.reversible_total, 0), 2),
        'missing_configuration_count', v_missing_configuration,
        'unpostable_without_evidence_count', v_unpostable
      ),
      'complete', v_missing_configuration = 0 and v_unpostable = 0,
      'blocking_reasons', (
        select coalesce(jsonb_agg(reason order by reason), '[]'::jsonb)
        from (values
          ('missing_configuration', v_missing_configuration > 0),
          ('unpostable_without_evidence', v_unpostable > 0)
        ) reasons(reason, blocked)
        where blocked
      )
    )
  );
end
$$;

-- Re-define prepare so the dry-run packet and deterministic source manifest are
-- captured at preparation time. The original operation key remains stable.
create or replace function public.prepare_restaurant_historical_cutover(
  p_lodge_id uuid, p_cutover_date date, p_opening_balances jsonb,
  p_evidence_manifest jsonb default '{}'::jsonb, p_operation_key text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_id uuid;
  v_hash text;
  v_operation_key text;
  v_existing public.restaurant_historical_cutover_batches%rowtype;
  v_audit jsonb;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_cutover_date is null or jsonb_typeof(coalesce(p_opening_balances, '[]'::jsonb)) <> 'array' then
    raise exception 'Cutover date and opening balances are required' using errcode = '22023';
  end if;
  v_operation_key := nullif(btrim(p_operation_key), '');
  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id, 'date', p_cutover_date,
    'opening_balances', p_opening_balances, 'operation_key', v_operation_key
  )::text, 'sha256'), 'hex');
  if v_operation_key is not null and exists (
    select 1 from public.restaurant_historical_cutover_batches b
    where b.lodge_id = p_lodge_id and b.operation_key = v_operation_key
      and b.cutover_date <> p_cutover_date
  ) then
    raise exception 'Cutover operation key is already bound to another date' using errcode = '23505';
  end if;
  select * into v_existing
  from public.restaurant_historical_cutover_batches
  where lodge_id = p_lodge_id and cutover_date = p_cutover_date
  for update;
  if found and v_existing.status in ('approved', 'applied') then
    raise exception 'Approved or applied cutover batches are immutable' using errcode = '55000';
  end if;

  v_audit := public.get_restaurant_historical_cutover_audit(p_lodge_id, p_cutover_date)->'data';
  insert into public.restaurant_historical_cutover_batches(
    lodge_id, cutover_date, opening_balances, source_counts, control_totals,
    evidence_manifest, source_manifest, source_manifest_hash, prepared_by,
    operation_key, review_notes
  ) values (
    p_lodge_id, p_cutover_date, p_opening_balances,
    coalesce(v_audit->'source_counts', '[]'::jsonb),
    coalesce(v_audit->'control_totals', '{}'::jsonb) || jsonb_build_object('opening_payload_hash', v_hash),
    coalesce(p_evidence_manifest, '{}'::jsonb),
    coalesce(v_audit->'source_manifest', '[]'::jsonb),
    v_audit->>'source_manifest_hash', v_actor, v_operation_key, null
  )
  on conflict (lodge_id, cutover_date) do update set
    opening_balances = excluded.opening_balances,
    source_counts = excluded.source_counts,
    control_totals = excluded.control_totals,
    evidence_manifest = excluded.evidence_manifest,
    source_manifest = excluded.source_manifest,
    source_manifest_hash = excluded.source_manifest_hash,
    prepared_by = excluded.prepared_by,
    operation_key = coalesce(excluded.operation_key, restaurant_historical_cutover_batches.operation_key);
  select id into v_id
  from public.restaurant_historical_cutover_batches
  where lodge_id = p_lodge_id and cutover_date = p_cutover_date;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', v_id, 'payload_hash', v_hash,
    'source_manifest_hash', v_audit->>'source_manifest_hash',
    'complete', coalesce((v_audit->>'complete')::boolean, false),
    'status', 'prepared'
  ));
end
$$;

create or replace function public.approve_restaurant_historical_cutover(
  p_lodge_id uuid,
  p_batch_id uuid,
  p_review_notes text,
  p_expected_opening_payload_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.restaurant_historical_cutover_batches%rowtype;
  v_audit jsonb;
  v_opening_hash text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_batch
  from public.restaurant_historical_cutover_batches
  where id = p_batch_id and lodge_id = p_lodge_id
  for update;
  if not found or v_batch.status <> 'prepared' then
    raise exception 'A prepared historical cutover batch is required' using errcode = '55000';
  end if;
  if v_batch.prepared_by = v_actor then
    raise exception 'The cutover preparer cannot approve the same batch' using errcode = '42501';
  end if;
  v_opening_hash := v_batch.control_totals->>'opening_payload_hash';
  if p_expected_opening_payload_hash is not null and p_expected_opening_payload_hash <> v_opening_hash then
    raise exception 'Opening-balance payload hash does not match the prepared batch' using errcode = '23505';
  end if;
  if nullif(btrim(coalesce(p_review_notes, '')), '') is null then
    raise exception 'Independent cutover review notes are required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(v_batch.opening_balances, '[]'::jsonb)) as opening(
      account_id uuid, equity_account_id uuid, entry_date date, amount numeric
    )
    where opening.account_id is null or opening.equity_account_id is null
      or opening.entry_date is null or coalesce(opening.amount, 0) = 0
  ) then
    raise exception 'Opening balances require active account, equity account, date, and non-zero amount' using errcode = '22023';
  end if;
  if exists (
    select opening.account_id
    from jsonb_to_recordset(coalesce(v_batch.opening_balances, '[]'::jsonb)) as opening(
      account_id uuid, equity_account_id uuid, entry_date date, amount numeric
    )
    group by opening.account_id
    having count(*) > 1
  ) then
    raise exception 'Opening balances may contain only one deterministic posting per account in a cutover batch' using errcode = '23505';
  end if;

  v_audit := public.get_restaurant_historical_cutover_audit(p_lodge_id, v_batch.cutover_date)->'data';
  if not coalesce((v_audit->>'complete')::boolean, false) then
    raise exception 'Historical cutover audit has blockers: %', v_audit->'blocking_reasons' using errcode = '55000';
  end if;
  if v_batch.source_manifest_hash is distinct from v_audit->>'source_manifest_hash' then
    raise exception 'Historical source manifest changed after preparation; prepare a new batch' using errcode = '55000';
  end if;

  update public.restaurant_historical_cutover_batches
  set status = 'approved',
      source_counts = v_audit->'source_counts',
      control_totals = v_audit->'control_totals' || jsonb_build_object('opening_payload_hash', v_opening_hash),
      source_manifest = v_audit->'source_manifest',
      source_manifest_hash = v_audit->>'source_manifest_hash',
      review_notes = btrim(p_review_notes),
      approved_by = v_actor,
      approved_at = now()
  where id = p_batch_id and lodge_id = p_lodge_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'accounting_cutover.approved', 'restaurant_historical_cutover_batches',
    p_batch_id, null, jsonb_build_object(
      'source_manifest_hash', v_audit->>'source_manifest_hash',
      'opening_payload_hash', v_opening_hash,
      'reviewed_by', v_actor
    ), null
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', p_batch_id, 'status', 'approved',
    'source_manifest_hash', v_audit->>'source_manifest_hash',
    'reviewed_by', v_actor
  ));
end
$$;

create or replace function public.apply_restaurant_historical_cutover(
  p_lodge_id uuid,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.restaurant_historical_cutover_batches%rowtype;
  v_result jsonb;
  v_postings jsonb := '[]'::jsonb;
  v_opening record;
  v_key text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_batch
  from public.restaurant_historical_cutover_batches
  where id = p_batch_id and lodge_id = p_lodge_id
  for update;
  if not found then
    raise exception 'Historical cutover batch not found' using errcode = 'P0002';
  end if;
  if v_batch.status = 'applied' then
    return jsonb_build_object('success', true, 'data', jsonb_build_object(
      'id', p_batch_id, 'status', 'applied', 'replayed', true,
      'opening_postings', v_batch.opening_postings
    ));
  end if;
  if v_batch.status <> 'approved' then
    raise exception 'An independently approved cutover batch is required before applying opening balances' using errcode = '55000';
  end if;

  for v_opening in
    select * from jsonb_to_recordset(coalesce(v_batch.opening_balances, '[]'::jsonb)) as opening(
      account_id uuid, equity_account_id uuid, entry_date date, amount numeric
    )
  loop
    if v_opening.account_id is null or v_opening.equity_account_id is null
       or v_opening.entry_date is null or coalesce(v_opening.amount, 0) = 0 then
      raise exception 'Opening balances require active account, equity account, date, and non-zero amount' using errcode = '22023';
    end if;
    v_key := 'cutover:' || p_batch_id::text || ':opening:' || v_opening.account_id::text;
    v_result := public.post_restaurant_opening_balance(
      p_lodge_id, v_opening.account_id, v_opening.equity_account_id,
      v_opening.entry_date, v_opening.amount, v_key
    );
    v_postings := v_postings || jsonb_build_array(jsonb_build_object(
      'account_id', v_opening.account_id,
      'equity_account_id', v_opening.equity_account_id,
      'entry_date', v_opening.entry_date,
      'amount', round(v_opening.amount, 2),
      'idempotency_key', v_key,
      'result', v_result
    ));
  end loop;

  update public.restaurant_historical_cutover_batches
  set status = 'applied', opening_postings = v_postings, applied_at = coalesce(applied_at, now())
  where id = p_batch_id and lodge_id = p_lodge_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'accounting_cutover.applied', 'restaurant_historical_cutover_batches',
    p_batch_id, null, jsonb_build_object('opening_postings', v_postings, 'applied_by', v_actor), null
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', p_batch_id, 'status', 'applied', 'replayed', false,
    'opening_postings', v_postings
  ));
end
$$;

create or replace function public.activate_restaurant_accounting(
  p_lodge_id uuid,
  p_effective_from date,
  p_configuration_version text,
  p_policy_version text default 'bar-accounting-financial-truth-v1',
  p_cutover_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ready jsonb;
  v_id uuid;
  v_batch public.restaurant_historical_cutover_batches%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  v_ready := public.get_restaurant_accounting_readiness(p_lodge_id)->'data';
  if not coalesce((v_ready->>'ready')::boolean, false) then
    raise exception 'Accounting readiness gate is not satisfied: %', v_ready->'missing_requirements' using errcode = '55000';
  end if;
  if p_effective_from is null or nullif(btrim(coalesce(p_configuration_version, '')), '') is null then
    raise exception 'Effective date and configuration version are required' using errcode = '22023';
  end if;
  if p_cutover_batch_id is null and (
    exists (select 1 from public.pos_orders where lodge_id = p_lodge_id and coalesce(business_date, (created_at at time zone 'Africa/Gaborone')::date) < p_effective_from and status in ('completed', 'settled'))
    or exists (select 1 from public.expenses where lodge_id = p_lodge_id and date < p_effective_from and status in ('posted', 'paid', 'reversed'))
    or exists (select 1 from public.restaurant_bills where lodge_id = p_lodge_id and bill_date < p_effective_from and status in ('approved', 'partially_paid', 'paid', 'overdue'))
    or exists (select 1 from public.inventory_purchases where lodge_id = p_lodge_id and date < p_effective_from)
    or exists (select 1 from public.restaurant_pay_periods where lodge_id = p_lodge_id and end_date < p_effective_from and journal_entry_id is not null)
  ) then
    raise exception 'An approved historical cutover batch is required when pre-effective financial activity exists' using errcode = '55000';
  end if;
  if p_cutover_batch_id is not null then
    select * into v_batch from public.restaurant_historical_cutover_batches
    where id = p_cutover_batch_id and lodge_id = p_lodge_id for update;
    if not found or v_batch.status <> 'applied' then
      raise exception 'Opening balances must be applied from an approved historical cutover batch before activation' using errcode = '55000';
    end if;
  end if;
  insert into public.restaurant_accounting_activation(
    lodge_id, status, effective_from, policy_version, configuration_version,
    historical_cutover_batch_id, activated_by, activated_at, updated_at
  ) values (
    p_lodge_id, 'active', p_effective_from, coalesce(p_policy_version, 'bar-accounting-financial-truth-v1'),
    btrim(p_configuration_version), p_cutover_batch_id, v_actor, now(), now()
  )
  on conflict (lodge_id) do update set
    status = 'active', effective_from = excluded.effective_from,
    policy_version = excluded.policy_version, configuration_version = excluded.configuration_version,
    historical_cutover_batch_id = excluded.historical_cutover_batch_id,
    activated_by = excluded.activated_by, activated_at = excluded.activated_at, updated_at = now()
  returning lodge_id into v_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'accounting_activated', 'accounting_activation', v_id, null,
    jsonb_build_object('effective_from', p_effective_from, 'configuration_version', p_configuration_version, 'cutover_batch_id', p_cutover_batch_id), null
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'lodge_id', v_id, 'status', 'active', 'effective_from', p_effective_from,
    'configuration_version', p_configuration_version, 'cutover_batch_id', p_cutover_batch_id
  ));
end
$$;

revoke all on function public.get_restaurant_historical_cutover_audit(uuid, date) from public, anon, authenticated;
revoke all on function public.prepare_restaurant_historical_cutover(uuid, date, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.apply_restaurant_historical_cutover(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_restaurant_accounting(uuid, date, text, text, uuid) from public, anon, authenticated;
revoke all on function public.suspend_restaurant_accounting(uuid, text) from public, anon, authenticated;
grant execute on function public.get_restaurant_historical_cutover_audit(uuid, date) to service_role;
grant execute on function public.prepare_restaurant_historical_cutover(uuid, date, jsonb, jsonb, text) to service_role;
grant execute on function public.approve_restaurant_historical_cutover(uuid, uuid, text, text) to service_role;
grant execute on function public.apply_restaurant_historical_cutover(uuid, uuid) to service_role;
grant execute on function public.activate_restaurant_accounting(uuid, date, text, text, uuid) to service_role;
grant execute on function public.suspend_restaurant_accounting(uuid, text) to service_role;

commit;
