-- Financial truth gate 6/9: bank evidence uses signed_amount = credit - debit
-- and matching is an allocation model with locks, not a loose proposal.

begin;

alter table public.restaurant_bank_statement_imports
  add column if not exists opening_balance numeric(18,2),
  add column if not exists closing_balance numeric(18,2),
  add column if not exists balance_policy text not null default 'every_row_balance_after';
alter table public.restaurant_bank_transactions
  add column if not exists signed_amount numeric(18,2),
  add column if not exists previous_balance numeric(18,2);

create or replace function public.restaurant_normalize_bank_transaction_sign()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 or (coalesce(new.debit,0)>0 and coalesce(new.credit,0)>0) or (coalesce(new.debit,0)=0 and coalesce(new.credit,0)=0) then raise exception 'A bank row must contain exactly one non-negative debit or credit amount' using errcode='22023'; end if;
  new.signed_amount:=round(coalesce(new.credit,0)-coalesce(new.debit,0),2);
  return new;
end
$$;
drop trigger if exists trg_restaurant_normalize_bank_transaction_sign on public.restaurant_bank_transactions;
create trigger trg_restaurant_normalize_bank_transaction_sign before insert or update of debit,credit on public.restaurant_bank_transactions for each row execute function public.restaurant_normalize_bank_transaction_sign();

create table if not exists public.restaurant_bank_match_allocations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bank_transaction_id uuid not null references public.restaurant_bank_transactions(id) on delete restrict,
  journal_entry_id uuid not null references public.restaurant_journal_entries(id) on delete restrict,
  journal_line_id uuid references public.restaurant_journal_lines(id) on delete restrict,
  allocated_amount numeric(18,2) not null check(allocated_amount>0),
  proposer_id uuid references public.users(id),
  reviewer_id uuid references public.users(id),
  evidence jsonb not null default '{}'::jsonb,
  reason text not null,
  status text not null default 'proposed' check(status in ('proposed','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(bank_transaction_id,journal_entry_id,journal_line_id)
);
alter table public.restaurant_bank_match_allocations enable row level security;
revoke all on table public.restaurant_bank_match_allocations from public,anon,authenticated;
grant select,insert,update on table public.restaurant_bank_match_allocations to service_role;

create or replace function public.import_bank_statement_v3(
  p_lodge_id uuid,p_bank_account_id uuid,p_rows jsonb,p_file_name text,p_operation_id text,
  p_opening_balance numeric,p_closing_balance numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_hash text; v_import uuid; v_existing record; v_row jsonb; v_prev numeric:=p_opening_balance; v_after numeric; v_debit numeric; v_credit numeric; v_date date; v_index integer:=0;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_opening_balance is null or p_closing_balance is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or nullif(btrim(p_operation_id),'') is null then raise exception 'Opening/closing evidence, rows and stable operation ID are required' using errcode='22023'; end if;
  if not exists(select 1 from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id and is_active) then raise exception 'Bank account is invalid for the lodge' using errcode='42501'; end if;
  v_hash:=encode(digest(jsonb_build_object('bank_account_id',p_bank_account_id,'rows',p_rows,'opening_balance',p_opening_balance,'closing_balance',p_closing_balance)::text,'sha256'),'hex');
  select id,payload_hash into v_existing from public.restaurant_bank_statement_imports where lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and operation_idempotency_key=p_operation_id for update;
  if found then if v_existing.payload_hash<>v_hash then raise exception 'Bank import operation ID conflicts with different payload' using errcode='23505'; end if; return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true)); end if;
  insert into public.restaurant_bank_statement_imports(lodge_id,bank_account_id,statement_hash,file_name,row_count,imported_by,raw_payload,payload_hash,period_start,period_end,operation_idempotency_key,opening_balance,closing_balance,balance_policy)
  values(p_lodge_id,p_bank_account_id,v_hash,nullif(btrim(p_file_name),''),jsonb_array_length(p_rows),v_actor,p_rows,v_hash,nullif(p_rows->0->>'transaction_date','')::date,nullif(p_rows->(jsonb_array_length(p_rows)-1)->>'transaction_date','')::date,p_operation_id,p_opening_balance,p_closing_balance,'every_row_balance_after') returning id into v_import;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_date:=nullif(v_row->>'transaction_date','')::date; v_debit:=coalesce(nullif(v_row->>'debit','')::numeric,0); v_credit:=coalesce(nullif(v_row->>'credit','')::numeric,0); v_after:=nullif(v_row->>'balance_after','')::numeric;
    if v_date is null or nullif(btrim(v_row->>'description'),'') is null or v_after is null or not ((v_debit>0 and v_credit=0) or (v_credit>0 and v_debit=0)) then raise exception 'Every imported row requires date, description, one debit/credit and balance_after' using errcode='22023'; end if;
    if round(v_after-(v_prev+v_credit-v_debit),2)<>0 then raise exception 'Bank running balance does not equal previous_balance + credit - debit at row %',v_index+1 using errcode='23514'; end if;
    insert into public.restaurant_bank_transactions(lodge_id,bank_account_id,transaction_date,description,debit,credit,balance_after,previous_balance,signed_amount,reference_number,category,fingerprint,statement_import_id)
    values(p_lodge_id,p_bank_account_id,v_date,btrim(v_row->>'description'),v_debit,v_credit,v_after,v_prev,round(v_credit-v_debit,2),nullif(btrim(v_row->>'reference_number'),''),nullif(btrim(v_row->>'category'),''),encode(digest(concat_ws('|',p_bank_account_id::text,v_date,btrim(v_row->>'description'),v_debit,v_credit,v_after),'sha256'),'hex'),v_import);
    v_prev:=v_after; v_index:=v_index+1;
  end loop;
  if round(v_prev-p_closing_balance,2)<>0 then raise exception 'Bank closing balance evidence does not equal the final row balance' using errcode='23514'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_import,'replayed',false,'row_count',v_index,'opening_balance',p_opening_balance,'closing_balance',p_closing_balance,'signed_amount_policy','credit - debit','balance_policy','every_row_balance_after','payload_hash',v_hash));
