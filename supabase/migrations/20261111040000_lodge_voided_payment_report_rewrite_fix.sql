-- Correct the report-function rewrite boundary for PostgreSQL ARE regexps.
-- Re-verify exact payment-reader counts so unmatched reports abort deployment.
begin;
do $$
declare
  v_signature text;
  v_expected_alias integer;
  v_expected_plain integer;
  v_definition text;
  v_alias_pattern text := 'from public.payments p';
  v_plain_pattern text := 'from public.payments';
  v_alias_count integer;
  v_plain_count integer;
begin
  for v_signature, v_expected_alias, v_expected_plain in
    select * from (values
      ('public.get_booking_register_report(uuid,date,date)', 1, 0),
      ('public.get_financial_exception_report(uuid,date,date)', 2, 0),
      ('public.get_invoice_register_report(uuid,date,date)', 1, 0),
      ('public.get_invoice_summary(uuid,uuid)', 5, 0),
      ('public.get_outstanding_balance_report(uuid,date,date)', 1, 0),
      ('public.get_payment_transaction_report(uuid,date,date)', 1, 0),
      ('public.get_reconciliation_controls_report(uuid,date,date)', 5, 0),
      ('public.app_get_revenue_by_method(integer)', 0, 1),
      ('public.app_get_revenue_summary(integer)', 0, 1),
      ('public._calculate_event_settlement_totals(uuid)', 0, 1),
      ('public.app_get_admin_today()', 1, 1),
      ('public.get_financial_reconciliation_v1(uuid)', 2, 1),
      ('public.get_guest_lifetime_summary(uuid,text,integer,integer)', 1, 0),
      ('public.get_guest_payment_history(text)', 1, 0),
      ('public.get_manager_dashboard_snapshot(uuid,date)', 0, 2),
      ('public.get_starter_basic_report(uuid,integer)', 3, 0)
    ) expected(signature, alias_count, plain_count)
  loop
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    if v_definition is null then raise exception 'Expected payment reader is missing: %',v_signature; end if;
    v_alias_count := (length(lower(v_definition))-length(replace(lower(v_definition),v_alias_pattern,'')))/length(v_alias_pattern);
    v_plain_count := (length(lower(v_definition))-length(replace(lower(v_definition),v_plain_pattern,'')))/length(v_plain_pattern)-v_alias_count;
    if v_alias_count=v_expected_alias and v_plain_count=v_expected_plain then
      v_definition := regexp_replace(v_definition,'(?i)from\s+public\.payments\s+p','from public.payment_reporting_active p','g');
      v_definition := regexp_replace(v_definition,'(?i)from\s+public\.payments','from public.payment_reporting_active','g');
      execute v_definition;
    elsif v_alias_count=0 and v_plain_count=0 then
      if position('payment_reporting_active' in v_definition)=0 then
        raise exception 'Reader has neither expected raw reads nor active view: %',v_signature;
      end if;
    else
      raise exception 'Unexpected payment-reader shape in %, alias %, plain %',v_signature,v_alias_count,v_plain_count;
    end if;
  end loop;
end;
$$;
commit;
