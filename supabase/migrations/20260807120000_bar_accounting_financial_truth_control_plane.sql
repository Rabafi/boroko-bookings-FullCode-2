-- Bar / Restaurant Accounting financial truth control plane.
-- Forward-only: historical data is not rewritten and accounting is enabled only
-- through the explicit readiness + cutover activation RPC.

begin;

alter table public.restaurant_journal_entries
  add column if not exists source_version integer not null default 1,
  add column if not exists source_business_date date,
  add column if not exists outlet_id uuid,
  add column if not exists operation_id uuid,
  add column if not exists mapping_version text,
  add column if not exists configuration_version text,
  add column if not exists source_payload_hash text;

create table if not exists public.restaurant_accounting_activation (
  lodge_id uuid primary key references public.settings(lodge_id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','ready','active','suspended','cutover_complete')),
  effective_from date,
  policy_version text not null default 'bar-accounting-financial-truth-v1',
  configuration_version text not null default 'unconfigured',
  historical_cutover_date date,
  historical_cutover_batch_id uuid,
  activated_by uuid references public.users(id),
  activated_at timestamptz,
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_financial_source_postings (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  source_version integer not null default 1,
  business_date date not null,
  outlet_id uuid,
  operation_id uuid,
  payload_hash text not null,
  journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  status text not null default 'posted' check (status in ('pending','posted','reversed','exception')),
  exception_code text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (lodge_id, source_type, source_id, source_version),
  unique (lodge_id, operation_id)
);

create index if not exists restaurant_financial_source_postings_lodge_date_idx
  on public.restaurant_financial_source_postings(lodge_id, business_date, source_type);
create index if not exists restaurant_financial_source_postings_journal_idx
  on public.restaurant_financial_source_postings(journal_entry_id);

create table if not exists public.restaurant_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  source_type text,
  source_id uuid,
  severity text not null default 'error' check (severity in ('warning','error','blocking')),
  status text not null default 'open' check (status in ('open','investigating','resolved','accepted')),
  expected_value numeric(18,2),
  actual_value numeric(18,2),
  details jsonb not null default '{}'::jsonb,
  assigned_to uuid references public.users(id),
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_report_runs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  report_key text not null,
  period_start date,
  period_end date,
  outlet_id uuid,
  as_of timestamptz not null default now(),
  status text not null default 'started' check (status in ('started','complete','failed')),
  complete boolean not null default false,
  source_manifest jsonb not null default '{}'::jsonb,
  control_totals jsonb not null default '{}'::jsonb,
  data_hash text,
  generated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.restaurant_report_run_sections (
  id uuid primary key default gen_random_uuid(),
  report_run_id uuid not null references public.restaurant_report_runs(id) on delete cascade,
  section_key text not null,
  row_count integer not null default 0,
  source_name text not null,
  source_hash text,
  complete boolean not null default false,
  created_at timestamptz not null default now(),
  unique(report_run_id, section_key)
);

create index if not exists restaurant_reconciliation_exceptions_open_idx
  on public.restaurant_reconciliation_exceptions(lodge_id, status, severity);

alter table public.restaurant_customers
  add column if not exists credit_limit numeric(18,2) not null default 0,
  add column if not exists account_status text not null default 'active';

alter table public.restaurant_account_ledger
  add column if not exists source_version integer not null default 1,
  add column if not exists operation_id uuid,
  add column if not exists payload_hash text,
  add column if not exists balance_after numeric(18,2),
  add column if not exists reversed_at timestamptz;

create unique index if not exists restaurant_account_ledger_operation_uidx
  on public.restaurant_account_ledger(lodge_id, operation_id)
  where operation_id is not null;

create table if not exists public.restaurant_voucher_ledger (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  voucher_id uuid not null references public.restaurant_vouchers(id) on delete restrict,
  order_id uuid,
  operation_id uuid,
  amount numeric(18,2) not null,
  balance_after numeric(18,2) not null,
  reason text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique(lodge_id, operation_id)
);

alter table public.expenses
  add column if not exists status text not null default 'unposted',
  add column if not exists source_version integer not null default 1,
  add column if not exists operation_id uuid,
  add column if not exists payload_hash text,
  add column if not exists journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists approved_by uuid references public.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists evidence_ref text;

create unique index if not exists expenses_operation_uidx
  on public.expenses(lodge_id, operation_id)
  where operation_id is not null;

alter table public.restaurant_pay_periods
  add column if not exists expected_worker_count integer not null default 0,
  add column if not exists calculated_worker_count integer not null default 0,
  add column if not exists approved_at timestamptz,
  add column if not exists payment_batch_id uuid;

create table if not exists public.restaurant_payroll_expected_workers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete cascade,
  staff_user_id uuid not null references public.users(id) on delete restrict,
  source text not null default 'employment_terms',
  expected boolean not null default true,
  created_at timestamptz not null default now(),
  unique(pay_period_id, staff_user_id)
);

create table if not exists public.restaurant_historical_cutover_batches (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  cutover_date date not null,
  opening_balances jsonb not null default '[]'::jsonb,
  source_counts jsonb not null default '{}'::jsonb,
  control_totals jsonb not null default '{}'::jsonb,
  evidence_manifest jsonb not null default '{}'::jsonb,
  status text not null default 'prepared' check(status in ('prepared','approved','applied','rejected')),
  prepared_by uuid references public.users(id),
  operation_key text,
  approved_by uuid references public.users(id),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.restaurant_historical_cutover_batches add column if not exists operation_key text;
create unique index if not exists restaurant_historical_cutover_batches_lodge_date_uidx
  on public.restaurant_historical_cutover_batches(lodge_id, cutover_date);
create unique index if not exists restaurant_historical_cutover_batches_operation_uidx
  on public.restaurant_historical_cutover_batches(lodge_id, operation_key)
  where operation_key is not null;

create table if not exists public.restaurant_bank_reconciliation_packets (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bank_account_id uuid not null references public.restaurant_bank_accounts(id) on delete restrict,
  statement_import_id uuid references public.restaurant_bank_statement_imports(id) on delete restrict,
  statement_hash text not null,
  book_balance numeric(18,2) not null,
  bank_balance numeric(18,2) not null,
  difference numeric(18,2) not null,
  control_totals jsonb not null default '{}'::jsonb,
  status text not null default 'prepared' check(status in ('prepared','reviewed','complete','exception')),
  prepared_by uuid references public.users(id),
  reviewed_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_status_chk') then
    alter table public.expenses add constraint expenses_status_chk
      check(status in ('unposted','posted','voided','exception'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurant_customers_account_status_chk') then
    alter table public.restaurant_customers add constraint restaurant_customers_account_status_chk
      check(account_status in ('active','suspended','closed'));
  end if;
end
$$;

alter table public.restaurant_accounting_activation enable row level security;
alter table public.restaurant_financial_source_postings enable row level security;
alter table public.restaurant_reconciliation_exceptions enable row level security;
alter table public.restaurant_report_runs enable row level security;
alter table public.restaurant_report_run_sections enable row level security;
alter table public.restaurant_voucher_ledger enable row level security;
alter table public.restaurant_historical_cutover_batches enable row level security;
alter table public.restaurant_bank_reconciliation_packets enable row level security;

revoke all on table public.restaurant_accounting_activation,
  public.restaurant_financial_source_postings,
  public.restaurant_reconciliation_exceptions,
  public.restaurant_report_runs,
  public.restaurant_report_run_sections,
  public.restaurant_voucher_ledger,
  public.restaurant_historical_cutover_batches,
  public.restaurant_bank_reconciliation_packets
  from public, anon, authenticated;

create or replace function public.restaurant_accounting_is_active(p_lodge_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.restaurant_accounting_activation a
    where a.lodge_id = p_lodge_id
      and a.status in ('active','cutover_complete')
      and a.effective_from is not null
      and a.effective_from <= public.get_lodge_business_date(p_lodge_id)
  )
$$;

create or replace function public.record_restaurant_source_posting(
  p_lodge_id uuid, p_source_type text, p_source_id uuid, p_business_date date,
  p_journal_entry_id uuid, p_operation_id uuid, p_payload_hash text,
  p_source_version integer default 1, p_outlet_id uuid default null,
  p_status text default 'posted'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_source_id is null or nullif(btrim(p_source_type),'') is null or p_business_date is null or p_journal_entry_id is null then
    raise exception 'Source posting requires source, business date and journal entry' using errcode='22023';
  end if;
  if p_operation_id is not null and exists(
    select 1 from public.restaurant_financial_source_postings s
    where s.lodge_id=p_lodge_id and s.operation_id=p_operation_id
      and not (s.source_type=btrim(p_source_type) and s.source_id=p_source_id and s.source_version=coalesce(p_source_version,1))
  ) then
    raise exception 'Operation key is already bound to a different financial source' using errcode='23505';
  end if;
  if exists(
    select 1 from public.restaurant_financial_source_postings s
    where s.lodge_id=p_lodge_id and s.source_type=btrim(p_source_type) and s.source_id=p_source_id
      and s.source_version=coalesce(p_source_version,1)
      and s.payload_hash<>coalesce(p_payload_hash,'')
  ) then
    raise exception 'Financial source payload changed during retry' using errcode='22000';
  end if;
  insert into public.restaurant_financial_source_postings(
    lodge_id,source_type,source_id,source_version,business_date,outlet_id,
    operation_id,payload_hash,journal_entry_id,status,created_by
  ) values(
    p_lodge_id,btrim(p_source_type),p_source_id,coalesce(p_source_version,1),p_business_date,
    p_outlet_id,p_operation_id,coalesce(p_payload_hash,''),p_journal_entry_id,
    coalesce(p_status,'posted'),public.app_current_user_id()
  )
  on conflict(lodge_id,source_type,source_id,source_version) do update
    set journal_entry_id=excluded.journal_entry_id,status=excluded.status,
        payload_hash=excluded.payload_hash,
        operation_id=coalesce(excluded.operation_id,restaurant_financial_source_postings.operation_id)
  returning id into v_id;
  return jsonb_build_object('success',true,'id',v_id);
end
$$;

create or replace function public.get_restaurant_accounting_readiness(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_activation record; v_missing jsonb:='[]'::jsonb; v_unposted integer:=0;
  v_open_exceptions integer:=0; v_active boolean:=false;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select * into v_activation from public.restaurant_accounting_activation where lodge_id=p_lodge_id;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='asset' and is_active) then v_missing:=v_missing||jsonb_build_array('active asset account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='revenue' and is_active) then v_missing:=v_missing||jsonb_build_array('active revenue account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='expense' and is_active) then v_missing:=v_missing||jsonb_build_array('active expense account'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='cash' and a.account_type='asset') then v_missing:=v_missing||jsonb_build_array('cash tender mapping'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active where m.lodge_id=p_lodge_id and m.mapping_type='category' and a.account_type='revenue') then v_missing:=v_missing||jsonb_build_array('POS category revenue mapping'); end if;
  select count(*) into v_unposted from public.expenses e where e.lodge_id=p_lodge_id and e.status in ('unposted','exception');
  select count(*) into v_open_exceptions from public.restaurant_reconciliation_exceptions e where e.lodge_id=p_lodge_id and e.status in ('open','investigating') and e.severity='blocking';
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'active',v_active,'status',coalesce(v_activation.status,'draft'),
    'effective_from',v_activation.effective_from,
    'policy_version',coalesce(v_activation.policy_version,'bar-accounting-financial-truth-v1'),
    'configuration_version',coalesce(v_activation.configuration_version,'unconfigured'),
    'missing_requirements',v_missing,'unposted_expenses',v_unposted,
    'blocking_exceptions',v_open_exceptions,
    'ready',jsonb_array_length(v_missing)=0 and v_unposted=0 and v_open_exceptions=0
  ));
end
$$;

create or replace function public.prepare_restaurant_historical_cutover(
  p_lodge_id uuid, p_cutover_date date, p_opening_balances jsonb,
  p_evidence_manifest jsonb default '{}'::jsonb, p_operation_key text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_id uuid; v_hash text; v_operation_key text; v_existing public.restaurant_historical_cutover_batches%rowtype;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_cutover_date is null or jsonb_typeof(coalesce(p_opening_balances,'[]'::jsonb))<>'array' then raise exception 'Cutover date and opening balances are required' using errcode='22023'; end if;
  v_operation_key:=nullif(btrim(p_operation_key),'');
  v_hash:=encode(digest(jsonb_build_object('lodge_id',p_lodge_id,'date',p_cutover_date,'opening_balances',p_opening_balances,'operation_key',v_operation_key)::text,'sha256'),'hex');
  if v_operation_key is not null and exists(select 1 from public.restaurant_historical_cutover_batches b where b.lodge_id=p_lodge_id and b.operation_key=v_operation_key and b.cutover_date<>p_cutover_date) then raise exception 'Cutover operation key is already bound to another date' using errcode='23505'; end if;
  select * into v_existing from public.restaurant_historical_cutover_batches where lodge_id=p_lodge_id and cutover_date=p_cutover_date for update;
  if found and v_existing.status in('approved','applied') then raise exception 'Approved or applied cutover batches are immutable' using errcode='55000'; end if;
  insert into public.restaurant_historical_cutover_batches(lodge_id,cutover_date,opening_balances,source_counts,control_totals,evidence_manifest,prepared_by,operation_key)
  values(p_lodge_id,p_cutover_date,p_opening_balances,jsonb_build_object('pos_orders',(select count(*) from public.pos_orders where lodge_id=p_lodge_id and coalesce(business_date,(created_at at time zone 'Africa/Gaborone')::date)<p_cutover_date)),jsonb_build_object('payload_hash',v_hash),coalesce(p_evidence_manifest,'{}'::jsonb),v_actor,v_operation_key)
  on conflict(lodge_id,cutover_date) do update set opening_balances=excluded.opening_balances,evidence_manifest=excluded.evidence_manifest,control_totals=excluded.control_totals,prepared_by=excluded.prepared_by,operation_key=coalesce(excluded.operation_key,restaurant_historical_cutover_batches.operation_key);
  select id into v_id from public.restaurant_historical_cutover_batches where lodge_id=p_lodge_id and cutover_date=p_cutover_date;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'payload_hash',v_hash,'status','prepared'));
end
$$;

create or replace function public.activate_restaurant_accounting(
  p_lodge_id uuid, p_effective_from date, p_configuration_version text,
  p_policy_version text default 'bar-accounting-financial-truth-v1',
  p_cutover_batch_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_ready jsonb; v_id uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_ready:=public.get_restaurant_accounting_readiness(p_lodge_id)->'data';
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Accounting readiness gate is not satisfied: %',v_ready->'missing_requirements' using errcode='55000'; end if;
  if p_effective_from is null or nullif(btrim(coalesce(p_configuration_version,'')),'') is null then raise exception 'Effective date and configuration version are required' using errcode='22023'; end if;
  if p_cutover_batch_id is null and exists(select 1 from public.pos_orders where lodge_id=p_lodge_id) then raise exception 'An approved historical cutover batch is required when historical POS activity exists' using errcode='55000'; end if;
  if p_cutover_batch_id is not null and not exists(select 1 from public.restaurant_historical_cutover_batches where id=p_cutover_batch_id and lodge_id=p_lodge_id and status in ('approved','applied')) then raise exception 'Approved historical cutover batch is required' using errcode='55000'; end if;
  insert into public.restaurant_accounting_activation(lodge_id,status,effective_from,policy_version,configuration_version,historical_cutover_batch_id,activated_by,activated_at,updated_at)
  values(p_lodge_id,'active',p_effective_from,coalesce(p_policy_version,'bar-accounting-financial-truth-v1'),btrim(p_configuration_version),p_cutover_batch_id,v_actor,now(),now())
  on conflict(lodge_id) do update set status='active',effective_from=excluded.effective_from,policy_version=excluded.policy_version,configuration_version=excluded.configuration_version,historical_cutover_batch_id=excluded.historical_cutover_batch_id,activated_by=excluded.activated_by,activated_at=excluded.activated_at,updated_at=now()
  returning lodge_id into v_id;
  if p_cutover_batch_id is not null then
    update public.restaurant_historical_cutover_batches set status='applied',applied_at=coalesce(applied_at,now()) where id=p_cutover_batch_id and lodge_id=p_lodge_id and status='approved';
  end if;
  perform public.log_restaurant_financial_action(p_lodge_id,'accounting_activated','accounting_activation',v_id,null,jsonb_build_object('effective_from',p_effective_from,'configuration_version',p_configuration_version,'cutover_batch_id',p_cutover_batch_id),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('lodge_id',v_id,'status','active','effective_from',p_effective_from,'configuration_version',p_configuration_version));
end
$$;

create or replace function public.suspend_restaurant_accounting(p_lodge_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Suspension reason is required' using errcode='22023'; end if;
  update public.restaurant_accounting_activation set status='suspended',suspended_reason=btrim(p_reason),updated_at=now() where lodge_id=p_lodge_id;
  if not found then raise exception 'Accounting activation record not found' using errcode='P0002'; end if;
  perform public.log_restaurant_financial_action(p_lodge_id,'accounting_suspended','accounting_activation',p_lodge_id,null,jsonb_build_object('reason',p_reason),null);
  return jsonb_build_object('success',true,'status','suspended','actor_id',v_actor);
end
$$;

create or replace function public.get_restaurant_financial_statements_v2(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_accounts jsonb; v_revenue jsonb; v_expenses jsonb;
  v_assets numeric:=0; v_liabilities numeric:=0; v_equity numeric:=0;
  v_revenue_total numeric:=0; v_expense_total numeric:=0;
  v_cumulative_revenue numeric:=0; v_cumulative_expense numeric:=0;
  v_difference numeric:=0; v_cashflow jsonb:='{}'::jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Valid statement period is required' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'name',x.name,'account_type',x.account_type,'balance',round(x.balance,2)) order by x.code),'[]'::jsonb),
    coalesce(sum(x.balance) filter(where x.account_type='asset'),0),
    coalesce(sum(x.balance) filter(where x.account_type='liability'),0),
    coalesce(sum(x.balance) filter(where x.account_type='equity'),0)
  into v_accounts,v_assets,v_liabilities,v_equity
  from (
    select a.id,a.code,a.name,a.account_type,
      case when a.account_type in('asset','expense')
        then coalesce((select sum(l.debit-l.credit) from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date),0)+coalesce(a.opening_balance,0)
        else coalesce((select sum(l.credit-l.debit) from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date),0)+coalesce(a.opening_balance,0)
      end balance
    from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.is_active
  )x;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'name',x.name,'amount',round(x.amount,2)) order by x.code),'[]'::jsonb),coalesce(sum(x.amount),0)
    into v_revenue,v_revenue_total
    from (select a.id,a.code,a.name,coalesce((select sum(l.credit-l.debit) from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date),0) amount from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.account_type='revenue' and a.is_active)x;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'name',x.name,'amount',round(x.amount,2)) order by x.code),'[]'::jsonb),coalesce(sum(x.amount),0)
    into v_expenses,v_expense_total
    from (select a.id,a.code,a.name,coalesce((select sum(l.debit-l.credit) from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date),0) amount from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.account_type='expense' and a.is_active)x;
  select coalesce(sum(case when a.account_type='revenue' then l.credit-l.debit else 0 end),0),coalesce(sum(case when a.account_type='expense' then l.debit-l.credit else 0 end),0)
    into v_cumulative_revenue,v_cumulative_expense
    from public.restaurant_accounts a
    join public.restaurant_journal_lines l on l.account_id=a.id
    join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date
   where a.lodge_id=p_lodge_id and a.account_type in('revenue','expense');
  with journal_cash as(
    select e.id,
      sum(case when a.cash_flow_classification='cash' then l.debit-l.credit else 0 end) cash_movement,
      array_agg(distinct a.cash_flow_classification) filter(where a.cash_flow_classification<>'cash' and (l.debit<>0 or l.credit<>0)) classes
    from public.restaurant_journal_entries e
    join public.restaurant_journal_lines l on l.entry_id=e.id
    join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id
   where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
   group by e.id
  ), classified as(
    select case when cardinality(classes)=1 and classes[1] in('operating','investing','financing') then classes[1] else 'unclassified' end classification,cash_movement
    from journal_cash where cash_movement<>0
  )
  select coalesce(jsonb_object_agg(classification,amount),'{}'::jsonb) into v_cashflow
    from(select classification,round(sum(cash_movement),2) amount from classified group by classification)x;
  v_difference:=round(v_assets-(v_liabilities+v_equity+v_cumulative_revenue-v_cumulative_expense),2);
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'as_of',now()),
    'balance_sheet',jsonb_build_object('accounts',v_accounts,'assets',coalesce((select jsonb_agg(x order by x->>'code') from jsonb_array_elements(v_accounts) x where x->>'account_type'='asset'),'[]'::jsonb),'liabilities',coalesce((select jsonb_agg(x order by x->>'code') from jsonb_array_elements(v_accounts) x where x->>'account_type'='liability'),'[]'::jsonb),'equity',coalesce((select jsonb_agg(x order by x->>'code') from jsonb_array_elements(v_accounts) x where x->>'account_type'='equity'),'[]'::jsonb),'assets_total',round(v_assets,2),'liabilities_total',round(v_liabilities,2),'current_period_earnings',round(v_revenue_total-v_expense_total,2),'cumulative_earnings',round(v_cumulative_revenue-v_cumulative_expense,2),'liabilities_and_equity_total',round(v_liabilities+v_equity+v_cumulative_revenue-v_cumulative_expense,2),'total_assets',round(v_assets,2),'total_liabilities',round(v_liabilities,2),'total_equity',round(v_equity+v_cumulative_revenue-v_cumulative_expense,2),'difference',v_difference),
    'income_statement',jsonb_build_object('revenue',v_revenue,'expenses',v_expenses,'revenue_total',round(v_revenue_total,2),'expense_total',round(v_expense_total,2),'total_revenue',round(v_revenue_total,2),'total_expenses',round(v_expense_total,2),'net_income',round(v_revenue_total-v_expense_total,2)),
    'cash_flow',v_cashflow||jsonb_build_object('operating',coalesce((v_cashflow->>'operating')::numeric,0),'investing',coalesce((v_cashflow->>'investing')::numeric,0),'financing',coalesce((v_cashflow->>'financing')::numeric,0),'unclassified',coalesce((v_cashflow->>'unclassified')::numeric,0),'net_change',coalesce((v_cashflow->>'operating')::numeric,0)+coalesce((v_cashflow->>'investing')::numeric,0)+coalesce((v_cashflow->>'financing')::numeric,0)+coalesce((v_cashflow->>'unclassified')::numeric,0),'complete',not(v_cashflow ? 'unclassified')),
    'controls',jsonb_build_object('posted_only',true,'balanced',v_difference=0,'source_coverage',(select count(*) from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.business_date between p_start_date and p_end_date and s.status='posted'),'cash_flow_complete',not(v_cashflow ? 'unclassified'))
  ));
