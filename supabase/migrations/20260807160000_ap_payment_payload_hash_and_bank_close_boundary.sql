-- AP payment retries must bind every financially meaningful field, not only
-- amount/date. Bank reconciliation completion is not an accounting-period close.

begin;

alter table public.restaurant_bill_payments
  add column if not exists payment_account_id uuid references public.restaurant_accounts(id) on delete restrict,
  add column if not exists payload_hash text;

create or replace function public.record_restaurant_bill_payment_v2(
  p_lodge_id uuid,p_bill_id uuid,p_payment_date date,p_amount numeric,
  p_payment_account_id uuid,p_reference text,p_notes text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_bill public.restaurant_bills%rowtype;v_settings public.restaurant_ap_gl_settings%rowtype;v_existing public.restaurant_bill_payments%rowtype;v_payment_id uuid:=gen_random_uuid();v_result jsonb;v_entry uuid;v_hash text;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.ap_pay');
  if p_payment_date is null or coalesce(p_amount,0)<=0 or p_payment_account_id is null or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Payment date, positive amount, payment account and idempotency key are required' using errcode='22023'; end if;
  v_hash:=encode(digest(jsonb_build_object('bill_id',p_bill_id,'payment_date',p_payment_date,'amount',round(p_amount,2),'payment_account_id',p_payment_account_id,'reference',nullif(btrim(p_reference),''),'notes',nullif(btrim(p_notes),''),'idempotency_key',p_idempotency_key)::text,'sha256'),'hex');
  select * into v_existing from public.restaurant_bill_payments where lodge_id=p_lodge_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.payload_hash is null or v_existing.payload_hash<>v_hash then raise exception 'Payment idempotency key conflicts with a different or legacy payload; resolve the original payment before retrying' using errcode='22000'; end if;
    return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true));
  end if;
  select * into v_bill from public.restaurant_bills where id=p_bill_id and lodge_id=p_lodge_id for update;
  if not found or v_bill.status not in('approved','partially_paid') then raise exception 'Only approved outstanding bills are payable' using errcode='22023'; end if;
  if round(p_amount,2)>v_bill.total-v_bill.amount_paid then raise exception 'Payment exceeds outstanding balance' using errcode='23514'; end if;
  if not exists(select 1 from public.restaurant_accounts where id=p_payment_account_id and lodge_id=p_lodge_id and is_active and account_type='asset') then raise exception 'Payment account must be an active lodge asset' using errcode='23503'; end if;
  select * into v_settings from public.restaurant_ap_gl_settings where lodge_id=p_lodge_id;
  if not found then raise exception 'AP GL settings are missing' using errcode='23503'; end if;
  v_result:=public._restaurant_post_journal(p_lodge_id,p_payment_date,concat('Payment ',v_bill.bill_number),'ap_payment',v_payment_id,p_reference,concat('ap-payment:',p_idempotency_key),jsonb_build_array(jsonb_build_object('account_id',v_settings.payable_account_id,'debit',round(p_amount,2),'credit',0,'memo','Reduce payable'),jsonb_build_object('account_id',p_payment_account_id,'debit',0,'credit',round(p_amount,2),'memo','Supplier payment')),v_actor,null);
  v_entry:=(v_result->'data'->>'entry_id')::uuid;
  insert into public.restaurant_bill_payments(id,lodge_id,bill_id,payment_date,amount,payment_method,reference,notes,created_by,journal_entry_id,idempotency_key,payment_account_id,payload_hash)
  values(v_payment_id,p_lodge_id,p_bill_id,p_payment_date,round(p_amount,2),'account',nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),v_actor,v_entry,p_idempotency_key,p_payment_account_id,v_hash);
  update public.restaurant_bills set amount_paid=amount_paid+round(p_amount,2),status=case when amount_paid+round(p_amount,2)=total then 'paid' else 'partially_paid' end,updated_at=now() where id=p_bill_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'ap_payment.recorded','restaurant_bill_payments',v_payment_id,null,jsonb_build_object('bill_id',p_bill_id,'amount',round(p_amount,2),'journal_entry_id',v_entry,'payload_hash',v_hash),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_payment_id,'journal_entry_id',v_entry,'replayed',false));
end
$$;

revoke all on function public.record_restaurant_bill_payment_v2(uuid,uuid,date,numeric,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_restaurant_bill_payment_v2(uuid,uuid,date,numeric,uuid,text,text,text) to authenticated,service_role;

commit;
