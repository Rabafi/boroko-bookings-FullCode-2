-- Financial truth gate 8/9: page-specific Accounting exports and explicit
-- finality.  These exports remain service-role-only until the behavioral gates
-- and professional review gates are recorded.

begin;

create table if not exists public.restaurant_accounting_export_runs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  export_kind text not null check (export_kind in ('chart','ledger','ap','bank','tax','budget','statements','payroll')),
  schema_version text not null,
  actual_filters jsonb not null default '{}'::jsonb,
  database_cutoff_at timestamptz not null default now(),
  dataset_hash text not null,
  detailed_companion_hash text,
  file_hash text,
  dataset_status text not null check (dataset_status in ('not_active','draft','certified','blocked','failed')),
  artifact_status text not null default 'not_created' check (artifact_status in ('not_created','writing','complete','failed')),
  watermark text not null,
  complete boolean not null default false,
  source_coverage_status text not null default 'unknown',
  close_state text not null default 'not_applicable',
  generated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  artifact_error text
);
alter table public.restaurant_accounting_export_runs enable row level security;
revoke all on table public.restaurant_accounting_export_runs from public, anon, authenticated;
grant select, insert, update on table public.restaurant_accounting_export_runs to service_role;

create or replace function public._restaurant_record_accounting_export_v3(
  p_lodge_id uuid,
  p_export_kind text,
  p_filters jsonb,
  p_payload jsonb,
  p_complete boolean,
  p_watermark text,
  p_source_coverage_status text,
  p_close_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_get_actor_user_id();
  v_cutoff timestamptz := clock_timestamp();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_hash text := encode(digest(v_payload::text, 'sha256'), 'hex');
  v_active boolean := public.restaurant_accounting_is_active(p_lodge_id);
  v_complete boolean := coalesce(p_complete, false) and v_active;
  v_status text := case when not v_active then 'not_active' when v_complete then 'certified' else 'blocked' end;
  v_watermark text := case when not v_active then 'ACCOUNTING NOT ACTIVE' when v_complete then 'CERTIFIED' else coalesce(nullif(p_watermark,''),'DRAFT / UNCLOSED FINANCIAL STATEMENT') end;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accounting export finality is service-role-only during no-ship' using errcode='42501';
  end if;
  if p_export_kind not in ('chart','ledger','ap','bank','tax','budget','statements','payroll') then
    raise exception 'Unknown Accounting export kind' using errcode='22023';
  end if;
  insert into public.restaurant_accounting_export_runs(
    lodge_id, export_kind, schema_version, actual_filters, database_cutoff_at,
    dataset_hash, dataset_status, watermark, complete, source_coverage_status,
    close_state, generated_by
  ) values (
    p_lodge_id, p_export_kind, 'accounting-export-v3', coalesce(p_filters,'{}'::jsonb), v_cutoff,
    v_hash, v_status, v_watermark, v_complete, coalesce(p_source_coverage_status,'unknown'),
    coalesce(p_close_state,'not_applicable'), v_actor
  ) returning id into v_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'export_id',v_id,'export_kind',p_export_kind,'schema_version','accounting-export-v3',
    'filters',coalesce(p_filters,'{}'::jsonb),'database_cutoff_at',v_cutoff,
    'dataset_hash',v_hash,'dataset_status',v_status,'complete',v_complete,
    'watermark',v_watermark,'artifact_status','not_created',
    'source_coverage_status',coalesce(p_source_coverage_status,'unknown'),
    'close_state',coalesce(p_close_state,'not_applicable'),'payload',v_payload
  ));
end
$$;

create or replace function public.get_restaurant_chart_export_v3(
  p_lodge_id uuid, p_filters jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_rows jsonb; v_accounts jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','chart','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE'));
  end if;
  v_read := public.get_restaurant_accounts(p_lodge_id); v_accounts := coalesce(v_read->'data','[]'::jsonb);
  select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('historical_balance',coalesce((select sum(l.debit-l.credit) from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted),0)) order by a.code),'[]'::jsonb) into v_rows from public.restaurant_accounts a where a.lodge_id=p_lodge_id;
  v_data := jsonb_build_object('accounts',v_rows,'account_count',jsonb_array_length(v_rows),'source_accounts',v_accounts);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'chart',coalesce(p_filters,'{}'::jsonb),v_data,true,'CERTIFIED','complete','not_applicable');
