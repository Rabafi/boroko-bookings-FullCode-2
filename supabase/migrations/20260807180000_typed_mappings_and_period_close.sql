-- Typed POS mappings, explicit accounting period close, and SQL-enforced close locks.
-- This migration is intentionally forward-only and restores no direct table DML.

begin;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.restaurant_pos_gl_mappings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%mapping_type%'
  loop
    execute format('alter table public.restaurant_pos_gl_mappings drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.restaurant_pos_gl_mappings
  add column if not exists effective_from date not null default current_date,
  add column if not exists effective_to date,
  add column if not exists mapping_version text not null default 'bar-accounting-financial-truth-v1';

alter table public.restaurant_pos_gl_mappings
  add constraint restaurant_pos_gl_mappings_mapping_type_v2_chk
  check (mapping_type in ('category','tender','discount','tax','tips','cogs','inventory','settlement_fee','settlement_clearing'));

alter table public.restaurant_pos_gl_mappings
  add constraint restaurant_pos_gl_mappings_effective_range_chk
  check (effective_to is null or effective_to >= effective_from);

create or replace function public.set_restaurant_pos_gl_mapping(
  p_lodge_id uuid,
  p_mapping_type text,
  p_source_key text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_account_type text;
  v_id uuid;
  v_type text := lower(btrim(coalesce(p_mapping_type,'')));
  v_key text := lower(btrim(coalesce(p_source_key,'')));
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if v_type not in ('category','tender','discount','tax','tips','cogs','inventory','settlement_fee','settlement_clearing') or v_key = '' then
    raise exception 'Valid typed mapping type and source key are required' using errcode = '22023';
  end if;

  select account_type into v_account_type
  from public.restaurant_accounts
  where id = p_account_id and lodge_id = p_lodge_id and is_active;
  if not found then
    raise exception 'Mapped account is inactive, missing, or belongs to another lodge' using errcode = '23503';
  end if;

  if v_type in ('category','discount') and v_account_type <> 'revenue' then
    raise exception 'Category and discount mappings require revenue accounts' using errcode = '22023';
  elsif v_type = 'tender' and v_key = 'voucher' and v_account_type <> 'liability' then
    raise exception 'Voucher tender mappings require a voucher-liability account' using errcode = '22023';
  elsif v_type = 'tender' and v_account_type <> 'asset' then
    raise exception 'Cash, card, mobile-money, account, and clearing tender mappings require asset accounts' using errcode = '22023';
  elsif v_type in ('tax','tips') and v_account_type <> 'liability' then
    raise exception 'Tax and tips mappings require liability accounts' using errcode = '22023';
  elsif v_type in ('cogs','settlement_fee') and v_account_type <> 'expense' then
    raise exception 'COGS and settlement-fee mappings require expense accounts' using errcode = '22023';
  elsif v_type in ('inventory','settlement_clearing') and v_account_type <> 'asset' then
    raise exception 'Inventory and settlement-clearing mappings require asset accounts' using errcode = '22023';
  end if;

  insert into public.restaurant_pos_gl_mappings(lodge_id,mapping_type,source_key,account_id,created_by,effective_from,effective_to,mapping_version)
  values(p_lodge_id,v_type,v_key,p_account_id,v_actor,current_date,null,'bar-accounting-financial-truth-v1')
  on conflict(lodge_id,mapping_type,source_key)
  do update set account_id=excluded.account_id,updated_at=now(),effective_from=excluded.effective_from,effective_to=null,mapping_version=excluded.mapping_version
  returning id into v_id;

  perform public.log_restaurant_financial_action(p_lodge_id,'pos_gl_mapping_set','pos_gl_mapping',v_id,null,
    jsonb_build_object('mapping_type',v_type,'source_key',v_key,'account_id',p_account_id,'effective_from',current_date),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'mapping_type',v_type,'source_key',v_key));
end;
$$;

create or replace function public.set_restaurant_pos_gl_mapping_v2(
  p_lodge_id uuid,
  p_mapping_type text,
  p_source_key text,
  p_account_id uuid,
  p_effective_from date,
  p_effective_to date default null,
  p_mapping_version text default 'bar-accounting-financial-truth-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_type text := lower(btrim(coalesce(p_mapping_type,'')));
  v_key text := lower(btrim(coalesce(p_source_key,'')));
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'A valid effective mapping date range is required' using errcode='22023';
  end if;
  perform public.set_restaurant_pos_gl_mapping(p_lodge_id,v_type,v_key,p_account_id);
  update public.restaurant_pos_gl_mappings
     set effective_from=p_effective_from,effective_to=p_effective_to,
         mapping_version=coalesce(nullif(btrim(p_mapping_version),''),'bar-accounting-financial-truth-v1'),updated_at=now()
   where lodge_id=p_lodge_id and mapping_type=v_type and source_key=v_key
   returning id into v_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'effective_from',p_effective_from,'effective_to',p_effective_to,'mapping_version',p_mapping_version,'actor_id',v_actor));
