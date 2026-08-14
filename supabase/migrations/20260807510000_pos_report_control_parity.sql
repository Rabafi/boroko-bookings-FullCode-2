-- Forward POS report correction.  The first generic export contract remains
-- compatible, but this version makes its server controls use the same
-- classifier, split-tender identity, business-date basis, and return signs as
-- the desktop report surface.

begin;

create or replace function public.get_pos_financial_report_export_v2(
  p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid;
  v_run uuid:=gen_random_uuid();
  v_cutoff timestamptz:=clock_timestamp();
  v_rows jsonb;
  v_count bigint;
  v_controls jsonb;
  v_hash text;
begin
  begin
    v_actor:=public._restaurant_require_operational_report_access(p_lodge_id,'pos.view');
  exception when insufficient_privilege then
    v_actor:=public._restaurant_require_operational_report_access(p_lodge_id,'reports.view');
  end;
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then
    raise exception 'Valid POS report dates are required' using errcode='22023';
  end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and lodge_id=p_lodge_id) then
    raise exception 'Outlet does not belong to the lodge' using errcode='42501';
  end if;
  with filtered as (
    select po.*,coalesce(po.business_date,(po.created_at at time zone 'Africa/Gaborone')::date) as report_business_date
    from public.pos_orders po
    where po.lodge_id=p_lodge_id
      and coalesce(po.business_date,(po.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and (p_outlet_id is null or po.outlet_id=p_outlet_id)
  ), classified as (
    select f.*,
      case
        when lower(coalesce(f.status,'')) in ('pending','failed','manual_review_required') then 'pending'
        when lower(coalesce(f.status,''))='cancelled' or lower(coalesce(f.transaction_type,''))='cancelled' then 'cancelled'
        when lower(coalesce(f.status,''))='voided' or lower(coalesce(f.transaction_type,''))='void' then 'void'
        when lower(coalesce(f.status,''))='failed' then 'failed/manual review'
        when lower(coalesce(f.transaction_type,'sale'))='return' or f.total<0 then 'return'
        when lower(coalesce(f.status,'')) in ('completed','settled','') then 'sale'
        else 'failed/manual review'
      end as report_classification
    from filtered f
  ), itemized as (
    select c.*,
      coalesce((select jsonb_agg(
        to_jsonb(i) || jsonb_build_object(
          'gross',coalesce(nullif(i.gross_subtotal,0),i.subtotal,0),
          'discount',coalesce(i.discount_allocated,0),
          'tax',coalesce(i.tax_allocated,0),
          'net',coalesce(nullif(i.net_subtotal,0),i.subtotal,0),
          'cost',coalesce((select sum(abs(m.total_cost)) from public.inventory_movements m where m.lodge_id=p_lodge_id and m.reference_id=c.id and m.item_id=i.inventory_item_id and m.movement_type in ('recipe_sale','sale','pos_sale')),0)
        ) order by i.id) from public.pos_order_items i where i.order_id=c.id and i.lodge_id=p_lodge_id),'[]'::jsonb) as item_rows
    from classified c
  ), tenderized as (
    select i.*,coalesce((select jsonb_agg(
      t.value || jsonb_build_object(
        'tender_id',coalesce(nullif(btrim(t.value->>'tender_id'),''),i.id::text||':'||(t.ordinality-1)::text),
        'tender_index',t.ordinality-1,
        'method',lower(coalesce(t.value->>'method',t.value->>'type',i.payment_method,'unknown'))
      ) order by t.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(coalesce(i.payment_breakdown,'[]'::jsonb))='array' and jsonb_array_length(coalesce(i.payment_breakdown,'[]'::jsonb))>0 then i.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(i.payment_method,'unknown'),'amount',i.total)) end) with ordinality t(value,ordinality)),'[]'::jsonb) as tender_rows
    from itemized i
  )
  select coalesce(jsonb_agg(
    (to_jsonb(t)-'item_rows'-'tender_rows') || jsonb_build_object(
      'business_date',t.report_business_date,
      'technical_created_at',t.created_at,
      'classification',t.report_classification,
      'items',t.item_rows,
      'tenders',t.tender_rows
    ) order by t.report_business_date,t.created_at,t.id),'[]'::jsonb),count(*)
    into v_rows,v_count from tenderized t;
  with dataset as (
    select * from jsonb_to_recordset(v_rows) as x(
      status text,transaction_type text,total numeric,gross_total numeric,discount_total numeric,tax_total numeric,tip_total numeric,classification text,tenders jsonb
    )
  ), tender_totals as (
    select lower(coalesce(t.value->>'method','unknown')) method,
      sum((case when d.classification='return' then -1 else 1 end)*coalesce(nullif(t.value->>'amount','')::numeric,0)) amount
    from dataset d cross join lateral jsonb_array_elements(coalesce(d.tenders,'[]'::jsonb)) t(value)
    where d.classification in ('sale','return')
    group by lower(coalesce(t.value->>'method','unknown'))
  )
  select jsonb_build_object(
    'gross_sales',round(coalesce(sum(case when d.classification='sale' then coalesce(nullif(d.gross_total,0),d.total,0) else 0 end),0),2),
    'discounts',round(coalesce(sum(case when d.classification='sale' then coalesce(d.discount_total,0) else 0 end),0),2),
    'tax',round(coalesce(sum(case when d.classification='sale' then coalesce(d.tax_total,0) when d.classification='return' then -abs(coalesce(d.tax_total,0)) else 0 end),0),2),
    'tips',round(coalesce(sum(case when d.classification='sale' then coalesce(d.tip_total,0) when d.classification='return' then -abs(coalesce(d.tip_total,0)) else 0 end),0),2),
    'returns',round(coalesce(sum(case when d.classification='return' then abs(d.total) else 0 end),0),2),
    'net_recorded_sales',round(coalesce(sum(case when d.classification in ('sale','return') then d.total else 0 end),0),2),
    'completed_sale_count',count(*) filter(where d.classification='sale'),
    'return_count',count(*) filter(where d.classification='return'),
    'void_count',count(*) filter(where d.classification='void'),
    'cancelled_count',count(*) filter(where d.classification='cancelled'),
    'pending_count',count(*) filter(where d.classification='pending'),
    'failed_manual_review_count',count(*) filter(where d.classification='failed/manual review'),
    'average_completed_sale',case when count(*) filter(where d.classification='sale')=0 then 0 else round(coalesce(sum(case when d.classification='sale' then d.total else 0 end),0)/count(*) filter(where d.classification='sale'),2) end,
    'tender_totals',coalesce((select jsonb_object_agg(method,round(amount,2)) from tender_totals),'{}'::jsonb)
  ) into v_controls from dataset d;
  v_hash:=encode(digest(v_rows::text,'sha256'),'hex');
  insert into public.restaurant_report_runs(id,lodge_id,report_key,period_start,period_end,outlet_id,as_of,status,complete,source_manifest,control_totals,data_hash,generated_by,schema_version,filters,business_timezone,database_cutoff_at,row_count,dataset_status,source_coverage_status,close_state,dataset_hash)
  values(v_run,p_lodge_id,'pos_financial_detail_v2',p_start_date,p_end_date,p_outlet_id,v_cutoff,'complete',true,jsonb_build_object('orders',jsonb_build_object('row_count',v_count,'complete',true,'source','pos_orders')) ,v_controls,v_hash,v_actor,'pos-financial-report-v2',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'outlet_id',p_outlet_id),'Africa/Gaborone',v_cutoff,v_count,'certified','complete','not_applicable',v_hash);
  return jsonb_build_object('success',true,'data',jsonb_build_object('schema_version','pos-financial-report-v2','report_run_id',v_run,'report_type','pos_transaction_detail','filters',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'outlet_id',p_outlet_id),'business_timezone','Africa/Gaborone','database_cutoff_at',v_cutoff,'row_count',v_count,'control_totals',v_controls,'dataset_status','certified','dataset_hash',v_hash,'rows',v_rows));
end
$$;

revoke all on function public.get_pos_financial_report_export_v2(uuid,date,date,uuid) from public,anon;
grant execute on function public.get_pos_financial_report_export_v2(uuid,date,date,uuid) to authenticated,service_role;

commit;
