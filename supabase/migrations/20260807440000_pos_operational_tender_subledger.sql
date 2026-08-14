-- Financial truth gate 3/9: account and voucher tenders are operational
-- subledgers and must work independently of the optional Accounting GL.

begin;

create table if not exists public.restaurant_pos_tender_allocations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  tender_id text not null,
  tender_index integer not null,
  method text not null,
  amount numeric(18,2) not null,
  customer_id uuid references public.restaurant_customers(id) on delete restrict,
  voucher_id uuid references public.restaurant_vouchers(id) on delete restrict,
  reference text,
  canonical_payload_hash text not null,
  created_at timestamptz not null default now(),
  unique(lodge_id, order_id, tender_id),
  unique(lodge_id, order_id, tender_index)
);
alter table public.restaurant_pos_tender_allocations enable row level security;
revoke all on table public.restaurant_pos_tender_allocations from public, anon, authenticated;
grant select, insert on table public.restaurant_pos_tender_allocations to service_role;

alter table public.restaurant_account_ledger
  add column if not exists tender_id text,
  add column if not exists tender_index integer,
  add column if not exists canonical_payload_hash text;
alter table public.restaurant_voucher_ledger
  add column if not exists tender_id text,
  add column if not exists tender_index integer,
  add column if not exists canonical_payload_hash text;
drop index if exists public.restaurant_account_ledger_order_tender_uidx;
drop index if exists public.restaurant_voucher_ledger_order_tender_uidx;
create unique index restaurant_account_ledger_order_tender_uidx
  on public.restaurant_account_ledger(lodge_id,order_id,tender_id);
create unique index restaurant_voucher_ledger_order_tender_uidx
  on public.restaurant_voucher_ledger(lodge_id,order_id,tender_id);

create or replace function public.guard_pos_account_voucher_tender_envelope()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_method text;
  v_tender_id text;
  v_i integer := 0;
  v_total numeric := 0;
  v_input jsonb;
begin
  if jsonb_typeof(coalesce(new.payment_breakdown,'[]'::jsonb)) <> 'array' then
    raise exception 'payment_breakdown must be an array' using errcode='22023';
  end if;
  v_input:=case when jsonb_array_length(coalesce(new.payment_breakdown,'[]'::jsonb))>0 then new.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(new.payment_method,'cash'),'amount',coalesce(new.total,0))) end;
  for v_row in select value from jsonb_array_elements(v_input) loop
    v_method:=lower(btrim(coalesce(v_row->>'method',new.payment_method,'cash')));
    v_tender_id:=nullif(btrim(coalesce(v_row->>'tender_id',v_row->>'id','')), '');
    v_tender_id:=coalesce(v_tender_id,new.id::text||':'||v_i::text);
    if exists(select 1 from jsonb_array_elements(v_rows) x where x->>'tender_id'=v_tender_id) then raise exception 'Duplicate tender_id in payment_breakdown' using errcode='23505'; end if;
    if v_method='account' and nullif(btrim(v_row->>'customer_id'),'') is null then raise exception 'Account tender requires customer_id' using errcode='22023'; end if;
    if v_method='voucher' and nullif(btrim(coalesce(v_row->>'voucher_id',v_row->>'code','')),'') is null then raise exception 'Voucher tender requires voucher_id or code' using errcode='22023'; end if;
    if v_method='voucher' and exists(select 1 from jsonb_array_elements(v_rows) x where lower(coalesce(x->>'method',''))='voucher' and coalesce(nullif(x->>'voucher_id',''),nullif(x->>'code',''))=coalesce(nullif(v_row->>'voucher_id',''),nullif(v_row->>'code',''))) then raise exception 'Duplicate voucher tender rows are not supported' using errcode='23505'; end if;
    v_total:=v_total+coalesce(nullif(v_row->>'amount','')::numeric,0);
    v_rows:=v_rows||jsonb_build_array(v_row||jsonb_build_object('tender_id',v_tender_id,'tender_index',v_i,'method',v_method));
    v_i:=v_i+1;
  end loop;
  if (new.payment_method in ('account','voucher') or exists(select 1 from jsonb_array_elements(v_rows) x where lower(coalesce(x->>'method','')) in ('account','voucher'))) and v_i=0 then raise exception 'Account or voucher tender requires a payment row' using errcode='22023'; end if;
  if round(abs(v_total)-abs(coalesce(new.total,0)),2)<>0 then raise exception 'Tender allocations must equal the authoritative order total' using errcode='23514'; end if;
  new.payment_breakdown:=v_rows;
  return new;
