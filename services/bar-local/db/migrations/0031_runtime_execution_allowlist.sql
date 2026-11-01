-- The runtime role is an HTTP execution identity, not a database owner or
-- migration helper. Keep the exact callable surface in a migrator-owned table
-- so restore-time security and ordinary migrations grant the same contract.
CREATE TABLE bar_local.runtime_function_allowlist (
  function_name text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE bar_local.runtime_function_allowlist FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.runtime_function_allowlist FROM bar_local_runtime;

INSERT INTO bar_local.runtime_function_allowlist (function_name) VALUES
  ('commission_owner'),
  ('query_dispatch'),
  ('service_authority'),
  ('service_complete_pairing'),
  ('service_create_approval'),
  ('service_create_pairing_code'),
  ('service_create_session'),
  ('service_device'),
  ('service_devices'),
  ('service_events'),
  ('service_increment_epoch'),
  ('service_login_outcome'),
  ('service_operation_status'),
  ('service_readiness'),
  ('service_refresh_session'),
  ('service_revoke_device'),
  ('service_revoke_session'),
  ('service_session'),
  ('service_set_entitlement'),
  ('service_staff'),
  ('cmd_accounting_account_upsert'),
  ('cmd_ap_invoice_approve'),
  ('cmd_ap_invoice_upsert'),
  ('cmd_ap_payment_post'),
  ('cmd_ap_payment_reverse'),
  ('cmd_bank_account_upsert'),
  ('cmd_bank_reconcile'),
  ('cmd_bank_statement_import'),
  ('cmd_budget_upsert'),
  ('cmd_cashup_reopen'),
  ('cmd_cashup_review'),
  ('cmd_cashup_submit'),
  ('cmd_catalogue_availability_set'),
  ('cmd_catalogue_modifier_group_upsert'),
  ('cmd_catalogue_modifier_option_upsert'),
  ('cmd_catalogue_product_modifier_set'),
  ('cmd_catalogue_recipe_set'),
  ('cmd_catalogue_upsert'),
  ('cmd_control_checklist_item_set'),
  ('cmd_control_checklist_start'),
  ('cmd_control_incident_log'),
  ('cmd_control_incident_resolve'),
  ('cmd_credit_payment'),
  ('cmd_customer_create'),
  ('cmd_drawer_movement'),
  ('cmd_expense_create'),
  ('cmd_expense_void'),
  ('cmd_export_bundle_create'),
  ('cmd_journal_post'),
  ('cmd_loyalty_account_enrol'),
  ('cmd_loyalty_points_adjust'),
  ('cmd_loyalty_points_earn'),
  ('cmd_loyalty_points_redeem'),
  ('cmd_loyalty_program_upsert'),
  ('cmd_payroll_run_create'),
  ('cmd_payroll_run_finalise'),
  ('cmd_payroll_run_prepare'),
  ('cmd_period_close'),
  ('cmd_promotion_upsert'),
  ('cmd_purchase_order_cancel'),
  ('cmd_purchase_order_create'),
  ('cmd_purchase_order_receive'),
  ('cmd_sale_commit'),
  ('cmd_sale_return'),
  ('cmd_sale_void'),
  ('cmd_settings_update'),
  ('cmd_shift_close'),
  ('cmd_shift_open'),
  ('cmd_staff_create'),
  ('cmd_staff_status'),
  ('cmd_stock_adjust'),
  ('cmd_stock_receive'),
  ('cmd_stock_stocktake'),
  ('cmd_stock_transfer'),
  ('cmd_stock_waste'),
  ('cmd_supplier_upsert'),
  ('cmd_support_report_create'),
  ('cmd_tab_add'),
  ('cmd_tab_merge'),
  ('cmd_tab_open'),
  ('cmd_tab_settle'),
  ('cmd_tab_split'),
  ('cmd_tab_transfer'),
  ('cmd_tax_code_upsert'),
  ('cmd_tax_return_prepare'),
  ('cmd_voucher_issue'),
  ('cmd_workforce_clock_in'),
  ('cmd_workforce_clock_out'),
  ('cmd_workforce_shift_cancel'),
  ('cmd_workforce_shift_schedule'),
  ('cmd_workforce_tip_allocate'),
  ('cmd_workforce_tip_payout'),
  ('cmd_workforce_tip_payout_reverse');

DO $runtime_allowlist$
DECLARE
  v_fn regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bar_local_runtime') THEN
    RAISE EXCEPTION 'The bar_local_runtime role must exist before the runtime allowlist migration runs.';
  END IF;

  FOR v_fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
       AND p.proname IN (SELECT function_name FROM bar_local.runtime_function_allowlist)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_fn);
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, bar_local', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM bar_local_runtime', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO bar_local_runtime', v_fn);
  END LOOP;

  FOR v_fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
       AND p.proname NOT IN (SELECT function_name FROM bar_local.runtime_function_allowlist)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM bar_local_runtime', v_fn);
  END LOOP;

  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'REVOKE ALL ON SCHEMA bar_local FROM PUBLIC';
  EXECUTE 'REVOKE CREATE ON SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'GRANT USAGE ON SCHEMA bar_local TO bar_local_runtime';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE ALL ON TABLES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE ALL ON SEQUENCES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE EXECUTE ON FUNCTIONS FROM bar_local_runtime';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE ALL ON TABLES FROM bar_local_runtime';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE ALL ON SEQUENCES FROM bar_local_runtime';
END;
$runtime_allowlist$;
