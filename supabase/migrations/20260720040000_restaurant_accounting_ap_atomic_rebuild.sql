-- Restaurant Accounting AP atomic rebuild. No operator grants restored.

begin;

alter table public.restaurant_bill_items
  add column if not exists expense_account_id uuid references public.restaurant_accounts(id) on delete restrict,
  add column if not exists tax_amount numeric(15,2) not null default 0;

alter table public.restaurant_bills
  add column if not exists approved_by uuid references public.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists accrual_journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists creation_idempotency_key text,
  add column if not exists creation_payload_hash text;

alter table public.restaurant_bill_payments
  add column if not exists journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists idempotency_key text;

create unique index if not exists restaurant_bills_supplier_invoice_uidx
  on public.restaurant_bills(lodge_id, lower(supplier_name), lower(bill_number))
  where nullif(btrim(bill_number), '') is not null and status <> 'cancelled';
create unique index if not exists restaurant_bill_payments_idempotency_uidx
  on public.restaurant_bill_payments(lodge_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists restaurant_bills_creation_idempotency_uidx
  on public.restaurant_bills(lodge_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

create table if not exists public.restaurant_ap_gl_settings (
  lodge_id uuid primary key references public.settings(lodge_id) on delete cascade,
  payable_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  input_tax_account_id uuid references public.restaurant_accounts(id) on delete restrict,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.restaurant_ap_gl_settings enable row level security;
revoke all on table public.restaurant_ap_gl_settings from public, anon, authenticated;
grant select, insert, update on table public.restaurant_ap_gl_settings to service_role;

create or replace function public.set_restaurant_ap_gl_settings(
  p_lodge_id uuid, p_payable_account_id uuid, p_input_tax_account_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if not exists (select 1 from public.restaurant_accounts where id=p_payable_account_id and lodge_id=p_lodge_id and is_active and account_type='liability') then
    raise exception 'AP payable account must be an active lodge liability' using errcode='23503';
  end if;
  if p_input_tax_account_id is not null and not exists (select 1 from public.restaurant_accounts where id=p_input_tax_account_id and lodge_id=p_lodge_id and is_active and account_type='asset') then
    raise exception 'Input tax account must be an active lodge asset' using errcode='23503';
  end if;
  insert into public.restaurant_ap_gl_settings(lodge_id,payable_account_id,input_tax_account_id,updated_by)
  values(p_lodge_id,p_payable_account_id,p_input_tax_account_id,v_actor)
  on conflict(lodge_id) do update set payable_account_id=excluded.payable_account_id,input_tax_account_id=excluded.input_tax_account_id,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('success',true);
end $$;

create or replace function public.create_restaurant_bill_v2(
  p_lodge_id uuid, p_supplier_id uuid, p_supplier_name text, p_bill_number text,
  p_bill_date date, p_due_date date, p_notes text, p_items jsonb,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_bill_id uuid := gen_random_uuid(); v_item jsonb; v_hash text;
  v_qty numeric; v_unit numeric; v_line numeric; v_tax numeric;
  v_subtotal numeric := 0; v_tax_total numeric := 0; v_existing record;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if nullif(btrim(p_supplier_name),'') is null or nullif(btrim(p_bill_number),'') is null
     or p_bill_date is null or p_due_date < p_bill_date
     or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0
     or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Supplier, invoice number, valid dates, items and idempotency key are required' using errcode='22023';
  end if;
  v_hash:=encode(digest(jsonb_build_object('supplier_id',p_supplier_id,'supplier_name',btrim(p_supplier_name),'bill_number',btrim(p_bill_number),'bill_date',p_bill_date,'due_date',p_due_date,'notes',p_notes,'items',p_items)::text,'sha256'),'hex');
  select id,creation_payload_hash into v_existing from public.restaurant_bills where lodge_id=p_lodge_id and creation_idempotency_key=p_idempotency_key;
  if found then
    if v_existing.creation_payload_hash is distinct from v_hash then raise exception 'Bill idempotency key conflicts with a different payload' using errcode='23505'; end if;
    return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true));
  end if;
  if exists(select 1 from public.restaurant_bills where lodge_id=p_lodge_id and lower(supplier_name)=lower(btrim(p_supplier_name)) and lower(bill_number)=lower(btrim(p_bill_number)) and status<>'cancelled') then
    raise exception 'Supplier invoice number already exists for this lodge' using errcode='23505';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := round(coalesce((v_item->>'quantity')::numeric,0),3);
    v_unit := round(coalesce((v_item->>'unit_cost')::numeric,0),2);
    v_tax := round(coalesce((v_item->>'tax_amount')::numeric,0),2);
    if v_qty<=0 or v_unit<0 or v_tax<0 or nullif(btrim(v_item->>'description'),'') is null then
      raise exception 'Every bill item requires description, positive quantity, and non-negative cost/tax' using errcode='22023';
    end if;
    if not exists(select 1 from public.restaurant_accounts where id=(v_item->>'expense_account_id')::uuid and lodge_id=p_lodge_id and is_active and account_type in ('asset','expense')) then
      raise exception 'Bill line account must be an active lodge asset or expense' using errcode='23503';
    end if;
    if nullif(v_item->>'inventory_item_id','') is not null and not exists(select 1 from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid and lodge_id=p_lodge_id) then
      raise exception 'Bill inventory item belongs to another lodge or is missing' using errcode='23503';
    end if;
    v_line := round(v_qty*v_unit,2); v_subtotal:=v_subtotal+v_line; v_tax_total:=v_tax_total+v_tax;
  end loop;

  insert into public.restaurant_bills(id,lodge_id,supplier_id,supplier_name,bill_number,bill_date,due_date,subtotal,tax_amount,total,amount_paid,status,notes,created_by,creation_idempotency_key,creation_payload_hash)
  values(v_bill_id,p_lodge_id,p_supplier_id,btrim(p_supplier_name),btrim(p_bill_number),p_bill_date,p_due_date,v_subtotal,v_tax_total,v_subtotal+v_tax_total,0,'draft',nullif(btrim(p_notes),''),v_actor,p_idempotency_key,v_hash);

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty:=round((v_item->>'quantity')::numeric,3); v_unit:=round((v_item->>'unit_cost')::numeric,2); v_tax:=round(coalesce((v_item->>'tax_amount')::numeric,0),2);
    insert into public.restaurant_bill_items(bill_id,lodge_id,description,quantity,unit_cost,total,tax_amount,inventory_item_id,category,expense_account_id)
    values(v_bill_id,p_lodge_id,btrim(v_item->>'description'),v_qty,v_unit,round(v_qty*v_unit,2),v_tax,nullif(v_item->>'inventory_item_id','')::uuid,nullif(btrim(v_item->>'category'),''),(v_item->>'expense_account_id')::uuid);
  end loop;
  perform public.log_restaurant_financial_action(p_lodge_id,'ap_bill.created','restaurant_bills',v_bill_id,null,jsonb_build_object('total',v_subtotal+v_tax_total),jsonb_build_object('idempotency_key',p_idempotency_key));
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_bill_id,'replayed',false));
end $$;

create or replace function public.submit_restaurant_bill(p_lodge_id uuid,p_bill_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_bill public.restaurant_bills%rowtype;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  select * into v_bill from public.restaurant_bills where id=p_bill_id and lodge_id=p_lodge_id for update;
  if not found or v_bill.status<>'draft' then raise exception 'Only a draft bill can be submitted' using errcode='22023'; end if;
  if v_bill.total<=0 or not exists(select 1 from public.restaurant_bill_items where bill_id=p_bill_id and lodge_id=p_lodge_id) then raise exception 'Bill has no valid payable lines' using errcode='23514'; end if;
  update public.restaurant_bills set status='submitted',updated_at=now() where id=p_bill_id;
  return jsonb_build_object('success',true);
end $$;

create or replace function public.approve_restaurant_bill(
  p_lodge_id uuid,p_bill_id uuid,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_bill public.restaurant_bills%rowtype; v_settings public.restaurant_ap_gl_settings%rowtype;
  v_lines jsonb; v_tax numeric; v_result jsonb; v_entry uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  select * into v_bill from public.restaurant_bills where id=p_bill_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Bill not found' using errcode='P0002'; end if;
  if v_bill.status='approved' and v_bill.accrual_journal_entry_id is not null then return jsonb_build_object('success',true,'data',jsonb_build_object('id',p_bill_id,'replayed',true)); end if;
  if v_bill.status<>'submitted' then raise exception 'Only submitted bills can be approved' using errcode='22023'; end if;
  if v_bill.created_by=v_actor then raise exception 'Bill creator cannot approve the same bill' using errcode='42501'; end if;
  select * into v_settings from public.restaurant_ap_gl_settings where lodge_id=p_lodge_id;
  if not found or (v_bill.tax_amount>0 and v_settings.input_tax_account_id is null) then raise exception 'Complete AP GL settings before approval' using errcode='23503'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('account_id',expense_account_id,'debit',amount,'credit',0,'memo','Bill accrual')),'[]'::jsonb)
  into v_lines from (select expense_account_id,sum(total) amount from public.restaurant_bill_items where bill_id=p_bill_id and lodge_id=p_lodge_id group by expense_account_id)x;
  if v_bill.tax_amount>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_settings.input_tax_account_id,'debit',v_bill.tax_amount,'credit',0,'memo','Input tax')); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_settings.payable_account_id,'debit',0,'credit',v_bill.total,'memo','Accounts payable'));
  v_result:=public._restaurant_post_journal(p_lodge_id,v_bill.bill_date,concat('Supplier bill ',v_bill.bill_number),'ap_bill',v_bill.id,v_bill.bill_number,p_idempotency_key,v_lines,v_actor,null);
  v_entry:=(v_result->'data'->>'entry_id')::uuid;
  update public.restaurant_bills set status='approved',approved_by=v_actor,approved_at=now(),accrual_journal_entry_id=v_entry,updated_at=now() where id=p_bill_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'ap_bill.approved','restaurant_bills',p_bill_id,to_jsonb(v_bill),jsonb_build_object('status','approved','journal_entry_id',v_entry),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',p_bill_id,'journal_entry_id',v_entry,'replayed',false));
