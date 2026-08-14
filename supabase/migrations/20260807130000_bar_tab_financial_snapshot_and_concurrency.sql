-- Open-tab financial read model and optimistic concurrency contract.
-- This is deliberately separate from the accounting activation migration so tab
-- operations remain compatible with lodges that have not enabled accounting.

begin;

alter table public.pos_tabs
  add column if not exists tab_version integer not null default 1,
  add column if not exists financial_snapshot jsonb not null default '{}'::jsonb;

alter table public.pos_tab_split_operations
  add column if not exists payload_hash text,
  add column if not exists source_tab_version integer;

create index if not exists pos_tabs_lodge_updated_version_idx
  on public.pos_tabs(lodge_id, updated_at desc, id, tab_version);

create or replace function public.get_restaurant_pos_tabs_financial_truth(
  p_lodge_id uuid, p_outlet_id uuid default null, p_status text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if p_lodge_id is null or not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_outlet_id is not null then perform public.app_require_pos_outlet_access(p_lodge_id,p_outlet_id); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id),'[]'::jsonb) into v_rows
    from (
      select t.*,s.subtotal,s.discount_total,s.tax_total,s.tip_total,s.total,s.financial_complete,t.tab_version as version,
        (s.total-s.subtotal) as adjustment_total
      from public.pos_tabs t
      left join lateral (
        select
          case when count(*) > 0 and count(*) = count(coalesce(nullif(value->>'line_subtotal','')::numeric,nullif(value->>'subtotal','')::numeric)) then round(sum(coalesce(nullif(value->>'line_subtotal','')::numeric,nullif(value->>'subtotal','')::numeric)),2) else null end subtotal,
          round(coalesce(sum(coalesce(nullif(value->>'discount','')::numeric,0)),0),2) discount_total,
          round(coalesce(sum(coalesce(nullif(value->>'tax','')::numeric,nullif(value->>'tax_amount','')::numeric,0)),0),2) tax_total,
          round(coalesce(sum(coalesce(nullif(value->>'tip','')::numeric,nullif(value->>'tip_amount','')::numeric,0)),0),2) tip_total,
          case when count(*) > 0 and count(*) = count(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric)) then round(sum(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric)),2) else null end total,
          count(*) > 0 and count(*) = count(coalesce(nullif(value->>'line_subtotal','')::numeric,nullif(value->>'subtotal','')::numeric)) and count(*) = count(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric)) financial_complete
        from jsonb_array_elements(coalesce(t.items,'[]'::jsonb))
      ) s on true
      where t.lodge_id=p_lodge_id and (p_outlet_id is null or t.outlet_id=p_outlet_id)
        and (nullif(btrim(p_status),'') is null or (lower(p_status)='active' and t.status in('open','running','ready','delivered')) or (lower(p_status)<>'active' and t.status=lower(p_status)))
    ) x;
  return jsonb_build_object('success',true,'data',v_rows,'source','server-authoritative-pos-tab-rpc','complete',coalesce((select bool_and(coalesce((row->>'financial_complete')::boolean,false)) from jsonb_array_elements(v_rows) row), jsonb_array_length(v_rows) = 0));
end
$$;