end
$$;

create or replace function public.get_restaurant_ledger_export_v3(
  p_lodge_id uuid, p_start_date date default null, p_end_date date default null, p_account_id uuid default null, p_filters jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_filters jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'account_id',p_account_id);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','ledger','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_ledger_report_export_v2(p_lodge_id,p_start_date,p_end_date,p_account_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'ledger',v_filters,v_data,coalesce((v_data->>'complete')::boolean,false),'DRAFT / UNCLOSED LEDGER','unknown','not_applicable');
end
$$;

create or replace function public.get_restaurant_ap_export_v3(p_lodge_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','ap','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_ap_export_v2(p_lodge_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb) || jsonb_build_object('ap_control_reconciliation','not_certified','supplier_statements','required');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'ap',p_filters,v_data,false,'DRAFT / AP RECONCILIATION REQUIRED','unknown','not_applicable');
end
$$;

create or replace function public.get_restaurant_bank_export_v3(p_lodge_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','bank','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_bank_export_v2(p_lodge_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb) || jsonb_build_object('match_allocations','required','exceptions','required','packet_hash','required');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'bank',p_filters,v_data,false,'DRAFT / BANK RECONCILIATION REQUIRED','unknown','not_applicable');
end
$$;

create or replace function public.get_restaurant_tax_export_v3(p_lodge_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','tax','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_tax_export_v2(p_lodge_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb) || jsonb_build_object('filing_state','requires_professional_review','control_account_reconciliation','required');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'tax',p_filters,v_data,false,'DRAFT / TAX REVIEW REQUIRED','unknown','not_applicable');
end
$$;

create or replace function public.get_restaurant_budget_export_v3(p_lodge_id uuid, p_year integer, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_filters jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('year',p_year);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','budget','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_budget_export_v2(p_lodge_id,p_year); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'budget',v_filters,v_data,coalesce((v_data->>'complete_matrix')::boolean,false),'DRAFT / BUDGET APPROVAL REQUIRED','unknown','not_applicable');
end
$$;

create or replace function public.get_restaurant_statements_export_v3(p_lodge_id uuid, p_start_date date, p_end_date date, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_filters jsonb; v_final boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('start_date',p_start_date,'end_date',p_end_date);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','statements','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_statements_export_v2(p_lodge_id,p_start_date,p_end_date); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb);
  v_final := coalesce((v_data->>'dataset_complete')::boolean,false) and coalesce((v_data->>'source_coverage_complete')::boolean,false) and coalesce((v_data->>'balanced')::boolean,false) and coalesce((v_data->>'cash_flow_complete')::boolean,false) and coalesce((v_data->>'financially_final')::boolean,false);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'statements',v_filters,v_data,v_final,case when v_final then 'CERTIFIED' else 'DRAFT / UNCLOSED FINANCIAL STATEMENT' end,case when v_final then 'complete' else 'incomplete' end,case when v_final then 'approved' else 'unclosed' end);
end
$$;

