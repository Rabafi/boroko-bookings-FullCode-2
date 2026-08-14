-- Financial truth gate 1/9: Accounting remains unavailable to authenticated
-- clients until the disposable PostgreSQL, authorization, reconciliation and
-- deployment gates are recorded. This migration is intentionally forward-only.
-- Generic POS/lodge reporting is not included in this revocation list.

begin;

alter table public.restaurant_report_runs
  add column if not exists schema_version text,
  add column if not exists filters jsonb not null default '{}'::jsonb,
  add column if not exists business_timezone text,
  add column if not exists database_cutoff_at timestamptz,
  add column if not exists row_count bigint,
  add column if not exists dataset_status text not null default 'uncertified',
  add column if not exists artifact_status text not null default 'not_created',
  add column if not exists dataset_hash text,
  add column if not exists file_hash text,
  add column if not exists artifact_error text,
  add column if not exists source_coverage_status text not null default 'unknown',
  add column if not exists close_state text not null default 'not_applicable';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurant_report_runs_dataset_status_check') then
    alter table public.restaurant_report_runs add constraint restaurant_report_runs_dataset_status_check
      check (dataset_status in ('uncertified','certified','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurant_report_runs_artifact_status_check') then
    alter table public.restaurant_report_runs add constraint restaurant_report_runs_artifact_status_check
      check (artifact_status in ('not_created','writing','complete','failed'));
  end if;
end
$$;

create table if not exists public.restaurant_report_artifact_results (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  report_run_id uuid not null references public.restaurant_report_runs(id) on delete restrict,
  artifact_type text not null check (artifact_type in ('json','csv','xlsx','pdf')),
  file_path text,
  file_hash text,
  byte_count bigint not null default 0 check (byte_count >= 0),
  artifact_status text not null check (artifact_status in ('complete','failed')),
  artifact_error text,
  recorded_by uuid references public.users(id),
  recorded_at timestamptz not null default now(),
  unique (report_run_id, artifact_type)
);
alter table public.restaurant_report_artifact_results enable row level security;
revoke all on table public.restaurant_report_artifact_results from public, anon, authenticated;
grant select, insert on table public.restaurant_report_artifact_results to service_role;

-- Revoke by routine name so this remains correct when later migrations add an
-- overload. Do not restore authenticated execution from this file.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'start_restaurant_report_run','complete_restaurant_report_run','fail_restaurant_report_run',
         '_restaurant_complete_accounting_export','get_accounting_report_export_v3',
         'get_restaurant_chart_export_v2','get_restaurant_ledger_report_export_v2',
         'get_restaurant_ledger_export_v2','get_restaurant_ap_export_v2',
         'get_restaurant_bank_export_v2','get_restaurant_tax_export_v2',
         'get_restaurant_budget_export_v2','get_restaurant_statements_export_v2',
         'get_restaurant_payroll_export_v2','get_restaurant_financial_statements_v2',
         'get_restaurant_ledger_workspace_v2','get_restaurant_budget_workspace_v2',
         'get_restaurant_ap_workspace_v2','get_restaurant_supplier_statement_v2',
         'get_restaurant_financial_source_coverage','get_restaurant_accounting_readiness',
         'get_restaurant_historical_cutover_audit','prepare_restaurant_historical_cutover',
         'approve_restaurant_historical_cutover','apply_restaurant_historical_cutover',
         'activate_restaurant_accounting','suspend_restaurant_accounting',
         'record_restaurant_source_posting','post_pos_order_to_gl_v2',
         'set_restaurant_pos_gl_mapping','set_restaurant_pos_gl_mapping_v2',
         'get_restaurant_pos_gl_mappings','generate_restaurant_tax_working_paper',
         'generate_restaurant_tax_amendment_working_paper','record_restaurant_tax_adjustment',
         'approve_restaurant_tax_adjustment','record_restaurant_tax_filing',
         'get_restaurant_tax_adjustments','save_restaurant_budget_matrix_v2',
         'set_restaurant_budget_version_status','create_restaurant_bill_v2',
         'create_restaurant_bill_v3','submit_restaurant_bill','approve_restaurant_bill',
         'create_restaurant_ap_credit_note_v2','submit_restaurant_ap_credit_note_v2',
         'approve_restaurant_ap_credit_note_v2','record_restaurant_bill_payment_v2',
         'get_restaurant_ap_workspace_v2','get_restaurant_supplier_statement_v2',
         'import_bank_statement_v2','propose_bank_matches_v2','review_bank_match_v2',
         'create_bank_reconciliation_v2','complete_bank_reconciliation_v2',
         'get_restaurant_bank_reconciliation_packet_v2','record_restaurant_settlement',
         'match_restaurant_settlement_to_bank_transaction','set_restaurant_expense_gl_mapping',
         'submit_expense','approve_expense','post_expense','pay_expense','void_expense',
         'reverse_expense','prepare_restaurant_payroll_expected_workers',
         'get_restaurant_payroll_readiness_v2','calculate_restaurant_payroll_v2',
         'approve_restaurant_payroll_v3','export_restaurant_payroll_payments_v3',
         'export_restaurant_payroll_payments','settle_restaurant_payroll_v3',
         'reconcile_restaurant_payroll_settlement_v3','close_restaurant_payroll_v3',
         'get_restaurant_financial_source_coverage_v2','get_restaurant_source_coverage_v2',
         'get_restaurant_statement_export_v3','get_restaurant_ap_export_v3',
         'get_restaurant_bank_export_v3','get_restaurant_tax_export_v3',
         'get_restaurant_budget_export_v3','get_restaurant_payroll_export_v3',
         'record_report_artifact_result'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end
$$;

-- Generic operational reporting has a separate access boundary. It does not
-- call _restaurant_require_capability, which always requires the Accounting
-- product feature.
create or replace function public._restaurant_require_operational_report_access(
  p_lodge_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_get_actor_user_id();
  v_role text;
  v_override jsonb;
begin
  if auth.role() = 'service_role' then return v_actor; end if;
  select lower(coalesce(u.role,'')), u.capability_overrides -> p_capability
    into v_role, v_override
    from public.users u
   where u.id = v_actor and u.lodge_id = p_lodge_id and coalesce(u.status,'active') = 'active';
  if not found then raise exception 'Operational report access denied' using errcode = '42501'; end if;
  if v_override is not null and jsonb_typeof(v_override) = 'boolean' then
    if (v_override::text)::boolean is false then raise exception 'Operational report capability is disabled' using errcode = '42501'; end if;
  elsif p_capability = 'pos.view' and v_role not in ('cashier','supervisor','manager','finance','admin','super_admin','owner') then
    raise exception 'POS report capability is required' using errcode = '42501';
  elsif p_capability = 'reports.view' and v_role not in ('manager','finance','admin','super_admin','owner') then
    raise exception 'Lodge report capability is required' using errcode = '42501';
  end if;
  return v_actor;
end
$$;
revoke all on function public._restaurant_require_operational_report_access(uuid,text) from public, anon, authenticated;
grant execute on function public._restaurant_require_operational_report_access(uuid,text) to service_role;

create or replace function public.get_pos_financial_report_export_v2(
  p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_run uuid := gen_random_uuid();
  v_cutoff timestamptz := clock_timestamp();
  v_rows jsonb;
  v_count bigint;
  v_controls jsonb;
  v_hash text;
begin
  v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'pos.view');
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Valid POS report dates are required' using errcode = '22023';
  end if;
  if p_outlet_id is not null and not exists (select 1 from public.outlets where id=p_outlet_id and lodge_id=p_lodge_id) then
    raise exception 'Outlet does not belong to the lodge' using errcode = '42501';
  end if;
  with filtered as (
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
     order by coalesce(po.business_date, (po.created_at at time zone 'Africa/Gaborone')::date), po.created_at, po.id
  ),
  enriched as (
    select f.*,
      coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.pos_order_items i where i.order_id=f.id and i.lodge_id=p_lodge_id),'[]'::jsonb) as item_rows,
      case when jsonb_typeof(coalesce(f.payment_breakdown,'[]'::jsonb))='array' and jsonb_array_length(coalesce(f.payment_breakdown,'[]'::jsonb))>0 then f.payment_breakdown else jsonb_build_array(jsonb_build_object('tender_id',f.id::text||':0','tender_index',0,'method',coalesce(f.payment_method,'cash'),'amount',f.total)) end as tender_rows
      from filtered f
  )
  select coalesce(jsonb_agg(to_jsonb(e) - 'item_rows' - 'tender_rows' || jsonb_build_object('items',e.item_rows,'tenders',e.tender_rows) order by e.business_date,e.created_at,e.id),'[]'::jsonb), count(*)
    into v_rows, v_count from enriched e;
  select jsonb_build_object(
    'gross_sales',coalesce(sum(case when po.status in ('completed','settled') and coalesce(po.transaction_type,'sale')='sale' and po.total>=0 then coalesce(nullif(po.gross_total,0),po.total) else 0 end),0),
    'discounts',coalesce(sum(case when po.status in ('completed','settled') and coalesce(po.transaction_type,'sale')='sale' and po.total>=0 then coalesce(po.discount_total,0) else 0 end),0),
    'tax',coalesce(sum(case when po.status in ('completed','settled') and coalesce(po.transaction_type,'sale')='sale' then coalesce(po.tax_total,0) else 0 end),0),
    'tips',coalesce(sum(case when po.status in ('completed','settled') and coalesce(po.transaction_type,'sale')='sale' then coalesce(po.tip_total,0) else 0 end),0),
    'returns',coalesce(sum(case when po.status in ('completed','settled') and (coalesce(po.transaction_type,'sale')='return' or po.total<0) then abs(po.total) else 0 end),0),
    'net_recorded_sales',coalesce(sum(case when po.status in ('completed','settled') then po.total else 0 end),0),
    'completed_sale_count',count(*) filter(where po.status in ('completed','settled') and coalesce(po.transaction_type,'sale')='sale' and po.total>=0),
    'return_count',count(*) filter(where po.status in ('completed','settled') and (coalesce(po.transaction_type,'sale')='return' or po.total<0)),
    'void_count',count(*) filter(where po.status='voided'),
    'cancelled_count',count(*) filter(where po.status='cancelled')
  ) into v_controls
  from public.pos_orders po
  where po.lodge_id=p_lodge_id and coalesce(po.business_date,(po.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date and (p_outlet_id is null or po.outlet_id=p_outlet_id);
  v_hash := encode(digest(v_rows::text,'sha256'),'hex');
  insert into public.restaurant_report_runs(id,lodge_id,report_key,period_start,period_end,outlet_id,as_of,status,complete,source_manifest,control_totals,data_hash,generated_by,schema_version,filters,business_timezone,database_cutoff_at,row_count,dataset_status,source_coverage_status,close_state)
  values(v_run,p_lodge_id,'pos_financial_detail_v2',p_start_date,p_end_date,p_outlet_id,v_cutoff,'complete',true,jsonb_build_object('orders',jsonb_build_object('row_count',v_count,'complete',true,'source','pos_orders')) ,v_controls,v_hash,v_actor,'pos-financial-report-v2',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'outlet_id',p_outlet_id),'Africa/Gaborone',v_cutoff,v_count,'certified','complete','not_applicable');
  return jsonb_build_object('success',true,'data',jsonb_build_object('schema_version','pos-financial-report-v2','report_run_id',v_run,'report_type','pos_transaction_detail','filters',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'outlet_id',p_outlet_id),'business_timezone','Africa/Gaborone','database_cutoff_at',v_cutoff,'row_count',v_count,'control_totals',v_controls,'dataset_status','certified','dataset_hash',v_hash,'rows',v_rows));
