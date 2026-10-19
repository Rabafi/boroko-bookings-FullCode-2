-- Keep the legacy ledger report outside certified-complete exports until its
-- authoritative source population can be reconciled and certified.
begin;

create or replace function public.get_restaurant_ledger_export_v3(
  p_lodge_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_account_id uuid default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_read jsonb;
  v_data jsonb;
  v_filters jsonb;
  v_reasons jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.export');
  v_filters := coalesce(p_filters, '{}'::jsonb) ||
    jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date, 'account_id', p_account_id);

  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'status', 'not_active',
        'complete', false,
        'export_kind', 'ledger',
        'filters', v_filters,
        'watermark', 'ACCOUNTING NOT ACTIVE'
      )
    );
  end if;

  v_read := public.get_restaurant_ledger_report_export_v2(p_lodge_id, p_start_date, p_end_date, p_account_id);
  v_data := coalesce(v_read->'data', v_read, '{}'::jsonb);
  v_reasons := case
    when jsonb_typeof(v_data->'completeness_reasons') = 'array' then v_data->'completeness_reasons'
    else '[]'::jsonb
  end;
  v_data := v_data || jsonb_build_object(
    'complete', false,
    'dataset_status', 'blocked',
    'source_coverage_status', 'unknown',
    'certification_blocked', true,
    'completeness_reasons', v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'LEDGER_SOURCE_COVERAGE_UNKNOWN',
      'message', 'The ledger source population is not certified. Do not use this export as a complete financial record; ask the Accounting administrator to resolve source coverage before exporting.'
    ))
  );

  return public._restaurant_record_accounting_export_v3(
    p_lodge_id,
    'ledger',
    v_filters,
    v_data,
    false,
    'UNCERTIFIED / LEDGER SOURCE COVERAGE UNKNOWN',
    'unknown',
    'not_applicable'
  );
end
$function$;

commit;