create or replace function public.get_restaurant_payroll_export_v3(p_lodge_id uuid, p_pay_period_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_period record; v_rows jsonb; v_payload jsonb; v_filters jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting export is service-role-only during no-ship' using errcode='42501'; end if;
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('pay_period_id',p_pay_period_id);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','payroll','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  select p.id,p.status,p.payment_batch_id,p.settlement_status into v_period from public.restaurant_pay_periods p where p.id=p_pay_period_id and p.lodge_id=p_lodge_id;
  if not found or v_period.status not in ('approved','paid','closed') then return public._restaurant_record_accounting_export_v3(p_lodge_id,'payroll',v_filters,jsonb_build_object('period',to_jsonb(v_period),'rows','[]'::jsonb),false,'DRAFT / APPROVED PAYROLL VERSION REQUIRED','incomplete','not_applicable'); end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.staff_name,r.id),'[]'::jsonb) into v_rows from public.restaurant_employee_pay_records r where r.lodge_id=p_lodge_id and r.pay_period_id=p_pay_period_id;
  v_payload := jsonb_build_object('period',to_jsonb(v_period),'register',v_rows,'control_total',coalesce((select sum(r.net_pay) from public.restaurant_employee_pay_records r where r.lodge_id=p_lodge_id and r.pay_period_id=p_pay_period_id),0),'payment_batch_identity',v_period.payment_batch_id,'pii','masked_in_general_exports');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'payroll',v_filters,v_payload,v_period.status in ('paid','closed') and v_period.settlement_status in ('reconciled'),'DRAFT / PAYROLL RECONCILIATION REQUIRED','unknown',case when v_period.status='closed' then 'closed' else 'unclosed' end);
end
$$;

create or replace function public.record_accounting_export_artifact_v3(
  p_lodge_id uuid, p_export_id uuid, p_artifact_type text, p_file_hash text,
  p_byte_count bigint, p_detailed_companion_hash text default null, p_artifact_error text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_status text; v_actor uuid := public.app_get_actor_user_id();
begin
  if auth.role() <> 'service_role' then raise exception 'Accounting artifact recording is service-role-only during no-ship' using errcode='42501'; end if;
  v_status := case when nullif(p_artifact_error,'') is null and p_byte_count>0 and p_file_hash ~ '^[0-9a-fA-F]{64}$' then 'complete' else 'failed' end;
  update public.restaurant_accounting_export_runs set artifact_status=v_status,file_hash=case when v_status='complete' then p_file_hash else null end,detailed_companion_hash=coalesce(p_detailed_companion_hash,detailed_companion_hash),artifact_error=case when v_status='failed' then coalesce(nullif(p_artifact_error,''),'Artifact output was not written and verified') else null end where id=p_export_id and lodge_id=p_lodge_id;
  if not found then raise exception 'Accounting export run not found' using errcode='P0002'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('export_id',p_export_id,'artifact_status',v_status,'file_hash',case when v_status='complete' then p_file_hash else null end,'detailed_companion_hash',p_detailed_companion_hash));
end
$$;

revoke all on function public._restaurant_record_accounting_export_v3(uuid,text,jsonb,jsonb,boolean,text,text,text) from public,anon,authenticated;
revoke all on function public.get_restaurant_chart_export_v3(uuid,jsonb),public.get_restaurant_ledger_export_v3(uuid,date,date,uuid,jsonb),public.get_restaurant_ap_export_v3(uuid,jsonb),public.get_restaurant_bank_export_v3(uuid,jsonb),public.get_restaurant_tax_export_v3(uuid,jsonb),public.get_restaurant_budget_export_v3(uuid,integer,jsonb),public.get_restaurant_statements_export_v3(uuid,date,date,jsonb),public.get_restaurant_payroll_export_v3(uuid,uuid,jsonb),public.record_accounting_export_artifact_v3(uuid,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public._restaurant_record_accounting_export_v3(uuid,text,jsonb,jsonb,boolean,text,text,text),public.get_restaurant_chart_export_v3(uuid,jsonb),public.get_restaurant_ledger_export_v3(uuid,date,date,uuid,jsonb),public.get_restaurant_ap_export_v3(uuid,jsonb),public.get_restaurant_bank_export_v3(uuid,jsonb),public.get_restaurant_tax_export_v3(uuid,jsonb),public.get_restaurant_budget_export_v3(uuid,integer,jsonb),public.get_restaurant_statements_export_v3(uuid,date,date,jsonb),public.get_restaurant_payroll_export_v3(uuid,uuid,jsonb),public.record_accounting_export_artifact_v3(uuid,uuid,text,text,bigint,text,text) to service_role;

commit;