end
$$;

create or replace function public.get_lodge_operational_report_export_v2(
  p_lodge_id uuid, p_report_key text, p_start_date date, p_end_date date, p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'reports.view');
  if nullif(btrim(p_report_key),'') is null or p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Operational report key and valid dates are required' using errcode='22023'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('schema_version','lodge-operational-report-v2','report_type',p_report_key,'filters',coalesce(p_filters,'{}'::jsonb)||jsonb_build_object('start_date',p_start_date,'end_date',p_end_date),'business_timezone','Africa/Gaborone','generated_by',v_actor,'dataset_status','blocked','complete',false,'source_coverage_status','operational_only','rows','[]'::jsonb,'control_totals',jsonb_build_object('row_count',0,'note','This boundary is not a fabricated dataset. The detailed lodge handlers use their own authoritative operational queries.')));
end
$$;

create or replace function public.get_accounting_report_export_v3(
  p_lodge_id uuid, p_report_key text, p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- This remains service-role-only under the gate. It deliberately does not
  -- fabricate a complete result while activation or source coverage is absent.
  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'report_type',p_report_key,'filters',coalesce(p_filters,'{}'::jsonb)));
  end if;
  return jsonb_build_object('success',false,'data',jsonb_build_object('status','blocked','complete',false,'reason','Accounting report implementation requires the certified source-coverage and finality contracts'));
