-- Financial-truth remediation follow-up.
--
-- This is deliberately forward-only. It corrects contracts introduced by the
-- local financial-truth gate without reopening the Accounting & Payroll
-- operator grant gate. Accounting remains service-role-only until the
-- behavioral and deployment gates are satisfied.

begin;

-- Tender values are signed source data. Reject an envelope whose tender sign
-- disagrees with its authoritative order sign; accepting it makes a refund
-- indistinguishable from a cash receipt in every downstream control.
create or replace function public.guard_pos_account_voucher_tender_envelope()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_method text;
  v_tender_id text;
  v_amount numeric;
  v_i integer := 0;
  v_total numeric := 0;
  v_input jsonb;
  v_is_return boolean := coalesce(new.transaction_type,'sale')='return' or coalesce(new.total,0)<0;
begin
  if jsonb_typeof(coalesce(new.payment_breakdown,'[]'::jsonb)) <> 'array' then
    raise exception 'payment_breakdown must be an array' using errcode='22023';
  end if;
  v_input := case when jsonb_array_length(coalesce(new.payment_breakdown,'[]'::jsonb)) > 0
    then new.payment_breakdown
    else jsonb_build_array(jsonb_build_object('method',coalesce(new.payment_method,'cash'),'amount',coalesce(new.total,0)))
  end;
  for v_row in select value from jsonb_array_elements(v_input) loop
    v_method := lower(btrim(coalesce(v_row->>'method',new.payment_method,'cash')));
    v_tender_id := coalesce(nullif(btrim(coalesce(v_row->>'tender_id',v_row->>'id','')),''),new.id::text||':'||v_i::text);
    v_amount := round(coalesce(nullif(v_row->>'amount','')::numeric,0),2);
    if v_amount = 0 then raise exception 'POS tender amount must be non-zero' using errcode='22023'; end if;
    if (v_is_return and v_amount > 0) or (not v_is_return and v_amount < 0) then
      raise exception 'Tender signs must match the authoritative POS order sign' using errcode='23514';
    end if;
    if exists(select 1 from jsonb_array_elements(v_rows) x where x->>'tender_id'=v_tender_id) then
      raise exception 'Duplicate tender_id in payment_breakdown' using errcode='23505';
    end if;
    if v_method='account' and nullif(btrim(v_row->>'customer_id'),'') is null then
      raise exception 'Account tender requires customer_id' using errcode='22023';
    end if;
    if v_method='voucher' and nullif(btrim(coalesce(v_row->>'voucher_id',v_row->>'code','')),'') is null then
      raise exception 'Voucher tender requires voucher_id or code' using errcode='22023';
    end if;
    if v_method='voucher' and exists(select 1 from jsonb_array_elements(v_rows) x where lower(coalesce(x->>'method',''))='voucher' and coalesce(nullif(x->>'voucher_id',''),nullif(x->>'code',''))=coalesce(nullif(v_row->>'voucher_id',''),nullif(v_row->>'code',''))) then
      raise exception 'Duplicate voucher tender rows are not supported' using errcode='23505';
    end if;
    v_total := v_total + v_amount;
    v_rows := v_rows || jsonb_build_array(v_row||jsonb_build_object('tender_id',v_tender_id,'tender_index',v_i,'method',v_method,'amount',v_amount));
    v_i := v_i + 1;
  end loop;
  if v_i = 0 or round(v_total-coalesce(new.total,0),2) <> 0 then
    raise exception 'Tender allocations must equal the signed authoritative order total' using errcode='23514';
  end if;
  new.payment_breakdown := v_rows;
  return new;
end
$$;

drop trigger if exists trg_guard_pos_account_voucher_tender_envelope on public.pos_orders;
create trigger trg_guard_pos_account_voucher_tender_envelope
before insert or update of payment_method,payment_breakdown,total,transaction_type on public.pos_orders
for each row execute function public.guard_pos_account_voucher_tender_envelope();

-- The optional Accounting GL is the only account/voucher writer while it is
-- active. Outside Accounting, this operational subledger is authoritative.
-- That division eliminates competing writers and makes retries idempotent.
create or replace function public.restaurant_post_operational_pos_tenders()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_tender jsonb;
  v_method text;
  v_amount numeric;
  v_is_return boolean := coalesce(new.transaction_type,'sale')='return' or new.total<0;
  v_customer public.restaurant_customers%rowtype;
  v_voucher public.restaurant_vouchers%rowtype;
  v_balance numeric;
  v_remaining numeric;
  v_tender_id text;
  v_index integer;
  v_hash text;
  v_alloc_amount numeric;
  v_existing_hash text;
