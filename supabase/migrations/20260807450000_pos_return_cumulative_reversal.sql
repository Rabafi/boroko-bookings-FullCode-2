-- Financial truth gate 4/9: returns use cumulative difference-of-rounding for
-- tips and each original tender, and preserve the original voucher/account and
-- inventory-cost evidence.

begin;

create table if not exists public.restaurant_pos_return_tender_reversals (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  original_order_id uuid not null references public.pos_orders(id) on delete restrict,
  return_order_id uuid not null references public.pos_orders(id) on delete restrict,
  original_tender_id text not null,
  original_amount numeric(18,2) not null,
  cumulative_return_amount numeric(18,2) not null,
  previously_reversed_amount numeric(18,2) not null,
  current_reversed_amount numeric(18,2) not null,
  canonical_payload_hash text not null,
  created_at timestamptz not null default now(),
  unique(return_order_id, original_tender_id)
);
alter table public.restaurant_pos_return_tender_reversals enable row level security;
revoke all on table public.restaurant_pos_return_tender_reversals from public,anon,authenticated;
grant select,insert on table public.restaurant_pos_return_tender_reversals to service_role;

create or replace function public.restaurant_reconcile_return_cumulative()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_return public.pos_orders%rowtype;
  v_original public.pos_orders%rowtype;
  v_original_net numeric;
  v_cumulative_net numeric;
  v_previous_tip numeric;
  v_target_tip numeric;
  v_current_tip numeric;
  v_new_total numeric;
  v_original_total numeric;
  v_previous_total numeric;
  v_cumulative_total numeric;
  v_rows jsonb := '[]'::jsonb;
  v_tender jsonb;
  v_tender_id text;
  v_index integer := 0;
  v_original_tender numeric;
  v_previous_tender numeric;
  v_target_tender numeric;
  v_current_tender numeric;
  v_allocated numeric := 0;
  v_tender_count integer;
  v_hash text;
begin
  select * into v_return from public.pos_orders where id=new.return_order_id and lodge_id=new.lodge_id for update;
  if not found or coalesce(v_return.transaction_type,'')<>'return' or v_return.original_order_id is null then return new; end if;
  select * into v_original from public.pos_orders where id=v_return.original_order_id and lodge_id=v_return.lodge_id for update;
  if not found then raise exception 'Return original order was not found' using errcode='P0002'; end if;
  select coalesce(sum(coalesce(nullif(i.net_subtotal,0),nullif(i.subtotal,0),i.gross_subtotal-coalesce(i.discount_allocated,0)) ),0) into v_original_net from public.pos_order_items i where i.order_id=v_original.id and i.lodge_id=v_original.lodge_id;
  select coalesce(sum(round(rl.quantity*coalesce(nullif(oi.net_subtotal,0),nullif(oi.subtotal,0),oi.gross_subtotal-coalesce(oi.discount_allocated,0))/nullif(oi.quantity,0),2)),0) into v_cumulative_net from public.pos_return_lines rl join public.pos_order_items oi on oi.id=rl.original_order_item_id and oi.lodge_id=rl.lodge_id where rl.original_order_id=v_original.id and rl.lodge_id=v_original.lodge_id;
  if v_original_net<=0 or v_cumulative_net<=0 then return new; end if;
  if v_cumulative_net>v_original_net then raise exception 'Returned quantity or value exceeds the original sale' using errcode='23514'; end if;
  select coalesce(sum(abs(r.tip_total)),0) into v_previous_tip from public.pos_orders r where r.lodge_id=v_return.lodge_id and r.original_order_id=v_original.id and r.id<>v_return.id and coalesce(r.transaction_type,'')='return' and r.status not in('voided','cancelled');
  v_target_tip:=round(abs(coalesce(v_original.tip_total,0))*least(v_cumulative_net,v_original_net)/v_original_net,2);
  v_current_tip:=greatest(0,round(v_target_tip-v_previous_tip,2));
  v_new_total:=-round(greatest(0,abs(v_return.total)-abs(coalesce(v_return.tip_total,0))+v_current_tip),2);
  v_original_total:=abs(coalesce(v_original.total,0));
  select coalesce(sum(abs(r.total)),0) into v_previous_total from public.pos_orders r where r.lodge_id=v_return.lodge_id and r.original_order_id=v_original.id and r.id<>v_return.id and coalesce(r.transaction_type,'')='return' and r.status not in('voided','cancelled');
  v_cumulative_total:=least(v_original_total,abs(v_new_total)+v_previous_total);
  select count(*) into v_tender_count from jsonb_array_elements(case when jsonb_typeof(coalesce(v_original.payment_breakdown,'[]'::jsonb))='array' and jsonb_array_length(coalesce(v_original.payment_breakdown,'[]'::jsonb))>0 then v_original.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(v_original.payment_method,'cash'),'amount',v_original.total)) end);
  for v_tender in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(v_original.payment_breakdown,'[]'::jsonb))='array' and jsonb_array_length(coalesce(v_original.payment_breakdown,'[]'::jsonb))>0 then v_original.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(v_original.payment_method,'cash'),'amount',v_original.total)) end) loop
    v_tender_id:=coalesce(nullif(btrim(v_tender->>'tender_id'),''),v_original.id::text||':'||v_index::text);
    v_original_tender:=abs(coalesce((v_tender->>'amount')::numeric,0));
    select coalesce(sum(abs((x->>'amount')::numeric)),0) into v_previous_tender from public.pos_orders r cross join lateral jsonb_array_elements(coalesce(r.payment_breakdown,'[]'::jsonb)) x where r.lodge_id=v_return.lodge_id and r.original_order_id=v_original.id and r.id<>v_return.id and coalesce(r.transaction_type,'')='return' and r.status not in('voided','cancelled') and coalesce(nullif(x->>'tender_id',''),v_original.id::text||':'||v_index::text)=v_tender_id;
    if v_index=v_tender_count-1 then v_current_tender:=greatest(0,round(v_cumulative_total-v_previous_total-v_allocated,2)); else v_target_tender:=round(v_original_tender*v_cumulative_total/nullif(v_original_total,0),2); v_current_tender:=greatest(0,round(v_target_tender-v_previous_tender,2)); end if;
    v_allocated:=v_allocated+v_current_tender;
    v_hash:=encode(digest(jsonb_build_object('return_order_id',v_return.id,'original_tender_id',v_tender_id,'cumulative_return_amount',v_cumulative_total,'previously_reversed',v_previous_tender,'current_reversed',v_current_tender)::text,'sha256'),'hex');
    insert into public.restaurant_pos_return_tender_reversals(lodge_id,original_order_id,return_order_id,original_tender_id,original_amount,cumulative_return_amount,previously_reversed_amount,current_reversed_amount,canonical_payload_hash) values(v_return.lodge_id,v_original.id,v_return.id,v_tender_id,v_original_tender,v_cumulative_total,v_previous_tender,v_current_tender,v_hash) on conflict(return_order_id,original_tender_id) do update set cumulative_return_amount=excluded.cumulative_return_amount,previously_reversed_amount=excluded.previously_reversed_amount,current_reversed_amount=excluded.current_reversed_amount,canonical_payload_hash=excluded.canonical_payload_hash;
    v_rows:=v_rows||jsonb_build_array((v_tender-'amount')||jsonb_build_object('tender_id',v_tender_id,'tender_index',v_index,'amount',-v_current_tender));
    v_index:=v_index+1;
  end loop;
  update public.pos_orders set tip_total=-v_current_tip,total=v_new_total,payment_breakdown=v_rows where id=v_return.id and lodge_id=v_return.lodge_id;
  return new;
