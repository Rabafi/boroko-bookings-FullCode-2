-- Complete cash-up variance accounting without re-recognizing POS revenue.
-- A cash-up posts only the difference between the locked expected drawer and
-- the counted drawer.  The shift close, journal, source posting, and audit
-- state remain one transaction and retain the v2 RPC signature.

begin;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.restaurant_pos_gl_mappings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%mapping_type%'
  loop
    execute format('alter table public.restaurant_pos_gl_mappings drop constraint %I', v_constraint.conname);
  end loop;
end
$$;

alter table public.restaurant_pos_gl_mappings
  add constraint restaurant_pos_gl_mappings_mapping_type_cashup_chk
  check (mapping_type in (
    'category','tender','discount','tax','tips','cogs','inventory',
    'settlement_fee','settlement_clearing','expense_category','expense_payable',
    'cash_variance'
  ));

alter table public.pos_cashup_sessions
  add column if not exists journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists source_version integer not null default 1,
  add column if not exists payload_hash text;

create index if not exists pos_cashup_sessions_financial_source_idx
  on public.pos_cashup_sessions(lodge_id, date, cash_over_short, journal_entry_id);

create or replace function public.set_restaurant_pos_gl_mapping(
  p_lodge_id uuid,
  p_mapping_type text,
  p_source_key text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_account_type text;
  v_id uuid;
  v_type text := lower(btrim(coalesce(p_mapping_type, '')));
  v_key text := lower(btrim(coalesce(p_source_key, '')));
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if v_type not in (
    'category','tender','discount','tax','tips','cogs','inventory',
    'settlement_fee','settlement_clearing','expense_category','expense_payable',
    'cash_variance'
  ) or v_key = '' then
    raise exception 'Valid typed mapping type and source key are required' using errcode = '22023';
  end if;
  if v_type = 'cash_variance' and v_key not in ('over','short') then
    raise exception 'Cash-variance mappings require over or short as the source key' using errcode = '22023';
  end if;

  select account_type into v_account_type
  from public.restaurant_accounts
  where id = p_account_id and lodge_id = p_lodge_id and is_active;
  if not found then
    raise exception 'Mapped account is inactive, missing, or belongs to another lodge' using errcode = '23503';
  end if;

  if v_type in ('category','discount') and v_account_type <> 'revenue' then
    raise exception 'Category and discount mappings require revenue accounts' using errcode = '22023';
  elsif v_type = 'tender' and v_key = 'voucher' and v_account_type <> 'liability' then
    raise exception 'Voucher tender mappings require a voucher-liability account' using errcode = '22023';
  elsif v_type = 'tender' and v_account_type <> 'asset' then
    raise exception 'Tender mappings require asset accounts' using errcode = '22023';
  elsif v_type in ('tax','tips') and v_account_type <> 'liability' then
    raise exception 'Tax and tips mappings require liability accounts' using errcode = '22023';
  elsif v_type in ('cogs','settlement_fee','expense_category') and v_account_type <> 'expense' then
    raise exception 'COGS, settlement-fee, and expense-category mappings require expense accounts' using errcode = '22023';
  elsif v_type in ('inventory','settlement_clearing') and v_account_type <> 'asset' then
    raise exception 'Inventory and settlement-clearing mappings require asset accounts' using errcode = '22023';
  elsif v_type = 'expense_payable' and v_account_type <> 'liability' then
    raise exception 'Expense-payable mappings require liability accounts' using errcode = '22023';
  elsif v_type = 'cash_variance' and v_key = 'over' and v_account_type <> 'revenue' then
    raise exception 'Cash-over mappings require a revenue account' using errcode = '22023';
  elsif v_type = 'cash_variance' and v_key = 'short' and v_account_type <> 'expense' then
    raise exception 'Cash-short mappings require an expense account' using errcode = '22023';
  end if;

  insert into public.restaurant_pos_gl_mappings(
    lodge_id, mapping_type, source_key, account_id, created_by,
    effective_from, effective_to, mapping_version
  ) values (
    p_lodge_id, v_type, v_key, p_account_id, v_actor,
    current_date, null, 'bar-accounting-financial-truth-v1'
  )
  on conflict (lodge_id, mapping_type, source_key)
  do update set
    account_id = excluded.account_id,
    updated_at = now(),
    effective_from = excluded.effective_from,
    effective_to = null,
    mapping_version = excluded.mapping_version
  returning id into v_id;

  perform public.log_restaurant_financial_action(
    p_lodge_id, 'pos_gl_mapping_set', 'pos_gl_mapping', v_id, null,
    jsonb_build_object(
      'mapping_type', v_type, 'source_key', v_key,
      'account_id', p_account_id, 'effective_from', current_date
    ), null
  );
  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object('id', v_id, 'mapping_type', v_type, 'source_key', v_key)
  );
