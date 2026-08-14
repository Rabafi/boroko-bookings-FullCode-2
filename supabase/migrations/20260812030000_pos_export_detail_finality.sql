-- POS export finality.
--
-- The previous compatibility export could certify every row and synthesize a
-- tender from payment_method + total.  This authoritative replacement keeps
-- the report-run identity and control totals, but marks the dataset
-- incomplete until posted orders have recorded/reconciled tenders, complete
-- amount fields, and persisted line amounts.

begin;

create or replace function public.get_pos_financial_report_export_v2(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_timezone text;
  v_run uuid := gen_random_uuid();
  v_cutoff timestamptz := clock_timestamp();
  v_rows jsonb;
  v_count bigint;
  v_controls jsonb;
  v_hash text;
  v_unknown_count bigint := 0;
  v_amount_gap_count bigint := 0;
  v_tender_gap_count bigint := 0;
  v_item_gap_count bigint := 0;
  v_complete boolean := false;
  v_dataset_status text;
begin
  begin
    v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'pos.view');
  exception when insufficient_privilege then
    v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'reports.view');
  end;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Valid POS report dates are required' using errcode = '22023';
  end if;
  if p_end_date - p_start_date > 366 then
    raise exception 'POS reporting range cannot exceed 367 days';
  end if;
  if p_outlet_id is not null and not exists (select 1 from public.outlets where id = p_outlet_id and lodge_id = p_lodge_id) then
    raise exception 'Outlet does not belong to the lodge' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Gaborone') into v_timezone
    from public.settings s where s.lodge_id = p_lodge_id limit 1;
  v_timezone := coalesce(v_timezone, 'Africa/Gaborone');

  with filtered as (
    select po.*, coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) as report_business_date
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  ), classified as (
    select f.*,
      case
        when lower(coalesce(f.status, '')) in ('pending', 'failed', 'manual_review_required') then 'failed/manual review'
        when lower(coalesce(f.status, '')) = 'cancelled' or lower(coalesce(f.transaction_type, '')) = 'cancelled' then 'cancelled'
        when lower(coalesce(f.status, '')) = 'voided' or lower(coalesce(f.transaction_type, '')) = 'void' then 'void'
        when lower(coalesce(f.transaction_type, 'sale')) = 'return' or f.total < 0 then 'return'
        when lower(coalesce(f.status, '')) in ('completed', 'settled') then 'sale'
        else 'failed/manual review'
      end as report_classification
    from filtered f
  ), quality as (
    select c.*,
      (c.report_classification in ('sale', 'return') and c.total is not null and c.gross_total is not null and c.discount_total is not null and c.tax_total is not null and c.tip_total is not null) as amount_complete,
      (c.report_classification not in ('sale', 'return') or (
        jsonb_typeof(coalesce(c.payment_breakdown, '[]'::jsonb)) = 'array'
        and jsonb_array_length(case when jsonb_typeof(coalesce(c.payment_breakdown, '[]'::jsonb)) = 'array' then c.payment_breakdown else '[]'::jsonb end) > 0
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(c.payment_breakdown, '[]'::jsonb)) = 'array' then c.payment_breakdown else '[]'::jsonb end) x(value) where nullif(btrim(x.value->>'method'), '') is null or coalesce(x.value->>'amount', '') !~ '^[-+]?[0-9]+(\.[0-9]+)?$')
        and abs(coalesce((select sum(case when x.value->>'amount' ~ '^[-+]?[0-9]+(\.[0-9]+)?$' then (x.value->>'amount')::numeric else 0 end) from jsonb_array_elements(case when jsonb_typeof(coalesce(c.payment_breakdown, '[]'::jsonb)) = 'array' then c.payment_breakdown else '[]'::jsonb end) x(value)), 0) - c.total) <= 0.005
      )) as tender_complete,
      (c.report_classification not in ('sale', 'return') or (
        exists (select 1 from public.pos_order_items i where i.order_id = c.id and i.lodge_id = p_lodge_id)
        and not exists (select 1 from public.pos_order_items i where i.order_id = c.id and i.lodge_id = p_lodge_id and (i.gross_subtotal is null or (i.net_subtotal is null and i.subtotal is null)))
      )) as item_complete
    from classified c
  )
  select count(*) filter (where report_classification = 'failed/manual review'),
         count(*) filter (where report_classification in ('sale', 'return') and not amount_complete),
         count(*) filter (where report_classification in ('sale', 'return') and not tender_complete),
         count(*) filter (where report_classification in ('sale', 'return') and not item_complete)
    into v_unknown_count, v_amount_gap_count, v_tender_gap_count, v_item_gap_count
    from quality;
  v_complete := v_unknown_count = 0 and v_amount_gap_count = 0 and v_tender_gap_count = 0 and v_item_gap_count = 0;
  v_dataset_status := case when v_complete then 'certified' else 'incomplete' end;

  with filtered as (
    select po.*, coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) as report_business_date
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  ), classified as (
    select f.*,
      case
        when lower(coalesce(f.status, '')) in ('pending', 'failed', 'manual_review_required') then 'failed/manual review'
        when lower(coalesce(f.status, '')) = 'cancelled' or lower(coalesce(f.transaction_type, '')) = 'cancelled' then 'cancelled'
        when lower(coalesce(f.status, '')) = 'voided' or lower(coalesce(f.transaction_type, '')) = 'void' then 'void'
        when lower(coalesce(f.transaction_type, 'sale')) = 'return' or f.total < 0 then 'return'
        when lower(coalesce(f.status, '')) in ('completed', 'settled') then 'sale'
        else 'failed/manual review'
      end as report_classification
    from filtered f
  ), itemized as (
    select c.*,
      coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'gross', i.gross_subtotal,
        'discount', i.discount_allocated,
        'tax', i.tax_allocated,
        'net', coalesce(i.net_subtotal, i.subtotal),
        'cost', (select sum(abs(m.total_cost)) from public.inventory_movements m where m.lodge_id = p_lodge_id and m.reference_id = c.id and m.item_id = i.inventory_item_id and m.movement_type in ('recipe_sale', 'sale', 'pos_sale', 'pos_return'))
      ) order by i.id) from public.pos_order_items i where i.order_id = c.id and i.lodge_id = p_lodge_id), '[]'::jsonb) as item_rows
    from classified c
  ), tenderized as (
    select i.*, coalesce((select jsonb_agg(t.value || jsonb_build_object(
      'tender_id', coalesce(nullif(btrim(t.value->>'tender_id'), ''), i.id::text || ':' || (t.ordinality - 1)::text),
      'tender_index', t.ordinality - 1,
      'method', lower(btrim(t.value->>'method'))
    ) order by t.ordinality) from jsonb_array_elements(case when jsonb_typeof(coalesce(i.payment_breakdown, '[]'::jsonb)) = 'array' then i.payment_breakdown else '[]'::jsonb end) with ordinality t(value, ordinality)), '[]'::jsonb) as tender_rows
    from itemized i
  )
  select coalesce(jsonb_agg((to_jsonb(t) - 'item_rows' - 'tender_rows') || jsonb_build_object(
    'business_date', t.report_business_date,
    'technical_created_at', t.created_at,
    'classification', t.report_classification,
    'items', t.item_rows,
    'tenders', t.tender_rows
  ) order by t.report_business_date, t.created_at, t.id), '[]'::jsonb), count(*) into v_rows, v_count from tenderized t;

  with dataset as (
    select * from jsonb_to_recordset(v_rows) as x(classification text, total numeric, gross_total numeric, discount_total numeric, tax_total numeric, tip_total numeric, tenders jsonb)
  ), tender_totals as (
    select lower(coalesce(t.value->>'method', 'unknown')) as method,
           sum(case when d.classification = 'return' then -abs((t.value->>'amount')::numeric) else abs((t.value->>'amount')::numeric) end) as amount
      from dataset d cross join lateral jsonb_array_elements(coalesce(d.tenders, '[]'::jsonb)) t(value)
     where d.classification in ('sale', 'return') and (t.value->>'amount') ~ '^[-+]?[0-9]+(\.[0-9]+)?$'
     group by lower(coalesce(t.value->>'method', 'unknown'))
  )
  select jsonb_build_object(
    'gross_sales', round(coalesce(sum(case when d.classification = 'sale' then d.gross_total else 0 end), 0), 2),
    'discounts', round(coalesce(sum(case when d.classification = 'sale' then d.discount_total else 0 end), 0), 2),
    'tax', round(coalesce(sum(case when d.classification = 'sale' then d.tax_total when d.classification = 'return' then -abs(d.tax_total) else 0 end), 0), 2),
    'tips', round(coalesce(sum(case when d.classification = 'sale' then d.tip_total when d.classification = 'return' then -abs(d.tip_total) else 0 end), 0), 2),
    'returns', round(coalesce(sum(case when d.classification = 'return' then abs(d.total) else 0 end), 0), 2),
    'net_recorded_sales', round(coalesce(sum(case when d.classification in ('sale', 'return') then d.total else 0 end), 0), 2),
    'completed_sale_count', count(*) filter (where d.classification = 'sale'),
    'return_count', count(*) filter (where d.classification = 'return'),
    'void_count', count(*) filter (where d.classification = 'void'),
    'cancelled_count', count(*) filter (where d.classification = 'cancelled'),
    'failed_manual_review_count', count(*) filter (where d.classification = 'failed/manual review'),
    'average_completed_sale', case when count(*) filter (where d.classification = 'sale') = 0 then 0 else round(coalesce(sum(case when d.classification = 'sale' then d.total else 0 end), 0) / count(*) filter (where d.classification = 'sale'), 2) end,
    'tender_totals', coalesce((select jsonb_object_agg(method, round(amount, 2)) from tender_totals), '{}'::jsonb)
  ) into v_controls from dataset d;
  v_hash := encode(digest(v_rows::text, 'sha256'), 'hex');

  insert into public.restaurant_report_runs(id, lodge_id, report_key, period_start, period_end, outlet_id, as_of, status, complete, source_manifest, control_totals, data_hash, generated_by, schema_version, filters, business_timezone, database_cutoff_at, row_count, dataset_status, source_coverage_status, close_state, dataset_hash)
  values(v_run, p_lodge_id, 'pos_financial_detail_v2', p_start_date, p_end_date, p_outlet_id, v_cutoff, case when v_complete then 'complete' else 'incomplete' end, v_complete,
    jsonb_build_object('orders', jsonb_build_object('row_count', v_count, 'complete', v_complete, 'source', 'pos_orders'), 'unresolved_status_rows', v_unknown_count, 'unresolved_amount_rows', v_amount_gap_count, 'unresolved_tender_rows', v_tender_gap_count, 'unresolved_item_rows', v_item_gap_count),
    v_controls, v_hash, v_actor, 'pos-financial-report-v3', jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date, 'outlet_id', p_outlet_id), v_timezone, v_cutoff, v_count, v_dataset_status, case when v_complete then 'complete' else 'incomplete' end, 'not_applicable', v_hash);

  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'schema_version', 'pos-financial-report-v3',
    'report_run_id', v_run,
    'report_type', 'pos_transaction_detail',
    'filters', jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date, 'outlet_id', p_outlet_id),
    'business_timezone', v_timezone,
    'database_cutoff_at', v_cutoff,
    'row_count', v_count,
    'control_totals', v_controls,
    'source_coverage_complete', v_complete,
    'dataset_status', v_dataset_status,
    'dataset_hash', v_hash,
    'rows', v_rows
  ));
end;
$$;

revoke all on function public.get_pos_financial_report_export_v2(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_pos_financial_report_export_v2(uuid, date, date, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