end;
$$;

create or replace function public.get_restaurant_pos_gl_mappings(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  return jsonb_build_object('success',true,'data',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',m.id,'mapping_type',m.mapping_type,'source_key',m.source_key,'account_id',m.account_id,
      'account_code',a.code,'account_name',a.name,'effective_from',m.effective_from,'effective_to',m.effective_to,
      'mapping_version',m.mapping_version
    ) order by m.mapping_type,m.source_key)
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=m.lodge_id
    where m.lodge_id=p_lodge_id
  ),'[]'::jsonb));
end;
$$;

-- Replace code-based COGS selection with effective typed lodge mappings.
create or replace function public._restaurant_post_pos_order_to_gl_v2(p_lodge_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  p_lodge uuid := p_lodge_id;
  o public.pos_orders%rowtype; p jsonb; m record; a uuid; lines jsonb:='[]'::jsonb;
  tender_total numeric:=0; tender_amount numeric; gross numeric; disc numeric; tax numeric; tips numeric; total numeric; category_total numeric:=0;
  is_return boolean; business_date date; journal jsonb; operation_id uuid; payload_hash text; customer uuid; voucher uuid;
  account_balance numeric; credit_limit numeric; remaining numeric; cost numeric; cogs uuid; inventory_account uuid; actor uuid;
begin
  if not public.restaurant_accounting_is_active(p_lodge) then return jsonb_build_object('success',true,'skipped',true,'reason','accounting_not_active'); end if;
  select * into o from public.pos_orders where id=p_order_id and lodge_id=p_lodge for update;
  if not found or o.status not in('completed','settled') then raise exception 'Only completed POS orders can be posted' using errcode='22023'; end if;
  select * into m from public.restaurant_financial_source_postings where lodge_id=p_lodge and source_type='pos_order' and source_id=p_order_id and status='posted' for share;
  if found then return jsonb_build_object('success',true,'replayed',true,'journal_entry_id',m.journal_entry_id); end if;
  actor:=coalesce(public.app_current_user_id(),o.cashier_id); operation_id:=p_order_id;
  payload_hash:=encode(digest(to_jsonb(o)::text||coalesce(o.payment_breakdown,'[]'::jsonb)::text,'sha256'),'hex');
  is_return:=coalesce(o.transaction_type,'sale')='return';
  gross:=abs(round(coalesce(nullif(o.gross_total,0),o.total),2)); disc:=abs(round(coalesce(o.discount_total,0),2)); tax:=abs(round(coalesce(o.tax_total,0),2)); tips:=abs(round(coalesce(o.tip_total,0),2)); total:=abs(round(o.total,2));
  business_date:=coalesce(o.business_date,(o.completed_at at time zone coalesce((select nullif(timezone,'') from public.settings where lodge_id=p_lodge),'Africa/Gaborone'))::date,public.get_lodge_business_date(p_lodge));
  for m in select lower(coalesce(nullif(btrim(i.category),''),'uncategorized')) category,round(sum(abs(coalesce(nullif(i.gross_subtotal,0),i.unit_price*i.quantity))),2) amount from public.pos_order_items i where i.order_id=p_order_id and i.lodge_id=p_lodge group by lower(coalesce(nullif(btrim(i.category),''),'uncategorized')) loop
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='revenue' where x.lodge_id=p_lodge and x.mapping_type='category' and x.source_key=m.category and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    if a is null then raise exception 'No active GL revenue mapping for POS category %',m.category using errcode='23503'; end if;
    category_total:=category_total+m.amount;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when is_return then m.amount else 0 end,'credit',case when is_return then 0 else m.amount end,'memo','POS revenue '||m.category));
  end loop;
  if round(category_total,2)<>gross then raise exception 'POS item gross does not reconcile to order gross' using errcode='23514'; end if;
  for p in select value from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' and jsonb_array_length(o.payment_breakdown)>0 then o.payment_breakdown else jsonb_build_array(jsonb_build_object('method',coalesce(o.payment_method,'cash'),'amount',o.total)) end) loop
    if coalesce((p->>'amount')::numeric,0)=0 then raise exception 'POS tender amount must be non-zero' using errcode='22023'; end if;
    tender_amount:=abs(round((p->>'amount')::numeric,2)); tender_total:=tender_total+tender_amount; customer:=nullif(p->>'customer_id','')::uuid; voucher:=nullif(p->>'voucher_id','')::uuid;
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active where x.lodge_id=p_lodge and x.mapping_type='tender' and x.source_key=lower(btrim(coalesce(p->>'method',o.payment_method,'cash'))) and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date) and ((lower(p->>'method')='voucher' and ac.account_type='liability') or lower(p->>'method')<>'voucher' and ac.account_type='asset');
    if a is null and lower(p->>'method')='account' then select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='asset' where x.lodge_id=p_lodge and x.mapping_type='tender' and x.source_key in('account','ar') and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date) order by case when x.source_key='account' then 0 else 1 end limit 1; end if;
    if a is null then raise exception 'No active GL tender mapping for %',lower(coalesce(p->>'method',o.payment_method,'cash')) using errcode='23503'; end if;
    if lower(p->>'method')='account' then
      if customer is null then raise exception 'Account tender requires customer_id' using errcode='22023'; end if;
      perform 1 from public.restaurant_customers where id=customer and lodge_id=p_lodge and account_status='active' for update;
      if not found then raise exception 'Customer account is missing or suspended' using errcode='42501'; end if;
      select coalesce(sum(amount),0) into account_balance from public.restaurant_account_ledger where lodge_id=p_lodge and customer_id=customer and reversed_at is null;
      select credit_limit into credit_limit from public.restaurant_customers where id=customer and lodge_id=p_lodge;
      if not is_return and credit_limit is not null and account_balance+tender_amount>credit_limit then raise exception 'Customer credit limit would be exceeded' using errcode='55000'; end if;
      insert into public.restaurant_account_ledger(lodge_id,customer_id,order_id,amount,reason,description,source_version,operation_id,payload_hash,balance_after) values(p_lodge,customer,p_order_id,case when is_return then -tender_amount else tender_amount end,case when is_return then 'return' else 'charge' end,'POS order '||p_order_id,1,operation_id,payload_hash,case when is_return then account_balance-tender_amount else account_balance+tender_amount end) on conflict do nothing;
    elsif lower(p->>'method')='voucher' then
      if voucher is null then voucher:=(select id from public.restaurant_vouchers where lodge_id=p_lodge and lower(code)=lower(p->>'code') and status='active' limit 1); end if;
      select remaining_value into remaining from public.restaurant_vouchers where id=voucher and lodge_id=p_lodge and status='active' for update;
      if not found or (not is_return and remaining<tender_amount) then raise exception 'Voucher is missing, inactive, or has insufficient balance' using errcode='55000'; end if;
      insert into public.restaurant_voucher_ledger(lodge_id,voucher_id,order_id,operation_id,amount,balance_after,reason,created_by) values(p_lodge,voucher,p_order_id,operation_id,case when is_return then tender_amount else -tender_amount end,case when is_return then remaining+tender_amount else remaining-tender_amount end,case when is_return then 'return' else 'redeem' end,actor) on conflict(lodge_id,operation_id) do nothing;
      update public.restaurant_vouchers set remaining_value=case when is_return then remaining_value+tender_amount else remaining_value-tender_amount end,status=case when remaining_value-tender_amount<=0 and not is_return then 'redeemed' else status end,updated_at=now() where id=voucher and lodge_id=p_lodge;
    end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when is_return then 0 else tender_amount end,'credit',case when is_return then tender_amount else 0 end,'memo','POS tender '||lower(coalesce(p->>'method',o.payment_method,'cash'))));
  end loop;
  if round(tender_total,2)<>total then raise exception 'POS tender breakdown does not reconcile to order total' using errcode='23514'; end if;
  for m in select * from(values('discount',disc),('tax',tax),('tips',tips))q(mapping_type,amount) where amount>0 loop
    select x.account_id into a from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active where x.lodge_id=p_lodge and x.mapping_type=m.mapping_type and x.source_key='default' and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    if a is null then raise exception 'No active default GL mapping for %',m.mapping_type using errcode='23503'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a,'debit',case when m.mapping_type='discount' and not is_return then m.amount when m.mapping_type<>'discount' and is_return then m.amount else 0 end,'credit',case when m.mapping_type='discount' and is_return then m.amount when m.mapping_type<>'discount' and not is_return then m.amount else 0 end,'memo','POS '||m.mapping_type));
  end loop;
  select coalesce(sum(abs(total_cost)),0) into cost from public.inventory_movements where lodge_id=p_lodge and reference_id=p_order_id and movement_type in('recipe_sale','sale','pos_sale');
  if cost>0 then
    select x.account_id into cogs from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='expense' where x.lodge_id=p_lodge and x.mapping_type='cogs' and x.source_key='default' and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    select x.account_id into inventory_account from public.restaurant_pos_gl_mappings x join public.restaurant_accounts ac on ac.id=x.account_id and ac.lodge_id=p_lodge and ac.is_active and ac.account_type='asset' where x.lodge_id=p_lodge and x.mapping_type='inventory' and x.source_key='default' and x.effective_from<=business_date and (x.effective_to is null or x.effective_to>=business_date);
    if cogs is null or inventory_account is null then raise exception 'Typed COGS and inventory mappings are required before POS activation' using errcode='23503'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',case when is_return then inventory_account else cogs end,'debit',case when is_return then 0 else cost end,'credit',case when is_return then cost else 0 end,'memo','POS COGS'),jsonb_build_object('account_id',case when is_return then cogs else inventory_account end,'debit',case when is_return then cost else 0 end,'credit',case when is_return then 0 else cost end,'memo','POS inventory movement'));
  end if;
  journal:=public._restaurant_post_journal(p_lodge,business_date,'POS '||coalesce(o.transaction_type,'sale')||' '||coalesce(o.receipt_number,p_order_id::text),'pos_'||coalesce(o.transaction_type,'sale'),p_order_id,o.receipt_number,'pos-order:'||p_order_id::text,lines,actor,null);
  perform public.record_restaurant_source_posting(p_lodge,'pos_order',p_order_id,business_date,(journal->'data'->>'entry_id')::uuid,operation_id,payload_hash,1,o.outlet_id,'posted');
  return jsonb_build_object('success',true,'journal_entry_id',(journal->'data'->>'entry_id')::uuid,'replayed',coalesce((journal->'data'->>'replayed')::boolean,false),'source_posting',true);