begin
  if public.restaurant_accounting_is_active(new.lodge_id) then return new; end if;
  for v_tender in select value from jsonb_array_elements(coalesce(new.payment_breakdown,'[]'::jsonb)) loop
    v_method := lower(btrim(coalesce(v_tender->>'method',new.payment_method,'cash')));
    if v_method not in ('account','voucher') then continue; end if;
    v_tender_id := coalesce(nullif(btrim(v_tender->>'tender_id'),''),new.id::text||':'||coalesce(v_tender->>'tender_index','0'));
    v_index := coalesce(nullif(v_tender->>'tender_index','')::integer,0);
    v_amount := round(abs(coalesce((v_tender->>'amount')::numeric,0)),2);
    if v_amount=0 then raise exception 'POS tender amount must be non-zero' using errcode='22023'; end if;
    v_hash := encode(digest((v_tender||jsonb_build_object('order_id',new.id,'tender_id',v_tender_id))::text,'sha256'),'hex');
    select canonical_payload_hash into v_existing_hash from public.restaurant_pos_tender_allocations
     where lodge_id=new.lodge_id and order_id=new.id and tender_id=v_tender_id for update;
    if found then
      if v_existing_hash is distinct from v_hash then raise exception 'Tender retry conflicts with a different payload' using errcode='22000'; end if;
      continue;
    end if;
    if v_method='account' then
      perform public.app_require_feature(new.lodge_id,'customer_accounts',array['cashier','supervisor','manager','finance','admin','super_admin','owner']);
      select * into v_customer from public.restaurant_customers where id=nullif(v_tender->>'customer_id','')::uuid and lodge_id=new.lodge_id for update;
      if not found or v_customer.account_status<>'active' then raise exception 'Customer account is not active or belongs to another lodge' using errcode='42501'; end if;
      select coalesce(sum(amount),0) into v_balance from public.restaurant_account_ledger where lodge_id=new.lodge_id and customer_id=v_customer.id and reversed_at is null;
      if not v_is_return and round(v_balance+v_amount,2)>round(coalesce(v_customer.credit_limit,0),2) then raise exception 'Customer account available credit is insufficient' using errcode='55000'; end if;
      v_alloc_amount := case when v_is_return then -v_amount else v_amount end;
      insert into public.restaurant_pos_tender_allocations(lodge_id,order_id,tender_id,tender_index,method,amount,customer_id,reference,canonical_payload_hash)
      values(new.lodge_id,new.id,v_tender_id,v_index,'account',v_alloc_amount,v_customer.id,nullif(v_tender->>'reference',''),v_hash);
      insert into public.restaurant_account_ledger(lodge_id,customer_id,order_id,amount,reason,description,source_version,operation_id,payload_hash,balance_after,tender_id,tender_index,canonical_payload_hash)
      values(new.lodge_id,v_customer.id,new.id,v_alloc_amount,case when v_is_return then 'return' else 'charge' end,'POS order '||new.id,2,md5(new.id::text||':'||v_tender_id)::uuid,v_hash,v_balance+v_alloc_amount,v_tender_id,v_index,v_hash);
      update public.restaurant_customers set total_spent=greatest(0,total_spent+v_alloc_amount),updated_at=now() where id=v_customer.id;
    else
      perform public.app_require_feature(new.lodge_id,'vouchers',array['cashier','supervisor','manager','finance','admin','super_admin','owner']);
      select * into v_voucher from public.restaurant_vouchers where lodge_id=new.lodge_id and (id=nullif(v_tender->>'voucher_id','')::uuid or upper(code)=upper(nullif(v_tender->>'code',''))) for update;
      if not found then raise exception 'Voucher belongs to another lodge or does not exist' using errcode='42501'; end if;
      if v_voucher.status not in ('active','redeemed') then raise exception 'Voucher is voided or expired' using errcode='55000'; end if;
      if v_voucher.expires_at is not null and v_voucher.expires_at<now() and not v_is_return then raise exception 'Voucher has expired' using errcode='55000'; end if;
      select coalesce(sum(amount),0) into v_remaining from public.restaurant_voucher_ledger where lodge_id=new.lodge_id and voucher_id=v_voucher.id;
      v_remaining := v_voucher.initial_value+v_remaining;
      if not v_is_return and v_amount>v_remaining then raise exception 'Voucher balance is insufficient' using errcode='55000'; end if;
      if v_is_return and v_remaining+v_amount>v_voucher.initial_value then raise exception 'Voucher return exceeds original issued value' using errcode='23514'; end if;
      v_alloc_amount := case when v_is_return then v_amount else -v_amount end;
      insert into public.restaurant_pos_tender_allocations(lodge_id,order_id,tender_id,tender_index,method,amount,voucher_id,reference,canonical_payload_hash)
      values(new.lodge_id,new.id,v_tender_id,v_index,'voucher',case when v_is_return then -v_amount else v_amount end,v_voucher.id,nullif(v_tender->>'reference',''),v_hash);
      insert into public.restaurant_voucher_ledger(lodge_id,voucher_id,order_id,operation_id,amount,balance_after,reason,created_by,tender_id,tender_index,canonical_payload_hash)
      values(new.lodge_id,v_voucher.id,new.id,md5(new.id::text||':'||v_tender_id)::uuid,v_alloc_amount,v_remaining+v_alloc_amount,case when v_is_return then 'return' else 'redeem' end,public.app_current_user_id(),v_tender_id,v_index,v_hash);
      update public.restaurant_vouchers set remaining_value=v_remaining+v_alloc_amount,status=case when v_remaining+v_alloc_amount=0 then 'redeemed' else 'active' end,updated_at=now() where id=v_voucher.id;
    end if;
  end loop;
  return new;
end
$$;

