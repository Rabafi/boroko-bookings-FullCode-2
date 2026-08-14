-- Payroll completion: durable operation attempts, immutable payment batches,
-- liability settlement, bank evidence, and controlled close.

begin;

alter table public.restaurant_pay_periods
  add column if not exists settlement_status text not null default 'unpaid',
  add column if not exists settlement_journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists settlement_operation_id uuid,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurant_pay_periods_settlement_status_chk') then
    alter table public.restaurant_pay_periods add constraint restaurant_pay_periods_settlement_status_chk
      check (settlement_status in ('unpaid', 'exported_not_paid', 'settled', 'reconciled', 'reversed'));
  end if;
end
$$;

create table if not exists public.restaurant_payroll_operations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete restrict,
  operation_id uuid not null,
  action text not null check (action in ('approve', 'export', 'settle', 'reconcile', 'close')),
  payload_hash text not null,
  result jsonb not null default '{}'::jsonb,
  actor_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (lodge_id, operation_id)
);
alter table public.restaurant_payroll_operations enable row level security;
revoke all on table public.restaurant_payroll_operations from public, anon, authenticated;

create table if not exists public.restaurant_payroll_payment_batches (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete restrict,
  export_id uuid references public.restaurant_payroll_payment_exports(id) on delete restrict,
  operation_id uuid not null,
  payload_hash text not null,
  file_hash text not null,
  debit_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  employee_count integer not null check (employee_count > 0),
  control_total numeric(18,2) not null check (control_total >= 0),
  status text not null default 'exported_not_paid' check (status in ('exported_not_paid', 'settled', 'reconciled', 'reversed')),
  exported_by uuid references public.users(id),
  exported_at timestamptz not null default now(),
  settled_by uuid references public.users(id),
  settled_at timestamptz,
  bank_reference text,
  reconciled_by uuid references public.users(id),
  reconciled_at timestamptz,
  unique (lodge_id, operation_id)
);
alter table public.restaurant_payroll_payment_batches enable row level security;
revoke all on table public.restaurant_payroll_payment_batches from public, anon, authenticated;

create index if not exists restaurant_payroll_batches_period_idx
  on public.restaurant_payroll_payment_batches (lodge_id, pay_period_id, exported_at desc);