end
$$;

create or replace function public.propose_bank_match_allocations_v1(p_lodge_id uuid,p_bank_transaction_id uuid,p_allocations jsonb,p_reason text,p_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_tx public.restaurant_bank_transactions%rowtype; v_row jsonb; v_entry uuid; v_line uuid; v_amount numeric; v_available numeric; v_requested numeric:=0; v_id uuid; v_ids jsonb:='[]'::jsonb;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_tx from public.restaurant_bank_transactions where id=p_bank_transaction_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Bank transaction was not found' using errcode='P0002'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 or nullif(btrim(p_reason),'') is null then raise exception 'Match allocations, reason and evidence are required' using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(p_allocations) loop
    v_entry:=nullif(v_row->>'journal_entry_id','')::uuid; v_line:=nullif(v_row->>'journal_line_id','')::uuid; v_amount:=round(coalesce((v_row->>'allocated_amount')::numeric,0),2);
    if v_entry is null or v_amount<=0 or not exists(select 1 from public.restaurant_journal_entries e where e.id=v_entry and e.lodge_id=p_lodge_id and e.is_posted) then raise exception 'Allocation journal evidence is invalid' using errcode='23503'; end if;
    if v_line is not null and not exists(select 1 from public.restaurant_journal_lines l where l.id=v_line and l.entry_id=v_entry) then raise exception 'Allocation journal line does not belong to the journal entry' using errcode='23503'; end if;
    select greatest(abs(coalesce(case when v_tx.signed_amount>=0 then (select sum(l.debit-l.credit) from public.restaurant_journal_lines l where l.entry_id=v_entry) else (select sum(l.credit-l.debit) from public.restaurant_journal_lines l where l.entry_id=v_entry) end,0))-coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m where m.journal_entry_id=v_entry and m.lodge_id=p_lodge_id and m.status='approved'),0),0) into v_available;
    if v_requested+v_amount>v_available then raise exception 'Journal amount is overallocated' using errcode='23514'; end if;
    select greatest(abs(coalesce(v_tx.signed_amount,0))-coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m where m.bank_transaction_id=v_tx.id and m.status='approved'),0),0) into v_available;
    if v_requested+v_amount>v_available then raise exception 'Bank row is overallocated' using errcode='23514'; end if;
    insert into public.restaurant_bank_match_allocations(lodge_id,bank_transaction_id,journal_entry_id,journal_line_id,allocated_amount,proposer_id,evidence,reason) values(p_lodge_id,v_tx.id,v_entry,v_line,v_amount,v_actor,coalesce(p_evidence,'{}'::jsonb),btrim(p_reason)) returning id into v_id;
    v_ids:=v_ids||jsonb_build_array(v_id);
    v_requested:=v_requested+v_amount;
  end loop;
  return jsonb_build_object('success',true,'data',jsonb_build_object('allocation_ids',v_ids,'status','proposed'));
