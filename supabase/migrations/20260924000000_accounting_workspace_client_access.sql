-- Bar Accounting workspace client access (production activation).
--
-- Operator-directed: applied on explicit owner instruction, bypassing the
-- staged disposable-target proof in docs/BAR_ACCOUNTING_ACTIVATION_RUNBOOK.md.
-- The owner accepts the residual risk (unproven end-to-end capability mapping
-- for Bar staff roles). Every surface below still fails closed server-side.
--
-- What this file does (additive and idempotent; no history rewritten):
-- 1. Replaces the in-body `service_role`-only no-ship gates on the v3
--    export family, the payroll workspace/calculation reads, and the export
--    artifact recorders with the same capability checker the rest of the
--    module uses (_restaurant_require_capability /
--    _restaurant_actor_has_capability, tenant-scoped by p_lodge_id,
--    fail-closed 42501). service_role callers bypass inside the checker, so
--    server-side jobs are unaffected. Capabilities mirror the reviewed
--    docs/ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md mapping (reads: read/export,
--    payroll: payroll_view/payroll_export/payroll_manage).
-- 2. Grants authenticated EXECUTE on the exact desktop client contract
--    (src/main/domains/restaurantAccountingV2.js) plus its internal callees.
--    anon/public stay revoked; service_role grants are untouched.
--
-- Deliberately NOT opened here (stay service_role-only):
-- - Payroll statutory source-document registration / verification / approval
--   (register/verify/approve v1): payroll calculation keeps requiring
--   independent professional approval, which no client can currently grant.
-- - Non-accounting report exports (starter/POS/lodge): separate capability
--   model, independent decision.
-- - get_accounting_report_export_v3: no desktop caller.
--
-- Post-apply the operator must still walk the activation lifecycle
-- (readiness -> cutover prepare/approve/apply -> activate) in
-- restaurant/accounting-setup before posting; grants alone do not activate.

begin;


-- _restaurant_record_accounting_export_v3(uuid,text,jsonb,jsonb,boolean,text,text,text): no-ship service_role gate -> capability 'accounting.read' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public._restaurant_record_accounting_export_v3(p_lodge_id uuid, p_export_kind text, p_filters jsonb, p_payload jsonb, p_complete boolean, p_watermark text, p_source_coverage_status text, p_close_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
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
$function$;


-- get_restaurant_chart_export_v3(uuid,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_chart_export_v3(p_lodge_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb; v_rows jsonb; v_accounts jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','chart','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE'));
  end if;
  v_read := public.get_restaurant_accounts(p_lodge_id); v_accounts := coalesce(v_read->'data','[]'::jsonb);
  select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('historical_balance',coalesce((select sum(l.debit-l.credit) from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted),0)) order by a.code),'[]'::jsonb) into v_rows from public.restaurant_accounts a where a.lodge_id=p_lodge_id;
  v_data := jsonb_build_object('accounts',v_rows,'account_count',jsonb_array_length(v_rows),'source_accounts',v_accounts);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'chart',coalesce(p_filters,'{}'::jsonb),v_data,true,'CERTIFIED','complete','not_applicable');
end
$function$;


