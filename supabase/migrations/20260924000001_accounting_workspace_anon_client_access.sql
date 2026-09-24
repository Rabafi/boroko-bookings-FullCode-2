-- Bar Accounting workspace anon client access (production activation).
--
-- Follow-up to 20260924000000 on explicit owner instruction. The desktop
-- connects with the anon key and carries staff identity in the
-- x-boroko-session header (src/main/domains/authClients.js); the wired
-- pgrst.db_pre_request hook (public.handle_pgrst_request) resolves actor,
-- role, and lodge GUCs per request. Granting authenticated alone therefore
-- never opened the Bar pages (permission denied for anon callers). This file
-- extends the identical capability-gated surface to anon, matching the
-- established desktop precedent (e.g. clock_out_staff_with_attendance_pin).
--
-- Safety is unchanged: without a valid session the checker resolves no actor
-- and every function fails closed 42501; with a session the staff role and
-- lodge binding decide. anon/public stay free of any new data access beyond
-- these capability-gated entry points; service_role grants are untouched.

begin;

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
      execute format('revoke all on function %s from public', r.sig);
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    end loop;
  end loop;
end
$$;

commit;
