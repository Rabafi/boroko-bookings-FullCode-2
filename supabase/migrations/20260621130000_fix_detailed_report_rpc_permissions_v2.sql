-- Fix: Desktop app uses the Supabase anon key, so report RPCs must be
-- executable by the anon role. SECURITY DEFINER + app_lodge_access() handles
-- authorization. This matches the pattern in 20260611134500_fix_report_rpc_anon_execute_grants.sql.

DO $$
DECLARE
  fn RECORD;
  fn_names text[] := ARRAY[
    'get_booking_register_report',
    'get_payment_transaction_report',
    'get_cancelled_booking_report',
    'get_refund_report',
    'get_outstanding_balance_report',
    'get_quotation_report',
    'get_invoice_register_report',
    'get_financial_exception_report',
    'get_reconciliation_controls_report'
  ];
  fn_name text;
  arg_list text;
  total_granted int := 0;
BEGIN
  FOREACH fn_name IN ARRAY fn_names LOOP
    FOR fn IN
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = fn_name
    LOOP
      arg_list := fn.args;
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
        fn.proname, arg_list
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated, service_role',
        fn.proname, arg_list
      );
      total_granted := total_granted + 1;
      RAISE NOTICE 'Fixed permissions on public.%(%)', fn.proname, arg_list;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Total functions fixed: %', total_granted;
END $$;