-- The account DTO is callable by authenticated clients, so its own definer
-- body must establish lodge membership and POS-report capability.
create or replace function public.get_restaurant_customer_account_dto(p_lodge_id uuid,p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._restaurant_require_operational_report_access(p_lodge_id,'pos.view');
  perform public.app_require_feature(p_lodge_id,'customer_accounts',array['cashier','supervisor','manager','finance','admin','super_admin','owner']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,
    'outstanding_balance',round(coalesce((select sum(l.amount) from public.restaurant_account_ledger l where l.lodge_id=p_lodge_id and l.customer_id=c.id and l.reversed_at is null),0),2),
    'credit_limit',round(coalesce(c.credit_limit,0),2),
    'available_credit',round(greatest(coalesce(c.credit_limit,0)-coalesce((select sum(l.amount) from public.restaurant_account_ledger l where l.lodge_id=p_lodge_id and l.customer_id=c.id and l.reversed_at is null),0),0),2),
    'account_status',c.account_status) order by c.name)
    from public.restaurant_customers c where c.lodge_id=p_lodge_id and (p_customer_id is null or c.id=p_customer_id)),'[]'::jsonb);
end
$$;

-- A return cannot be posted to the GL until the deferred cumulative tender
-- reconciliation has produced its final signed tender allocations.
create or replace function public.restaurant_post_pos_order_after_lines()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.pos_orders o where o.id=new.order_id and o.lodge_id=new.lodge_id and coalesce(o.transaction_type,'sale')='return')
     and not exists(select 1 from public.restaurant_pos_return_tender_reversals r where r.return_order_id=new.order_id and r.lodge_id=new.lodge_id) then
    return new;
  end if;
  perform public._restaurant_post_pos_order_to_gl_v2(new.lodge_id,new.order_id);
  return new;
end
$$;

create or replace function public.restaurant_post_reconciled_pos_return_to_gl()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(new.transaction_type,'sale')='return'
     and exists(select 1 from public.restaurant_pos_return_tender_reversals r where r.return_order_id=new.id and r.lodge_id=new.lodge_id) then
    perform public._restaurant_post_pos_order_to_gl_v2(new.lodge_id,new.id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_restaurant_post_reconciled_pos_return_to_gl on public.pos_orders;
create trigger trg_restaurant_post_reconciled_pos_return_to_gl
after update of payment_breakdown on public.pos_orders
for each row execute function public.restaurant_post_reconciled_pos_return_to_gl();

revoke all on function public.guard_pos_account_voucher_tender_envelope(),public.restaurant_post_operational_pos_tenders(),public.restaurant_post_pos_order_after_lines(),public.restaurant_post_reconciled_pos_return_to_gl() from public,anon,authenticated;
grant execute on function public.guard_pos_account_voucher_tender_envelope(),public.restaurant_post_operational_pos_tenders(),public.restaurant_post_pos_order_after_lines(),public.restaurant_post_reconciled_pos_return_to_gl() to service_role;

-- Keep the public operational report contract, but put a scoped wrapper in
-- front of the old implementation. The old function is retained as a local
-- compatibility body; the wrapper fixes signed tender controls and prevents a
-- cashier/supervisor from using a null outlet selector to read every outlet.
create or replace function public.get_pos_financial_report_export_v2_legacy(
  p_lodge_id uuid,p_start_date date,p_end_date date,p_outlet_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run uuid:=gen_random_uuid();
  v_cutoff timestamptz:=clock_timestamp();
  v_rows jsonb;
  v_count bigint;
  v_hash text;
begin
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Valid POS report dates are required' using errcode='22023'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and lodge_id=p_lodge_id) then raise exception 'Outlet does not belong to the lodge' using errcode='42501'; end if;
  with filtered as (
    select po.*,coalesce(po.business_date,(po.created_at at time zone 'Africa/Gaborone')::date) report_business_date
    from public.pos_orders po where po.lodge_id=p_lodge_id
      and coalesce(po.business_date,(po.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and (p_outlet_id is null or po.outlet_id=p_outlet_id)
  ), classified as (
    select f.*,case
      when lower(coalesce(f.status,''))='pending' then 'pending'
      when lower(coalesce(f.status,''))='cancelled' or lower(coalesce(f.transaction_type,''))='cancelled' then 'cancelled'
      when lower(coalesce(f.status,''))='voided' or lower(coalesce(f.transaction_type,''))='void' then 'void'
      when lower(coalesce(f.status,'')) in ('failed','manual_review_required') then 'failed/manual review'
      when lower(coalesce(f.transaction_type,'sale'))='return' or f.total<0 then 'return'
      when lower(coalesce(f.status,'')) in ('completed','settled','') then 'sale'
      else 'failed/manual review' end report_classification
    from filtered f
  ), itemized as (
    select c.*,coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
      'gross',coalesce(nullif(i.gross_subtotal,0),i.subtotal,0),'discount',coalesce(i.discount_allocated,0),'tax',coalesce(i.tax_allocated,0),'net',coalesce(nullif(i.net_subtotal,0),i.subtotal,0),
      'cost',coalesce((select sum(abs(m.total_cost)) from public.inventory_movements m where m.lodge_id=p_lodge_id and m.reference_id=c.id and m.item_id=i.inventory_item_id and m.movement_type in ('recipe_sale','sale','pos_sale','pos_return')),0)
    ) order by i.id) from public.pos_order_items i where i.order_id=c.id and i.lodge_id=p_lodge_id),'[]'::jsonb) item_rows
    from classified c
  ), tenderized as (
    select i.*,coalesce((select jsonb_agg(t.value||jsonb_build_object(
      'tender_id',coalesce(nullif(btrim(t.value->>'tender_id'),''),i.id::text||':'||(t.ordinality-1)::text),'tender_index',t.ordinality-1,
      'method',lower(coalesce(t.value->>'method',t.value->>'type',i.payment_method,'unknown'))
    ) order by t.ordinality) from jsonb_array_elements(case when jsonb_typeof(coalesce(i.payment_breakdown,'[]'::jsonb))='array' and jsonb_array_length(coalesce(i.payment_breakdown,'[]'::jsonb))>0 then i.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(i.payment_method,'unknown'),'amount',i.total)) end) with ordinality t(value,ordinality)),'[]'::jsonb) tender_rows
    from itemized i
  )
  select coalesce(jsonb_agg((to_jsonb(t)-'item_rows'-'tender_rows')||jsonb_build_object('business_date',t.report_business_date,'technical_created_at',t.created_at,'classification',t.report_classification,'items',t.item_rows,'tenders',t.tender_rows) order by t.report_business_date,t.created_at,t.id),'[]'::jsonb),count(*) into v_rows,v_count from tenderized t;
  v_hash:=encode(digest(v_rows::text,'sha256'),'hex');
  insert into public.restaurant_report_runs(id,lodge_id,report_key,period_start,period_end,outlet_id,as_of,status,complete,source_manifest,control_totals,data_hash,generated_by,schema_version,filters,business_timezone,database_cutoff_at,row_count,dataset_status,source_coverage_status,close_state,dataset_hash)
  values(v_run,p_lodge_id,'pos_financial_detail_v2',p_start_date,p_end_date,p_outlet_id,v_cutoff,'complete',true,jsonb_build_object('orders',jsonb_build_object('row_count',v_count,'complete',true,'source','pos_orders')),'{}'::jsonb,v_hash,public.app_current_user_id(),'pos-financial-report-v2',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'outlet_id',p_outlet_id),'Africa/Gaborone',v_cutoff,v_count,'certified','complete','not_applicable',v_hash);
  return jsonb_build_object('success',true,'data',jsonb_build_object('schema_version','pos-financial-report-v2','report_run_id',v_run,'report_type','pos_transaction_detail','filters',jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'outlet_id',p_outlet_id),'business_timezone','Africa/Gaborone','database_cutoff_at',v_cutoff,'row_count',v_count,'control_totals','{}'::jsonb,'dataset_status','certified','dataset_hash',v_hash,'rows',v_rows));
