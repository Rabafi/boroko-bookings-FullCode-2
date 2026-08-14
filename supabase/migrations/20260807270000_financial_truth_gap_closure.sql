-- Financial-truth gap closure: typed mappings, expense containment,
-- deterministic ledger paging, and an explicit source-coverage matrix.
-- Forward-only. This migration restores no direct client table writes.

begin;

-- ---------------------------------------------------------------------------
-- Mapping taxonomy
-- ---------------------------------------------------------------------------

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
  add constraint restaurant_pos_gl_mappings_mapping_type_financial_truth_chk
  check (mapping_type in (
    'category','tender','discount','tax','tips','cogs','inventory',
    'settlement_fee','settlement_clearing','expense_category','expense_payable'
  ));

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
    'settlement_fee','settlement_clearing','expense_category','expense_payable'
  ) or v_key = '' then
    raise exception 'Valid typed mapping type and source key are required' using errcode = '22023';
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
    raise exception 'Cash, card, mobile-money, account, and clearing tender mappings require asset accounts' using errcode = '22023';
  elsif v_type in ('tax','tips') and v_account_type <> 'liability' then
    raise exception 'Tax and tips mappings require liability accounts' using errcode = '22023';
  elsif v_type in ('cogs','settlement_fee','expense_category') and v_account_type <> 'expense' then
    raise exception 'COGS, settlement-fee, and expense-category mappings require expense accounts' using errcode = '22023';
  elsif v_type in ('inventory','settlement_clearing') and v_account_type <> 'asset' then
    raise exception 'Inventory and settlement-clearing mappings require asset accounts' using errcode = '22023';
  elsif v_type = 'expense_payable' and v_account_type <> 'liability' then
    raise exception 'Expense-payable mappings require liability accounts' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- Expense lifecycle containment
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists tax_treatment text not null default 'out_of_scope',
  add column if not exists created_by uuid references public.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_tax_treatment_chk') then
    alter table public.expenses add constraint expenses_tax_treatment_chk
      check (tax_treatment in ('taxable','zero_rated','exempt','out_of_scope','unknown'));
  end if;
end
$$;

-- Creating an expense creates a draft source document. Recognition is performed
-- only by submit -> approve -> post, so a compatibility caller cannot create a
-- cash/GL entry merely by opening the expense form.
create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_operation uuid := coalesce(nullif(payload->>'operation_id', '')::uuid, v_id);
  v_amount numeric := round(coalesce(nullif(payload->>'amount', '')::numeric, 0), 2);
  v_tax numeric := round(coalesce(nullif(payload->>'tax_amount', '')::numeric, 0), 2);
  v_treatment text := lower(coalesce(nullif(btrim(payload->>'tax_treatment'), ''), 'out_of_scope'));
  v_actor uuid;
  v_hash text;
  v_existing public.expenses%rowtype;
begin
  v_actor := public._restaurant_require_capability(v_lodge, 'expenses.manage');
  if v_lodge is null or v_amount <= 0 or v_amount > 999999.99 then
    raise exception 'Expense lodge and amount are required' using errcode = '22023';
  end if;
  if v_tax < 0 or v_tax > v_amount then
    raise exception 'Expense tax must be between zero and the expense amount' using errcode = '22023';
  end if;
  if v_treatment not in ('taxable','zero_rated','exempt','out_of_scope','unknown') then
    raise exception 'Unsupported expense tax treatment' using errcode = '22023';
  end if;
  if v_treatment = 'taxable' and v_tax <= 0 then
    raise exception 'Taxable expenses require an explicit positive tax amount' using errcode = '22023';
  end if;
  if v_treatment <> 'taxable' and v_tax <> 0 then
    raise exception 'Only taxable expenses may carry input tax' using errcode = '22023';
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'id', v_id, 'lodge_id', v_lodge, 'operation_id', v_operation,
    'date', payload->>'date', 'category', payload->>'category',
    'description', payload->>'description', 'amount', v_amount,
    'tax_amount', v_tax, 'tax_treatment', v_treatment,
    'source_kind', coalesce(payload->>'source_kind', 'direct'),
    'source_document_type', payload->>'source_document_type',
    'source_document_id', payload->>'source_document_id',
    'supplier_id', payload->>'supplier_id', 'payee_name', payload->>'payee_name',
    'payment_method', payload->>'payment_method',
    'payment_account_id', payload->>'payment_account_id',
    'expense_account_id', payload->>'expense_account_id',
    'tax_code', payload->>'tax_code', 'reference_number', payload->>'reference_number',
    'evidence_ref', payload->>'evidence_ref'
  )::text, 'sha256'), 'hex');

  select * into v_existing
  from public.expenses
  where id = v_id and lodge_id = v_lodge
  for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception 'Expense operation conflicts with the original payload' using errcode = '22000';
    end if;
    return jsonb_build_object('success', true, 'id', v_id, 'status', v_existing.status, 'replayed', true);
  end if;
  if exists (select 1 from public.expenses where lodge_id = v_lodge and operation_id = v_operation) then
    raise exception 'Expense operation key is already bound to another expense' using errcode = '23505';
  end if;
  if nullif(btrim(coalesce(payload->>'source_kind', 'direct')), '') = 'direct'
     and nullif(btrim(payload->>'evidence_ref'), '') is null then
    raise exception 'Direct expenses require evidence_ref before submission' using errcode = '22023';
  end if;

  insert into public.expenses(
    id, lodge_id, date, category, description, amount, notes, outlet_id,
    status, operation_id, payload_hash, evidence_ref, source_kind,
    source_document_type, source_document_id, supplier_id, payee_name,
    payment_method, payment_account_id, expense_account_id, tax_code,
    tax_amount, tax_treatment, reference_number, created_by
  ) values (
    v_id, v_lodge, nullif(payload->>'date', '')::date,
    nullif(payload->>'category', ''), nullif(payload->>'description', ''),
    v_amount, nullif(payload->>'notes', ''), nullif(payload->>'outlet_id', '')::uuid,
    'draft', v_operation, v_hash, nullif(payload->>'evidence_ref', ''),
    coalesce(nullif(payload->>'source_kind', ''), 'direct'),
    nullif(payload->>'source_document_type', ''), nullif(payload->>'source_document_id', '')::uuid,
    nullif(payload->>'supplier_id', '')::uuid, nullif(payload->>'payee_name', ''),
    nullif(payload->>'payment_method', ''), nullif(payload->>'payment_account_id', '')::uuid,
    nullif(payload->>'expense_account_id', '')::uuid, nullif(payload->>'tax_code', ''),
    v_tax, v_treatment, nullif(payload->>'reference_number', ''), v_actor
  );
  perform public.log_restaurant_financial_action(
    v_lodge, 'expense.created', 'expense', v_id, null,
    jsonb_build_object('status', 'draft', 'operation_id', v_operation, 'payload_hash', v_hash), null
  );
  return jsonb_build_object('success', true, 'id', v_id, 'status', 'draft', 'replayed', false);