end
$$;

create or replace function public.get_restaurant_ledger_workspace_v2(p_lodge_id uuid,p_start_date date default null,p_end_date date default null,p_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_total integer; v_entries jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if p_account_id is not null and not exists(select 1 from public.restaurant_accounts where id=p_account_id and lodge_id=p_lodge_id) then raise exception 'Ledger account belongs to another lodge or is missing' using errcode='23503'; end if;
  select count(*) into v_total from public.restaurant_journal_entries e where e.lodge_id=p_lodge_id and e.is_posted and(p_start_date is null or e.entry_date>=p_start_date)and(p_end_date is null or e.entry_date<=p_end_date)and(p_account_id is null or exists(select 1 from public.restaurant_journal_lines l where l.entry_id=e.id and l.account_id=p_account_id));
  select coalesce(jsonb_agg(x order by x.entry_date desc,x.created_at desc),'[]'::jsonb) into v_entries from(select e.id,e.entry_date,e.description,e.source_type,e.source_id,e.reference_number,e.posting_key,e.reversal_of,e.created_at,e.source_version,e.source_business_date,e.outlet_id,e.operation_id,coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'account_id',l.account_id,'account_code',a.code,'account_name',a.name,'debit',l.debit,'credit',l.credit,'memo',l.memo)order by l.id)from public.restaurant_journal_lines l join public.restaurant_accounts a on a.id=l.account_id where l.entry_id=e.id),'[]'::jsonb)lines from public.restaurant_journal_entries e where e.lodge_id=p_lodge_id and e.is_posted and(p_start_date is null or e.entry_date>=p_start_date)and(p_end_date is null or e.entry_date<=p_end_date)and(p_account_id is null or exists(select 1 from public.restaurant_journal_lines l where l.entry_id=e.id and l.account_id=p_account_id)))x;
  return jsonb_build_object('success',true,'data',jsonb_build_object('entries',v_entries,'total_count',v_total,'complete',true,'trial_balance',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'debit',coalesce(t.debit,0),'credit',coalesce(t.credit,0),'balance',case when a.account_type in('asset','expense')then coalesce(t.debit,0)-coalesce(t.credit,0)else coalesce(t.credit,0)-coalesce(t.debit,0)end)order by a.code)from public.restaurant_accounts a left join lateral(select sum(l.debit) debit,sum(l.credit)credit from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted and(p_end_date is null or e.entry_date<=p_end_date))t on true where a.lodge_id=p_lodge_id),'[]'::jsonb)));