end
$$;

create or replace function public.get_pos_financial_report_export_v2(
  p_lodge_id uuid,p_start_date date,p_end_date date,p_outlet_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid;
  v_role text;
  v_response jsonb;
  v_data jsonb;
  v_controls jsonb;
begin
  begin
    v_actor := public._restaurant_require_operational_report_access(p_lodge_id,'pos.view');
  exception when insufficient_privilege then
    v_actor := public._restaurant_require_operational_report_access(p_lodge_id,'reports.view');
  end;
  select lower(role) into v_role from public.users where id=v_actor and lodge_id=p_lodge_id;
  if p_outlet_id is null and v_role in ('cashier','supervisor') then
    raise exception 'A cashier or supervisor POS export requires one assigned outlet' using errcode='42501';
  end if;
  if p_outlet_id is not null then perform public.app_require_pos_outlet_access(p_lodge_id,p_outlet_id); end if;

  v_response := public.get_pos_financial_report_export_v2_legacy(p_lodge_id,p_start_date,p_end_date,p_outlet_id);
  v_data := v_response->'data';
  with dataset as (
    select * from jsonb_to_recordset(coalesce(v_data->'rows','[]'::jsonb)) as d(
      classification text,total numeric,gross_total numeric,discount_total numeric,tax_total numeric,tip_total numeric,tenders jsonb
    )
  ), tender_totals as (
    select lower(coalesce(t.value->>'method','unknown')) method,
      sum(case when d.classification='return' then -abs(coalesce(nullif(t.value->>'amount','')::numeric,0)) else abs(coalesce(nullif(t.value->>'amount','')::numeric,0)) end) amount
    from dataset d cross join lateral jsonb_array_elements(coalesce(d.tenders,'[]'::jsonb)) t(value)
    where d.classification in ('sale','return')
    group by lower(coalesce(t.value->>'method','unknown'))
  )
  select jsonb_build_object(
    'gross_sales',round(coalesce(sum(case when classification='sale' then coalesce(nullif(gross_total,0),total,0) else 0 end),0),2),
    'discounts',round(coalesce(sum(case when classification='sale' then coalesce(discount_total,0) else 0 end),0),2),
    'tax',round(coalesce(sum(case when classification='sale' then coalesce(tax_total,0) when classification='return' then -abs(coalesce(tax_total,0)) else 0 end),0),2),
    'tips',round(coalesce(sum(case when classification='sale' then coalesce(tip_total,0) when classification='return' then -abs(coalesce(tip_total,0)) else 0 end),0),2),
    'returns',round(coalesce(sum(case when classification='return' then abs(total) else 0 end),0),2),
    'net_recorded_sales',round(coalesce(sum(case when classification in ('sale','return') then total else 0 end),0),2),
    'completed_sale_count',count(*) filter(where classification='sale'),
    'return_count',count(*) filter(where classification='return'),
    'void_count',count(*) filter(where classification='void'),
    'cancelled_count',count(*) filter(where classification='cancelled'),
    'pending_count',count(*) filter(where classification='pending'),
    'failed_manual_review_count',count(*) filter(where classification='failed/manual review'),
    'average_completed_sale',case when count(*) filter(where classification='sale')=0 then 0 else round(coalesce(sum(case when classification='sale' then total else 0 end),0)/count(*) filter(where classification='sale'),2) end,
    'tender_totals',coalesce((select jsonb_object_agg(method,round(amount,2)) from tender_totals),'{}'::jsonb)
  ) into v_controls from dataset;
  v_data := jsonb_set(v_data,'{control_totals}',v_controls,true);
  update public.restaurant_report_runs
     set control_totals=v_controls
   where id=(v_data->>'report_run_id')::uuid and lodge_id=p_lodge_id;
  return jsonb_set(v_response,'{data}',v_data,true);
end
$$;

revoke all on function public.get_pos_financial_report_export_v2(uuid,date,date,uuid) from public,anon;
grant execute on function public.get_pos_financial_report_export_v2(uuid,date,date,uuid) to authenticated,service_role;
revoke all on function public.get_pos_financial_report_export_v2_legacy(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.get_pos_financial_report_export_v2_legacy(uuid,date,date,uuid) to service_role;

-- Replace the statement runtime body rather than flattening an income
-- statement into scalar fields. Balance-sheet equity is cumulative through the
-- as-of date; the period P&L remains period-scoped and is returned as rows.
create or replace function public.get_restaurant_financial_statements_v2(
  p_lodge_id uuid,p_start_date date,p_end_date date
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_accounts jsonb;
  v_assets_rows jsonb;
  v_liability_rows jsonb;
  v_equity_rows jsonb;
  v_revenue_rows jsonb;
  v_expense_rows jsonb;
  v_revenue numeric:=0;
  v_expense numeric:=0;
  v_cumulative_revenue numeric:=0;
  v_cumulative_expense numeric:=0;
  v_assets numeric:=0;
  v_liabilities numeric:=0;
  v_stock_equity numeric:=0;
  v_total_equity numeric:=0;
  v_diff numeric:=0;
  v_active boolean:=false;
  v_unresolved bigint:=0;
  v_open_exceptions bigint:=0;
  v_cash_flow jsonb:='{}'::jsonb;
  v_cash_flow_complete boolean:=false;
  v_coverage jsonb:='{}'::jsonb;
  v_source_complete boolean:=false;
  v_close_status text:='open';
  v_period_status text;
  v_final boolean:=false;
  v_blocking jsonb:='[]'::jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Statement dates are invalid' using errcode='22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'is_active',a.is_active,
    'opening_balance',0,'historical_balance',round(case when a.account_type in('asset','expense') then coalesce(x.debit,0)-coalesce(x.credit,0) else coalesce(x.credit,0)-coalesce(x.debit,0) end,2)
  ) order by a.code),'[]'::jsonb),count(*) filter(where round(a.opening_balance,2)<>0 and d.id is null)
  into v_accounts,v_unresolved
  from public.restaurant_accounts a
  left join public.restaurant_opening_balance_dispositions d on d.account_id=a.id and d.lodge_id=p_lodge_id
  left join lateral(
    select sum(l.debit) debit,sum(l.credit) credit from public.restaurant_journal_lines l
    join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date
    where l.account_id=a.id
  ) x on true
  where a.lodge_id=p_lodge_id;

  select coalesce(jsonb_agg(x order by x->>'code') filter(where x->>'account_type'='asset'),'[]'::jsonb),
         coalesce(jsonb_agg(x order by x->>'code') filter(where x->>'account_type'='liability'),'[]'::jsonb),
         coalesce(jsonb_agg(x order by x->>'code') filter(where x->>'account_type'='equity'),'[]'::jsonb)
    into v_assets_rows,v_liability_rows,v_equity_rows from jsonb_array_elements(v_accounts) x;

  with period_rows as (
    select a.id,a.code,a.name,round(coalesce(sum(case when e.entry_date between p_start_date and p_end_date then l.credit-l.debit else 0 end),0),2) amount
    from public.restaurant_accounts a left join public.restaurant_journal_lines l on l.account_id=a.id
    left join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted
    where a.lodge_id=p_lodge_id and a.account_type='revenue' group by a.id,a.code,a.name
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'account_id',id,'code',code,'name',name,'amount',amount) order by code),'[]'::jsonb),coalesce(sum(amount),0) into v_revenue_rows,v_revenue from period_rows;
  with period_rows as (
    select a.id,a.code,a.name,round(coalesce(sum(case when e.entry_date between p_start_date and p_end_date then l.debit-l.credit else 0 end),0),2) amount
    from public.restaurant_accounts a left join public.restaurant_journal_lines l on l.account_id=a.id
    left join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted
    where a.lodge_id=p_lodge_id and a.account_type='expense' group by a.id,a.code,a.name
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'account_id',id,'code',code,'name',name,'amount',amount) order by code),'[]'::jsonb),coalesce(sum(amount),0) into v_expense_rows,v_expense from period_rows;

  select coalesce(sum(case when a.account_type='asset' then l.debit-l.credit else 0 end),0),
         coalesce(sum(case when a.account_type='liability' then l.credit-l.debit else 0 end),0),
         coalesce(sum(case when a.account_type='equity' then l.credit-l.debit else 0 end),0),
         coalesce(sum(case when a.account_type='revenue' then l.credit-l.debit else 0 end),0),
         coalesce(sum(case when a.account_type='expense' then l.debit-l.credit else 0 end),0)
    into v_assets,v_liabilities,v_stock_equity,v_cumulative_revenue,v_cumulative_expense
    from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date
    join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id;
  v_total_equity:=v_stock_equity+v_cumulative_revenue-v_cumulative_expense;
  v_diff:=round(v_assets-(v_liabilities+v_total_equity),2);
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);

  with journal_cash as(
    select e.id,sum(case when a.cash_flow_classification='cash' then l.debit-l.credit else 0 end) cash_movement,
      array_agg(distinct a.cash_flow_classification) filter(where a.cash_flow_classification<>'cash' and (l.debit<>0 or l.credit<>0)) classes
    from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id
    where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date group by e.id
  ), classified as(
    select case when cardinality(classes)=1 and classes[1] in('operating','investing','financing') then classes[1] else 'unclassified' end classification,cash_movement from journal_cash where cash_movement<>0
  ) select coalesce(jsonb_object_agg(classification,amount),'{}'::jsonb) into v_cash_flow from(select classification,round(sum(cash_movement),2) amount from classified group by classification) q;
  v_cash_flow_complete:=not(v_cash_flow ? 'unclassified');

  select public.get_restaurant_financial_source_coverage_v2(p_lodge_id,p_start_date,p_end_date) into v_coverage;
  v_source_complete:=coalesce((v_coverage->'data'->>'complete')::boolean,false);
  select coalesce((select c.status from public.restaurant_accounting_period_closes c where c.lodge_id=p_lodge_id and c.period_start=p_start_date and c.period_end=p_end_date limit 1),'open') into v_close_status;
  select count(*) into v_open_exceptions from public.restaurant_reconciliation_exceptions e where e.lodge_id=p_lodge_id and e.status in('open','investigating') and e.severity='blocking';
  if v_unresolved>0 then v_blocking:=v_blocking||jsonb_build_array('unresolved_scalar_opening_balances'); end if;
  if not v_active then v_blocking:=v_blocking||jsonb_build_array('accounting_not_active'); end if;
  if not v_source_complete then v_blocking:=v_blocking||jsonb_build_array('source_coverage_incomplete'); end if;
  if v_diff<>0 then v_blocking:=v_blocking||jsonb_build_array('balance_sheet_difference'); end if;
  if not v_cash_flow_complete then v_blocking:=v_blocking||jsonb_build_array('cash_flow_unclassified'); end if;
  if v_open_exceptions>0 then v_blocking:=v_blocking||jsonb_build_array('blocking_reconciliation_exceptions'); end if;
  if v_close_status<>'closed' then v_blocking:=v_blocking||jsonb_build_array('period_not_closed'); end if;
  v_period_status:=case when not v_active then 'not_active' when v_close_status='closed' then 'closed' else 'draft_unclosed' end;
  v_final:=v_active and v_source_complete and v_diff=0 and v_cash_flow_complete and v_close_status='closed' and v_open_exceptions=0 and v_unresolved=0;

  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'schema_version','financial-statements-v5','period_start',p_start_date,'period_end',p_end_date,'accounts',v_accounts,
    'income_statement',jsonb_build_object('revenue',v_revenue_rows,'expenses',v_expense_rows,'revenue_total',round(v_revenue,2),'expense_total',round(v_expense,2),'total_revenue',round(v_revenue,2),'total_expenses',round(v_expense,2),'net_income',round(v_revenue-v_expense,2)),
    'balance_sheet',jsonb_build_object('assets',v_assets_rows,'liabilities',v_liability_rows,'equity',v_equity_rows,'assets_total',round(v_assets,2),'liabilities_total',round(v_liabilities,2),'current_period_earnings',round(v_revenue-v_expense,2),'cumulative_earnings',round(v_cumulative_revenue-v_cumulative_expense,2),'total_assets',round(v_assets,2),'total_liabilities',round(v_liabilities,2),'total_equity',round(v_total_equity,2),'liabilities_and_equity_total',round(v_liabilities+v_total_equity,2),'difference',v_diff),
    'cash_flow',v_cash_flow||jsonb_build_object('operating',coalesce((v_cash_flow->>'operating')::numeric,0),'investing',coalesce((v_cash_flow->>'investing')::numeric,0),'financing',coalesce((v_cash_flow->>'financing')::numeric,0),'unclassified',coalesce((v_cash_flow->>'unclassified')::numeric,0),'net_change',coalesce((v_cash_flow->>'operating')::numeric,0)+coalesce((v_cash_flow->>'investing')::numeric,0)+coalesce((v_cash_flow->>'financing')::numeric,0)+coalesce((v_cash_flow->>'unclassified')::numeric,0),'complete',v_cash_flow_complete),
    'dataset_complete',v_unresolved=0 and v_source_complete and v_diff=0,'source_coverage_complete',v_source_complete,'balanced',v_diff=0,'cash_flow_complete',v_cash_flow_complete,'period_status',v_period_status,'financially_final',v_final,'blocking_exceptions',v_blocking,'source_coverage',v_coverage->'data'
  ));