end
$$;

-- ---------------------------------------------------------------------------
-- Source-coverage matrix
-- ---------------------------------------------------------------------------

create table if not exists public.restaurant_financial_source_scope (
  source_type text primary key,
  gl_treatment text not null,
  required_when_present boolean not null default true,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.restaurant_financial_source_scope enable row level security;
revoke all on table public.restaurant_financial_source_scope from public, anon, authenticated;
grant select on table public.restaurant_financial_source_scope to service_role;

insert into public.restaurant_financial_source_scope(source_type, gl_treatment, required_when_present, description)
values
  ('pos_order', 'sale/return, tender, tax, tips, COGS and source audit are atomic', true, 'Completed POS sales and returns'),
  ('expense', 'direct expense recognition and source audit are atomic', true, 'Approved direct-paid or payable expenses'),
  ('expense_payment', 'expense payable settlement and source audit are atomic', true, 'Direct expense payment'),
  ('ap_bill', 'approved supplier bill recognition and source audit are atomic', true, 'Recognized supplier bills'),
  ('ap_payment', 'AP settlement and source audit are atomic', true, 'Supplier payments'),
  ('payroll', 'approved payroll liabilities and source audit are atomic', true, 'Approved payroll posting'),
  ('payroll_settlement', 'payroll liability settlement and source audit are atomic', true, 'Payroll payment batch settlement'),
  ('inventory_purchase', 'inventory valuation and payable/cash source audit are atomic', true, 'Inventory receipt'),
  ('inventory_stocktake', 'inventory adjustment/COGS source audit are atomic', true, 'Posted physical stocktake'),
  ('settlement', 'clearing, fee, deposit and source audit are atomic', true, 'Card/mobile settlement batch'),
  ('bank_reconciliation', 'evidence control; no revenue recognition', false, 'Bank statement evidence and reconciliation packet'),
  ('stock_transfer', 'subledger-only; no net GL movement', false, 'Custody transfer between stock locations')
on conflict (source_type) do update set
  gl_treatment = excluded.gl_treatment,
  required_when_present = excluded.required_when_present,
  description = excluded.description,
  active = true;

create index if not exists restaurant_financial_source_scope_active_idx
  on public.restaurant_financial_source_scope(active, required_when_present);

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
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid source-coverage period is required' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x order by x.source_type), '[]'::jsonb)
    into v_rows
  from (
    select s.source_type,
           count(*) as source_count,
           count(*) filter (where s.status = 'posted') as posted_count,
           count(*) filter (where s.status <> 'posted' or s.journal_entry_id is null) as exception_count,
           min(s.business_date) as first_business_date,
           max(s.business_date) as last_business_date
      from public.restaurant_financial_source_postings s
     where s.lodge_id = p_lodge_id
       and s.business_date between p_start_date and p_end_date
     group by s.source_type
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type', q.source_type, 'source_id', q.source_id,
    'reason', q.reason, 'required', true
  ) order by q.source_type, q.source_id), '[]'::jsonb)
    into v_missing
  from (
    select o.id as source_id, 'pos_order' as source_type,
           'Completed POS order has no posted financial source record' as reason
      from public.pos_orders o
     where o.lodge_id = p_lodge_id
       and coalesce(o.business_date, (o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
       and o.status in ('completed','settled')
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'pos_order' and s.source_id = o.id and s.status = 'posted')
    union all
    select e.id, 'expense', 'Posted expense has no posted financial source record'
      from public.expenses e
     where e.lodge_id = p_lodge_id and e.date between p_start_date and p_end_date and e.status in ('posted','paid','reversed')
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'expense' and s.source_id = e.id and s.status = 'posted')
    union all
    select e.id, 'expense_payment', 'Paid expense has no posted settlement source record'
      from public.expenses e
     where e.lodge_id = p_lodge_id and coalesce(e.paid_at::date,e.date) between p_start_date and p_end_date and e.status in ('paid','reversed')
       and e.payment_journal_entry_id is not null
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'expense_payment' and s.source_id = e.id and s.status = 'posted')
    union all
    select b.id, 'ap_bill', 'Recognized AP bill has no posted financial source record'
      from public.restaurant_bills b
     where b.lodge_id = p_lodge_id and b.bill_date between p_start_date and p_end_date
       and b.status in ('approved','partially_paid','paid','overdue') and b.accrual_journal_entry_id is not null
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'ap_bill' and s.source_id = b.id and s.status = 'posted')
    union all
    select bp.id, 'ap_payment', 'AP payment has no posted settlement source record'
      from public.restaurant_bill_payments bp
     where bp.lodge_id = p_lodge_id and bp.payment_date between p_start_date and p_end_date and bp.journal_entry_id is not null
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'ap_payment' and s.source_id = bp.id and s.status = 'posted')
    union all
    select p.id, 'payroll', 'Posted payroll period has no posted financial source record'
      from public.restaurant_pay_periods p
     where p.lodge_id = p_lodge_id and p.end_date between p_start_date and p_end_date and p.journal_entry_id is not null
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'payroll' and s.source_id = p.id and s.status = 'posted')
    union all
    select ip.id, 'inventory_purchase', 'Inventory receipt has no posted financial source record'
      from public.inventory_purchases ip
     where ip.lodge_id = p_lodge_id and ip.date between p_start_date and p_end_date
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'inventory_purchase' and s.source_id = ip.id and s.status = 'posted')
    union all
    select st.id, 'inventory_stocktake', 'Posted stocktake has no posted financial source record'
      from public.inventory_stocktakes st
     where st.lodge_id = p_lodge_id and st.status = 'posted' and st.posted_at::date between p_start_date and p_end_date
       and exists (select 1 from public.inventory_stocktake_lines sl where sl.stocktake_id = st.id and sl.lodge_id = p_lodge_id and coalesce(sl.variance_cost,0) <> 0)
       and not exists (select 1 from public.restaurant_financial_source_postings s where s.lodge_id = p_lodge_id and s.source_type = 'inventory_stocktake' and s.source_id = st.id and s.status = 'posted')
  ) q;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.source_type), '[]'::jsonb)
    into v_scope
  from public.restaurant_financial_source_scope s
  where s.active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type', s.source_type, 'source_count', s.source_count,
    'posted_count', s.posted_count, 'exception_count', s.exception_count,
    'required_when_present', sc.required_when_present,
    'gl_treatment', sc.gl_treatment
  ) order by s.source_type), '[]'::jsonb)
    into v_unsupported
  from jsonb_to_recordset(v_rows) as s(source_type text, source_count bigint, posted_count bigint, exception_count bigint)
  join public.restaurant_financial_source_scope sc on sc.source_type = s.source_type and sc.active
  where sc.required_when_present and s.exception_count > 0;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'period', jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date),
      'source_counts', v_rows,
      'source_matrix', v_scope,
      'missing', v_missing,
      'posting_exceptions', v_unsupported,
      'required_source_types', (
        select coalesce(jsonb_agg(source_type order by source_type), '[]'::jsonb)
          from public.restaurant_financial_source_scope
         where active and required_when_present
      ),
      'complete', jsonb_array_length(v_missing) = 0 and jsonb_array_length(v_unsupported) = 0,
      'source_mode', 'server_authoritative_post_cutover'
    )
  );
end
$$;

revoke all on function public.set_restaurant_pos_gl_mapping(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_expense(jsonb) from public, anon, authenticated;
revoke all on function public.get_restaurant_financial_source_coverage(uuid, date, date) from public, anon, authenticated;
grant execute on function public.set_restaurant_pos_gl_mapping(uuid, text, text, uuid) to service_role;
grant execute on function public.create_expense(jsonb) to authenticated, service_role;
grant execute on function public.get_restaurant_financial_source_coverage(uuid, date, date) to authenticated, service_role;

commit;