end
$$;

create table if not exists public.restaurant_accounting_period_closes (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'prepared' check(status in ('prepared','blocked','closed','reopened')),
  operation_key text not null,
  checklist jsonb not null default '{}'::jsonb,
  control_totals jsonb not null default '{}'::jsonb,
  evidence_manifest jsonb not null default '{}'::jsonb,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz not null default now(),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  reopened_by uuid references public.users(id),
  reopened_at timestamptz,
  reopen_reason text,
  unique(lodge_id,period_start,period_end),
  unique(lodge_id,operation_key),
  check(period_end>=period_start)
);
alter table public.restaurant_accounting_period_closes enable row level security;
revoke all on table public.restaurant_accounting_period_closes from public,anon,authenticated;
grant select on table public.restaurant_accounting_period_closes to service_role;

create or replace function public.restaurant_accounting_period_is_closed(p_lodge_id uuid,p_entry_date date)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.restaurant_accounting_period_closes where lodge_id=p_lodge_id and status='closed' and p_entry_date between period_start and period_end)
$$;

create or replace function public.restaurant_block_closed_accounting_period()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.restaurant_accounting_period_is_closed(new.lodge_id,new.entry_date) then
    raise exception 'Accounting period % to % is closed; use the governed reopen workflow before posting a correction',
      (select period_start from public.restaurant_accounting_period_closes where lodge_id=new.lodge_id and status='closed' and new.entry_date between period_start and period_end order by period_end desc limit 1),
      (select period_end from public.restaurant_accounting_period_closes where lodge_id=new.lodge_id and status='closed' and new.entry_date between period_start and period_end order by period_end desc limit 1)
      using errcode='55000';
  end if;
  return new;
