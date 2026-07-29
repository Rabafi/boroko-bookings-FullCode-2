-- Restaurant Accounting bank evidence, matching, reconciliation and period-lock rebuild.
-- Operator execution remains revoked.

begin;

alter table public.restaurant_bank_statement_imports
  add column if not exists raw_payload jsonb,
  add column if not exists payload_hash text,
  add column if not exists period_start date,
  add column if not exists period_end date;

alter table public.restaurant_bank_transactions
  add column if not exists statement_import_id uuid references public.restaurant_bank_statement_imports(id) on delete restrict,
  add column if not exists reconciliation_id uuid references public.restaurant_bank_reconciliations(id) on delete restrict,
  add column if not exists exception_reason text,
  add column if not exists exception_by uuid references public.users(id),
  add column if not exists exception_at timestamptz;

alter table public.restaurant_bank_reconciliations
  add column if not exists statement_import_id uuid references public.restaurant_bank_statement_imports(id) on delete restrict,
  add column if not exists completed_by uuid references public.users(id);

create table if not exists public.restaurant_reconciliation_adjustments(
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  reconciliation_id uuid not null references public.restaurant_bank_reconciliations(id) on delete restrict,
  journal_entry_id uuid not null references public.restaurant_journal_entries(id) on delete restrict,
  reason text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique(reconciliation_id,journal_entry_id)
);
alter table public.restaurant_reconciliation_adjustments enable row level security;
revoke all on table public.restaurant_reconciliation_adjustments from public,anon,authenticated;
grant select,insert on table public.restaurant_reconciliation_adjustments to service_role;

create table if not exists public.restaurant_accounting_period_locks(
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  locked_through date not null,
  source_type text not null,
  source_id uuid not null,
  locked_by uuid references public.users(id),
  locked_at timestamptz not null default now(),
  unique(lodge_id,source_type,source_id)
);
alter table public.restaurant_accounting_period_locks enable row level security;
revoke all on table public.restaurant_accounting_period_locks from public,anon,authenticated;
grant select,insert on table public.restaurant_accounting_period_locks to service_role;

create or replace function public._restaurant_guard_locked_period()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.restaurant_accounting_period_locks where lodge_id=new.lodge_id and new.entry_date<=locked_through) then
    raise exception 'Accounting period is locked through this journal date' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function public._restaurant_guard_locked_period() from public,anon,authenticated;
drop trigger if exists restaurant_journal_period_lock on public.restaurant_journal_entries;
create trigger restaurant_journal_period_lock before insert on public.restaurant_journal_entries
for each row execute function public._restaurant_guard_locked_period();

create or replace function public._restaurant_guard_statement_evidence()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Imported bank statement evidence is immutable' using errcode='55000'; end if;
  if old.lodge_id is distinct from new.lodge_id or old.bank_account_id is distinct from new.bank_account_id
     or old.transaction_date is distinct from new.transaction_date or old.description is distinct from new.description
     or old.debit is distinct from new.debit or old.credit is distinct from new.credit
     or old.balance_after is distinct from new.balance_after or old.reference_number is distinct from new.reference_number
     or old.fingerprint is distinct from new.fingerprint or old.statement_import_id is distinct from new.statement_import_id then
    raise exception 'Imported bank transaction evidence is immutable' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function public._restaurant_guard_statement_evidence() from public,anon,authenticated;
drop trigger if exists restaurant_bank_transactions_evidence_immutable on public.restaurant_bank_transactions;
create trigger restaurant_bank_transactions_evidence_immutable before update or delete on public.restaurant_bank_transactions
for each row execute function public._restaurant_guard_statement_evidence();

create or replace function public._restaurant_block_statement_import_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
begin raise exception 'Imported bank statement evidence is immutable' using errcode='55000'; end $$;
revoke all on function public._restaurant_block_statement_import_mutation() from public,anon,authenticated;
drop trigger if exists restaurant_bank_statement_imports_immutable on public.restaurant_bank_statement_imports;
create trigger restaurant_bank_statement_imports_immutable before update or delete on public.restaurant_bank_statement_imports
for each row execute function public._restaurant_block_statement_import_mutation();