end
$$;

-- Remove the old account/voucher effect before a cumulative correction is
-- applied; the 4400 after-update trigger then posts the corrected allocation.
create or replace function public.restaurant_prepare_return_tender_correction()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_amount numeric; v_customer uuid; v_voucher uuid;
begin
  if coalesce(old.transaction_type,'')<>'return' or old.payment_breakdown is not distinct from new.payment_breakdown then return new; end if;
  select coalesce(sum(amount),0),max(customer_id) into v_amount,v_customer from public.restaurant_account_ledger where lodge_id=old.lodge_id and order_id=old.id;
  if v_customer is not null then update public.restaurant_customers set total_spent=greatest(0,total_spent-v_amount),updated_at=now() where id=v_customer and lodge_id=old.lodge_id; end if;
  delete from public.restaurant_account_ledger where lodge_id=old.lodge_id and order_id=old.id;
  select coalesce(sum(amount),0),max(voucher_id) into v_amount,v_voucher from public.restaurant_voucher_ledger where lodge_id=old.lodge_id and order_id=old.id;
  if v_voucher is not null then update public.restaurant_vouchers set remaining_value=least(initial_value,remaining_value-v_amount),status=case when remaining_value-v_amount=0 then 'redeemed' else 'active' end,updated_at=now() where id=v_voucher; end if;
  delete from public.restaurant_voucher_ledger where lodge_id=old.lodge_id and order_id=old.id;
  delete from public.restaurant_pos_tender_allocations where lodge_id=old.lodge_id and order_id=old.id;
  return new;
end
$$;

drop trigger if exists trg_restaurant_pos_operational_tender_subledger on public.pos_orders;
create trigger trg_restaurant_pos_operational_tender_subledger after insert or update of payment_breakdown on public.pos_orders for each row execute function public.restaurant_post_operational_pos_tenders();
drop trigger if exists trg_restaurant_prepare_return_tender_correction on public.pos_orders;
create trigger trg_restaurant_prepare_return_tender_correction before update of payment_breakdown on public.pos_orders for each row execute function public.restaurant_prepare_return_tender_correction();
drop trigger if exists trg_restaurant_pos_return_cumulative_reversal on public.pos_return_lines;
create constraint trigger trg_restaurant_pos_return_cumulative_reversal after insert on public.pos_return_lines deferrable initially deferred for each row execute function public.restaurant_reconcile_return_cumulative();

revoke all on function public.restaurant_reconcile_return_cumulative(),public.restaurant_prepare_return_tender_correction() from public,anon,authenticated;
grant execute on function public.restaurant_reconcile_return_cumulative(),public.restaurant_prepare_return_tender_correction() to service_role;

commit;