end
$$;
drop trigger if exists trg_restaurant_block_closed_accounting_period on public.restaurant_journal_entries;
create trigger trg_restaurant_block_closed_accounting_period before insert on public.restaurant_journal_entries for each row execute function public.restaurant_block_closed_accounting_period();

create or replace function public.prepare_restaurant_period_close(p_lodge_id uuid,p_period_start date,p_period_end date,p_operation_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_existing public.restaurant_accounting_period_closes%rowtype; v_coverage jsonb; v_blocking integer; v_unposted integer; v_bank_missing integer; v_checklist jsonb; v_status text;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.close');
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start or nullif(btrim(p_operation_key),'') is null then raise exception 'Period dates and a stable close operation key are required' using errcode='22023'; end if;
  select * into v_existing from public.restaurant_accounting_period_closes where lodge_id=p_lodge_id and period_start=p_period_start and period_end=p_period_end for update;
  if found then
    if v_existing.operation_key<>btrim(p_operation_key) then raise exception 'This period already has a different close operation key' using errcode='23505'; end if;
    return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'status',v_existing.status,'checklist',v_existing.checklist),'replayed',true);
  end if;
  v_coverage:=public.get_restaurant_financial_source_coverage(p_lodge_id,p_period_start,p_period_end)->'data';
  select count(*) into v_blocking from public.restaurant_reconciliation_exceptions where lodge_id=p_lodge_id and severity='blocking' and status in('open','investigating') and (occurred_at::date between p_period_start and p_period_end or occurred_at is null);
  select count(*) into v_unposted from public.expenses where lodge_id=p_lodge_id and date between p_period_start and p_period_end and status in('unposted','exception');
  select count(*) into v_bank_missing from public.restaurant_bank_accounts b where b.lodge_id=p_lodge_id and b.is_active and not exists(select 1 from public.restaurant_bank_reconciliation_packets p where p.lodge_id=b.lodge_id and p.bank_account_id=b.id and p.status='complete' and p.completed_at::date between p_period_start and p_period_end);
  v_checklist:=jsonb_build_object('source_coverage',v_coverage,'blocking_exceptions',v_blocking,'unposted_expenses',v_unposted,'bank_accounts_without_completed_packet',v_bank_missing);
  v_status:=case when coalesce((v_coverage->>'complete')::boolean,false) and v_blocking=0 and v_unposted=0 and v_bank_missing=0 then 'prepared' else 'blocked' end;
  insert into public.restaurant_accounting_period_closes(lodge_id,period_start,period_end,status,operation_key,checklist,control_totals,evidence_manifest,prepared_by)
  values(p_lodge_id,p_period_start,p_period_end,v_status,btrim(p_operation_key),v_checklist,'{}'::jsonb,jsonb_build_object('coverage',v_coverage),v_actor)
  returning id into v_existing.id;
  perform public.log_restaurant_financial_action(p_lodge_id,'accounting_period_prepared','accounting_period_close',v_existing.id,null,v_checklist,null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'status',v_status,'checklist',v_checklist));