create or replace function public.import_bank_statement_v2(
 p_lodge_id uuid,p_bank_account_id uuid,p_transactions jsonb,p_file_name text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_hash text;v_import uuid;v_existing record;v_tx jsonb;v_fp text;v_count int:=0;v_start date;v_end date;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if jsonb_typeof(p_transactions)<>'array' or jsonb_array_length(p_transactions)=0 or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Statement rows and idempotency key are required' using errcode='22023';end if;
 if not exists(select 1 from public.restaurant_bank_accounts b join public.restaurant_accounts a on a.id=b.account_id and a.lodge_id=p_lodge_id and a.is_active where b.id=p_bank_account_id and b.lodge_id=p_lodge_id and b.is_active) then raise exception 'Active lodge bank/GL account not found' using errcode='23503';end if;
 v_hash:=encode(digest(jsonb_build_object('bank_account_id',p_bank_account_id,'transactions',p_transactions)::text,'sha256'),'hex');
 select id,payload_hash into v_existing from public.restaurant_bank_statement_imports where bank_account_id=p_bank_account_id and statement_hash=p_idempotency_key;
 if found then
  if v_existing.payload_hash is distinct from v_hash then raise exception 'Statement idempotency key conflicts with different evidence' using errcode='23505';end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true));
 end if;
 for v_tx in select value from jsonb_array_elements(p_transactions) loop
  if nullif(btrim(v_tx->>'description'),'') is null or nullif(v_tx->>'transaction_date','') is null
     or not ((coalesce((v_tx->>'debit')::numeric,0)>0 and coalesce((v_tx->>'credit')::numeric,0)=0) or (coalesce((v_tx->>'credit')::numeric,0)>0 and coalesce((v_tx->>'debit')::numeric,0)=0)) then
   raise exception 'Each statement row requires a date, description, and one positive debit or credit' using errcode='22023';
  end if;
  v_start:=least(coalesce(v_start,(v_tx->>'transaction_date')::date),(v_tx->>'transaction_date')::date);
  v_end:=greatest(coalesce(v_end,(v_tx->>'transaction_date')::date),(v_tx->>'transaction_date')::date);
 end loop;
 insert into public.restaurant_bank_statement_imports(lodge_id,bank_account_id,statement_hash,file_name,row_count,imported_by,raw_payload,payload_hash,period_start,period_end)
 values(p_lodge_id,p_bank_account_id,p_idempotency_key,nullif(btrim(p_file_name),''),jsonb_array_length(p_transactions),v_actor,p_transactions,v_hash,v_start,v_end) returning id into v_import;
 for v_tx in select value from jsonb_array_elements(p_transactions) loop
  v_fp:=encode(digest(concat_ws('|',p_bank_account_id::text,v_tx->>'transaction_date',btrim(v_tx->>'description'),coalesce(v_tx->>'debit','0'),coalesce(v_tx->>'credit','0'),coalesce(v_tx->>'balance_after',''),coalesce(v_tx->>'reference_number','')),'sha256'),'hex');
  insert into public.restaurant_bank_transactions(lodge_id,bank_account_id,transaction_date,description,debit,credit,balance_after,reference_number,category,fingerprint,statement_import_id)
  values(p_lodge_id,p_bank_account_id,(v_tx->>'transaction_date')::date,btrim(v_tx->>'description'),coalesce((v_tx->>'debit')::numeric,0),coalesce((v_tx->>'credit')::numeric,0),nullif(v_tx->>'balance_after','')::numeric,nullif(btrim(v_tx->>'reference_number'),''),nullif(btrim(v_tx->>'category'),''),v_fp,v_import);
  v_count:=v_count+1;
 end loop;
 perform public.log_restaurant_financial_action(p_lodge_id,'bank_statement.imported','restaurant_bank_statement_imports',v_import,null,jsonb_build_object('row_count',v_count,'payload_hash',v_hash),null);
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_import,'imported',v_count,'replayed',false));
end $$;