end $$;

create or replace function public.record_restaurant_bill_payment_v2(
  p_lodge_id uuid,p_bill_id uuid,p_payment_date date,p_amount numeric,
  p_payment_account_id uuid,p_reference text,p_notes text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_bill public.restaurant_bills%rowtype; v_settings public.restaurant_ap_gl_settings%rowtype;
  v_existing public.restaurant_bill_payments%rowtype; v_payment_id uuid:=gen_random_uuid(); v_result jsonb; v_entry uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.ap_pay');
  if p_payment_date is null or coalesce(p_amount,0)<=0 or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Payment date, positive amount and idempotency key are required' using errcode='22023'; end if;
  select * into v_existing from public.restaurant_bill_payments where lodge_id=p_lodge_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.bill_id<>p_bill_id or v_existing.amount<>round(p_amount,2) or v_existing.payment_date<>p_payment_date then raise exception 'Payment idempotency key conflicts with a different payload' using errcode='23505'; end if;
    return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true));
  end if;
  select * into v_bill from public.restaurant_bills where id=p_bill_id and lodge_id=p_lodge_id for update;
  if not found or v_bill.status not in ('approved','partially_paid') then raise exception 'Only approved outstanding bills are payable' using errcode='22023'; end if;
  if round(p_amount,2)>v_bill.total-v_bill.amount_paid then raise exception 'Payment exceeds outstanding balance' using errcode='23514'; end if;
  if not exists(select 1 from public.restaurant_accounts where id=p_payment_account_id and lodge_id=p_lodge_id and is_active and account_type='asset') then raise exception 'Payment account must be an active lodge asset' using errcode='23503'; end if;
  select * into v_settings from public.restaurant_ap_gl_settings where lodge_id=p_lodge_id;
  if not found then raise exception 'AP GL settings are missing' using errcode='23503'; end if;
  v_result:=public._restaurant_post_journal(p_lodge_id,p_payment_date,concat('Payment ',v_bill.bill_number),'ap_payment',v_payment_id,p_reference,concat('ap-payment:',p_idempotency_key),jsonb_build_array(
    jsonb_build_object('account_id',v_settings.payable_account_id,'debit',round(p_amount,2),'credit',0,'memo','Reduce payable'),
    jsonb_build_object('account_id',p_payment_account_id,'debit',0,'credit',round(p_amount,2),'memo','Supplier payment')
  ),v_actor,null);
  v_entry:=(v_result->'data'->>'entry_id')::uuid;
  insert into public.restaurant_bill_payments(id,lodge_id,bill_id,payment_date,amount,payment_method,reference,notes,created_by,journal_entry_id,idempotency_key)
  values(v_payment_id,p_lodge_id,p_bill_id,p_payment_date,round(p_amount,2),'account',nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),v_actor,v_entry,p_idempotency_key);
  update public.restaurant_bills set amount_paid=amount_paid+round(p_amount,2),status=case when amount_paid+round(p_amount,2)=total then 'paid' else 'partially_paid' end,updated_at=now() where id=p_bill_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'ap_payment.recorded','restaurant_bill_payments',v_payment_id,null,jsonb_build_object('bill_id',p_bill_id,'amount',round(p_amount,2),'journal_entry_id',v_entry),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_payment_id,'journal_entry_id',v_entry,'replayed',false));
end $$;

revoke all on function public.set_restaurant_ap_gl_settings(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_restaurant_bill_v2(uuid,uuid,text,text,date,date,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.submit_restaurant_bill(uuid,uuid) from public,anon,authenticated;
revoke all on function public.approve_restaurant_bill(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.record_restaurant_bill_payment_v2(uuid,uuid,date,numeric,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.set_restaurant_ap_gl_settings(uuid,uuid,uuid) to service_role;
grant execute on function public.create_restaurant_bill_v2(uuid,uuid,text,text,date,date,text,jsonb,text) to service_role;
grant execute on function public.submit_restaurant_bill(uuid,uuid) to service_role;
grant execute on function public.approve_restaurant_bill(uuid,uuid,text) to service_role;
grant execute on function public.record_restaurant_bill_payment_v2(uuid,uuid,date,numeric,uuid,text,text,text) to service_role;

commit;
