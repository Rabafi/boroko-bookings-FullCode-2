do $luna_reconciliation_contract$
declare v_reconciliation_definition text;
begin
  if to_regclass('public.financial_reconciliation_reports') is null
     or to_regclass('public.financial_validation_run_intents') is null then
    raise exception 'Immutable reconciliation report or validation run tables are missing';
  end if;
  if to_regprocedure('public.get_financial_reconciliation_v1(uuid)') is null
     or to_regprocedure('public.prepare_financial_validation_report_v1(uuid)') is null
     or to_regprocedure('public.record_financial_validation_run_v2(uuid,uuid,text,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.get_financial_validation_runs_v2(uuid,integer)') is null then
    raise exception 'Complete reconciliation or durable validation RPC signatures are missing';
  end if;
  select pg_get_functiondef('public.get_financial_reconciliation_v1(uuid)'::regprocedure) into v_reconciliation_definition;
  if position('event_booking_line_items' in v_reconciliation_definition)=0 then
    raise exception 'Complete POS folio reconciliation omits event booking charge rows';
  end if;
  if not has_function_privilege('anon', 'public.get_financial_reconciliation_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.prepare_financial_validation_report_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.record_financial_validation_run_v2(uuid,uuid,text,text,text,uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_financial_reconciliation_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.prepare_financial_validation_report_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_financial_validation_run_v2(uuid,uuid,text,text,text,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_financial_validation_run(uuid,text,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_financial_validation_run(uuid,text,uuid,jsonb)', 'EXECUTE') then
    raise exception 'Financial staff-session RPC grants permit an unsafe recorder or block the new report flow';
  end if;
  if has_table_privilege('authenticated', 'public.financial_reconciliation_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.financial_validation_run_intents', 'INSERT')
     or not exists (select 1 from pg_trigger where tgname = 'financial_validation_run_intents_immutable' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'financial_reconciliation_reports_immutable' and not tgisinternal) then
    raise exception 'Financial validation reports are writable by clients or lack immutability triggers';
  end if;
end
$luna_reconciliation_contract$;