-- get_restaurant_ledger_export_v3(uuid,date,date,uuid,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_ledger_export_v3(p_lodge_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_account_id uuid DEFAULT NULL::uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb; v_filters jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'account_id',p_account_id);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','ledger','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_ledger_report_export_v2(p_lodge_id,p_start_date,p_end_date,p_account_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'ledger',v_filters,v_data,coalesce((v_data->>'complete')::boolean,false),'DRAFT / UNCLOSED LEDGER','unknown','not_applicable');
end
$function$;


-- get_restaurant_ap_export_v3(uuid,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_ap_export_v3(p_lodge_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','ap','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_ap_export_v2(p_lodge_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb) || jsonb_build_object('ap_control_reconciliation','not_certified','supplier_statements','required');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'ap',p_filters,v_data,false,'DRAFT / AP RECONCILIATION REQUIRED','unknown','not_applicable');
end
$function$;


-- get_restaurant_bank_export_v3(uuid,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_bank_export_v3(p_lodge_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','bank','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_bank_export_v2(p_lodge_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb) || jsonb_build_object('match_allocations','required','exceptions','required','packet_hash','required');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'bank',p_filters,v_data,false,'DRAFT / BANK RECONCILIATION REQUIRED','unknown','not_applicable');
end
$function$;


-- get_restaurant_tax_export_v3(uuid,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_tax_export_v3(p_lodge_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','tax','filters',coalesce(p_filters,'{}'::jsonb),'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_tax_export_v2(p_lodge_id); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb) || jsonb_build_object('filing_state','requires_professional_review','control_account_reconciliation','required');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'tax',p_filters,v_data,false,'DRAFT / TAX REVIEW REQUIRED','unknown','not_applicable');
end
$function$;


-- get_restaurant_budget_export_v3(uuid,integer,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_budget_export_v3(p_lodge_id uuid, p_year integer, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb; v_filters jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('year',p_year);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','budget','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_budget_export_v2(p_lodge_id,p_year); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'budget',v_filters,v_data,coalesce((v_data->>'complete_matrix')::boolean,false),'DRAFT / BUDGET APPROVAL REQUIRED','unknown','not_applicable');
end
$function$;


-- get_restaurant_statements_export_v3(uuid,date,date,jsonb): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_statements_export_v3(p_lodge_id uuid, p_start_date date, p_end_date date, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_read jsonb; v_data jsonb; v_filters jsonb; v_final boolean;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('start_date',p_start_date,'end_date',p_end_date);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','statements','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  v_read := public.get_restaurant_statements_export_v2(p_lodge_id,p_start_date,p_end_date); v_data := coalesce(v_read->'data',v_read,'{}'::jsonb);
  v_final := coalesce((v_data->>'dataset_complete')::boolean,false) and coalesce((v_data->>'source_coverage_complete')::boolean,false) and coalesce((v_data->>'balanced')::boolean,false) and coalesce((v_data->>'cash_flow_complete')::boolean,false) and coalesce((v_data->>'financially_final')::boolean,false);
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'statements',v_filters,v_data,v_final,case when v_final then 'CERTIFIED' else 'DRAFT / UNCLOSED FINANCIAL STATEMENT' end,case when v_final then 'complete' else 'incomplete' end,case when v_final then 'approved' else 'unclosed' end);
end
$function$;


-- get_restaurant_payroll_export_v3(uuid,uuid,jsonb): no-ship service_role gate -> capability 'accounting.payroll_export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_payroll_export_v3(p_lodge_id uuid, p_pay_period_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_period record; v_rows jsonb; v_payload jsonb; v_filters jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_export');
  v_filters := coalesce(p_filters,'{}'::jsonb) || jsonb_build_object('pay_period_id',p_pay_period_id);
  if not public.restaurant_accounting_is_active(p_lodge_id) then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'export_kind','payroll','filters',v_filters,'watermark','ACCOUNTING NOT ACTIVE')); end if;
  select p.id,p.status,p.payment_batch_id,p.settlement_status into v_period from public.restaurant_pay_periods p where p.id=p_pay_period_id and p.lodge_id=p_lodge_id;
  if not found or v_period.status not in ('approved','paid','closed') then return public._restaurant_record_accounting_export_v3(p_lodge_id,'payroll',v_filters,jsonb_build_object('period',to_jsonb(v_period),'rows','[]'::jsonb),false,'DRAFT / APPROVED PAYROLL VERSION REQUIRED','incomplete','not_applicable'); end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.staff_name,r.id),'[]'::jsonb) into v_rows from public.restaurant_employee_pay_records r where r.lodge_id=p_lodge_id and r.pay_period_id=p_pay_period_id;
  v_payload := jsonb_build_object('period',to_jsonb(v_period),'register',v_rows,'control_total',coalesce((select sum(r.net_pay) from public.restaurant_employee_pay_records r where r.lodge_id=p_lodge_id and r.pay_period_id=p_pay_period_id),0),'payment_batch_identity',v_period.payment_batch_id,'pii','masked_in_general_exports');
  return public._restaurant_record_accounting_export_v3(p_lodge_id,'payroll',v_filters,v_payload,v_period.status in ('paid','closed') and v_period.settlement_status in ('reconciled'),'DRAFT / PAYROLL RECONCILIATION REQUIRED','unknown',case when v_period.status='closed' then 'closed' else 'unclosed' end);
end
$function$;