end
$$;

create or replace function public.get_restaurant_financial_statements_v3(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
begin return public.get_restaurant_financial_statements_v2(p_lodge_id,p_start_date,p_end_date); end
$$;

revoke all on function public.get_restaurant_financial_statements_v2(uuid,date,date),public.get_restaurant_financial_statements_v3(uuid,date,date) from public,anon,authenticated;
grant execute on function public.get_restaurant_financial_statements_v2(uuid,date,date),public.get_restaurant_financial_statements_v3(uuid,date,date) to service_role;

-- Allocation capacity is recomputed after every insert while the bank row is
-- locked. A cumulative client-loop counter was being subtracted twice and
-- rejected valid split allocations.
create or replace function public.propose_bank_match_allocations_v1(
  p_lodge_id uuid,p_bank_transaction_id uuid,p_allocations jsonb,p_reason text,p_evidence jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid;
  v_tx public.restaurant_bank_transactions%rowtype;
  v_row jsonb;
  v_entry uuid;
  v_line uuid;
  v_amount numeric;
  v_available numeric;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_operation_id text;
  v_hash text;
  v_existing public.restaurant_bank_match_operations%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  v_operation_id := nullif(btrim(coalesce(p_evidence->>'operation_id','')),'');
  if v_operation_id is null then raise exception 'A stable bank allocation operation ID is required' using errcode='22023'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 or nullif(btrim(p_reason),'') is null then raise exception 'Match allocations, reason and evidence are required' using errcode='22023'; end if;
  v_hash := encode(digest(jsonb_build_object('bank_transaction_id',p_bank_transaction_id,'allocations',p_allocations,'reason',btrim(p_reason),'evidence',coalesce(p_evidence,'{}'::jsonb)-'operation_id')::text,'sha256'),'hex');
  insert into public.restaurant_bank_match_operations(lodge_id,operation_id,payload_hash,created_by) values(p_lodge_id,v_operation_id,v_hash,v_actor) on conflict(lodge_id,operation_id) do nothing;
  select * into v_existing from public.restaurant_bank_match_operations where lodge_id=p_lodge_id and operation_id=v_operation_id for update;
  if v_existing.payload_hash<>v_hash then raise exception 'Bank allocation operation ID conflicts with a different payload' using errcode='23505'; end if;
  if jsonb_array_length(coalesce(v_existing.allocation_ids,'[]'::jsonb))>0 then return jsonb_build_object('success',true,'data',jsonb_build_object('allocation_ids',v_existing.allocation_ids,'status','proposed','replayed',true)); end if;
  select * into v_tx from public.restaurant_bank_transactions where id=p_bank_transaction_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Bank transaction was not found' using errcode='P0002'; end if;
  if v_tx.is_reconciled then raise exception 'Completed bank reconciliation cannot be mutated' using errcode='55000'; end if;
  for v_row in select value from jsonb_array_elements(p_allocations) loop
    v_entry := nullif(v_row->>'journal_entry_id','')::uuid;
    v_line := nullif(v_row->>'journal_line_id','')::uuid;
    v_amount := round(coalesce((v_row->>'allocated_amount')::numeric,0),2);
    if v_entry is null or v_amount<=0 then raise exception 'Allocation journal evidence is invalid' using errcode='23503'; end if;
    select e.id into v_entry from public.restaurant_journal_entries e where e.id=v_entry and e.lodge_id=p_lodge_id and e.is_posted for update;
    if not found then raise exception 'Allocation journal evidence is invalid' using errcode='23503'; end if;
    if v_line is not null and not exists(select 1 from public.restaurant_journal_lines l where l.id=v_line and l.entry_id=v_entry) then raise exception 'Allocation journal line does not belong to the journal entry' using errcode='23503'; end if;
    select greatest(
      case when v_line is not null then abs(coalesce((select l.debit-l.credit from public.restaurant_journal_lines l where l.id=v_line),0))
        else greatest(coalesce((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=v_entry),0),coalesce((select sum(l.credit) from public.restaurant_journal_lines l where l.entry_id=v_entry),0)) end
      - coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m where m.journal_entry_id=v_entry and m.lodge_id=p_lodge_id and m.status in('approved','proposed')),0),0) into v_available;
    if v_amount>v_available then raise exception 'Journal amount is overallocated' using errcode='23514'; end if;
    select greatest(abs(coalesce(v_tx.signed_amount,v_tx.credit-v_tx.debit))-coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m where m.bank_transaction_id=v_tx.id and m.status in('approved','proposed')),0),0) into v_available;
    if v_amount>v_available then raise exception 'Bank row is overallocated' using errcode='23514'; end if;
    insert into public.restaurant_bank_match_allocations(lodge_id,bank_transaction_id,journal_entry_id,journal_line_id,allocated_amount,proposer_id,evidence,reason)
      values(p_lodge_id,v_tx.id,v_entry,v_line,v_amount,v_actor,coalesce(p_evidence,'{}'::jsonb),btrim(p_reason)) returning id into v_id;
    v_ids := v_ids || jsonb_build_array(v_id);
  end loop;
  update public.restaurant_bank_match_operations set allocation_ids=v_ids where lodge_id=p_lodge_id and operation_id=v_operation_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('allocation_ids',v_ids,'status','proposed','replayed',false));