end
$$;

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
begin
  for v_tender in select value from jsonb_array_elements(coalesce(new.payment_breakdown,'[]'::jsonb)) loop
    v_method:=lower(btrim(coalesce(v_tender->>'method',new.payment_method,'cash')));
    v_tender_id:=coalesce(nullif(btrim(v_tender->>'tender_id'),''),new.id::text||':'||coalesce(v_tender->>'tender_index','0'));
    v_index:=coalesce(nullif(v_tender->>'tender_index','')::integer,0);
    v_amount:=round(abs(coalesce((v_tender->>'amount')::numeric,0)),2);
    if v_amount=0 then continue; end if;
    v_hash:=encode(digest((v_tender||jsonb_build_object('order_id',new.id,'tender_id',v_tender_id))::text,'sha256'),'hex');
    if exists(select 1 from public.restaurant_pos_tender_allocations a where a.lodge_id=new.lodge_id and a.order_id=new.id and a.tender_id=v_tender_id and a.canonical_payload_hash is distinct from v_hash) then raise exception 'Tender retry conflicts with a different payload' using errcode='22000'; end if;
    if v_method='account' then
      perform public.app_require_feature(new.lodge_id,'customer_accounts',array['cashier','supervisor','manager','finance','admin','super_admin','owner']);
      select * into v_customer from public.restaurant_customers where id=nullif(v_tender->>'customer_id','')::uuid and lodge_id=new.lodge_id for update;
      if not found or v_customer.account_status<>'active' then raise exception 'Customer account is not active or belongs to another lodge' using errcode='42501'; end if;
      select coalesce(sum(amount),0) into v_balance from public.restaurant_account_ledger where lodge_id=new.lodge_id and customer_id=v_customer.id and reversed_at is null;
      if not v_is_return and round(v_balance+v_amount,2)>round(coalesce(v_customer.credit_limit,0),2) then raise exception 'Customer account available credit is insufficient' using errcode='55000'; end if;
      v_alloc_amount:=case when v_is_return then -v_amount else v_amount end;
      insert into public.restaurant_pos_tender_allocations(lodge_id,order_id,tender_id,tender_index,method,amount,customer_id,reference,canonical_payload_hash)
      values(new.lodge_id,new.id,v_tender_id,v_index,'account',v_alloc_amount,v_customer.id,nullif(v_tender->>'reference',''),v_hash)
      on conflict(lodge_id,order_id,tender_id) do update set canonical_payload_hash=excluded.canonical_payload_hash;
      insert into public.restaurant_account_ledger(lodge_id,customer_id,order_id,amount,reason,description,source_version,operation_id,payload_hash,balance_after,tender_id,tender_index,canonical_payload_hash)
      values(new.lodge_id,v_customer.id,new.id,v_alloc_amount,case when v_is_return then 'return' else 'charge' end,'POS order '||new.id,2,md5(new.id::text||':'||v_tender_id)::uuid,v_hash,v_balance+v_alloc_amount,v_tender_id,v_index,v_hash)
      on conflict(lodge_id,order_id,tender_id) do update set canonical_payload_hash=excluded.canonical_payload_hash;
      update public.restaurant_customers set total_spent=greatest(0,total_spent+v_alloc_amount),visit_count=case when v_is_return then greatest(0,visit_count-1) else visit_count+1 end,updated_at=now() where id=v_customer.id;
    elsif v_method='voucher' then
      perform public.app_require_feature(new.lodge_id,'vouchers',array['cashier','supervisor','manager','finance','admin','super_admin','owner']);
      select * into v_voucher from public.restaurant_vouchers where lodge_id=new.lodge_id and (id=nullif(v_tender->>'voucher_id','')::uuid or upper(code)=upper(nullif(v_tender->>'code',''))) for update;
      if not found then raise exception 'Voucher belongs to another lodge or does not exist' using errcode='42501'; end if;
      if v_voucher.status not in ('active','redeemed') then raise exception 'Voucher is voided or expired' using errcode='55000'; end if;
      if v_voucher.expires_at is not null and v_voucher.expires_at<now() and not v_is_return then raise exception 'Voucher has expired' using errcode='55000'; end if;
      select coalesce(sum(amount),0) into v_remaining from public.restaurant_voucher_ledger where lodge_id=new.lodge_id and voucher_id=v_voucher.id;
      v_remaining:=v_voucher.initial_value+v_remaining;
      if not v_is_return and v_amount>v_remaining then raise exception 'Voucher balance is insufficient' using errcode='55000'; end if;
      if v_is_return and v_remaining+v_amount>v_voucher.initial_value then raise exception 'Voucher return exceeds original issued value' using errcode='23514'; end if;
      v_alloc_amount:=case when v_is_return then v_amount else -v_amount end;
      insert into public.restaurant_pos_tender_allocations(lodge_id,order_id,tender_id,tender_index,method,amount,voucher_id,reference,canonical_payload_hash)
      values(new.lodge_id,new.id,v_tender_id,v_index,'voucher',case when v_is_return then -v_amount else v_amount end,v_voucher.id,nullif(v_tender->>'reference',''),v_hash)
      on conflict(lodge_id,order_id,tender_id) do update set canonical_payload_hash=excluded.canonical_payload_hash;
      insert into public.restaurant_voucher_ledger(lodge_id,voucher_id,order_id,operation_id,amount,balance_after,reason,created_by,tender_id,tender_index,canonical_payload_hash)
      values(new.lodge_id,v_voucher.id,new.id,md5(new.id::text||':'||v_tender_id)::uuid,v_alloc_amount,v_remaining+v_alloc_amount,case when v_is_return then 'return' else 'redeem' end,public.app_current_user_id(),v_tender_id,v_index,v_hash)
      on conflict(lodge_id,order_id,tender_id) do update set canonical_payload_hash=excluded.canonical_payload_hash;
      update public.restaurant_vouchers set remaining_value=v_remaining+v_alloc_amount,status=case when v_remaining+v_alloc_amount=0 then 'redeemed' else 'active' end,updated_at=now() where id=v_voucher.id;
    end if;
  end loop;
  return new;