create or replace function public.upsert_pos_tab(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_id uuid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_outlet uuid:=nullif(payload->>'outlet_id','')::uuid;
  v_table text:=nullif(btrim(coalesce(payload->>'table_name','')),'');
  v_waiter_name text:=nullif(btrim(coalesce(payload->>'waiter_name','')),'');
  v_waiter_id uuid:=nullif(payload->>'waiter_id','')::uuid;
  v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid;
  v_status text:=lower(coalesce(nullif(payload->>'status',''),case when v_table is null then 'open' else 'running' end));
  v_expected integer:=nullif(payload->>'expected_version','')::integer;
  v_existing public.pos_tabs%rowtype;
  v_row public.pos_tabs%rowtype;
  v_subtotal numeric:=0;v_discount numeric:=0;v_tax numeric:=0;v_tip numeric:=0;v_total numeric:=0;v_snapshot jsonb;v_financial_complete boolean:=false;
begin
  if v_lodge is null or not public.app_lodge_access(v_lodge) then return jsonb_build_object('success',false,'error','Access denied.'); end if;
  perform public.app_require_pos_outlet_access(v_lodge,v_outlet);
  if v_status not in('open','running','ready','delivered','closed','cancelled') then v_status:=case when v_table is null then 'open' else 'running' end; end if;
  if v_status in('open','running','ready','delivered') and (v_waiter_id is null or v_waiter_name is null or v_shift_id is null) then return jsonb_build_object('success',false,'error','Unlock Till with the serving staff PIN and start their shift before holding an open check.'); end if;
  if v_status in('open','running','ready','delivered') and not exists(select 1 from public.pos_shifts s where s.id=v_shift_id and s.lodge_id=v_lodge and s.outlet_id is not distinct from v_outlet and s.cashier_id=v_waiter_id and s.status='open' and s.closed_at is null) then return jsonb_build_object('success',false,'error','The selected staff member does not have an active Till shift for this outlet.'); end if;
  select * into v_existing from public.pos_tabs where id=v_id and lodge_id=v_lodge for update;
  if found and v_expected is not null and v_existing.tab_version<>v_expected then return jsonb_build_object('success',false,'code','tab_version_conflict','error','This tab changed on another terminal. Refresh it before saving.','tab',to_jsonb(v_existing)); end if;
  if v_table is not null and v_status in('open','running','ready','delivered') and exists(select 1 from public.pos_tabs t where t.lodge_id=v_lodge and t.outlet_id is not distinct from v_outlet and lower(btrim(t.table_name))=lower(v_table) and t.status in('open','running','ready','delivered') and t.id<>v_id) then
    select * into v_existing from public.pos_tabs t where t.lodge_id=v_lodge and t.outlet_id is not distinct from v_outlet and lower(btrim(t.table_name))=lower(v_table) and t.status in('open','running','ready','delivered') and t.id<>v_id order by t.updated_at desc limit 1;
    return jsonb_build_object('success',true,'already_open',true,'tab',to_jsonb(v_existing));
  end if;
  select case when count(*) > 0 and count(*) = count(coalesce(nullif(value->>'line_subtotal','')::numeric,nullif(value->>'subtotal','')::numeric)) then round(sum(coalesce(nullif(value->>'line_subtotal','')::numeric,nullif(value->>'subtotal','')::numeric)),2) else null end,round(coalesce(sum(coalesce(nullif(value->>'discount','')::numeric,0)),0),2),round(coalesce(sum(coalesce(nullif(value->>'tax','')::numeric,nullif(value->>'tax_amount','')::numeric,0)),0),2),round(coalesce(sum(coalesce(nullif(value->>'tip','')::numeric,nullif(value->>'tip_amount','')::numeric,0)),0),2),case when count(*) > 0 and count(*) = count(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric)) then round(sum(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric)),2) else null end into v_subtotal,v_discount,v_tax,v_tip,v_total from jsonb_array_elements(coalesce(payload->'items','[]'::jsonb));
  v_financial_complete:=v_subtotal is not null and v_total is not null;
  v_snapshot:=jsonb_build_object('subtotal',v_subtotal,'discount_total',v_discount,'tax_total',v_tax,'tip_total',v_tip,'total',v_total,'financial_complete',v_financial_complete,'calculated_at',now());
  insert into public.pos_tabs(id,lodge_id,outlet_id,table_name,tab_name,customer_name,waiter_name,waiter_id,shift_id,room_id,booking_id,items,notes,status,opened_by,opened_by_name,created_at,updated_at,closed_at,tab_version,financial_snapshot)
  values(v_id,v_lodge,v_outlet,v_table,nullif(btrim(coalesce(payload->>'tab_name','')),''),nullif(btrim(coalesce(payload->>'customer_name','')), ''),v_waiter_name,v_waiter_id,v_shift_id,nullif(payload->>'room_id','')::uuid,nullif(payload->>'booking_id','')::uuid,coalesce(payload->'items','[]'::jsonb),nullif(payload->>'notes',''),v_status,coalesce(nullif(payload->>'opened_by','')::uuid,public.app_current_user_id()),nullif(payload->>'opened_by_name',''),coalesce(nullif(payload->>'created_at','')::timestamptz,now()),now(),case when v_status in('closed','cancelled') then now() else null end,1,v_snapshot)
  on conflict(id) do update set outlet_id=excluded.outlet_id,table_name=excluded.table_name,tab_name=excluded.tab_name,customer_name=excluded.customer_name,waiter_name=excluded.waiter_name,waiter_id=excluded.waiter_id,shift_id=excluded.shift_id,room_id=excluded.room_id,booking_id=excluded.booking_id,items=excluded.items,notes=excluded.notes,status=excluded.status,updated_at=now(),closed_at=excluded.closed_at,tab_version=public.pos_tabs.tab_version+1,financial_snapshot=excluded.financial_snapshot
  returning * into v_row;
  insert into public.pos_audit_log(lodge_id,outlet_id,actor_id,action,entity_type,entity_id,after_snapshot) values(v_lodge,v_outlet,public.app_current_user_id(),'tab_saved','pos_tab',v_row.id,to_jsonb(v_row));
  return jsonb_build_object('success',true,'tab',to_jsonb(v_row));