end
$$;

create or replace function public.approve_restaurant_period_close(p_lodge_id uuid,p_period_close_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_row public.restaurant_accounting_period_closes%rowtype; v_coverage jsonb;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.close');
  select * into v_row from public.restaurant_accounting_period_closes where id=p_period_close_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Period close packet not found' using errcode='P0002'; end if;
  if v_row.status='closed' then return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status','closed'),'replayed',true); end if;
  if v_row.prepared_by=v_actor then raise exception 'The period-close preparer cannot approve the same close' using errcode='42501'; end if;
  v_coverage:=public.get_restaurant_financial_source_coverage(p_lodge_id,v_row.period_start,v_row.period_end)->'data';
  if v_row.status<>'prepared' or not coalesce((v_coverage->>'complete')::boolean,false) or coalesce((v_row.checklist->>'blocking_exceptions')::integer,0)>0 or coalesce((v_row.checklist->>'unposted_expenses')::integer,0)>0 or coalesce((v_row.checklist->>'bank_accounts_without_completed_packet')::integer,0)>0 then
    raise exception 'Period close checklist is incomplete; resolve every named control before approval' using errcode='55000';
  end if;
  update public.restaurant_accounting_period_closes set status='closed',approved_by=v_actor,approved_at=now(),checklist=jsonb_set(checklist,'{approved_coverage}',v_coverage,true) where id=v_row.id;
  perform public.log_restaurant_financial_action(p_lodge_id,'accounting_period_closed','accounting_period_close',v_row.id,null,jsonb_build_object('period_start',v_row.period_start,'period_end',v_row.period_end,'coverage',v_coverage),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status','closed','period_start',v_row.period_start,'period_end',v_row.period_end));
end
$$;

create or replace function public.reopen_restaurant_period_close(p_lodge_id uuid,p_period_close_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_row public.restaurant_accounting_period_closes%rowtype;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.close');
  if nullif(btrim(p_reason),'') is null then raise exception 'A governed period reopen reason is required' using errcode='22023'; end if;
  select * into v_row from public.restaurant_accounting_period_closes where id=p_period_close_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Period close packet not found' using errcode='P0002'; end if;
  if v_row.status<>'closed' then return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status',v_row.status),'replayed',true); end if;
  if v_row.approved_by=v_actor then raise exception 'The period-close approver cannot reopen the same close' using errcode='42501'; end if;
  update public.restaurant_accounting_period_closes set status='reopened',reopened_by=v_actor,reopened_at=now(),reopen_reason=btrim(p_reason) where id=v_row.id;
  perform public.log_restaurant_financial_action(p_lodge_id,'accounting_period_reopened','accounting_period_close',v_row.id,null,jsonb_build_object('reason',btrim(p_reason),'affected_reports_invalidated',true),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status','reopened','affected_reports_invalidated',true));
end
$$;

create or replace function public.get_restaurant_period_close(p_lodge_id uuid,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  return jsonb_build_object('success',true,'data',(select to_jsonb(c) from public.restaurant_accounting_period_closes c where c.lodge_id=p_lodge_id and c.period_start=p_period_start and c.period_end=p_period_end));
end
$$;

-- Add a dedicated close capability without changing the existing capability API.
create or replace function public._restaurant_actor_has_capability(p_lodge_id uuid,p_capability text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_get_actor_user_id(); v_role text; v_overrides jsonb; v_override jsonb; v_default boolean:=false;
begin
  if auth.role()='service_role' then return true; end if;
  select lower(coalesce(u.role,'')),coalesce(u.capability_overrides,'{}'::jsonb) into v_role,v_overrides from public.users u where u.id=v_actor and u.lodge_id=p_lodge_id and coalesce(u.status,'active')='active';
  if not found then return false; end if;
  v_default:=case p_capability
    when 'accounting.read' then v_role in('finance','manager','admin','super_admin')
    when 'accounting.manage' then v_role in('finance','admin','super_admin')
    when 'accounting.ap_pay' then v_role in('finance','admin','super_admin')
    when 'accounting.bank_approve' then v_role in('finance','admin','super_admin')
    when 'accounting.tax_file' then v_role in('finance','admin','super_admin')
    when 'accounting.payroll_view' then v_role in('admin','super_admin')
    when 'accounting.payroll_manage' then v_role in('admin','super_admin')
    when 'accounting.close' then v_role in('finance','admin','super_admin')
    else false end;
  v_override:=v_overrides->p_capability;
  if v_override is not null and jsonb_typeof(v_override)='boolean' then return (v_override::text)::boolean; end if;
  return v_default;
end
$$;

revoke all on function public.set_restaurant_pos_gl_mapping(uuid,text,text,uuid),public.set_restaurant_pos_gl_mapping_v2(uuid,text,text,uuid,date,date,text),public.get_restaurant_pos_gl_mappings(uuid),public.restaurant_accounting_period_is_closed(uuid,date),public.restaurant_block_closed_accounting_period(),public.prepare_restaurant_period_close(uuid,date,date,text),public.approve_restaurant_period_close(uuid,uuid),public.reopen_restaurant_period_close(uuid,uuid,text),public.get_restaurant_period_close(uuid,date,date) from public,anon,authenticated;
grant execute on function public.set_restaurant_pos_gl_mapping(uuid,text,text,uuid),public.set_restaurant_pos_gl_mapping_v2(uuid,text,text,uuid,date,date,text),public.get_restaurant_pos_gl_mappings(uuid),public.prepare_restaurant_period_close(uuid,date,date,text),public.approve_restaurant_period_close(uuid,uuid),public.reopen_restaurant_period_close(uuid,uuid,text),public.get_restaurant_period_close(uuid,date,date) to service_role;

commit;