end
$$;

create or replace function public.get_restaurant_budget_workspace_v2(p_lodge_id uuid,p_year integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.get_restaurant_budget_matrix_v2(p_lodge_id,p_year);
end
$$;

create or replace function public.get_restaurant_ap_workspace_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'bills',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.restaurant_bill_items i where i.bill_id=b.id and i.lodge_id=p_lodge_id),'[]'::jsonb),'payments',coalesce((select jsonb_agg(to_jsonb(bp) order by bp.payment_date,bp.created_at) from public.restaurant_bill_payments bp where bp.bill_id=b.id and bp.lodge_id=p_lodge_id),'[]'::jsonb)) order by b.bill_date desc,b.created_at desc) from public.restaurant_bills b where b.lodge_id=p_lodge_id),'[]'::jsonb),
    'summary',coalesce((select jsonb_build_object('total_outstanding',round(coalesce(sum(greatest(total-amount_paid,0)) filter(where status in('approved','partially_paid','overdue')),0),2),'overdue_outstanding',round(coalesce(sum(case when due_date<public.get_lodge_business_date(p_lodge_id) and status in('approved','partially_paid','overdue') then greatest(total-amount_paid,0) else 0 end),0),2),'open_bills',count(*) filter(where status in('approved','partially_paid','overdue')),'unrecognized_bills',count(*) filter(where status in('draft','submitted')) ) from public.restaurant_bills where lodge_id=p_lodge_id),'{}'::jsonb),
    'controls',jsonb_build_object('recognized_statuses',jsonb_build_array('approved','partially_paid','overdue','paid'),'drafts_excluded_from_liability',true)
  ));