end
$$;

create or replace function public.finalize_pos_shift_cashup_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_cashup_id uuid := coalesce(nullif(payload->>'cashup_id', '')::uuid, gen_random_uuid());
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_counted jsonb := coalesce(payload->'counted_by_method', '{}'::jsonb);
  v_notes text := nullif(payload->>'notes', '');
  v_actor_id uuid := public.app_current_user_id();
  v_shift record;
  v_preview jsonb;
  v_expected jsonb;
  v_variance jsonb;
  v_request_hash text;
  v_source_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_business_date date;
  v_cash_variance numeric := 0;
  v_cash_account uuid;
  v_over_account uuid;
  v_short_account uuid;
  v_journal jsonb;
begin
  if v_lodge_id is null or v_shift_id is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id, shift_id and idempotency_key are required');
  end if;
  if jsonb_typeof(v_counted) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'counted_by_method must be an object');
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['supervisor', 'manager', 'admin', 'super_admin']
  );

  v_request_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  v_claim := public._claim_financial_operation(
    v_lodge_id, v_key, 'finalize_pos_shift_cashup_v2', v_cashup_id, v_request_hash
  );
  if coalesce((v_claim->>'found')::boolean, false) then
    return v_claim->'operation_result';
  end if;
  if coalesce(v_claim->>'success', 'true') <> 'true' then
    return jsonb_build_object(
      'success', false,
      'error', coalesce(v_claim->>'error', 'Idempotency conflict'),
      'code', 'idempotency_conflict'
    );
  end if;

  select s.* into v_shift
  from public.pos_shifts s
  where s.id = v_shift_id and s.lodge_id = v_lodge_id
  for update;
  if not found or v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Shift is not open');
  end if;

  v_preview := public.get_pos_shift_cashup_preview_v2(v_shift_id, v_lodge_id);
  if coalesce((v_preview->>'success')::boolean, false) = false then
    return v_preview;
  end if;
  v_expected := coalesce(v_preview->'expected_by_method', '{}'::jsonb);
  v_business_date := (v_preview->>'business_date')::date;

  select coalesce(
    jsonb_object_agg(
      methods.method,
      round(
        coalesce((v_counted->>methods.method)::numeric, 0)
        - coalesce((v_expected->>methods.method)::numeric, 0),
        2
      )
    ), '{}'
  ) into v_variance
  from (
    select jsonb_object_keys(v_counted) as method
    union
    select jsonb_object_keys(v_expected) as method
  ) methods;

  -- Cash is a drawer count, so its expectation includes the opening float.
  v_cash_variance := round(
    coalesce((v_counted->>'cash')::numeric, 0)
    - (v_preview->>'expected_cash_drawer')::numeric,
    2
  );
  v_variance := jsonb_set(v_variance, '{cash}', to_jsonb(v_cash_variance), true);
  v_source_hash := encode(digest(jsonb_build_object(
    'cashup_id', v_cashup_id, 'shift_id', v_shift_id, 'business_date', v_business_date,
    'expected_by_method', v_expected, 'counted_by_method', v_counted,
    'variance_by_method', v_variance, 'cash_over_short', v_cash_variance
  )::text, 'sha256'), 'hex');

  insert into public.pos_cashup_sessions (
    id, lodge_id, date, outlet_id, opening_float, expected_cash_drawer,
    expected_by_method, counted_by_method, variance_by_method, cash_over_short,
    orders_count, void_count, pending_count, gross_sales, returns_total,
    net_sales, notes, created_by, created_by_name, cashier_id, cashier_name,
    created_at, shift_id, idempotency_key, source_version, payload_hash
  ) values (
    v_cashup_id, v_lodge_id, v_business_date, v_shift.outlet_id,
    coalesce(v_shift.opening_float, 0), (v_preview->>'expected_cash_drawer')::numeric,
    v_expected, v_counted, v_variance, v_cash_variance,
    (v_preview->>'order_count')::integer, (v_preview->>'void_count')::integer,
    0, (v_preview->>'gross_sales')::numeric, (v_preview->>'returns')::numeric,
    (v_preview->>'net_sales')::numeric, v_notes, v_actor_id,
    (select u.name from public.users u where u.id = v_actor_id),
    v_shift.cashier_id, v_shift.cashier_name, now(), v_shift_id, v_key,
    1, v_source_hash
  );

  if public.restaurant_accounting_is_active(v_lodge_id) and v_cash_variance <> 0 then
    select m.account_id into v_cash_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id
      and a.lodge_id = v_lodge_id and a.is_active and a.account_type = 'asset'
    where m.lodge_id = v_lodge_id and m.mapping_type = 'tender'
      and m.source_key = 'cash' and m.effective_from <= v_business_date
      and (m.effective_to is null or m.effective_to >= v_business_date)
    order by m.effective_from desc, m.updated_at desc nulls last limit 1;

    select m.account_id into v_over_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id
      and a.lodge_id = v_lodge_id and a.is_active and a.account_type = 'revenue'
    where m.lodge_id = v_lodge_id and m.mapping_type = 'cash_variance'
      and m.source_key = 'over' and m.effective_from <= v_business_date
      and (m.effective_to is null or m.effective_to >= v_business_date)
    order by m.effective_from desc, m.updated_at desc nulls last limit 1;

    select m.account_id into v_short_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id
      and a.lodge_id = v_lodge_id and a.is_active and a.account_type = 'expense'
    where m.lodge_id = v_lodge_id and m.mapping_type = 'cash_variance'
      and m.source_key = 'short' and m.effective_from <= v_business_date
      and (m.effective_to is null or m.effective_to >= v_business_date)
    order by m.effective_from desc, m.updated_at desc nulls last limit 1;

    if v_cash_account is null or (v_cash_variance > 0 and v_over_account is null)
       or (v_cash_variance < 0 and v_short_account is null) then
      raise exception 'Cash tender and applicable cash-over/short mappings are required after Accounting activation'
        using errcode = '23503';
    end if;

    v_journal := public._restaurant_post_journal(
      v_lodge_id, v_business_date, 'Cash-up variance ' || v_cashup_id,
      'cashup', v_cashup_id, v_key, 'cashup:' || v_cashup_id::text,
      case when v_cash_variance > 0 then
        jsonb_build_array(
          jsonb_build_object('account_id', v_cash_account, 'debit', v_cash_variance, 'credit', 0, 'memo', 'Cash counted over expected drawer'),
          jsonb_build_object('account_id', v_over_account, 'debit', 0, 'credit', v_cash_variance, 'memo', 'Cash over')
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_id', v_short_account, 'debit', abs(v_cash_variance), 'credit', 0, 'memo', 'Cash short'),
          jsonb_build_object('account_id', v_cash_account, 'debit', 0, 'credit', abs(v_cash_variance), 'memo', 'Cash counted short of expected drawer')
        )
      end,
      v_actor_id, null
    );
    update public.pos_cashup_sessions
       set journal_entry_id = (v_journal->'data'->>'entry_id')::uuid
     where id = v_cashup_id and lodge_id = v_lodge_id;
    perform public.record_restaurant_source_posting(
      v_lodge_id, 'cashup', v_cashup_id, v_business_date,
      (v_journal->'data'->>'entry_id')::uuid, v_cashup_id, v_source_hash,
      1, v_shift.outlet_id, 'posted'
    );
  end if;

  update public.pos_shifts
     set status = 'closed', closed_at = now(),
         closing_cash = coalesce((v_counted->>'cash')::numeric, 0),
         close_notes = v_notes, close_idempotency_key = v_key
   where id = v_shift_id;
  update public.pos_orders set status = 'settled'
   where shift_id = v_shift_id and lodge_id = v_lodge_id and status = 'completed';

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, actor_id, operator_id, action,
    entity_type, entity_id, staff_id, amount_delta, idempotency_key,
    after_snapshot, details
  ) values (
    v_lodge_id, v_shift.outlet_id, v_shift_id, v_actor_id, v_shift.cashier_id,
    'cashup_finalized', 'pos_cashup', v_cashup_id, v_actor_id, v_cash_variance, v_key,
    jsonb_build_object('preview', v_preview, 'counted_by_method', v_counted, 'variance_by_method', v_variance),
    jsonb_build_object('notes', v_notes, 'journal_entry_id', case when v_journal is null then null else v_journal->'data'->>'entry_id' end)
  );

  v_result := jsonb_build_object(
    'success', true, 'cashup_id', v_cashup_id, 'shift_id', v_shift_id,
    'business_date', v_business_date, 'expected_cash_drawer', v_preview->'expected_cash_drawer',
    'expected_by_method', v_expected, 'counted_by_method', v_counted,
    'variance_by_method', v_variance, 'preview', v_preview,
    'cash_over_short', v_cash_variance,
    'journal_entry_id', case when v_journal is null then null else v_journal->'data'->>'entry_id' end,
    'financial_source_posted', v_journal is not null or v_cash_variance = 0 or not public.restaurant_accounting_is_active(v_lodge_id),
    'source_status', case when v_cash_variance = 0 then 'not_required_zero_variance' when v_journal is null then 'operational_only' else 'posted' end
  );
  perform public._record_financial_operation(v_lodge_id, v_key, 'finalize_pos_shift_cashup_v2', v_cashup_id, v_request_hash, v_result);
  return v_result;