end
$$;

create or replace function public.update_pos_tab_status(p_tab_id uuid,p_status text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pos_tabs%rowtype; v_status text:=lower(coalesce(nullif(p_status,''),'closed'));
begin
  if v_status not in('open','running','ready','delivered','closed','cancelled') then v_status:='closed'; end if;
  update public.pos_tabs set status=v_status,notes=coalesce(p_notes,notes),updated_at=now(),closed_at=case when v_status in('closed','cancelled') then now() else closed_at end,tab_version=tab_version+1 where id=p_tab_id and public.app_lodge_access(lodge_id) returning * into v_row;
  if v_row.id is null then return jsonb_build_object('success',false,'error','Open table tab not found.'); end if;
  return jsonb_build_object('success',true,'tab',to_jsonb(v_row));
end
$$;

create or replace function public.split_pos_tab_evenly(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_source_id uuid:=nullif(payload->>'source_tab_id','')::uuid;v_key uuid:=nullif(payload->>'idempotency_key','')::uuid;v_count integer:=coalesce(nullif(payload->>'split_count','')::integer,0);v_source public.pos_tabs%rowtype;v_existing record;v_hash text;v_total numeric:=0;v_missing_line_amount boolean:=false;v_base numeric;v_remainder numeric;v_share numeric;v_tabs jsonb:='[]'::jsonb;v_line jsonb;v_target public.pos_tabs%rowtype;v_name text;v_i integer;v_response jsonb;
begin
  if v_source_id is null or v_key is null or v_count not between 2 and 10 then return jsonb_build_object('success',false,'error','Source tab, operation key, and split count 2-10 are required.'); end if;
  v_hash:=encode(digest(payload::text,'sha256'),'hex');
  select * into v_existing from public.pos_tab_split_operations where lodge_id=(select lodge_id from public.pos_tabs where id=v_source_id) and idempotency_key=v_key for update;
  if found then if v_existing.payload_hash is distinct from v_hash then raise exception 'Split operation key conflicts with a different payload' using errcode='22000'; end if; return v_existing.response||jsonb_build_object('replayed',true); end if;
  select * into v_source from public.pos_tabs where id=v_source_id for update;
  if not found or v_source.status not in('open','running','ready','delivered') then return jsonb_build_object('success',false,'error','Only an open tab can be split.'); end if;
  perform public.app_require_lodge_role(v_source.lodge_id,array['cashier','supervisor','manager','admin','super_admin']); perform public.app_require_pos_outlet_access(v_source.lodge_id,v_source.outlet_id);
  if payload ? 'source_tab_version' and v_source.tab_version<>nullif(payload->>'source_tab_version','')::integer then return jsonb_build_object('success',false,'code','tab_version_conflict','error','This tab changed on another terminal. Refresh it before splitting.','tab',to_jsonb(v_source)); end if;
  if exists(select 1 from public.pos_payments where tab_id=v_source.id and lodge_id=v_source.lodge_id and status='completed') then return jsonb_build_object('success',false,'error','This tab has already received payments. Void the payment before splitting.'); end if;
  select coalesce(sum(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric)),0), coalesce(bool_or(coalesce(nullif(value->>'line_total','')::numeric,nullif(value->>'total','')::numeric) is null),false) into v_total, v_missing_line_amount from jsonb_array_elements(coalesce(v_source.items,'[]'::jsonb));
  if v_missing_line_amount then return jsonb_build_object('success',false,'error','This tab has an unrecorded line amount. Refresh the server-confirmed check before splitting.'); end if;
  if v_total<=0 then return jsonb_build_object('success',false,'error','No billable items to split.'); end if;
  v_base:=trunc(v_total/v_count,2);v_remainder:=round(v_total-(v_base*v_count),2);
  for v_i in 0..v_count-1 loop
    v_share:=case when v_i=v_count-1 then v_base+v_remainder else v_base end;v_name:=nullif(btrim(coalesce(payload->'target_table_names'->>v_i,'')),'');v_line:=jsonb_build_array(jsonb_build_object('item_name',format('Bill split %s/%s',v_i+1,v_count),'quantity',1,'unit_price',v_share,'line_subtotal',v_share,'line_total',v_share,'category','split_adjustment'));
    if v_name is not null then select * into v_target from public.pos_tabs where lodge_id=v_source.lodge_id and outlet_id is not distinct from v_source.outlet_id and lower(btrim(table_name))=lower(v_name) and status in('open','running','ready','delivered') for update; else v_target.id:=null; end if;
    if v_target.id is not null then update public.pos_tabs set items=coalesce(items,'[]'::jsonb)||v_line,notes=concat_ws(E'\n',notes,format('Even split %s/%s from %s',v_i+1,v_count,coalesce(v_source.table_name,v_source.tab_name,'source tab'))),updated_at=now(),tab_version=tab_version+1 where id=v_target.id returning * into v_target;
    else insert into public.pos_tabs(lodge_id,outlet_id,table_name,tab_name,customer_name,waiter_name,items,notes,status,opened_by,opened_by_name,tab_version) values(v_source.lodge_id,v_source.outlet_id,v_name,coalesce(v_name,coalesce(v_source.table_name,v_source.tab_name,'Tab')||format(' (split %s of %s)',v_i+1,v_count)),v_source.customer_name,v_source.waiter_name,v_line,format('Even split %s/%s from %s',v_i+1,v_count,coalesce(v_source.table_name,v_source.tab_name,'source tab')),case when v_name is null then 'open' else 'running' end,v_source.opened_by,v_source.opened_by_name,1) returning * into v_target; end if;
    v_tabs:=v_tabs||jsonb_build_array(to_jsonb(v_target));
  end loop;
  update public.pos_tabs set items='[]'::jsonb,notes=concat_ws(E'\n',notes,format('Split evenly %s ways',v_count)),status='closed',closed_at=now(),updated_at=now(),tab_version=tab_version+1 where id=v_source.id returning * into v_source;
  v_response:=jsonb_build_object('success',true,'source_tab',to_jsonb(v_source),'new_tabs',v_tabs,'source','server-authoritative-tab-split');
  insert into public.pos_tab_split_operations(lodge_id,source_tab_id,idempotency_key,payload_hash,source_tab_version,response) values(v_source.lodge_id,v_source.id,v_key,v_hash,v_source.tab_version,v_response);
  insert into public.pos_audit_log(lodge_id,outlet_id,actor_id,action,entity_type,entity_id,before_snapshot,after_snapshot,idempotency_key) values(v_source.lodge_id,v_source.outlet_id,auth.uid(),'pos_bill_split_evenly','pos_tab',v_source.id,jsonb_build_object('split_count',v_count,'total_amount',v_total,'source_items',v_source.items,'source_version',v_source.tab_version-1),v_response,v_key::text);
  return v_response;
end
$$;

revoke all on function public.get_restaurant_pos_tabs_financial_truth(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_restaurant_pos_tabs_financial_truth(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.upsert_pos_tab(jsonb) to anon,authenticated,service_role;
grant execute on function public.update_pos_tab_status(uuid,text,text) to anon,authenticated,service_role;
grant execute on function public.split_pos_tab_evenly(jsonb) to authenticated,service_role;

commit;