create or replace function public._restaurant_payroll_operation_lock(p_lodge_id uuid, p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_operation_id is null then
    raise exception 'Payroll operation id is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text || ':' || p_operation_id::text, 0));
end
$$;

create or replace function public.approve_restaurant_payroll_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  v_hash text := encode(digest(jsonb_build_object('action', 'approve', 'pay_period_id', p_pay_period_id)::text, 'sha256'), 'hex');
  v_existing public.restaurant_payroll_operations%rowtype;
  v_period public.restaurant_pay_periods%rowtype;
  v_result jsonb;
begin
  perform public._restaurant_payroll_operation_lock(p_lodge_id, p_operation_id);
  select * into v_existing from public.restaurant_payroll_operations where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash or v_existing.action <> 'approve' or v_existing.pay_period_id <> p_pay_period_id then
      raise exception 'Payroll operation key conflicts with a different approval' using errcode = '22000';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;
  v_result := public.approve_restaurant_payroll_v2(p_lodge_id, p_pay_period_id);
  v_result := v_result || jsonb_build_object('operation_id', p_operation_id, 'replayed', false);
  insert into public.restaurant_payroll_operations(lodge_id, pay_period_id, operation_id, action, payload_hash, result, actor_id)
  values (p_lodge_id, p_pay_period_id, p_operation_id, 'approve', v_hash, v_result, v_actor);
  return v_result;
end
$$;

create or replace function public.export_restaurant_payroll_payments_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid,
  p_operation_id uuid,
  p_debit_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  v_hash text := encode(digest(jsonb_build_object('action', 'export', 'pay_period_id', p_pay_period_id, 'debit_account_id', p_debit_account_id)::text, 'sha256'), 'hex');
  v_existing public.restaurant_payroll_operations%rowtype;
  v_period public.restaurant_pay_periods%rowtype;
  v_export jsonb;
  v_payments jsonb;
  v_employee_count integer;
  v_control_total numeric(18,2);
  v_payload_hash text;
  v_file_hash text;
  v_export_id uuid;
  v_batch_id uuid;
  v_result jsonb;
begin
  perform public._restaurant_payroll_operation_lock(p_lodge_id, p_operation_id);
  if not exists (select 1 from public.restaurant_accounts where id = p_debit_account_id and lodge_id = p_lodge_id and is_active and account_type = 'asset') then
    raise exception 'Payroll payment debit account must be an active lodge asset account' using errcode = '23503';
  end if;
  select * into v_existing from public.restaurant_payroll_operations where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash or v_existing.action <> 'export' or v_existing.pay_period_id <> p_pay_period_id then
      raise exception 'Payroll operation key conflicts with a different export' using errcode = '22000';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_period from public.restaurant_pay_periods where id = p_pay_period_id and lodge_id = p_lodge_id for update;
  if not found or v_period.status <> 'approved' then
    raise exception 'Approved payroll is required for payment export' using errcode = '22023';
  end if;
  v_export := public.export_restaurant_payroll_payments(p_lodge_id, p_pay_period_id);
  v_payments := coalesce(v_export->'data'->'payments', '[]'::jsonb);
  v_export_id := nullif(v_export->'data'->>'id', '')::uuid;
  v_payload_hash := v_export->'data'->>'payload_hash';
  select count(*) into v_employee_count from jsonb_array_elements(v_payments);
  select coalesce(sum((value->>'amount')::numeric), 0) into v_control_total from jsonb_array_elements(v_payments);
  if v_employee_count <= 0 then raise exception 'Payroll payment export has no employees' using errcode = '23514'; end if;
  v_file_hash := encode(digest(jsonb_build_object(
    'period_id', p_pay_period_id, 'period_name', v_period.name,
    'start_date', v_period.start_date, 'end_date', v_period.end_date,
    'export_id', v_export_id, 'payload_hash', v_payload_hash,
    'debit_account_id', p_debit_account_id, 'employee_count', v_employee_count,
    'control_total', v_control_total, 'payments', v_payments
  )::text, 'sha256'), 'hex');
  insert into public.restaurant_payroll_payment_batches(
    lodge_id, pay_period_id, export_id, operation_id, payload_hash, file_hash,
    debit_account_id, employee_count, control_total, exported_by
  ) values (
    p_lodge_id, p_pay_period_id, v_export_id, p_operation_id, v_payload_hash,
    v_file_hash, p_debit_account_id, v_employee_count, v_control_total, v_actor
  ) returning id into v_batch_id;
  update public.restaurant_pay_periods
     set payment_batch_id = v_batch_id,
         payment_exported_at = coalesce(payment_exported_at, now()),
         settlement_status = 'exported_not_paid'
   where id = p_pay_period_id and lodge_id = p_lodge_id;
  v_result := jsonb_build_object(
    'success', true, 'operation_id', p_operation_id, 'replayed', false,
    'data', jsonb_build_object(
      'batch_id', v_batch_id, 'export_id', v_export_id,
      'pay_period_id', p_pay_period_id, 'period_name', v_period.name,
      'start_date', v_period.start_date, 'end_date', v_period.end_date,
      'payload_hash', v_payload_hash, 'file_hash', v_file_hash,
      'employee_count', v_employee_count, 'control_total', v_control_total,
      'debit_account_id', p_debit_account_id, 'payments', v_payments,
      'status', 'exported_not_paid'
    )
  );
  insert into public.restaurant_payroll_operations(lodge_id, pay_period_id, operation_id, action, payload_hash, result, actor_id)
  values (p_lodge_id, p_pay_period_id, p_operation_id, 'export', v_hash, v_result, v_actor);
  return v_result;
end
$$;

create or replace function public.settle_restaurant_payroll_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid,
  p_operation_id uuid,
  p_settlement_date date,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  v_hash text := encode(digest(jsonb_build_object('action', 'settle', 'pay_period_id', p_pay_period_id, 'settlement_date', p_settlement_date, 'reference', p_reference)::text, 'sha256'), 'hex');
  v_existing public.restaurant_payroll_operations%rowtype;
  v_period public.restaurant_pay_periods%rowtype;
  v_batch public.restaurant_payroll_payment_batches%rowtype;
  v_settings public.restaurant_payroll_gl_settings%rowtype;
  v_gross numeric; v_tax numeric; v_other numeric; v_net numeric;
  v_lines jsonb; v_posted jsonb; v_entry_id uuid;
  v_result jsonb;
begin
  perform public._restaurant_payroll_operation_lock(p_lodge_id, p_operation_id);
  if nullif(btrim(p_reference), '') is null then raise exception 'Payroll settlement bank reference is required' using errcode = '22023'; end if;
  select * into v_existing from public.restaurant_payroll_operations where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash or v_existing.action <> 'settle' or v_existing.pay_period_id <> p_pay_period_id then
      raise exception 'Payroll operation key conflicts with a different settlement' using errcode = '22000';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_period from public.restaurant_pay_periods where id = p_pay_period_id and lodge_id = p_lodge_id for update;
  if not found or v_period.status <> 'approved' or v_period.payment_exported_at is null then
    raise exception 'An approved payroll payment batch must be exported before settlement' using errcode = '22023';
  end if;
  select * into v_batch from public.restaurant_payroll_payment_batches where lodge_id = p_lodge_id and pay_period_id = p_pay_period_id order by exported_at desc limit 1 for update;
  if not found then raise exception 'Payroll payment batch not found' using errcode = 'P0002'; end if;
  select * into v_settings from public.restaurant_payroll_gl_settings where lodge_id = p_lodge_id;
  select round(sum(gross_pay), 2), round(sum(paye_tax), 2), round(sum(total_deductions - paye_tax), 2), round(sum(net_pay), 2)
    into v_gross, v_tax, v_other, v_net
    from public.restaurant_employee_pay_records where lodge_id = p_lodge_id and pay_period_id = p_pay_period_id;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_settings.net_payable_account_id, 'debit', v_net, 'credit', 0, 'memo', 'Payroll net liability settlement'),
    jsonb_build_object('account_id', v_settings.tax_payable_account_id, 'debit', v_tax, 'credit', 0, 'memo', 'Payroll tax liability settlement'),
    jsonb_build_object('account_id', v_settings.deductions_payable_account_id, 'debit', v_other, 'credit', 0, 'memo', 'Payroll deductions liability settlement'),
    jsonb_build_object('account_id', v_batch.debit_account_id, 'debit', 0, 'credit', v_net + v_tax + v_other, 'memo', 'Payroll bank settlement')
  );
  v_posted := public._restaurant_post_journal(p_lodge_id, coalesce(p_settlement_date, v_period.end_date), 'Payroll settlement ' || v_period.name, 'payroll_settlement', p_pay_period_id, p_reference, 'payroll-settlement:' || p_pay_period_id, v_lines, v_actor, null);
  v_entry_id := nullif(v_posted->'data'->>'entry_id', '')::uuid;
  update public.restaurant_payroll_payment_batches
     set status = 'settled', settled_by = v_actor, settled_at = now(), bank_reference = p_reference
   where id = v_batch.id;
  update public.restaurant_pay_periods
     set status = 'paid', paid_at = coalesce(paid_at, now()), settlement_status = 'settled', settlement_journal_entry_id = v_entry_id, settlement_operation_id = p_operation_id
   where id = p_pay_period_id and lodge_id = p_lodge_id;
  if not exists (select 1 from public.restaurant_financial_source_postings where lodge_id = p_lodge_id and source_type = 'payroll_settlement' and source_id = p_pay_period_id and status = 'posted') then
    insert into public.restaurant_financial_source_postings(lodge_id, source_type, source_id, source_version, business_date, operation_id, payload_hash, status, journal_entry_id, created_by)
    values (p_lodge_id, 'payroll_settlement', p_pay_period_id, 1, coalesce(p_settlement_date, v_period.end_date), p_operation_id, v_hash, 'posted', v_entry_id, v_actor)
    on conflict (lodge_id, operation_id) do nothing;
  end if;
  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'data', jsonb_build_object('pay_period_id', p_pay_period_id, 'batch_id', v_batch.id, 'journal_entry_id', v_entry_id, 'status', 'settled', 'bank_reference', p_reference, 'control_total', v_net + v_tax + v_other));
  insert into public.restaurant_payroll_operations(lodge_id, pay_period_id, operation_id, action, payload_hash, result, actor_id)
  values (p_lodge_id, p_pay_period_id, p_operation_id, 'settle', v_hash, v_result, v_actor);
  return v_result;