end
$$;

-- A non-zero post-cutover cash difference is a required financial source.
insert into public.restaurant_financial_source_scope(source_type, gl_treatment, required_when_present, description)
values ('cashup', 'difference-only cash-over/short journal; cash-up never re-recognizes revenue', true, 'Non-zero blind cash-up variance')
on conflict (source_type) do update set
  gl_treatment = excluded.gl_treatment,
  required_when_present = excluded.required_when_present,
  description = excluded.description,
  active = true;

create or replace function public.get_restaurant_financial_source_coverage(
  p_lodge_id uuid, p_start_date date, p_end_date date
)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  where a.lodge_id = p_lodge_id and a.status in ('active','cutover_complete')
  order by a.updated_at desc nulls last limit 1;

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
    'source_type', q.source_type, 'source_id', q.source_id, 'reason', q.reason, 'required', true
  ) order by q.source_type, q.source_id), '[]'::jsonb) into v_missing
  from (
    select o.id source_id, 'pos_order' source_type, 'Completed POS order has no posted financial source record' reason
    from public.pos_orders o
    where v_active and (v_effective_from is null or coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) >= v_effective_from)
      and o.lodge_id=p_lodge_id and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
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
    union all
    select cu.id, 'cashup', 'Non-zero cash-up variance has no posted cash-over/short source record'
    from public.pos_cashup_sessions cu
    where v_active and (v_effective_from is null or cu.date >= v_effective_from)
      and cu.lodge_id=p_lodge_id and cu.date between p_start_date and p_end_date and coalesce(cu.cash_over_short,0)<>0
      and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='cashup' and s.source_id=cu.id and s.status='posted')
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

  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date),
    'effective_from',v_effective_from,'accounting_active',v_active,
    'source_counts',v_rows,'source_matrix',v_scope,'missing',v_missing,
    'posting_exceptions',v_unsupported,
    'required_source_types',(select coalesce(jsonb_agg(source_type order by source_type),'[]'::jsonb) from public.restaurant_financial_source_scope where active and required_when_present),
    'complete',jsonb_array_length(v_missing)=0 and jsonb_array_length(v_unsupported)=0,
    'source_mode','server_authoritative_post_cutover'
  ));