-- record_accounting_export_artifact_v3(uuid,uuid,text,text,bigint,text,text): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.record_accounting_export_artifact_v3(p_lodge_id uuid, p_export_id uuid, p_artifact_type text, p_file_hash text, p_byte_count bigint, p_detailed_companion_hash text DEFAULT NULL::text, p_artifact_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_status text; v_actor uuid := public.app_get_actor_user_id();
begin
  -- Export artifact recording accompanies chart/ledger/AP/bank/tax/budget/
  -- statement exports (accounting.export) and the payroll register export
  -- (accounting.payroll_export). service_role bypasses via the checker.
  if not (public._restaurant_actor_has_capability(p_lodge_id, 'accounting.export')
       or public._restaurant_actor_has_capability(p_lodge_id, 'accounting.payroll_export')) then
    raise exception 'Accounting capability accounting.export is required' using errcode = '42501';
  end if;
  v_status := case when nullif(p_artifact_error,'') is null and p_byte_count>0 and p_file_hash ~ '^[0-9a-fA-F]{64}$' then 'complete' else 'failed' end;
  update public.restaurant_accounting_export_runs set artifact_status=v_status,file_hash=case when v_status='complete' then p_file_hash else null end,detailed_companion_hash=coalesce(p_detailed_companion_hash,detailed_companion_hash),artifact_error=case when v_status='failed' then coalesce(nullif(p_artifact_error,''),'Artifact output was not written and verified') else null end where id=p_export_id and lodge_id=p_lodge_id;
  if not found then raise exception 'Accounting export run not found' using errcode='P0002'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('export_id',p_export_id,'artifact_status',v_status,'file_hash',case when v_status='complete' then p_file_hash else null end,'detailed_companion_hash',p_detailed_companion_hash));
end
$function$;


-- record_accounting_export_artifact_v3(uuid,uuid,text,text,bigint,text,text,text,text): no-ship service_role gate -> capability 'accounting.export' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.record_accounting_export_artifact_v3(p_lodge_id uuid, p_export_id uuid, p_artifact_type text, p_file_hash text, p_byte_count bigint, p_artifact_file_path text DEFAULT NULL::text, p_detailed_companion_path text DEFAULT NULL::text, p_detailed_companion_hash text DEFAULT NULL::text, p_artifact_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_actor uuid := public.app_get_actor_user_id();
begin
  -- Export artifact recording accompanies chart/ledger/AP/bank/tax/budget/
  -- statement exports (accounting.export) and the payroll register export
  -- (accounting.payroll_export). service_role bypasses via the checker.
  if not (public._restaurant_actor_has_capability(p_lodge_id, 'accounting.export')
       or public._restaurant_actor_has_capability(p_lodge_id, 'accounting.payroll_export')) then
    raise exception 'Accounting capability accounting.export is required' using errcode = '42501';
  end if;
  if p_artifact_type not in ('json','csv','xlsx','pdf') then
    raise exception 'Unsupported Accounting artifact type' using errcode='22023';
  end if;
  v_status := case
    when nullif(p_artifact_error,'') is null
      and coalesce(p_byte_count,0) > 0
      and p_file_hash ~ '^[0-9a-fA-F]{64}$'
      and (p_artifact_type <> 'pdf' or (
        nullif(p_detailed_companion_path,'') is not null
        and p_detailed_companion_hash ~ '^[0-9a-fA-F]{64}$'
      ))
    then 'complete'
    else 'failed'
  end;
  update public.restaurant_accounting_export_runs
  set artifact_status=v_status,
      artifact_file_path=case when v_status='complete' then p_artifact_file_path else artifact_file_path end,
      file_hash=case when v_status='complete' then lower(p_file_hash) else null end,
      detailed_companion_path=case when v_status='complete' then p_detailed_companion_path else detailed_companion_path end,
      detailed_companion_hash=case when v_status='complete' then lower(p_detailed_companion_hash) else detailed_companion_hash end,
      artifact_error=case when v_status='failed' then coalesce(nullif(p_artifact_error,''),'Artifact output was not written and verified') else null end
  where id=p_export_id and lodge_id=p_lodge_id;
  if not found then
    raise exception 'Accounting export run not found' using errcode='P0002';
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'export_id',p_export_id,
    'artifact_status',v_status,
    'file_hash',case when v_status='complete' then lower(p_file_hash) else null end,
    'detailed_companion_path',case when v_status='complete' then p_detailed_companion_path else null end,
    'detailed_companion_hash',case when v_status='complete' then lower(p_detailed_companion_hash) else null end,
    'recorded_by',v_actor
  ));
end
$function$;