end
$$;

revoke all on function public.propose_bank_match_allocations_v1(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.propose_bank_match_allocations_v1(uuid,uuid,jsonb,text,jsonb) to service_role;

create or replace function public.review_bank_match_allocation_v1(p_lodge_id uuid,p_allocation_id uuid,p_approve boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_row public.restaurant_bank_match_allocations%rowtype;
  v_tx public.restaurant_bank_transactions%rowtype; v_entry public.restaurant_journal_entries%rowtype; v_capacity numeric;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_row from public.restaurant_bank_match_allocations where id=p_allocation_id and lodge_id=p_lodge_id for update;
  if not found or v_row.status<>'proposed' then raise exception 'Bank allocation is missing or already reviewed' using errcode='22023'; end if;
  if v_row.proposer_id=v_actor then raise exception 'The proposer cannot approve the same bank allocation' using errcode='42501'; end if;
  select * into v_tx from public.restaurant_bank_transactions where id=v_row.bank_transaction_id and lodge_id=p_lodge_id for update;
  if not found or v_tx.is_reconciled then raise exception 'Completed bank reconciliation cannot be mutated' using errcode='55000'; end if;
  select * into v_entry from public.restaurant_journal_entries where id=v_row.journal_entry_id and lodge_id=p_lodge_id and is_posted for update;
  if not found then raise exception 'Journal evidence is missing' using errcode='23503'; end if;
  if p_approve then
    if coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='approved'),0)+v_row.allocated_amount>abs(coalesce(v_tx.signed_amount,0)) then raise exception 'Bank row allocations exceed signed amount' using errcode='23514'; end if;
    select case when v_row.journal_line_id is not null then abs(coalesce((select l.debit-l.credit from public.restaurant_journal_lines l where l.id=v_row.journal_line_id and l.entry_id=v_entry.id),0)) else greatest(coalesce((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=v_entry.id),0),coalesce((select sum(l.credit) from public.restaurant_journal_lines l where l.entry_id=v_entry.id),0)) end into v_capacity;
    if coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where journal_entry_id=v_entry.id and status='approved'),0)+v_row.allocated_amount>v_capacity then raise exception 'Journal allocations exceed journal evidence' using errcode='23514'; end if;
  end if;
  update public.restaurant_bank_match_allocations set status=case when p_approve then 'approved' else 'rejected' end,reviewer_id=v_actor,reviewed_at=now(),reason=case when nullif(btrim(p_reason),'') is null then reason else btrim(p_reason) end where id=v_row.id;
  if p_approve and not exists(select 1 from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='proposed') and coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='approved'),0)=abs(coalesce(v_tx.signed_amount,0)) then
    update public.restaurant_bank_transactions set is_reconciled=true,reconciled_entry_id=v_entry.id where id=v_tx.id;
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status',case when p_approve then 'approved' else 'rejected' end,'reviewer_id',v_actor));
end
$$;

