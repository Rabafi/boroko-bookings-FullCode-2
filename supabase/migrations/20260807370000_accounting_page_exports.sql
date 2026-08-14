-- Server-authoritative, complete export envelopes for all Accounting pages.
-- The UI may paginate/render a projection, but it must never turn that
-- projection into a statutory or financial export.  Each function captures a
-- report-run identity and hashes the canonical server payload.

begin;

create or replace function public._restaurant_complete_accounting_export(
  p_lodge_id uuid,
  p_report_key text,
  p_payload jsonb,
  p_row_count integer,
  p_complete boolean default true
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run jsonb;
  v_run_id uuid;
  v_hash text;
  v_generated_at timestamptz := now();
  v_timezone text;
  v_currency text;
  v_sections jsonb;
  v_active boolean;
  v_complete boolean := coalesce(p_complete, false);
begin
  select coalesce(nullif(s.timezone, ''), 'Africa/Gaborone'), coalesce(nullif(s.currency, ''), 'BWP')
    into v_timezone, v_currency
    from public.settings s
   where s.lodge_id = p_lodge_id;
  v_timezone := coalesce(v_timezone, 'Africa/Gaborone');
  v_currency := coalesce(v_currency, 'BWP');
  v_active := public.restaurant_accounting_is_active(p_lodge_id);
  v_complete := v_complete and v_active;
  v_hash := encode(digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex');
  v_run := public.start_restaurant_report_run(p_lodge_id, p_report_key, null, null, null);
  v_run_id := nullif(v_run->'data'->>'id', '')::uuid;
  if v_run_id is null then
    raise exception 'Accounting export report-run could not be created' using errcode='P0001';
  end if;
  v_sections := jsonb_build_object(
    'accounting', jsonb_build_object(
      'row_count', coalesce(p_row_count, 0),
      'source_name', p_report_key,
      'source_hash', v_hash,
      'complete', v_complete
    )
  );
  if v_complete then
    perform public.complete_restaurant_report_run(p_lodge_id, v_run_id, v_sections,
      jsonb_build_object('row_count', coalesce(p_row_count, 0)), v_hash);
  else
    perform public.fail_restaurant_report_run(p_lodge_id, v_run_id, 'Required Accounting source is incomplete or unreconciled');
  end if;
  return jsonb_build_object(
    'success', true,
    'data', coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'schema_version', 'financial-report-v1',
    'report_type', p_report_key,
    'parameters', jsonb_build_object('lodge_id', p_lodge_id),
    'complete', v_complete,
    'status', case when v_complete then 'complete' else 'incomplete' end,
    'report_run_id', v_run_id,
    'data_hash', v_hash,
    'dataset_hash', 'sha256:' || v_hash,
    'generated_at', v_generated_at,
    'data_cutoff', v_generated_at,
    'business_timezone', v_timezone,
    'currency', v_currency,
    'source', 'server-authoritative-accounting-export',
    'source_mode', 'server_authoritative',
    'export_version', 'bar-accounting-financial-truth-v1',
    'warnings', case when v_complete then '[]'::jsonb else jsonb_build_array(case when not v_active then 'Accounting is not activated for this lodge' else 'Required Accounting source is incomplete or unreconciled' end) end,
    'row_count', coalesce(p_row_count, 0),
    'control_totals', jsonb_build_object('row_count', coalesce(p_row_count, 0)),
    'reconciliations', jsonb_build_object('report_run', case when v_complete then 'complete' else 'incomplete' end),
    'next_cursor', null,
    'export_manifest', jsonb_build_object(
        'report_run_id', v_run_id,
        'row_count', coalesce(p_row_count, 0),
        'data_hash', v_hash,
        'completeness', case when v_complete then 'COMPLETE' else 'INCOMPLETE' end,
        'sections', v_sections
      )
    )
  );
end
$$;

create or replace function public.get_restaurant_chart_export_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_rows jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_accounts(p_lodge_id);
  v_rows := coalesce(v_read->'data', '[]'::jsonb);
  return public._restaurant_complete_accounting_export(
    p_lodge_id, 'accounting-chart-of-accounts',
    jsonb_build_object('accounts', v_rows), jsonb_array_length(v_rows), true
  );
end
$$;

create or replace function public.get_restaurant_ledger_report_export_v2(
  p_lodge_id uuid, p_start_date date default null, p_end_date date default null, p_account_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_rows jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_ledger_export_v2(p_lodge_id, p_start_date, p_end_date, p_account_id);
  v_data := coalesce(v_read->'data', v_read);
  v_rows := coalesce(v_data->'entries', '[]'::jsonb);
  return public._restaurant_complete_accounting_export(
    p_lodge_id, 'accounting-general-ledger',
    v_data || jsonb_build_object('complete', true), jsonb_array_length(v_rows), true
  );
end
$$;

create or replace function public.get_restaurant_ap_export_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_rows jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_ap_workspace_v2(p_lodge_id);
  v_data := coalesce(v_read->'data', '{}'::jsonb);
  v_rows := coalesce(v_data->'bills', '[]'::jsonb);
  return public._restaurant_complete_accounting_export(
    p_lodge_id, 'accounting-accounts-payable',
    v_data || jsonb_build_object('bills', v_rows), jsonb_array_length(v_rows), true
  );
end
$$;

create or replace function public.get_restaurant_bank_export_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_rows integer := 0;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_bank_workspace_v2(p_lodge_id, null);
  v_data := coalesce(v_read->'data', '{}'::jsonb);
  v_rows := jsonb_array_length(coalesce(v_data->'transactions', '[]'::jsonb))
    + jsonb_array_length(coalesce(v_data->'imports', '[]'::jsonb))
    + jsonb_array_length(coalesce(v_data->'reconciliations', '[]'::jsonb));
  return public._restaurant_complete_accounting_export(
    p_lodge_id, 'accounting-bank-reconciliation', v_data, v_rows, true
  );
end
$$;

create or replace function public.get_restaurant_tax_export_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_read jsonb; v_adj jsonb; v_data jsonb; v_returns jsonb; v_count integer;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_tax_working_papers_v2(p_lodge_id);
  v_adj := public.get_restaurant_tax_adjustments(p_lodge_id);
  select coalesce(jsonb_agg(
    to_jsonb(r) || jsonb_build_object(
      'allocations', coalesce((select jsonb_agg(to_jsonb(a) order by a.business_date,a.source_type,a.source_id,a.source_line_id)
        from public.restaurant_tax_detail_allocations a
       where a.tax_return_id=r.id and a.lodge_id=p_lodge_id), '[]'::jsonb)
    ) order by r.period_end desc, r.created_at desc
  ), '[]'::jsonb)
    into v_returns
    from public.restaurant_tax_returns r
   where r.lodge_id=p_lodge_id;
  v_data := jsonb_build_object(
    'configurations', coalesce(v_read->'data'->'configurations', '[]'::jsonb),
    'working_papers', coalesce(v_read->'data'->'working_papers', '[]'::jsonb),
    'filing_detail', v_returns,
    'adjustments', coalesce(v_adj->'data', '[]'::jsonb),
    'professional_review_required', true
  );
  v_count := jsonb_array_length(v_returns) + jsonb_array_length(coalesce(v_adj->'data', '[]'::jsonb));
  return public._restaurant_complete_accounting_export(p_lodge_id, 'accounting-tax', v_data, v_count, true);
end
$$;

create or replace function public.get_restaurant_budget_export_v2(p_lodge_id uuid, p_year integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_rows jsonb; v_complete boolean;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_budget_matrix_v2(p_lodge_id, p_year);
  v_data := coalesce(v_read->'data', '{}'::jsonb);
  v_rows := coalesce(v_data->'matrix', '[]'::jsonb);
  v_complete := coalesce((v_data->>'complete')::boolean, false)
    and not exists(
      select 1
        from jsonb_array_elements(v_rows) row_data
       where jsonb_object_length(coalesce(row_data->'months', '{}'::jsonb)) <> 12
    );
  return public._restaurant_complete_accounting_export(
    p_lodge_id, 'accounting-budget-' || p_year::text,
    v_data || jsonb_build_object('year', p_year, 'complete_matrix', v_complete),
    jsonb_array_length(v_rows) * 12, v_complete
  );
end
$$;

create or replace function public.get_restaurant_statements_export_v2(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_count integer; v_complete boolean;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  v_read := public.get_restaurant_financial_statements_v3(p_lodge_id, p_start_date, p_end_date);
  v_data := coalesce(v_read->'data', v_read);
  v_count := jsonb_array_length(coalesce(v_data->'income_statement'->'revenue', '[]'::jsonb))
    + jsonb_array_length(coalesce(v_data->'income_statement'->'expenses', '[]'::jsonb))
    + jsonb_array_length(coalesce(v_data->'balance_sheet'->'accounts', '[]'::jsonb))
    + jsonb_array_length(coalesce(v_data->'trial_balance', '[]'::jsonb));
  v_complete := coalesce((v_data->>'complete')::boolean, true)
    and coalesce((v_data->'cash_flow'->>'complete')::boolean, true)
    and coalesce((v_data->'balance_sheet'->>'difference')::numeric, 0) = 0;
  return public._restaurant_complete_accounting_export(
    p_lodge_id, 'accounting-statements-' || p_start_date::text || '-' || p_end_date::text,
    v_data || jsonb_build_object('period_start', p_start_date, 'period_end', p_end_date), v_count, v_complete
  );
end
$$;

create or replace function public.get_restaurant_payroll_export_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_read jsonb; v_data jsonb; v_records jsonb; v_count integer;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_view');
  v_read := public.get_restaurant_payroll_workspace_v2(p_lodge_id);
  select coalesce(jsonb_agg(to_jsonb(r) order by p.end_date desc,p.name,r.staff_name,r.id), '[]'::jsonb)
    into v_records
    from public.restaurant_employee_pay_records r
    join public.restaurant_pay_periods p on p.id=r.pay_period_id and p.lodge_id=p_lodge_id
   where r.lodge_id=p_lodge_id;
  v_data := coalesce(v_read->'data', '{}'::jsonb) || jsonb_build_object('pay_records', v_records, 'pii_export_warning', 'Contains confidential payroll data; handle as restricted evidence.');
  v_count := jsonb_array_length(coalesce(v_data->'periods', '[]'::jsonb)) + jsonb_array_length(v_records);
  return public._restaurant_complete_accounting_export(p_lodge_id, 'accounting-payroll', v_data, v_count, true);
end
$$;

revoke all on function public.get_restaurant_chart_export_v2(uuid), public.get_restaurant_ledger_report_export_v2(uuid,date,date,uuid), public.get_restaurant_ap_export_v2(uuid),
  public.get_restaurant_bank_export_v2(uuid), public.get_restaurant_tax_export_v2(uuid),
  public.get_restaurant_budget_export_v2(uuid,integer), public.get_restaurant_statements_export_v2(uuid,date,date),
  public.get_restaurant_payroll_export_v2(uuid) from public, anon;
grant execute on function public.get_restaurant_chart_export_v2(uuid), public.get_restaurant_ledger_report_export_v2(uuid,date,date,uuid), public.get_restaurant_ap_export_v2(uuid),
  public.get_restaurant_bank_export_v2(uuid), public.get_restaurant_tax_export_v2(uuid),
  public.get_restaurant_budget_export_v2(uuid,integer), public.get_restaurant_statements_export_v2(uuid,date,date),
  public.get_restaurant_payroll_export_v2(uuid) to authenticated, service_role;

commit;