end
$$;

create or replace function public.generate_restaurant_tax_working_paper(p_lodge_id uuid,p_period_start date,p_period_end date,p_configuration_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_cfg public.restaurant_tax_configurations%rowtype;v_existing public.restaurant_tax_returns%rowtype;v_snapshot jsonb;v_hash text;v_id uuid;v_output numeric;v_input numeric;v_sales numeric;v_purchases numeric;v_manifest jsonb;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if p_period_start is null or p_period_end<p_period_start then raise exception 'Valid tax period is required' using errcode='22023'; end if;
 select * into v_cfg from public.restaurant_tax_configurations where id=p_configuration_id and lodge_id=p_lodge_id and effective_from<=p_period_start and(effective_to is null or effective_to>=p_period_end);
 if not found then raise exception 'Tax configuration is not effective for the full period' using errcode='23503'; end if;
 select * into v_existing from public.restaurant_tax_returns where lodge_id=p_lodge_id and period_start=p_period_start and period_end=p_period_end for update;
 if found and v_existing.status<>'draft' then raise exception 'Reviewed, approved, or filed working papers are immutable' using errcode='55000'; end if;
 select coalesce(sum(l.credit-l.debit),0) into v_output from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and l.account_id=v_cfg.output_tax_account_id;
 select coalesce(sum(l.debit-l.credit),0) into v_input from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and l.account_id=v_cfg.input_tax_account_id;
 select coalesce(sum(l.credit-l.debit) filter(where a.account_type='revenue'),0) into v_sales from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and e.source_type in('pos_sale','pos_return');
 select coalesce(sum(l.debit-l.credit) filter(where a.account_type in('expense','asset') and a.id not in(v_cfg.input_tax_account_id,v_cfg.output_tax_account_id)),0) into v_purchases from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and e.source_type in('ap_bill','expense');
 select coalesce(jsonb_agg(jsonb_build_object('source_type',s.source_type,'source_id',s.source_id,'source_version',s.source_version,'business_date',s.business_date,'payload_hash',s.payload_hash,'journal_entry_id',s.journal_entry_id) order by s.source_type,s.source_id),'[]'::jsonb) into v_manifest from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.business_date between p_period_start and p_period_end and s.status='posted';
 v_snapshot:=jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'configuration_id',v_cfg.id,'jurisdiction_code',v_cfg.jurisdiction_code,'rule_version',v_cfg.rule_version,'output_tax_account_id',v_cfg.output_tax_account_id,'input_tax_account_id',v_cfg.input_tax_account_id,'sales_ex_tax',round(v_sales,2),'output_tax',round(v_output,2),'purchases_ex_tax',round(v_purchases,2),'input_tax',round(v_input,2),'net_tax_payable',round(v_output-v_input,2),'source_manifest',v_manifest,'journal_count',(select count(*) from public.restaurant_journal_entries where lodge_id=p_lodge_id and is_posted and entry_date between p_period_start and p_period_end));
 v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
 insert into public.restaurant_tax_returns(lodge_id,period_start,period_end,tax_rate,total_sales_incl,total_sales_excl,total_tax_collected,total_purchases_incl,total_purchases_excl,total_input_tax,net_tax_payable,status,configuration_id,jurisdiction_code,rule_version,source_snapshot,snapshot_hash,prepared_by,prepared_at,updated_at) values(p_lodge_id,p_period_start,p_period_end,0,v_sales+v_output,v_sales,v_output,v_purchases+v_input,v_purchases,v_input,v_output-v_input,'draft',v_cfg.id,v_cfg.jurisdiction_code,v_cfg.rule_version,v_snapshot,v_hash,v_actor,now(),now()) on conflict(lodge_id,period_start,period_end) do update set total_sales_incl=excluded.total_sales_incl,total_sales_excl=excluded.total_sales_excl,total_tax_collected=excluded.total_tax_collected,total_purchases_incl=excluded.total_purchases_incl,total_purchases_excl=excluded.total_purchases_excl,total_input_tax=excluded.total_input_tax,net_tax_payable=excluded.net_tax_payable,configuration_id=excluded.configuration_id,jurisdiction_code=excluded.jurisdiction_code,rule_version=excluded.rule_version,source_snapshot=excluded.source_snapshot,snapshot_hash=excluded.snapshot_hash,prepared_by=excluded.prepared_by,prepared_at=excluded.prepared_at,updated_at=now() returning id into v_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'tax_working_paper.generated','restaurant_tax_returns',v_id,null,v_snapshot,jsonb_build_object('snapshot_hash',v_hash));
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'snapshot_hash',v_hash,'source_manifest',v_manifest,'working_paper_only',true));
end
$$;