end
$$;

drop trigger if exists trg_guard_pos_account_voucher_tender_envelope on public.pos_orders;
create trigger trg_guard_pos_account_voucher_tender_envelope before insert or update of payment_method,payment_breakdown on public.pos_orders for each row execute function public.guard_pos_account_voucher_tender_envelope();
drop trigger if exists trg_restaurant_pos_operational_tender_subledger on public.pos_orders;
create constraint trigger trg_restaurant_pos_operational_tender_subledger after insert on public.pos_orders deferrable initially deferred for each row execute function public.restaurant_post_operational_pos_tenders();

create or replace function public.get_restaurant_customer_account_dto(p_lodge_id uuid,p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'outstanding_balance',round(coalesce((select sum(l.amount) from public.restaurant_account_ledger l where l.lodge_id=p_lodge_id and l.customer_id=c.id and l.reversed_at is null),0),2),'credit_limit',round(coalesce(c.credit_limit,0),2),'available_credit',round(greatest(coalesce(c.credit_limit,0)-coalesce((select sum(l.amount) from public.restaurant_account_ledger l where l.lodge_id=p_lodge_id and l.customer_id=c.id and l.reversed_at is null),0),0),2),'account_status',c.account_status) order by c.name) from public.restaurant_customers c where c.lodge_id=p_lodge_id and (p_customer_id is null or c.id=p_customer_id)),'[]'::jsonb);
end
$$;

revoke all on function public.guard_pos_account_voucher_tender_envelope(),public.restaurant_post_operational_pos_tenders(),public.get_restaurant_customer_account_dto(uuid,uuid) from public,anon,authenticated;
grant execute on function public.guard_pos_account_voucher_tender_envelope(),public.restaurant_post_operational_pos_tenders() to service_role;
grant execute on function public.get_restaurant_customer_account_dto(uuid,uuid) to authenticated,service_role;

commit;