end
$$;

create or replace function public.reconcile_restaurant_payroll_settlement_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid,
  p_operation_id uuid,
  p_bank_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.bank_approve');
  v_hash text := encode(digest(jsonb_build_object('action', 'reconcile', 'pay_period_id', p_pay_period_id, 'bank_reference', p_bank_reference)::text, 'sha256'), 'hex');
  v_existing public.restaurant_payroll_operations%rowtype;
  v_batch public.restaurant_payroll_payment_batches%rowtype;
  v_result jsonb;
begin
  perform public._restaurant_payroll_operation_lock(p_lodge_id, p_operation_id);
  if nullif(btrim(p_bank_reference), '') is null then raise exception 'Bank evidence reference is required' using errcode = '22023'; end if;
  select * into v_existing from public.restaurant_payroll_operations where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash or v_existing.action <> 'reconcile' or v_existing.pay_period_id <> p_pay_period_id then raise exception 'Payroll operation key conflicts with a different reconciliation' using errcode = '22000'; end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_batch from public.restaurant_payroll_payment_batches where lodge_id = p_lodge_id and pay_period_id = p_pay_period_id order by exported_at desc limit 1 for update;
  if not found or v_batch.status <> 'settled' then raise exception 'Settled payroll batch is required before bank reconciliation' using errcode = '22023'; end if;
  update public.restaurant_payroll_payment_batches set status = 'reconciled', bank_reference = p_bank_reference, reconciled_by = v_actor, reconciled_at = now() where id = v_batch.id;
  update public.restaurant_pay_periods set settlement_status = 'reconciled' where id = p_pay_period_id and lodge_id = p_lodge_id;
  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'data', jsonb_build_object('pay_period_id', p_pay_period_id, 'batch_id', v_batch.id, 'status', 'reconciled', 'bank_reference', p_bank_reference));
  insert into public.restaurant_payroll_operations(lodge_id, pay_period_id, operation_id, action, payload_hash, result, actor_id) values (p_lodge_id, p_pay_period_id, p_operation_id, 'reconcile', v_hash, v_result, v_actor);
  return v_result;