end
$$;

create or replace function public.review_bank_match_allocation_v1(p_lodge_id uuid,p_allocation_id uuid,p_approve boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_row public.restaurant_bank_match_allocations%rowtype; v_tx public.restaurant_bank_transactions%rowtype; v_entry public.restaurant_journal_entries%rowtype;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_row from public.restaurant_bank_match_allocations where id=p_allocation_id and lodge_id=p_lodge_id for update;
  if not found or v_row.status<>'proposed' then raise exception 'Bank allocation is missing or already reviewed' using errcode='22023'; end if;
  if v_row.proposer_id=v_actor then raise exception 'The proposer cannot approve the same bank allocation' using errcode='42501'; end if;
  select * into v_tx from public.restaurant_bank_transactions where id=v_row.bank_transaction_id and lodge_id=p_lodge_id for update;
  select * into v_entry from public.restaurant_journal_entries where id=v_row.journal_entry_id and lodge_id=p_lodge_id for update;
  if p_approve and (coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='approved'),0)+v_row.allocated_amount)>abs(coalesce(v_tx.signed_amount,0)) then raise exception 'Bank row allocations exceed signed amount' using errcode='23514'; end if;
  if p_approve and coalesce((select sum(case when v_tx.signed_amount>=0 then l.debit-l.credit else l.credit-l.debit end) from public.restaurant_journal_lines l where l.entry_id=v_entry.id),0)<coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where journal_entry_id=v_entry.id and status='approved'),0)+v_row.allocated_amount then raise exception 'Journal allocations exceed journal evidence' using errcode='23514'; end if;
  update public.restaurant_bank_match_allocations set status=case when p_approve then 'approved' else 'rejected' end,reviewer_id=v_actor,reviewed_at=now(),reason=case when nullif(btrim(p_reason),'') is null then reason else btrim(p_reason) end where id=v_row.id;
  if p_approve and not exists(select 1 from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='proposed') and coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='approved'),0)=abs(coalesce(v_tx.signed_amount,0)) then update public.restaurant_bank_transactions set is_reconciled=true,reconciled_entry_id=v_entry.id where id=v_tx.id; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status',case when p_approve then 'approved' else 'rejected' end,'reviewer_id',v_actor));
end
$$;

revoke all on function public.restaurant_normalize_bank_transaction_sign(),public.import_bank_statement_v3(uuid,uuid,jsonb,text,text,numeric,numeric),public.propose_bank_match_allocations_v1(uuid,uuid,jsonb,text,jsonb),public.review_bank_match_allocation_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.restaurant_normalize_bank_transaction_sign() to service_role;
grant execute on function public.import_bank_statement_v3(uuid,uuid,jsonb,text,text,numeric,numeric),public.propose_bank_match_allocations_v1(uuid,uuid,jsonb,text,jsonb),public.review_bank_match_allocation_v1(uuid,uuid,boolean,text) to service_role;

commit;