-- get_restaurant_payroll_workspace_v3(uuid): no-ship service_role gate -> capability 'accounting.payroll_view' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.get_restaurant_payroll_workspace_v3(p_lodge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid := public.app_get_actor_user_id(); v_data jsonb; v_terms jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_view');
  v_data := coalesce((public.get_restaurant_payroll_workspace_v2(p_lodge_id))->'data','{}'::jsonb);
  select coalesce(jsonb_agg((to_jsonb(t) - 'bank_account_name' - 'bank_account_number' - 'bank_branch_code') || jsonb_build_object('bank_account_number_masked',case when nullif(t.bank_account_number,'') is null then null else repeat('*',greatest(length(t.bank_account_number)-4,0))||right(t.bank_account_number,4) end) order by t.effective_from desc),'[]'::jsonb) into v_terms from public.restaurant_payroll_employment_terms t where t.lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',v_data || jsonb_build_object('terms',v_terms,'pii_policy','bank details are restricted to the dedicated payment-export operation','bank_details','masked','generated_by',v_actor));
end
$function$;


-- calculate_restaurant_payroll_v3(uuid,uuid): no-ship service_role gate -> capability 'accounting.payroll_manage' (service_role bypass preserved inside the checker).
CREATE OR REPLACE FUNCTION public.calculate_restaurant_payroll_v3(p_lodge_id uuid, p_pay_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid := public.app_get_actor_user_id(); v_period public.restaurant_pay_periods%rowtype; v_cfg public.restaurant_payroll_statutory_configurations%rowtype; v_result jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  select * into v_period from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Pay period was not found' using errcode='P0002'; end if;
  select * into v_cfg from public.restaurant_payroll_statutory_configurations where id=v_period.statutory_configuration_id and lodge_id=p_lodge_id;
  if not found or v_cfg.approval_status<>'approved' or v_cfg.source_document_id is null or v_cfg.policy_approved_by is null or v_cfg.source_document_hash !~ '^[0-9a-fA-F]{64}$' then raise exception 'Payroll calculation is blocked until the rule version has independent professional approval' using errcode='42501'; end if;
  if exists(select 1 from public.restaurant_payroll_time_inputs t where t.pay_period_id=p_pay_period_id and t.lodge_id=p_lodge_id and t.approved_at is null) then raise exception 'Payroll has unapproved time inputs' using errcode='23514'; end if;
  v_result := public.calculate_restaurant_payroll_v2(p_lodge_id,p_pay_period_id);
  return v_result || jsonb_build_object('statutory_evidence',jsonb_build_object('configuration_id',v_cfg.id,'rule_version',v_cfg.rule_version,'source_document_id',v_cfg.source_document_id,'source_document_hash',v_cfg.source_document_hash,'approval_reference',v_cfg.professional_approval_reference));
end
$function$;


-- Part C: least-privilege client surface for the desktop accounting contract.
-- Every listed function enforces its capability internally
-- (_restaurant_require_capability / _restaurant_actor_has_capability /
-- _restaurant_require_operational_report_access, tenant-scoped by p_lodge_id,
-- fail-closed 42501, service_role bypass preserved). anon/public stay revoked;
-- service_role grants are untouched. Overload-proof: every existing overload of
-- each name is covered, so later signature-compatible redefinitions cannot
-- leave a bypassing entry point executable.
do $$
declare
  names text[] := array[
    -- Desktop client contract (src/main/domains/restaurantAccountingV2.js).
    -- Excludes the non-accounting report exports (get_starter_basic_report,
    -- get_lodge_operational_report_export_v2,
    -- get_pos_financial_report_export_v2), which live under a separate
    -- operational-report capability model and are handled independently.
    'activate_restaurant_accounting','apply_restaurant_budget_template_v2',
    'apply_restaurant_historical_cutover','approve_restaurant_ap_credit_note_v2',
    'approve_restaurant_bill','approve_restaurant_budget_version',
    'approve_restaurant_historical_cutover','approve_restaurant_manual_journal',
    'approve_restaurant_payroll_time_input','approve_restaurant_payroll_v3',
    'approve_restaurant_period_close','approve_restaurant_tax_adjustment',
    'approve_restaurant_tax_working_paper','calculate_restaurant_payroll_v3',
    'close_restaurant_payroll_v3','complete_bank_reconciliation_v2',
    'complete_restaurant_report_run','create_bank_reconciliation_v2',
    'create_restaurant_account','create_restaurant_ap_credit_note_v2',
    'create_restaurant_bill_v3','create_restaurant_budget_template_v2',
    'create_restaurant_journal_entry','create_restaurant_manual_journal_draft',
    'create_restaurant_pay_period_v2','create_restaurant_tax_amendment',
    'delete_restaurant_account','export_restaurant_payroll_payments_v4',
    'fail_restaurant_report_run','generate_restaurant_tax_amendment_working_paper',
    'generate_restaurant_tax_working_paper','get_bank_match_candidates_v1',
    'get_restaurant_accounting_activation_state','get_restaurant_accounting_readiness',
    'get_restaurant_accounts','get_restaurant_ap_export_v2',
    'get_restaurant_ap_export_v3','get_restaurant_ap_workspace_v2',
    'get_restaurant_bank_export_v2','get_restaurant_bank_export_v3',
    'get_restaurant_bank_reconciliation_packet_v2','get_restaurant_bank_workspace_v2',
    'get_restaurant_budget_export_v2','get_restaurant_budget_export_v3',
    'get_restaurant_budget_matrix_v2','get_restaurant_chart_export_v2',
    'get_restaurant_chart_export_v3','get_restaurant_financial_source_coverage',
    'get_restaurant_financial_statements_v3','get_restaurant_historical_cutover_batch',
    'get_restaurant_historical_cutover_batches','get_restaurant_ledger_export_v2',
    'get_restaurant_ledger_export_v3','get_restaurant_ledger_report_export_v2',
    'get_restaurant_ledger_workspace_page_v2','get_restaurant_ledger_workspace_v2',
    'get_restaurant_payroll_attendance_reconciliation_v3','get_restaurant_payroll_export_v2',
    'get_restaurant_payroll_export_v3','get_restaurant_payroll_readiness_v2',
    'get_restaurant_payroll_records_v2','get_restaurant_payroll_workspace_v3',
    'get_restaurant_period_close','get_restaurant_pos_gl_mappings',
    'get_restaurant_statements_export_v2','get_restaurant_statements_export_v3',
    'get_restaurant_supplier_statement_v2','get_restaurant_tax_adjustments',
    'get_restaurant_tax_export_v2','get_restaurant_tax_export_v3',
    'get_restaurant_tax_filing_packet_v2','get_restaurant_tax_working_papers_v2',
    'import_bank_statement_v2','import_bank_statement_v3',
    'match_restaurant_settlement_to_bank_transaction','post_pos_order_to_gl_v2',
    'post_restaurant_manual_journal','post_restaurant_opening_balance',
    'post_restaurant_payroll_to_gl_v2','prepare_restaurant_historical_cutover',
    'prepare_restaurant_period_close','propose_bank_match_allocations_v1',
    'propose_bank_matches_v2','reconcile_restaurant_payroll_settlement_v3',
    'record_accounting_export_artifact_v3','record_report_artifact_result',
    'record_restaurant_bill_payment_v2','record_restaurant_tax_adjustment',
    'record_restaurant_tax_filing','reopen_restaurant_period_close',
    'reverse_restaurant_journal_entry','review_bank_match_allocation_v1',
    'review_bank_match_v2','review_restaurant_tax_working_paper',
    'save_restaurant_bank_account_v2','save_restaurant_budget_matrix_v2',
    'seed_restaurant_default_accounts','set_bank_transaction_exception',
    'set_restaurant_account_cash_flow_classification','set_restaurant_ap_gl_settings',
    'set_restaurant_payroll_attendance_disposition_v3','set_restaurant_payroll_employment_terms',
    'set_restaurant_payroll_gl_settings','set_restaurant_payroll_statutory_configuration_v3',
    'set_restaurant_payroll_time_input','set_restaurant_pos_gl_mapping',
    'set_restaurant_pos_gl_mapping_v2','set_restaurant_tax_configuration',
    'settle_restaurant_payroll_v3','start_restaurant_report_run',
    'submit_restaurant_ap_credit_note_v2','submit_restaurant_bill',
    'submit_restaurant_manual_journal','suspend_restaurant_accounting',
    'update_restaurant_account',
    -- Internal callees of the surface above. Each is either capability-gated
    -- itself or a pure/session utility whose direct use is lodge-scoped and
    -- attributed (locks, hashes, audit writer, business date, actor helpers).
    '_restaurant_require_capability','_restaurant_actor_has_capability',
    'app_require_feature','app_current_role','app_get_actor_user_id',
    'app_current_user_id','log_restaurant_financial_action',
    '_restaurant_record_accounting_export_v3','restaurant_accounting_is_active',
    '_restaurant_require_operational_report_access',
    'prepare_restaurant_payroll_expected_workers','_restaurant_payroll_operation_lock',
    'export_restaurant_payroll_payments','_restaurant_payroll_tax',
    'get_restaurant_payroll_workspace_v2','calculate_restaurant_payroll_v2',
    'export_restaurant_payroll_payments_v3','get_restaurant_ap_export_v2',
    'get_restaurant_bank_export_v2','get_restaurant_budget_export_v2',
    'get_restaurant_ledger_report_export_v2','get_restaurant_statements_export_v2',
    'get_restaurant_tax_export_v2','get_restaurant_financial_statements_v2',
    '_generate_restaurant_tax_working_paper','get_lodge_business_date'
  ];
  fn text;
  r record;
begin
  foreach fn in array names loop
    for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = fn loop
      execute format('revoke all on function %s from anon, public', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    end loop;
  end loop;
end
$$;

commit;