create or replace function public.create_expense(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_id uuid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  v_lodge uuid:=(payload->>'lodge_id')::uuid;
  v_amount numeric:=round(coalesce((payload->>'amount')::numeric,0),2);
  v_actor uuid; v_expense_account uuid; v_cash_account uuid; v_journal jsonb;
  v_operation uuid:=coalesce(nullif(payload->>'operation_id','')::uuid,v_id); v_hash text; v_existing_hash text;
begin
  v_actor:=public.app_get_actor_user_id();
  perform public.app_require_lodge_role(v_lodge,array['finance','manager','admin','super_admin']);
  if v_amount<=0 or v_amount>999999.99 then raise exception 'Expense amount must be between P0.01 and P999,999.99' using errcode='22023'; end if;
  v_hash:=encode(digest(payload::text,'sha256'),'hex');
  select payload_hash into v_existing_hash from public.expenses where id=v_id and lodge_id=v_lodge for update;
  if v_existing_hash is not null then
    if v_existing_hash<>v_hash then raise exception 'Expense retry payload does not match the original operation' using errcode='22000'; end if;
    return jsonb_build_object('success',true,'id',v_id,'idempotent',true,'posted',public.restaurant_accounting_is_active(v_lodge),'status',(select status from public.expenses where id=v_id));
  end if;
  if exists(select 1 from public.expenses where lodge_id=v_lodge and operation_id=v_operation and id<>v_id) then raise exception 'Expense operation key is already bound to another expense' using errcode='23505'; end if;
  insert into public.expenses(id,lodge_id,date,category,description,amount,notes,outlet_id,status,operation_id,payload_hash,evidence_ref)
  values(v_id,v_lodge,(payload->>'date')::date,nullif(payload->>'category',''),nullif(payload->>'description',''),v_amount,nullif(payload->>'notes',''),nullif(payload->>'outlet_id','')::uuid,case when public.restaurant_accounting_is_active(v_lodge) then 'posted' else 'unposted' end,v_operation,v_hash,nullif(payload->>'evidence_ref',''));
  if public.restaurant_accounting_is_active(v_lodge) then
    select id into v_expense_account from public.restaurant_accounts where lodge_id=v_lodge and is_active and account_type='expense' and code=coalesce(nullif(payload->>'expense_account_code',''),'5000') order by code limit 1;
    v_expense_account:=coalesce(v_expense_account,(select id from public.restaurant_accounts where lodge_id=v_lodge and is_active and account_type='expense' order by code limit 1));
    select m.account_id into v_cash_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=v_lodge and a.is_active and a.account_type='asset' where m.lodge_id=v_lodge and m.mapping_type='tender' and m.source_key=lower(coalesce(nullif(payload->>'paid_by',''),'cash'));
    if v_cash_account is null or v_expense_account is null then update public.expenses set status='exception' where id=v_id; raise exception 'Expense GL mapping is incomplete' using errcode='23503'; end if;
    v_journal:=public._restaurant_post_journal(v_lodge,(payload->>'date')::date,'Expense: '||coalesce(payload->>'description','expense'),'expense',v_id,null,'expense:'||v_id::text,jsonb_build_array(jsonb_build_object('account_id',v_expense_account,'debit',v_amount,'credit',0,'memo',coalesce(payload->>'category','expense')),jsonb_build_object('account_id',v_cash_account,'debit',0,'credit',v_amount,'memo','Expense payment')),v_actor,null);
    update public.expenses set journal_entry_id=(v_journal->'data'->>'entry_id')::uuid where id=v_id;
    perform public.record_restaurant_source_posting(v_lodge,'expense',v_id,(payload->>'date')::date,(v_journal->'data'->>'entry_id')::uuid,v_operation,v_hash,1,null,'posted');
  end if;
  return jsonb_build_object('success',true,'id',v_id,'posted',public.restaurant_accounting_is_active(v_lodge),'status',(select status from public.expenses where id=v_id));
end
$$;

create or replace function public.update_expense(p_id uuid,p_lodge_id uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_status text; v_actor uuid;
begin
  v_actor:=public.app_get_actor_user_id(); perform public.app_require_lodge_role(p_lodge_id,array['finance','manager','admin','super_admin']);
  select status into v_status from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then return jsonb_build_object('success',false,'error','Expense not found'); end if;
  if v_status='posted' or exists(select 1 from public.restaurant_financial_source_postings where lodge_id=p_lodge_id and source_type='expense' and source_id=p_id and status='posted') then raise exception 'Posted expenses are immutable; void and re-enter with a correction' using errcode='55000'; end if;
  update public.expenses set date=case when payload ? 'date' then(payload->>'date')::date else date end,category=case when payload ? 'category' then payload->>'category' else category end,description=case when payload ? 'description' then payload->>'description' else description end,amount=case when payload ? 'amount' then round((payload->>'amount')::numeric,2) else amount end,notes=case when payload ? 'notes' then nullif(payload->>'notes','') else notes end,outlet_id=case when payload ? 'outlet_id' then nullif(payload->>'outlet_id','')::uuid else outlet_id end where id=p_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'id',p_id,'updated_by',v_actor);
end
$$;

create or replace function public.delete_expense(p_id uuid,p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_actor uuid;
begin
  v_actor:=public.app_get_actor_user_id(); perform public.app_require_lodge_role(p_lodge_id,array['finance','manager','admin','super_admin']);
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then return jsonb_build_object('success',false,'error','Expense not found'); end if;
  if v_exp.status='posted' and v_exp.journal_entry_id is not null then raise exception 'Posted expenses cannot be deleted; use a controlled reversal workflow' using errcode='55000'; end if;
  update public.expenses set status='voided',voided_at=now() where id=p_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'id',p_id,'voided',true,'actor_id',v_actor);
end
$$;

create or replace function public._restaurant_post_pos_order_to_gl_v2(p_lodge_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.pos_orders%rowtype; p jsonb; m record; a uuid; lines jsonb:='[]'::jsonb;
  tender_total numeric:=0; tender_amount numeric; gross numeric; disc numeric; tax numeric; tips numeric; total numeric; category_total numeric:=0;
  is_return boolean; business_date date; journal jsonb; operation_id uuid; payload_hash text; customer uuid; voucher uuid;
  account_balance numeric; credit_limit numeric; remaining numeric; cost numeric; cogs uuid; inventory_account uuid; actor uuid;
begin
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'skipped',true,'reason','accounting_not_active'); end if;
  select * into o from public.pos_orders where id=p_order_id and lodge_id=p_lodge_id for update;
  if not found or o.status not in('completed','settled') then raise exception 'Only completed POS orders can be posted' using errcode='22023'; end if;
  select * into m from public.restaurant_financial_source_postings where lodge_id=p_lodge_id and source_type='pos_order' and source_id=p_order_id and status='posted' for share;
  if found then return jsonb_build_object('success',true,'replayed',true,'journal_entry_id',m.journal_entry_id); end if;
  actor:=coalesce(public.app_current_user_id(),o.cashier_id); operation_id:=p_order_id;
  payload_hash:=encode(digest(to_jsonb(o)::text||coalesce(o.payment_breakdown,'[]'::jsonb)::text,'sha256'),'hex');
  is_return:=coalesce(o.transaction_type,'sale')='return';
  gross:=abs(round(coalesce(nullif(o.gross_total,0),o.total),2)); disc:=abs(round(coalesce(o.discount_total,0),2)); tax:=abs(round(coalesce(o.tax_total,0),2)); tips:=abs(round(coalesce(o.tip_total,0),2)); total:=abs(round(o.total,2));
  business_date:=coalesce(o.business_date,(o.completed_at at time zone coalesce((select nullif(timezone,'') from public.settings where lodge_id=p_lodge_id),'Africa/Gaborone'))::date,public.get_lodge_business_date(p_lodge_id));
  for m in select lower(coalesce(nullif(btrim(i.category),''),'uncategorized')) category,round(sum(abs(coalesce(nullif(i.gross_subtotal,0),i.unit_price*i.quantity))),2) amount from public.pos_order_items i where i.order_id=p_order_id and i.lodge_id=p_lodge_id group by lower(coalesce(nullif(btrim(i.category),''),'uncategorized')) loop
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge_id and ac.is_active and ac.account_type='revenue' where x.lodge_id=p_lodge_id and x.mapping_type='category' and x.source_key=m.category;
    if a is null then raise exception 'No active GL revenue mapping for POS category %',m.category using errcode='23503'; end if;
    category_total:=category_total+m.amount;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when is_return then m.amount else 0 end,'credit',case when is_return then 0 else m.amount end,'memo','POS revenue '||m.category));
  end loop;
  if round(category_total,2)<>gross then raise exception 'POS item gross does not reconcile to order gross' using errcode='23514'; end if;
  for p in select value from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' and jsonb_array_length(o.payment_breakdown)>0 then o.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(o.payment_method,'cash'),'amount',o.total)) end) loop
    if coalesce((p->>'amount')::numeric,0)=0 then raise exception 'POS tender amount must be non-zero' using errcode='22023'; end if;
    tender_amount:=abs(round((p->>'amount')::numeric,2));
    tender_total:=tender_total+tender_amount; customer:=nullif(p->>'customer_id','')::uuid; voucher:=nullif(p->>'voucher_id','')::uuid;
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge_id and ac.is_active where x.lodge_id=p_lodge_id and x.mapping_type='tender' and x.source_key=lower(btrim(coalesce(p->>'method',o.payment_method,'cash'))) and ((lower(p->>'method')='voucher' and ac.account_type='liability') or lower(p->>'method')<>'voucher' and ac.account_type='asset');
    if a is null and lower(p->>'method')='account' then select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge_id and ac.is_active and ac.account_type='asset' where x.lodge_id=p_lodge_id and x.mapping_type='tender' and x.source_key in('account','ar') order by case when x.source_key='account' then 0 else 1 end limit 1; end if;
    if a is null then raise exception 'No active GL tender mapping for %',lower(coalesce(p->>'method',o.payment_method,'cash')) using errcode='23503'; end if;
    if lower(p->>'method')='account' then
      if customer is null then raise exception 'Account tender requires customer_id' using errcode='22023'; end if;
      perform 1 from public.restaurant_customers where id=customer and lodge_id=p_lodge_id and account_status='active' for update;
      if not found then raise exception 'Customer account is missing or suspended' using errcode='42501'; end if;
      select coalesce(sum(amount),0) into account_balance from public.restaurant_account_ledger where lodge_id=p_lodge_id and customer_id=customer and reversed_at is null;
      select credit_limit into credit_limit from public.restaurant_customers where id=customer and lodge_id=p_lodge_id;
      if not is_return and credit_limit is not null and account_balance+tender_amount>credit_limit then raise exception 'Customer credit limit would be exceeded' using errcode='55000'; end if;
      insert into public.restaurant_account_ledger(lodge_id,customer_id,order_id,amount,reason,description,source_version,operation_id,payload_hash,balance_after) values(p_lodge_id,customer,p_order_id,case when is_return then -tender_amount else tender_amount end,case when is_return then 'return' else 'charge' end,'POS order '||p_order_id,1,operation_id,payload_hash,case when is_return then account_balance-tender_amount else account_balance+tender_amount end) on conflict do nothing;
    elsif lower(p->>'method')='voucher' then
      if voucher is null then voucher:=(select id from public.restaurant_vouchers where lodge_id=p_lodge_id and lower(code)=lower(p->>'code') and status='active' limit 1); end if;
      select remaining_value into remaining from public.restaurant_vouchers where id=voucher and lodge_id=p_lodge_id and status='active' for update;
      if not found or (not is_return and remaining<tender_amount) then raise exception 'Voucher is missing, inactive, or has insufficient balance' using errcode='55000'; end if;
      insert into public.restaurant_voucher_ledger(lodge_id,voucher_id,order_id,operation_id,amount,balance_after,reason,created_by) values(p_lodge_id,voucher,p_order_id,operation_id,case when is_return then tender_amount else -tender_amount end,case when is_return then remaining+tender_amount else remaining-tender_amount end,case when is_return then 'return' else 'redeem' end,actor) on conflict(lodge_id,operation_id) do nothing;
      update public.restaurant_vouchers set remaining_value=case when is_return then remaining_value+tender_amount else remaining_value-tender_amount end,status=case when remaining_value-tender_amount<=0 and not is_return then 'redeemed' else status end,updated_at=now() where id=voucher and lodge_id=p_lodge_id;
    end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when is_return then 0 else tender_amount end,'credit',case when is_return then tender_amount else 0 end,'memo','POS tender '||lower(coalesce(p->>'method',o.payment_method,'cash'))));
  end loop;
  if round(tender_total,2)<>total then raise exception 'POS tender breakdown does not reconcile to order total' using errcode='23514'; end if;
  for m in select * from(values('discount',disc),('tax',tax),('tips',tips))q(mapping_type,amount) where amount>0 loop
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge_id and ac.is_active where x.lodge_id=p_lodge_id and x.mapping_type=m.mapping_type and x.source_key='default';
    if a is null then raise exception 'No active default GL mapping for %',m.mapping_type using errcode='23503'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when m.mapping_type='discount' and not is_return then m.amount when m.mapping_type<>'discount' and is_return then m.amount else 0 end,'credit',case when m.mapping_type='discount' and is_return then m.amount when m.mapping_type<>'discount' and not is_return then m.amount else 0 end,'memo','POS '||m.mapping_type));
  end loop;
  select coalesce(sum(abs(total_cost)),0) into cost from public.inventory_movements where lodge_id=p_lodge_id and reference_id=p_order_id and movement_type in('recipe_sale','sale','pos_sale');
  if cost>0 then
    select id into cogs from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='expense' and is_active and code in('5100','5200') order by code limit 1;
    select id into inventory_account from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='asset' and is_active and code in('1200','1300','1400') order by code limit 1;
    if cogs is null or inventory_account is null then raise exception 'COGS and inventory accounts are required before POS activation' using errcode='23503'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',case when is_return then inventory_account else cogs end,'debit',case when is_return then 0 else cost end,'credit',case when is_return then cost else 0 end,'memo','POS COGS'),jsonb_build_object('account_id',case when is_return then cogs else inventory_account end,'debit',case when is_return then cost else 0 end,'credit',case when is_return then 0 else cost end,'memo','POS inventory movement'));
  end if;
  journal:=public._restaurant_post_journal(p_lodge,business_date,'POS '||coalesce(o.transaction_type,'sale')||' '||coalesce(o.receipt_number,p_order_id::text),'pos_'||coalesce(o.transaction_type,'sale'),p_order_id,o.receipt_number,'pos-order:'||p_order_id::text,lines,actor,null);
  perform public.record_restaurant_source_posting(p_lodge,'pos_order',p_order_id,business_date,(journal->'data'->>'entry_id')::uuid,operation_id,payload_hash,1,o.outlet_id,'posted');
  return jsonb_build_object('success',true,'journal_entry_id',(journal->'data'->>'entry_id')::uuid,'replayed',coalesce((journal->'data'->>'replayed')::boolean,false),'source_posting',true);