create or replace function public.propose_bank_matches_v2(p_lodge_id uuid,p_bank_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_count int;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if not exists(select 1 from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id and is_active) then raise exception 'Active bank account not found' using errcode='23503';end if;
 with candidates as(
  select distinct on(bt.id) bt.id bt_id,e.id entry_id,
   case when bt.transaction_date=e.entry_date then 1.0 when abs(bt.transaction_date-e.entry_date)<=1 then .9 else .7 end confidence
  from public.restaurant_bank_transactions bt
  join public.restaurant_bank_accounts ba on ba.id=bt.bank_account_id and ba.lodge_id=p_lodge_id
  join public.restaurant_journal_lines l on l.account_id=ba.account_id
  join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id
  where bt.lodge_id=p_lodge_id and bt.bank_account_id=p_bank_account_id and not bt.is_reconciled and bt.reconciled_entry_id is null
   and abs(bt.transaction_date-e.entry_date)<=3
   and ((bt.debit>0 and l.credit=bt.debit and l.debit=0) or(bt.credit>0 and l.debit=bt.credit and l.credit=0))
   and not exists(select 1 from public.restaurant_match_proposals p where p.bank_transaction_id=bt.id and p.status in('pending','approved'))
  order by bt.id,confidence desc,e.id
 ),ins as(
  insert into public.restaurant_match_proposals(lodge_id,bank_account_id,bank_transaction_id,journal_entry_id,confidence,proposed_by)
  select p_lodge_id,p_bank_account_id,bt_id,entry_id,confidence,v_actor from candidates returning 1
 )select count(*) into v_count from ins;
 return jsonb_build_object('success',true,'data',jsonb_build_object('proposed',v_count));
end $$;

create or replace function public.review_bank_match_v2(p_lodge_id uuid,p_proposal_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_p public.restaurant_match_proposals%rowtype;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
 select * into v_p from public.restaurant_match_proposals where id=p_proposal_id and lodge_id=p_lodge_id for update;
 if not found or v_p.status<>'pending' then raise exception 'Pending match proposal not found' using errcode='22023';end if;
 if v_p.proposed_by=v_actor then raise exception 'Match proposer cannot approve the same match' using errcode='42501';end if;
 update public.restaurant_match_proposals set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=v_actor,reviewed_at=now() where id=p_proposal_id;
 if p_approve then update public.restaurant_bank_transactions set reconciled_entry_id=v_p.journal_entry_id where id=v_p.bank_transaction_id and lodge_id=p_lodge_id and not is_reconciled;end if;
 perform public.log_restaurant_financial_action(p_lodge_id,case when p_approve then 'bank_match.approved' else 'bank_match.rejected' end,'restaurant_match_proposals',p_proposal_id,to_jsonb(v_p),jsonb_build_object('reviewed_by',v_actor),null);
 return jsonb_build_object('success',true);
end $$;

create or replace function public.set_bank_transaction_exception(p_lodge_id uuid,p_transaction_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if nullif(btrim(p_reason),'') is null then raise exception 'Exception reason is required' using errcode='22023';end if;
 update public.restaurant_bank_transactions set exception_reason=btrim(p_reason),exception_by=v_actor,exception_at=now()
 where id=p_transaction_id and lodge_id=p_lodge_id and not is_reconciled;
 if not found then raise exception 'Open bank transaction not found' using errcode='P0002';end if;
 return jsonb_build_object('success',true);
end $$;

create or replace function public.create_bank_reconciliation_v2(
 p_lodge_id uuid,p_bank_account_id uuid,p_statement_import_id uuid,p_statement_balance numeric,
 p_reconciliation_date date,p_transaction_ids uuid[],p_adjustments jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_bank public.restaurant_bank_accounts%rowtype;v_id uuid;v_book numeric;v_diff numeric;v_count int;v_adj jsonb;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 select * into v_bank from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id and is_active for update;
 if not found or p_reconciliation_date is null or p_statement_balance is null or coalesce(array_length(p_transaction_ids,1),0)=0 then raise exception 'Active bank account, statement balance/date, and transactions are required' using errcode='22023';end if;
 if not exists(select 1 from public.restaurant_bank_statement_imports where id=p_statement_import_id and lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and period_end<=p_reconciliation_date) then raise exception 'Statement import evidence does not match this reconciliation' using errcode='23503';end if;
 select count(*) into v_count from public.restaurant_bank_transactions where id=any(p_transaction_ids) and lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and statement_import_id=p_statement_import_id and not is_reconciled and reconciliation_id is null and (reconciled_entry_id is not null or exception_reason is not null);
 if v_count<>array_length(p_transaction_ids,1) then raise exception 'Every selected statement row needs an approved match or documented exception' using errcode='23514';end if;
 select coalesce(sum(l.debit-l.credit),0) into v_book from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_reconciliation_date and l.account_id=v_bank.account_id;
 v_diff:=round(p_statement_balance-v_book,2);
 insert into public.restaurant_bank_reconciliations(lodge_id,bank_account_id,reconciliation_date,statement_balance,book_balance,difference,status,reconciled_by,statement_import_id)
 values(p_lodge_id,p_bank_account_id,p_reconciliation_date,p_statement_balance,v_book,v_diff,'draft',v_actor,p_statement_import_id) returning id into v_id;
 update public.restaurant_bank_transactions set reconciliation_id=v_id where id=any(p_transaction_ids) and lodge_id=p_lodge_id;
 for v_adj in select value from jsonb_array_elements(coalesce(p_adjustments,'[]'::jsonb)) loop
  if nullif(btrim(v_adj->>'reason'),'') is null or not exists(select 1 from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.id=(v_adj->>'journal_entry_id')::uuid and e.lodge_id=p_lodge_id and l.account_id=v_bank.account_id) then raise exception 'Adjustment requires reason and a lodge journal affecting this bank account' using errcode='23503';end if;
  insert into public.restaurant_reconciliation_adjustments(lodge_id,reconciliation_id,journal_entry_id,reason,created_by) values(p_lodge_id,v_id,(v_adj->>'journal_entry_id')::uuid,btrim(v_adj->>'reason'),v_actor);
 end loop;
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'book_balance',v_book,'difference',v_diff));
end $$;

create or replace function public.complete_bank_reconciliation_v2(p_lodge_id uuid,p_reconciliation_id uuid,p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_r public.restaurant_bank_reconciliations%rowtype;v_bank public.restaurant_bank_accounts%rowtype;v_book numeric;v_open int;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
 select * into v_r from public.restaurant_bank_reconciliations where id=p_reconciliation_id and lodge_id=p_lodge_id for update;
 if not found or v_r.status<>'draft' then raise exception 'Draft reconciliation not found' using errcode='22023';end if;
 if v_r.reconciled_by=v_actor then raise exception 'Reconciliation preparer cannot complete it' using errcode='42501';end if;
 select * into v_bank from public.restaurant_bank_accounts where id=v_r.bank_account_id and lodge_id=p_lodge_id for update;
 select coalesce(sum(l.debit-l.credit),0) into v_book from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=v_r.reconciliation_date and l.account_id=v_bank.account_id;
 if round(v_r.statement_balance-v_book,2)<>0 then raise exception 'Reconciliation difference must be zero at completion' using errcode='23514';end if;
 select count(*) into v_open from public.restaurant_bank_transactions where lodge_id=p_lodge_id and bank_account_id=v_r.bank_account_id and transaction_date<=v_r.reconciliation_date and not is_reconciled and reconciliation_id is distinct from p_reconciliation_id;
 if v_open>0 then raise exception 'Earlier unmatched bank transactions prevent completion' using errcode='23514';end if;
 update public.restaurant_bank_transactions set is_reconciled=true where reconciliation_id=p_reconciliation_id and lodge_id=p_lodge_id;
 update public.restaurant_bank_reconciliations set status='completed',difference=0,book_balance=v_book,notes=nullif(btrim(p_notes),''),completed_by=v_actor,completed_at=now() where id=p_reconciliation_id;
 insert into public.restaurant_accounting_period_locks(lodge_id,locked_through,source_type,source_id,locked_by) values(p_lodge_id,v_r.reconciliation_date,'bank_reconciliation',p_reconciliation_id,v_actor);
 perform public.log_restaurant_financial_action(p_lodge_id,'bank_reconciliation.completed','restaurant_bank_reconciliations',p_reconciliation_id,to_jsonb(v_r),jsonb_build_object('book_balance',v_book,'locked_through',v_r.reconciliation_date),null);
 return jsonb_build_object('success',true,'data',jsonb_build_object('book_balance',v_book,'locked_through',v_r.reconciliation_date));
end $$;

revoke all on function public.import_bank_statement_v2(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.propose_bank_matches_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function public.review_bank_match_v2(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.set_bank_transaction_exception(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.create_bank_reconciliation_v2(uuid,uuid,uuid,numeric,date,uuid[],jsonb) from public,anon,authenticated;
revoke all on function public.complete_bank_reconciliation_v2(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.import_bank_statement_v2(uuid,uuid,jsonb,text,text) to service_role;
grant execute on function public.propose_bank_matches_v2(uuid,uuid) to service_role;
grant execute on function public.review_bank_match_v2(uuid,uuid,boolean) to service_role;
grant execute on function public.set_bank_transaction_exception(uuid,uuid,text) to service_role;
grant execute on function public.create_bank_reconciliation_v2(uuid,uuid,uuid,numeric,date,uuid[],jsonb) to service_role;
grant execute on function public.complete_bank_reconciliation_v2(uuid,uuid,text) to service_role;

commit;