end
$$;

create or replace function public.close_restaurant_payroll_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  v_hash text := encode(digest(jsonb_build_object('action', 'close', 'pay_period_id', p_pay_period_id)::text, 'sha256'), 'hex');
  v_existing public.restaurant_payroll_operations%rowtype;
  v_period public.restaurant_pay_periods%rowtype;
  v_result jsonb;
begin
  perform public._restaurant_payroll_operation_lock(p_lodge_id, p_operation_id);
  select * into v_existing from public.restaurant_payroll_operations where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash or v_existing.action <> 'close' or v_existing.pay_period_id <> p_pay_period_id then raise exception 'Payroll operation key conflicts with a different close' using errcode = '22000'; end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_period from public.restaurant_pay_periods where id = p_pay_period_id and lodge_id = p_lodge_id for update;
  if not found or v_period.status <> 'paid' or v_period.settlement_status <> 'reconciled' then raise exception 'Payroll must be settled and bank-reconciled before close' using errcode = '22023'; end if;
  update public.restaurant_pay_periods set status = 'closed', closed_at = now(), closed_by = v_actor where id = p_pay_period_id and lodge_id = p_lodge_id;
  v_result := jsonb_build_object('success', true, 'operation_id', p_operation_id, 'data', jsonb_build_object('pay_period_id', p_pay_period_id, 'status', 'closed'));
  insert into public.restaurant_payroll_operations(lodge_id, pay_period_id, operation_id, action, payload_hash, result, actor_id) values (p_lodge_id, p_pay_period_id, p_operation_id, 'close', v_hash, v_result, v_actor);
  return v_result;
end
$$;

revoke all on function public._restaurant_payroll_operation_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_restaurant_payroll_v3(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.export_restaurant_payroll_payments_v3(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.settle_restaurant_payroll_v3(uuid, uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.reconcile_restaurant_payroll_settlement_v3(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.close_restaurant_payroll_v3(uuid, uuid, uuid) to authenticated, service_role;

commit;