end
$$;

create or replace function public.post_pos_order_to_gl_v2(p_lodge_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  return public._restaurant_post_pos_order_to_gl_v2(p_lodge_id,p_order_id);
end
$$;

create or replace function public.restaurant_post_pos_order_after_lines()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public._restaurant_post_pos_order_to_gl_v2(new.lodge_id,new.order_id);
  return new;
end
$$;

drop trigger if exists trg_restaurant_financial_truth_pos_post on public.pos_order_items;
create constraint trigger trg_restaurant_financial_truth_pos_post
after insert on public.pos_order_items
deferrable initially deferred for each row execute function public.restaurant_post_pos_order_after_lines();

create or replace function public.start_restaurant_report_run(p_lodge_id uuid,p_report_key text,p_start_date date,p_end_date date,p_outlet_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if nullif(btrim(p_report_key),'') is null then raise exception 'Report key is required' using errcode='22023'; end if;
  insert into public.restaurant_report_runs(lodge_id,report_key,period_start,period_end,outlet_id,generated_by,source_manifest)
  values(p_lodge_id,p_report_key,p_start_date,p_end_date,p_outlet_id,v_actor,jsonb_build_object('database','authoritative','posted_only',true))
  returning id into v_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'as_of',(select as_of from public.restaurant_report_runs where id=v_id),'complete',false));
end
$$;

create or replace function public.complete_restaurant_report_run(p_lodge_id uuid,p_report_run_id uuid,p_sections jsonb,p_control_totals jsonb,p_data_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.read');
  update public.restaurant_report_runs set status='complete',complete=true,control_totals=coalesce(p_control_totals,'{}'::jsonb),source_manifest=coalesce(p_sections,'{}'::jsonb),data_hash=nullif(p_data_hash,''),completed_at=now() where id=p_report_run_id and lodge_id=p_lodge_id and not complete returning id into v_id;
  if v_id is null then raise exception 'Report run is missing, foreign, or already complete' using errcode='55000'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'complete',true,'completed_by',v_actor));
end
$$;

create or replace function public.fail_restaurant_report_run(p_lodge_id uuid,p_report_run_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  update public.restaurant_report_runs
     set status='failed',complete=false,source_manifest=jsonb_build_object('failure',left(coalesce(nullif(btrim(p_reason),''),'Report generation failed'),500)),completed_at=now()
   where id=p_report_run_id and lodge_id=p_lodge_id and status='started'
   returning id into v_id;
  if v_id is null then
    return jsonb_build_object('success',true,'data',jsonb_build_object('id',p_report_run_id,'status','already_finalized'),'replayed',true);
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'status','failed'));
end
$$;