revoke all on function public.review_bank_match_allocation_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.review_bank_match_allocation_v1(uuid,uuid,boolean,text) to service_role;

-- Desktop POS exports create their report run through an authenticated,
-- server-authorized operation. Permit only that run's creator to record a
-- verified artifact; accounting report artifacts remain behind the no-ship
-- service-role gate.
create or replace function public.record_report_artifact_result(
  p_lodge_id uuid,p_report_run_id uuid,p_artifact_type text,p_file_path text,
  p_file_hash text,p_byte_count bigint,p_artifact_error text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.app_get_actor_user_id();
  v_status text;
  v_run public.restaurant_report_runs%rowtype;
begin
  if p_artifact_type not in ('json','csv','xlsx','pdf') then raise exception 'Unsupported artifact type' using errcode='22023'; end if;
  select * into v_run from public.restaurant_report_runs where id=p_report_run_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Report run was not found for this lodge' using errcode='P0002'; end if;
  if auth.role()<>'service_role' then
    perform public._restaurant_require_operational_report_access(p_lodge_id,'pos.view');
    if v_run.report_key<>'pos_financial_detail_v2' or v_run.generated_by is distinct from v_actor then
      raise exception 'Only the authenticated creator of a POS report run may record its artifact' using errcode='42501';
    end if;
  end if;
  v_status:=case when nullif(p_artifact_error,'') is null and p_byte_count>0 and p_file_hash~'^[0-9a-fA-F]{64}$' then 'complete' else 'failed' end;
  insert into public.restaurant_report_artifact_results(lodge_id,report_run_id,artifact_type,file_path,file_hash,byte_count,artifact_status,artifact_error,recorded_by)
  values(p_lodge_id,p_report_run_id,p_artifact_type,nullif(p_file_path,''),nullif(p_file_hash,''),greatest(coalesce(p_byte_count,0),0),v_status,nullif(p_artifact_error,''),v_actor)
  on conflict(report_run_id,artifact_type) do update set file_path=excluded.file_path,file_hash=excluded.file_hash,byte_count=excluded.byte_count,artifact_status=excluded.artifact_status,artifact_error=excluded.artifact_error,recorded_by=excluded.recorded_by,recorded_at=now();
  update public.restaurant_report_runs set artifact_status=v_status,file_hash=case when v_status='complete' then p_file_hash else null end,artifact_error=case when v_status='failed' then coalesce(nullif(p_artifact_error,''),'Artifact was not written and verified') else null end where id=p_report_run_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('report_run_id',p_report_run_id,'artifact_type',p_artifact_type,'artifact_status',v_status,'file_hash',case when v_status='complete' then p_file_hash else null end));
end
$$;

revoke all on function public.record_report_artifact_result(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.record_report_artifact_result(uuid,uuid,text,text,text,bigint,text) to authenticated,service_role;

commit;
