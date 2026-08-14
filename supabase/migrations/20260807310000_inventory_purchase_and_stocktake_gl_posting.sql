-- Complete the inventory source path: receipts and stocktake variances update
-- stock, subledger evidence, and GL atomically after Accounting activation.

begin;

alter table public.inventory_purchases
  add column if not exists tax_code text,
  add column if not exists tax_treatment text not null default 'out_of_scope',
  add column if not exists tax_amount numeric(18,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='inventory_purchases_tax_treatment_chk') then
    alter table public.inventory_purchases add constraint inventory_purchases_tax_treatment_chk
      check (tax_treatment in ('taxable','zero_rated','exempt','out_of_scope','unknown'));
  end if;
end
$$;

create or replace function public.add_inventory_purchase(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_purchase_id uuid := coalesce(nullif(payload->>'id','')::uuid, gen_random_uuid());
  v_item_id uuid := nullif(payload->>'item_id','')::uuid;
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_operation uuid := coalesce(nullif(payload->>'operation_id','')::uuid,v_purchase_id);
  v_qty numeric := coalesce(nullif(payload->>'quantity_purchased','')::numeric,0);
  v_total numeric := round(coalesce(nullif(payload->>'total_cost','')::numeric,0),2);
  v_tax numeric := round(coalesce(nullif(payload->>'tax_amount','')::numeric,0),2);
  v_unit_cost numeric := round(coalesce(nullif(payload->>'unit_cost','')::numeric,case when v_qty>0 then v_total/v_qty else 0 end),2);
  v_treatment text := lower(coalesce(nullif(btrim(payload->>'tax_treatment'),''),'out_of_scope'));
  v_actor uuid := public.app_current_user_id(); v_new_stock numeric; v_outlet_id uuid; v_outlet_stock numeric;
  v_hash text; v_existing public.inventory_purchases%rowtype; v_inv_account uuid; v_payable_account uuid; v_tax_account uuid; v_journal jsonb;
  v_business_date date := coalesce(nullif(payload->>'date','')::date,public.get_lodge_business_date(v_lodge_id));
begin
  perform public.app_require_lodge_role(v_lodge_id,array['manager','admin','super_admin']);
  if v_item_id is null or v_lodge_id is null or v_qty<=0 or v_total<0 or v_tax<0 or v_tax>v_total or v_treatment not in ('taxable','zero_rated','exempt','out_of_scope','unknown') then
    raise exception 'Inventory purchase item, lodge, quantity, total, and tax treatment are invalid' using errcode='22023';
  end if;
  if v_treatment='taxable' and v_tax<=0 then raise exception 'Taxable inventory purchases require explicit tax amount' using errcode='22023'; end if;
  if v_treatment<>'taxable' and v_tax<>0 then raise exception 'Only taxable inventory purchases may carry input tax' using errcode='22023'; end if;
  v_hash := encode(digest(jsonb_build_object('id',v_purchase_id,'lodge_id',v_lodge_id,'item_id',v_item_id,'operation_id',v_operation,'date',v_business_date,'quantity_purchased',v_qty,'total_cost',v_total,'unit_cost',v_unit_cost,'tax_amount',v_tax,'tax_treatment',v_treatment,'source_document_type',payload->>'source_document_type','source_document_id',payload->>'source_document_id','evidence_ref',payload->>'evidence_ref')::text,'sha256'),'hex');
  select * into v_existing from public.inventory_purchases where lodge_id=v_lodge_id and (id=v_purchase_id or operation_id=v_operation) for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then raise exception 'Inventory purchase retry conflicts with original payload' using errcode='23505'; end if;
    return jsonb_build_object('success',true,'id',v_existing.id,'new_stock',(select current_stock from public.inventory_items where id=v_existing.item_id and lodge_id=v_lodge_id),'idempotent',true);
  end if;
  select current_stock,outlet_id into v_new_stock,v_outlet_id from public.inventory_items where id=v_item_id and lodge_id=v_lodge_id for update;
  if not found then raise exception 'Inventory item not found' using errcode='23503'; end if;
  insert into public.inventory_purchases(id,lodge_id,item_id,date,quantity_purchased,total_cost,unit_cost,notes,operation_id,payload_hash,source_document_type,source_document_id,evidence_ref,tax_code,tax_treatment,tax_amount)
  values(v_purchase_id,v_lodge_id,v_item_id,v_business_date,v_qty,v_total,v_unit_cost,nullif(payload->>'notes',''),v_operation,v_hash,coalesce(nullif(payload->>'source_document_type',''),'inventory_purchase'),nullif(payload->>'source_document_id','')::uuid,nullif(payload->>'evidence_ref',''),nullif(payload->>'tax_code',''),v_treatment,v_tax);
  update public.inventory_items set current_stock=coalesce(current_stock,0)+v_qty,latest_unit_cost=v_unit_cost,updated_at=now() where id=v_item_id and lodge_id=v_lodge_id returning current_stock into v_new_stock;
  if v_outlet_id is not null then v_outlet_stock:=public.restaurant_apply_outlet_stock_balance(v_lodge_id,v_item_id,v_outlet_id,v_qty); end if;
  insert into public.inventory_movements(lodge_id,item_id,movement_type,quantity,unit_cost,total_cost,notes,reference_type,reference_id,source,created_by,operation_id,payload_hash,source_document_type,source_document_id,valuation_method,quantity_before,quantity_after,cost_basis,recorded_at)
  values(v_lodge_id,v_item_id,'purchase',v_qty,v_unit_cost,v_total,nullif(payload->>'notes',''),'inventory_purchase',v_purchase_id,'purchase',v_actor,v_operation,v_hash,coalesce(nullif(payload->>'source_document_type',''),'inventory_purchase'),nullif(payload->>'source_document_id','')::uuid,coalesce(nullif(payload->>'valuation_method',''),'weighted_average'),v_new_stock-v_qty,v_new_stock,v_total,now());
  if public.restaurant_accounting_is_active(v_lodge_id) then
    select m.account_id into v_inv_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=v_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=v_lodge_id and m.mapping_type='inventory' and m.source_key in (lower(coalesce(payload->>'category','')), 'default') and m.effective_from<=v_business_date and (m.effective_to is null or m.effective_to>=v_business_date) order by case when m.source_key=lower(coalesce(payload->>'category','')) then 0 else 1 end limit 1;
    select m.account_id into v_payable_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=v_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=v_lodge_id and m.mapping_type='expense_payable' and m.source_key in ('inventory_purchase','default') and m.effective_from<=v_business_date and (m.effective_to is null or m.effective_to>=v_business_date) order by case when m.source_key='inventory_purchase' then 0 else 1 end limit 1;
    if v_tax > 0 then
      select c.input_tax_account_id into v_tax_account from public.restaurant_tax_configurations c where c.lodge_id=v_lodge_id and c.effective_from<=v_business_date and (c.effective_to is null or c.effective_to>=v_business_date) order by c.effective_from desc limit 1;
    end if;
    if v_inv_account is null or v_payable_account is null or (v_tax > 0 and v_tax_account is null) then raise exception 'Inventory, inventory-payable, and effective input-tax mappings are required after Accounting activation' using errcode='23503'; end if;
    v_journal:=public._restaurant_post_journal(v_lodge_id,v_business_date,'Inventory purchase '||v_purchase_id,'inventory_purchase',v_purchase_id,null,'inventory-purchase:'||v_operation::text,
      case when v_tax > 0 then jsonb_build_array(jsonb_build_object('account_id',v_inv_account,'debit',v_total-v_tax,'credit',0,'memo','Inventory receipt ex tax'),jsonb_build_object('account_id',v_tax_account,'debit',v_tax,'credit',0,'memo','Input tax'),jsonb_build_object('account_id',v_payable_account,'debit',0,'credit',v_total,'memo','Inventory payable')) else jsonb_build_array(jsonb_build_object('account_id',v_inv_account,'debit',v_total,'credit',0,'memo','Inventory receipt'),jsonb_build_object('account_id',v_payable_account,'debit',0,'credit',v_total,'memo','Inventory payable')) end,v_actor,null);
    perform public.record_restaurant_source_posting(v_lodge_id,'inventory_purchase',v_purchase_id,v_business_date,(v_journal->'data'->>'entry_id')::uuid,v_operation,v_hash,1,v_outlet_id,'posted');
  end if;
  return jsonb_build_object('success',true,'id',v_purchase_id,'new_stock',v_new_stock,'outlet_id',v_outlet_id,'outlet_stock',v_outlet_stock,'journal_entry_id',case when v_journal is null then null else v_journal->'data'->>'entry_id' end);
end
$$;

create or replace function public.post_inventory_stocktake_session(p_stocktake_id uuid,p_lodge_id uuid,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.inventory_stocktakes%rowtype; v_line record; v_system numeric; v_counted numeric; v_cost numeric; v_variance numeric;
  v_variance_count integer:=0; v_variance_total numeric:=0; v_actor uuid:=public.app_current_user_id(); v_lines jsonb:='[]'::jsonb; v_journal jsonb; v_cogs uuid; v_inventory uuid; v_date date;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['manager','admin','super_admin']);
  select * into v_session from public.inventory_stocktakes where id=p_stocktake_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Stock take session not found' using errcode='P0002'; end if;
  if v_session.status='posted' then return jsonb_build_object('success',true,'idempotent',true,'variance_count',(select count(*) from public.inventory_stocktake_lines where stocktake_id=p_stocktake_id and lodge_id=p_lodge_id and coalesce(variance_qty,0)<>0)); end if;
  if v_session.status not in('open','draft') then raise exception 'This stock take has already been cancelled' using errcode='55000'; end if;
  v_date:=coalesce(v_session.posted_at::date,public.get_lodge_business_date(p_lodge_id));
  for v_line in select * from public.inventory_stocktake_lines where stocktake_id=p_stocktake_id and lodge_id=p_lodge_id order by item_id for update loop
    select current_stock,coalesce(latest_unit_cost,v_line.unit_cost,0) into v_system,v_cost from public.inventory_items where id=v_line.item_id and lodge_id=p_lodge_id for update;
    if not found then raise exception 'A counted inventory item no longer belongs to this restaurant' using errcode='23503'; end if;
    v_counted:=coalesce(v_line.counted_qty,v_system); if v_counted<0 then raise exception 'Counted inventory cannot be negative' using errcode='22023'; end if;
    v_variance:=round(v_counted-v_system,3);
    update public.inventory_stocktake_lines set expected_qty=v_system,counted_qty=v_counted,variance_qty=v_variance,variance_cost=round(v_variance*v_cost,2),unit_cost=v_cost,updated_at=now() where id=v_line.id;
    if v_variance<>0 then
      update public.inventory_items set current_stock=v_counted,updated_at=now() where id=v_line.item_id and lodge_id=p_lodge_id;
      insert into public.inventory_movements(lodge_id,item_id,movement_type,quantity,unit_cost,total_cost,notes,reference_type,reference_id,source,created_by,operation_id,payload_hash,source_document_type,source_document_id,valuation_method,quantity_before,quantity_after,cost_basis,recorded_at)
      values(p_lodge_id,v_line.item_id,'stocktake_adjustment',v_variance,v_cost,round(v_variance*v_cost,2),coalesce(nullif(p_notes,''),'Posted physical stocktake'),'inventory_stocktake',p_stocktake_id,'stocktake',v_actor,p_stocktake_id,encode(digest(jsonb_build_object('stocktake_id',p_stocktake_id,'line_id',v_line.id,'variance',v_variance,'cost',v_cost)::text,'sha256'),'hex'),'inventory_stocktake',p_stocktake_id,'manual_count',v_system,v_counted,abs(round(v_variance*v_cost,2)),now());
      v_variance_count:=v_variance_count+1; v_variance_total:=v_variance_total+round(v_variance*v_cost,2);
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('item_id',v_line.item_id,'variance_cost',round(v_variance*v_cost,2)));
    end if;
  end loop;
  if public.restaurant_accounting_is_active(p_lodge_id) and v_variance_count>0 then
    select m.account_id into v_cogs from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='cogs' and m.source_key='default' and m.effective_from<=v_date and (m.effective_to is null or m.effective_to>=v_date) limit 1;
    select m.account_id into v_inventory from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='inventory' and m.source_key='default' and m.effective_from<=v_date and (m.effective_to is null or m.effective_to>=v_date) limit 1;
    if v_cogs is null or v_inventory is null then raise exception 'Typed COGS and inventory mappings are required for stocktake variance posting' using errcode='23503'; end if;
    v_journal:=public._restaurant_post_journal(p_lodge_id,v_date,'Inventory stocktake '||p_stocktake_id,'inventory_stocktake',p_stocktake_id,null,'inventory-stocktake:'||p_stocktake_id::text,jsonb_build_array(jsonb_build_object('account_id',case when v_variance_total>=0 then v_inventory else v_cogs end,'debit',abs(v_variance_total),'credit',0,'memo','Stocktake variance'),jsonb_build_object('account_id',case when v_variance_total>=0 then v_cogs else v_inventory end,'debit',0,'credit',abs(v_variance_total),'memo','Stocktake variance')),v_actor,null);
    perform public.record_restaurant_source_posting(p_lodge_id,'inventory_stocktake',p_stocktake_id,v_date,(v_journal->'data'->>'entry_id')::uuid,p_stocktake_id,encode(digest(v_lines::text,'sha256'),'hex'),1,v_session.outlet_id,'posted');
  end if;
  update public.inventory_stocktakes set status='posted',notes=coalesce(nullif(p_notes,''),notes),counted_at=coalesce(counted_at,now()),posted_at=now(),updated_at=now() where id=p_stocktake_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'variance_count',v_variance_count,'variance_total',round(v_variance_total,2),'count_basis','locked_system_quantity_at_post','journal_entry_id',case when v_journal is null then null else v_journal->'data'->>'entry_id' end,'financial_source_posted',v_journal is not null or not public.restaurant_accounting_is_active(p_lodge_id));
end
$$;

commit;