end
$$;

create or replace function public.record_report_artifact_result(
  p_lodge_id uuid, p_report_run_id uuid, p_artifact_type text, p_file_path text,
  p_file_hash text, p_byte_count bigint, p_artifact_error text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.app_get_actor_user_id(); v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'Report artifact recording is service-role-only during no-ship' using errcode='42501'; end if;
  if p_artifact_type not in ('json','csv','xlsx','pdf') then raise exception 'Unsupported artifact type' using errcode='22023'; end if;
  v_status := case when nullif(p_artifact_error,'') is null and p_byte_count > 0 and p_file_hash ~ '^[0-9a-fA-F]{64}$' then 'complete' else 'failed' end;
  insert into public.restaurant_report_artifact_results(lodge_id,report_run_id,artifact_type,file_path,file_hash,byte_count,artifact_status,artifact_error,recorded_by)
  values(p_lodge_id,p_report_run_id,p_artifact_type,nullif(p_file_path,''),nullif(p_file_hash,''),greatest(coalesce(p_byte_count,0),0),v_status,nullif(p_artifact_error,''),v_actor)
  on conflict(report_run_id,artifact_type) do update set file_path=excluded.file_path,file_hash=excluded.file_hash,byte_count=excluded.byte_count,artifact_status=excluded.artifact_status,artifact_error=excluded.artifact_error,recorded_by=excluded.recorded_by,recorded_at=now();
  update public.restaurant_report_runs set artifact_status=v_status,file_hash=case when v_status='complete' then p_file_hash else null end,artifact_error=case when v_status='failed' then coalesce(nullif(p_artifact_error,''),'Artifact was not written and verified') else null end where id=p_report_run_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('report_run_id',p_report_run_id,'artifact_type',p_artifact_type,'artifact_status',v_status,'file_hash',case when v_status='complete' then p_file_hash else null end));
end
$$;

revoke all on function public.get_pos_financial_report_export_v2(uuid,date,date,uuid) from public,anon;
grant execute on function public.get_pos_financial_report_export_v2(uuid,date,date,uuid) to authenticated,service_role;
revoke all on function public.get_lodge_operational_report_export_v2(uuid,text,date,date,jsonb) from public,anon;
grant execute on function public.get_lodge_operational_report_export_v2(uuid,text,date,date,jsonb) to authenticated,service_role;
revoke all on function public.get_accounting_report_export_v3(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_accounting_report_export_v3(uuid,text,jsonb) to service_role;
revoke all on function public.record_report_artifact_result(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.record_report_artifact_result(uuid,uuid,text,text,text,bigint,text) to service_role;

commit;