end
$$;

create or replace function public.get_restaurant_accounting_readiness(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_activation record;
  v_missing jsonb := '[]'::jsonb;
  v_unposted integer := 0;
  v_open_exceptions integer := 0;
  v_active boolean := false;
  v_has_account boolean := false;
  v_has_voucher boolean := false;
  v_has_discount boolean := false;
  v_has_tax boolean := false;
  v_has_tips boolean := false;
  v_has_stock boolean := false;
  v_has_settlement boolean := false;
  v_has_cash_variance boolean := false;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select * into v_activation from public.restaurant_accounting_activation where lodge_id=p_lodge_id;
  v_active := public.restaurant_accounting_is_active(p_lodge_id);
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='asset' and is_active) then v_missing:=v_missing||jsonb_build_array('active asset account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='liability' and is_active) then v_missing:=v_missing||jsonb_build_array('active liability account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='revenue' and is_active) then v_missing:=v_missing||jsonb_build_array('active revenue account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='expense' and is_active) then v_missing:=v_missing||jsonb_build_array('active expense account'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='cash' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('cash tender mapping'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='category' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('POS category revenue mapping'); end if;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and (lower(coalesce(o.payment_method,'')) in ('account','ar') or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method','')) in ('account','ar')))) into v_has_account;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and (lower(coalesce(o.payment_method,''))='voucher' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher'))) into v_has_voucher;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.discount_total,0)>0) into v_has_discount;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.tax_total,0)>0) into v_has_tax;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.tip_total,0)>0) into v_has_tips;
  select exists(select 1 from public.inventory_movements m where m.lodge_id=p_lodge_id and m.movement_type in('recipe_sale','sale','pos_sale','receipt','adjustment','waste','transfer')) into v_has_stock;
  select exists(select 1 from public.restaurant_settlement_reconciliations s where s.lodge_id=p_lodge_id) into v_has_settlement;
  select exists(select 1 from public.pos_cashup_sessions c where c.lodge_id=p_lodge_id and coalesce(c.cash_over_short,0)<>0) into v_has_cash_variance;
  if v_has_account and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key in('account','ar')) then v_missing:=v_missing||jsonb_build_array('customer-account receivable tender mapping'); end if;
  if v_has_voucher and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='voucher') then v_missing:=v_missing||jsonb_build_array('voucher liability tender mapping'); end if;
  if v_has_discount and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='discount' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default discount mapping'); end if;
  if v_has_tax and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tax' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default output-tax mapping'); end if;
  if v_has_tips and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tips' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default tips-payable mapping'); end if;
  if v_has_stock and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='cogs' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default COGS mapping'); end if;
  if v_has_stock and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='inventory' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default inventory-control mapping'); end if;
  if v_has_settlement and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='settlement_clearing' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('settlement-clearing mapping'); end if;
  if v_has_settlement and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='settlement_fee' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('settlement-fee mapping'); end if;
  if v_has_cash_variance and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='cash_variance' and m.source_key='over') then v_missing:=v_missing||jsonb_build_array('cash-over mapping'); end if;
  if v_has_cash_variance and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='cash_variance' and m.source_key='short') then v_missing:=v_missing||jsonb_build_array('cash-short mapping'); end if;
  select count(*) into v_unposted from public.expenses e where e.lodge_id=p_lodge_id and e.status in('unposted','exception');
  select count(*) into v_open_exceptions from public.restaurant_reconciliation_exceptions e where e.lodge_id=p_lodge_id and e.status in('open','investigating') and e.severity='blocking';
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'active',v_active,'status',coalesce(v_activation.status,'draft'),'effective_from',v_activation.effective_from,
    'policy_version',coalesce(v_activation.policy_version,'bar-accounting-financial-truth-v1'),'configuration_version',coalesce(v_activation.configuration_version,'unconfigured'),
    'mapping_requirements',jsonb_build_object('account',v_has_account,'voucher',v_has_voucher,'discount',v_has_discount,'tax',v_has_tax,'tips',v_has_tips,'stock',v_has_stock,'settlement',v_has_settlement,'cash_variance',v_has_cash_variance),
    'missing_requirements',v_missing,'unposted_expenses',v_unposted,'blocking_exceptions',v_open_exceptions,
    'ready',jsonb_array_length(v_missing)=0 and v_unposted=0 and v_open_exceptions=0
  ));
end
$$;

revoke all on function public.finalize_pos_shift_cashup_v2(jsonb) from public;
grant execute on function public.finalize_pos_shift_cashup_v2(jsonb) to anon, authenticated, service_role;
revoke all on function public.get_restaurant_financial_source_coverage(uuid,date,date) from public, anon;
grant execute on function public.get_restaurant_financial_source_coverage(uuid,date,date) to authenticated, service_role;
revoke all on function public.get_restaurant_accounting_readiness(uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_accounting_readiness(uuid) to service_role;

commit;
