-- Close remaining report joins and booking recalculation readers over voided
-- duplicate receipts. Historical/audit receipt readers continue to expose the
-- original rows and their void metadata.
begin;

do $$
declare
  v_signature text;
  v_alias integer;
  v_plain integer;
  v_left integer;
  v_definition text;
  v_before text;
  v_alias_pattern text := 'from[[:space:]]+public\.payments[[:space:]]+p([[:space:]]|$)';
  v_plain_pattern text := 'from[[:space:]]+public\.payments([[:space:]]|$)';
  v_left_alias_pattern text := 'left[[:space:]]+join[[:space:]]+public\.payments[[:space:]]+p([[:space:]]|$)';
  v_left_plain_pattern text := 'left[[:space:]]+join[[:space:]]+public\.payments([[:space:]]|$)';
  v_actual integer;
begin
  for v_signature, v_alias, v_plain, v_left in
    select * from (values
      ('public.app_get_admin_today()', 1, 1, 0),
      ('public.app_get_revenue_by_method(integer)', 0, 1, 0),
      ('public.app_get_revenue_summary(integer)', 0, 1, 0),
      ('public.get_booking_register_report(uuid,date,date)', 1, 0, 0),
      ('public.get_financial_exception_report(uuid,date,date)', 2, 0, 0),
      ('public.get_reconciliation_controls_report(uuid,date,date)', 5, 0, 0),
      ('public.get_reports_snapshot_before_refund_fee_fix(uuid,date)', 0, 6, 0),
      ('public.get_revenue_report_before_refund_fee_fix(uuid,date,date)', 1, 0, 0),
      ('public.get_financial_reconciliation_v1(uuid)', 2, 0, 1),
      ('public.get_manager_dashboard_snapshot(uuid,date)', 0, 2, 1),
      ('public.get_outstanding_balance_report(uuid,date,date)', 1, 0, 1),
      ('public.get_prepayment_matching_suggestions(uuid,integer)', 0, 0, 1),
      ('public.get_starter_basic_report(uuid,integer)', 3, 0, 1),
      ('public.run_financial_reconciliation_snapshot(uuid)', 0, 0, 1)
    ) expected(signature, alias_count, plain_count, left_count)
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Expected payment report reader is missing: %', v_signature;
    end if;
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;

    v_before := v_definition;
    v_definition := regexp_replace(v_definition, v_alias_pattern, 'from public.payment_reporting_active p\1', 'gi');
    v_actual := (length(v_before) - length(v_definition)) / (length('public.payments') - length('public.payment_reporting_active'));
    if v_actual not in (0, v_alias) then raise exception 'Unexpected aliased payment source count in %: %', v_signature, v_actual; end if;

    v_before := v_definition;
    v_definition := regexp_replace(v_definition, v_plain_pattern, 'from public.payment_reporting_active\1', 'gi');
    v_actual := (length(v_before) - length(v_definition)) / (length('public.payments') - length('public.payment_reporting_active'));
    if v_actual not in (0, v_plain) then raise exception 'Unexpected unaliased payment source count in %: %', v_signature, v_actual; end if;

    v_before := v_definition;
    v_definition := regexp_replace(v_definition, v_left_alias_pattern, 'left join public.payment_reporting_active p\1', 'gi');
    v_actual := (length(v_before) - length(v_definition)) / (length('public.payments') - length('public.payment_reporting_active'));
    if v_actual not in (0, v_left) then raise exception 'Unexpected left-joined payment source count in %: %', v_signature, v_actual; end if;
    execute v_definition;
  end loop;
end;
$$;

do $$
declare
  v_signature text;
  v_definition text;
  v_before text;
  v_actual integer;
begin
  for v_signature in select unnest(array[
    'public.reschedule_booking(uuid,uuid,uuid,date,date,text,text,text,boolean,numeric,timestamp with time zone,uuid)',
    'public.apply_customer_credit_to_booking(uuid,uuid,uuid,numeric,text,text,uuid,timestamp with time zone)',
    'public.reverse_customer_credit_entry(uuid,uuid,text,text,uuid)'
  ])
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Expected booking recalculation routine is missing: %', v_signature;
    end if;
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    v_before := v_definition;
    v_definition := regexp_replace(v_definition, 'from[[:space:]]+public\.payments([[:space:]]|$)', 'from public.payment_reporting_active\1', 'gi');
    v_actual := (length(v_before) - length(v_definition)) / (length('public.payments') - length('public.payment_reporting_active'));
    if v_actual = 0 then raise exception 'No payment aggregation was rewritten in %', v_signature; end if;
    execute v_definition;
  end loop;
end;
$$;

do $$
declare
  v_signature text := 'public.get_event_booking_details(uuid,uuid)';
  v_definition text;
  v_before text;
begin
  if to_regprocedure(v_signature) is null then
    raise exception 'Expected event details reader is missing';
  end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '''recorded_by'', payment.recorded_by',
    '''recorded_by'', payment.recorded_by,
    ''voided_at'', payment.voided_at,
    ''void_reason'', payment.void_reason,
    ''voided_as_duplicate_of'', payment.voided_as_duplicate_of,
    ''voided_by'', payment.voided_by');
  if v_definition = v_before then raise exception 'Event details payment JSON did not expose void metadata'; end if;
  execute v_definition;
end;
$$;

commit;