create or replace function public.get_restaurant_financial_source_coverage(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_sources jsonb; v_missing jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select coalesce(jsonb_agg(x order by x.source_type),'[]'::jsonb) into v_sources
  from(select s.source_type,count(*) source_count,count(*) filter(where s.status='posted') posted_count,count(*) filter(where s.journal_entry_id is null) missing_journal_count from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.business_date between p_start_date and p_end_date group by s.source_type)x;
  select coalesce(jsonb_agg(jsonb_build_object('source_type',q.source_type,'source_id',q.id,'reason',q.reason) order by q.source_type,q.id),'[]'::jsonb) into v_missing
  from(
    select o.id,'pos_order' source_type,'completed POS order has no posted source record' reason from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date and o.status in('completed','settled') and not exists(select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='pos_order' and s.source_id=o.id and s.status='posted')
    union all select e.id,'expense','posted expense has no posted source record' from public.expenses e where e.lodge_id=p_lodge_id and e.date between p_start_date and p_end_date and e.status='posted' and not exists(select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='expense' and s.source_id=e.id and s.status='posted')
    union all select b.id,'ap_bill','recognized AP bill has no posted source record' from public.restaurant_bills b where b.lodge_id=p_lodge_id and b.bill_date between p_start_date and p_end_date and b.status in('approved','partially_paid','paid','overdue') and b.accrual_journal_entry_id is not null and not exists(select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='ap_bill' and s.source_id=b.id and s.status='posted')
    union all select p.id,'payroll','posted payroll period has no posted source record' from public.restaurant_pay_periods p where p.lodge_id=p_lodge_id and p.end_date between p_start_date and p_end_date and p.journal_entry_id is not null and not exists(select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type='payroll' and s.source_id=p.id and s.status='posted')
  )q;
  return jsonb_build_object('success',true,'data',jsonb_build_object('source_counts',v_sources,'missing',v_missing,'required_source_types',jsonb_build_array('pos_order','expense','ap_bill','payroll'),'complete',jsonb_array_length(v_missing)=0));
end
$$;

create or replace function public.restaurant_record_ap_source_posting()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.accrual_journal_entry_id is not null and public.restaurant_accounting_is_active(new.lodge_id) then
    perform public.record_restaurant_source_posting(new.lodge_id,'ap_bill',new.id,new.bill_date,new.accrual_journal_entry_id,new.id,encode(digest(to_jsonb(new)::text,'sha256'),'hex'),1,null,'posted');
  end if;
  return new;
end
$$;
drop trigger if exists trg_restaurant_financial_truth_ap_bill on public.restaurant_bills;
create trigger trg_restaurant_financial_truth_ap_bill after update of accrual_journal_entry_id on public.restaurant_bills for each row when (new.accrual_journal_entry_id is distinct from old.accrual_journal_entry_id) execute function public.restaurant_record_ap_source_posting();

create or replace function public.restaurant_record_ap_payment_source_posting()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.journal_entry_id is not null and public.restaurant_accounting_is_active(new.lodge_id) then
    perform public.record_restaurant_source_posting(new.lodge_id,'ap_payment',new.id,new.payment_date,new.journal_entry_id,new.id,encode(digest(to_jsonb(new)::text,'sha256'),'hex'),1,null,'posted');
  end if;
  return new;
end
$$;
drop trigger if exists trg_restaurant_financial_truth_ap_payment on public.restaurant_bill_payments;
create trigger trg_restaurant_financial_truth_ap_payment after insert on public.restaurant_bill_payments for each row execute function public.restaurant_record_ap_payment_source_posting();

create or replace function public.restaurant_record_payroll_source_posting()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.journal_entry_id is not null and public.restaurant_accounting_is_active(new.lodge_id) then
    perform public.record_restaurant_source_posting(new.lodge_id,'payroll',new.id,new.end_date,new.journal_entry_id,new.id,encode(digest(to_jsonb(new)::text,'sha256'),'hex'),1,null,'posted');
  end if;
  return new;
end
$$;
drop trigger if exists trg_restaurant_financial_truth_payroll on public.restaurant_pay_periods;
create trigger trg_restaurant_financial_truth_payroll after update of journal_entry_id on public.restaurant_pay_periods for each row when (new.journal_entry_id is distinct from old.journal_entry_id) execute function public.restaurant_record_payroll_source_posting();

create table if not exists public.restaurant_loyalty_repair_queue (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  customer_id uuid not null references public.restaurant_customers(id) on delete restrict,
  points integer not null check(points > 0),
  description text,
  operation_id uuid not null,
  payload_hash text not null,
  status text not null default 'pending' check(status in ('pending','applied','failed','cancelled')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(lodge_id, operation_id),
  unique(lodge_id, order_id, customer_id)
);
alter table public.restaurant_loyalty_repair_queue enable row level security;
revoke all on table public.restaurant_loyalty_repair_queue from public,anon,authenticated;

create or replace function public.queue_restaurant_loyalty_repair(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=(payload->>'lodge_id')::uuid; v_order uuid:=(payload->>'order_id')::uuid; v_customer uuid:=(payload->>'customer_id')::uuid; v_points integer:=(payload->>'points')::integer; v_operation uuid:=(payload->>'operation_id')::uuid; v_hash text; v_id uuid; v_existing public.restaurant_loyalty_repair_queue%rowtype;
begin
  perform public._restaurant_require_capability(v_lodge,'pos.manage');
  if v_order is null or v_customer is null or v_points is null or v_points<=0 or v_operation is null then raise exception 'Loyalty repair requires order, customer, positive points and operation_id' using errcode='22023'; end if;
  if not exists(select 1 from public.pos_orders where id=v_order and lodge_id=v_lodge and status in('completed','settled')) then raise exception 'Loyalty repair order is missing or not completed' using errcode='23503'; end if;
  v_hash:=encode(digest(payload::text,'sha256'),'hex');
  select * into v_existing from public.restaurant_loyalty_repair_queue where lodge_id=v_lodge and order_id=v_order and customer_id=v_customer for update;
  if found then
    if v_existing.payload_hash<>v_hash then raise exception 'Loyalty repair payload conflicts with the existing repair' using errcode='22000'; end if;
    return jsonb_build_object('success',true,'repair_id',v_existing.id,'status',v_existing.status,'replayed',true);
  end if;
  if exists(select 1 from public.restaurant_loyalty_repair_queue where lodge_id=v_lodge and operation_id=v_operation and payload_hash<>v_hash) then raise exception 'Loyalty repair operation key conflicts with a different payload' using errcode='22000'; end if;
  insert into public.restaurant_loyalty_repair_queue(lodge_id,order_id,customer_id,points,description,operation_id,payload_hash,created_by)
  values(v_lodge,v_order,v_customer,v_points,nullif(payload->>'description',''),v_operation,v_hash,public.app_current_user_id())
  returning id into v_id;
  if v_id is null then raise exception 'Loyalty repair payload conflicts with the existing repair' using errcode='22000'; end if;
  return jsonb_build_object('success',true,'repair_id',v_id,'status',(select status from public.restaurant_loyalty_repair_queue where id=v_id));
end
$$;

create or replace function public.prepare_restaurant_payroll_expected_workers(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_period public.restaurant_pay_periods%rowtype; v_expected integer; v_approved integer; v_missing integer;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
  select * into v_period from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Pay period not found' using errcode='P0002'; end if;
  insert into public.restaurant_payroll_expected_workers(lodge_id,pay_period_id,staff_user_id,source,expected)
  select p_lodge_id,p_pay_period_id,e.staff_user_id,'employment_terms',true
  from public.restaurant_payroll_employment_terms e
  join public.users u on u.id=e.staff_user_id and u.lodge_id=p_lodge_id and coalesce(u.status,'active')='active'
  where e.lodge_id=p_lodge_id and e.effective_from<=v_period.end_date and (e.effective_to is null or e.effective_to>=v_period.start_date)
  on conflict(pay_period_id,staff_user_id) do update set expected=true,source=excluded.source;
  select count(*) into v_expected from public.restaurant_payroll_expected_workers where lodge_id=p_lodge_id and pay_period_id=p_pay_period_id and expected;
  select count(*) into v_approved from public.restaurant_payroll_time_inputs t join public.restaurant_payroll_expected_workers w on w.pay_period_id=t.pay_period_id and w.staff_user_id=t.staff_user_id and w.expected where t.lodge_id=p_lodge_id and t.pay_period_id=p_pay_period_id and t.approved_at is not null;
  v_missing:=v_expected-v_approved;
  update public.restaurant_pay_periods set expected_worker_count=v_expected,calculated_worker_count=0 where id=p_pay_period_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('expected_worker_count',v_expected,'approved_worker_count',v_approved,'missing_worker_count',greatest(v_missing,0),'ready',v_expected>0 and v_missing=0));
end
$$;

create or replace function public.get_restaurant_payroll_readiness_v2(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
  return public.prepare_restaurant_payroll_expected_workers(p_lodge_id,p_pay_period_id);
end
$$;

create or replace function public.calculate_restaurant_payroll_v2(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_p public.restaurant_pay_periods%rowtype;v_cfg public.restaurant_payroll_statutory_configurations%rowtype;v_row record;v_base numeric;v_ot numeric;v_gross numeric;v_tax numeric;v_social numeric;v_pension numeric;v_health numeric;v_ded numeric;v_net numeric;v_snap jsonb;v_hash text;v_count int:=0;v_period_hash text;v_readiness jsonb;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 select * into v_p from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
 if not found or v_p.status<>'draft' then raise exception 'Draft pay period not found' using errcode='22023'; end if;
 v_readiness:=public.prepare_restaurant_payroll_expected_workers(p_lodge_id,p_pay_period_id)->'data';
 if not coalesce((v_readiness->>'ready')::boolean,false) then raise exception 'Payroll expected-worker register is incomplete: %',v_readiness using errcode='55000'; end if;
 select * into v_cfg from public.restaurant_payroll_statutory_configurations where id=v_p.statutory_configuration_id and lodge_id=p_lodge_id;
 if not found then raise exception 'Versioned payroll statutory configuration is required' using errcode='23503'; end if;
 delete from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 for v_row in select t.*,e.id terms_id,e.pay_type,e.monthly_salary,e.hourly_rate,e.overtime_multiplier,e.standard_monthly_hours,u.name staff_name from public.restaurant_payroll_time_inputs t join public.restaurant_payroll_expected_workers w on w.pay_period_id=t.pay_period_id and w.staff_user_id=t.staff_user_id and w.expected join public.restaurant_payroll_employment_terms e on e.staff_user_id=t.staff_user_id and e.lodge_id=p_lodge_id and e.effective_from<=v_p.start_date and(e.effective_to is null or e.effective_to>=v_p.end_date) join public.users u on u.id=t.staff_user_id and u.lodge_id=p_lodge_id where t.pay_period_id=p_pay_period_id and t.lodge_id=p_lodge_id and t.approved_at is not null loop
  v_base:=case when v_row.pay_type='salary' then v_row.monthly_salary else round(v_row.regular_hours*v_row.hourly_rate,2) end;
  v_ot:=round(v_row.overtime_hours*case when v_row.pay_type='salary' then v_row.monthly_salary/v_row.standard_monthly_hours else v_row.hourly_rate end*v_row.overtime_multiplier,2);
  v_gross:=v_base+v_ot;v_tax:=public._restaurant_payroll_tax(v_gross,v_cfg.tax_brackets);v_social:=round(v_gross*v_cfg.social_security_rate/100,2);v_pension:=round(v_gross*v_cfg.pension_rate/100,2);v_health:=v_cfg.health_amount;v_ded:=v_tax+v_social+v_pension+v_health;v_net:=v_gross-v_ded;
  if v_net<0 then raise exception 'Payroll deductions exceed gross pay for employee %',v_row.staff_user_id using errcode='23514'; end if;
  v_snap:=jsonb_build_object('terms_id',v_row.terms_id,'time_input_id',v_row.id,'configuration_id',v_cfg.id,'regular_hours',v_row.regular_hours,'overtime_hours',v_row.overtime_hours,'base_pay',v_base,'overtime_pay',v_ot,'gross_pay',v_gross,'paye_tax',v_tax,'social_security',v_social,'pension',v_pension,'health',v_health,'net_pay',v_net,'rule_version',v_cfg.rule_version);v_hash:=encode(digest(v_snap::text,'sha256'),'hex');
  insert into public.restaurant_employee_pay_records(lodge_id,staff_user_id,staff_name,pay_period_id,base_salary,hourly_rate,hours_worked,overtime_hours,overtime_rate,gross_pay,paye_tax,social_security,pension_contribution,health_insurance,total_deductions,net_pay,employment_terms_id,time_input_id,statutory_configuration_id,calculation_snapshot,calculation_snapshot_hash) values(p_lodge_id,v_row.staff_user_id,v_row.staff_name,p_pay_period_id,v_base,v_row.hourly_rate,v_row.regular_hours,v_row.overtime_hours,v_row.overtime_multiplier,v_gross,v_tax,v_social,v_pension,v_health,v_ded,v_net,v_row.terms_id,v_row.id,v_cfg.id,v_snap,v_hash);v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'No approved payroll time inputs with effective employment terms' using errcode='23514'; end if;
 select encode(digest(string_agg(calculation_snapshot_hash,',' order by staff_user_id),'sha256'),'hex') into v_period_hash from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 update public.restaurant_pay_periods set status='processing',processed_at=now(),prepared_by=v_actor,prepared_at=now(),calculation_snapshot_hash=v_period_hash,calculated_worker_count=v_count where id=p_pay_period_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('records',v_count,'snapshot_hash',v_period_hash,'expected_worker_count',(v_readiness->>'expected_worker_count')::integer));
end
$$;

create or replace function public.post_inventory_stocktake_session(
  p_stocktake_id uuid, p_lodge_id uuid, p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_session public.inventory_stocktakes%rowtype; v_line record; v_system numeric; v_counted numeric; v_cost numeric; v_variance numeric; v_variance_count integer:=0; v_actor uuid:=public.app_current_user_id();
begin
  perform public.app_require_lodge_role(p_lodge_id,array['manager','admin','super_admin']);
  select * into v_session from public.inventory_stocktakes where id=p_stocktake_id and lodge_id=p_lodge_id for update;
  if not found then return jsonb_build_object('success',false,'error','Stock take session not found'); end if;
  if v_session.status='posted' then return jsonb_build_object('success',true,'idempotent',true,'variance_count',(select count(*) from public.inventory_stocktake_lines where stocktake_id=p_stocktake_id and lodge_id=p_lodge_id and coalesce(variance_qty,0)<>0)); end if;
  if v_session.status not in('open','draft') then return jsonb_build_object('success',false,'error','This stock take has already been posted'); end if;
  for v_line in select * from public.inventory_stocktake_lines where stocktake_id=p_stocktake_id and lodge_id=p_lodge_id order by item_id for update loop
    select current_stock,coalesce(latest_unit_cost,v_line.unit_cost,0) into v_system,v_cost from public.inventory_items where id=v_line.item_id and lodge_id=p_lodge_id for update;
    if not found then raise exception 'A counted inventory item no longer belongs to this restaurant' using errcode='23503'; end if;
    v_counted:=coalesce(v_line.counted_qty,v_system);
    if v_counted<0 then raise exception 'Counted inventory cannot be negative' using errcode='22023'; end if;
    v_variance:=round(v_counted-v_system,3);
    update public.inventory_stocktake_lines set expected_qty=v_system,counted_qty=v_counted,variance_qty=v_variance,variance_cost=round(v_variance*v_cost,2),unit_cost=v_cost,updated_at=now() where id=v_line.id;
    if v_variance<>0 then
      update public.inventory_items set current_stock=v_counted,updated_at=now() where id=v_line.item_id and lodge_id=p_lodge_id;
      insert into public.inventory_movements(lodge_id,item_id,movement_type,quantity,unit_cost,total_cost,notes,reference_type,reference_id,source,created_by)
      values(p_lodge_id,v_line.item_id,'stocktake_adjustment',v_variance,v_cost,round(v_variance*v_cost,2),coalesce(nullif(p_notes,''),'Posted physical stocktake'),'inventory_stocktake',p_stocktake_id,'stocktake',v_actor);
      v_variance_count:=v_variance_count+1;
    end if;
  end loop;
  update public.inventory_stocktakes set status='posted',notes=coalesce(nullif(p_notes,''),notes),counted_at=coalesce(counted_at,now()),posted_at=now(),updated_at=now() where id=p_stocktake_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'variance_count',v_variance_count,'count_basis','locked_system_quantity_at_post');
end
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('restaurant_accounting_is_active','record_restaurant_source_posting','get_restaurant_accounting_readiness','prepare_restaurant_historical_cutover','activate_restaurant_accounting','suspend_restaurant_accounting','get_restaurant_financial_statements_v2','get_restaurant_ledger_workspace_v2','get_restaurant_budget_workspace_v2','post_pos_order_to_gl_v2','start_restaurant_report_run','complete_restaurant_report_run','fail_restaurant_report_run','get_restaurant_financial_source_coverage') loop
    execute format('revoke all on function %s from public,anon,authenticated',r.sig);
  end loop;
end
$$;

grant execute on function public.get_restaurant_accounting_readiness(uuid) to authenticated,service_role;
grant execute on function public.prepare_restaurant_historical_cutover(uuid,date,jsonb,jsonb,text) to authenticated,service_role;
grant execute on function public.activate_restaurant_accounting(uuid,date,text,text,uuid) to authenticated,service_role;
grant execute on function public.suspend_restaurant_accounting(uuid,text) to authenticated,service_role;
grant execute on function public.get_restaurant_financial_statements_v2(uuid,date,date) to authenticated,service_role;
grant execute on function public.get_restaurant_ledger_workspace_v2(uuid,date,date,uuid) to authenticated,service_role;
grant execute on function public.get_restaurant_budget_workspace_v2(uuid,integer) to authenticated,service_role;
grant execute on function public.post_pos_order_to_gl_v2(uuid,uuid) to authenticated,service_role;
grant execute on function public.get_restaurant_payroll_readiness_v2(uuid,uuid) to authenticated,service_role;
grant execute on function public.start_restaurant_report_run(uuid,text,date,date,uuid) to authenticated,service_role;
grant execute on function public.complete_restaurant_report_run(uuid,uuid,jsonb,jsonb,text) to authenticated,service_role;
grant execute on function public.fail_restaurant_report_run(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.get_restaurant_financial_source_coverage(uuid,date,date) to authenticated,service_role;
grant execute on function public.queue_restaurant_loyalty_repair(jsonb) to authenticated,service_role;
revoke all on function public.restaurant_record_ap_source_posting() from public,anon,authenticated;
revoke all on function public.restaurant_record_ap_payment_source_posting() from public,anon,authenticated;
revoke all on function public.restaurant_record_payroll_source_posting() from public,anon,authenticated;
grant execute on function public.create_expense(jsonb) to anon,authenticated,service_role;
grant execute on function public.update_expense(uuid,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.delete_expense(uuid,uuid) to anon,authenticated,service_role;

commit;
