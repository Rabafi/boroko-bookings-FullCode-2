-- Forward compatibility hardening for multi-tender returns and immutable
-- bank matching.  Existing single-tender ledger uniqueness must not prevent
-- two distinct account/voucher tenders on one order.

begin;

drop index if exists public.restaurant_account_ledger_dedup_idx;
create unique index if not exists restaurant_account_ledger_order_tender_uidx
  on public.restaurant_account_ledger(lodge_id,order_id,tender_id)
  where order_id is not null and tender_id is not null;

create or replace function public.restaurant_prepare_return_tender_correction()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row record;
begin
  if coalesce(old.transaction_type,'')<>'return' or old.payment_breakdown is not distinct from new.payment_breakdown then
    return new;
  end if;
  for v_row in
    select customer_id,sum(amount) amount
    from public.restaurant_account_ledger
    where lodge_id=old.lodge_id and order_id=old.id
    group by customer_id
  loop
    update public.restaurant_customers
       set total_spent=greatest(0,total_spent-v_row.amount),updated_at=now()
     where id=v_row.customer_id and lodge_id=old.lodge_id;
  end loop;
  delete from public.restaurant_account_ledger where lodge_id=old.lodge_id and order_id=old.id;
  for v_row in
    select voucher_id,sum(amount) amount
    from public.restaurant_voucher_ledger
    where lodge_id=old.lodge_id and order_id=old.id
    group by voucher_id
  loop
    update public.restaurant_vouchers
       set remaining_value=least(initial_value,remaining_value-v_row.amount),
           status=case when remaining_value-v_row.amount=0 then 'redeemed' else 'active' end,
           updated_at=now()
     where id=v_row.voucher_id and lodge_id=old.lodge_id;
  end loop;
  delete from public.restaurant_voucher_ledger where lodge_id=old.lodge_id and order_id=old.id;
  delete from public.restaurant_pos_tender_allocations where lodge_id=old.lodge_id and order_id=old.id;
  return new;
end
$$;

create or replace function public.propose_bank_match_allocations_v1(
  p_lodge_id uuid,p_bank_transaction_id uuid,p_allocations jsonb,p_reason text,p_evidence jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_tx public.restaurant_bank_transactions%rowtype; v_row jsonb;
  v_entry uuid; v_line uuid; v_amount numeric; v_available numeric;
  v_requested numeric:=0; v_id uuid; v_ids jsonb:='[]'::jsonb;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_tx from public.restaurant_bank_transactions where id=p_bank_transaction_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Bank transaction was not found' using errcode='P0002'; end if;
  if v_tx.is_reconciled then raise exception 'Completed bank reconciliation cannot be mutated' using errcode='55000'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 or nullif(btrim(p_reason),'') is null then raise exception 'Match allocations, reason and evidence are required' using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(p_allocations) loop
    v_entry:=nullif(v_row->>'journal_entry_id','')::uuid;
    v_line:=nullif(v_row->>'journal_line_id','')::uuid;
    v_amount:=round(coalesce((v_row->>'allocated_amount')::numeric,0),2);
    if v_entry is null or v_amount<=0 then raise exception 'Allocation journal evidence is invalid' using errcode='23503'; end if;
    select e.id into v_entry from public.restaurant_journal_entries e where e.id=v_entry and e.lodge_id=p_lodge_id and e.is_posted for update;
    if not found then raise exception 'Allocation journal evidence is invalid' using errcode='23503'; end if;
    if v_line is not null and not exists(select 1 from public.restaurant_journal_lines l where l.id=v_line and l.entry_id=v_entry) then raise exception 'Allocation journal line does not belong to the journal entry' using errcode='23503'; end if;
    select greatest(
      case when v_line is not null then abs(coalesce((select l.debit-l.credit from public.restaurant_journal_lines l where l.id=v_line),0))
           else greatest(coalesce((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=v_entry),0),coalesce((select sum(l.credit) from public.restaurant_journal_lines l where l.entry_id=v_entry),0)) end
      -coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m where m.journal_entry_id=v_entry and m.lodge_id=p_lodge_id and m.status in ('approved','proposed')),0),0
    ,0) into v_available;
    if v_requested+v_amount>v_available then raise exception 'Journal amount is overallocated' using errcode='23514'; end if;
    select greatest(abs(coalesce(v_tx.signed_amount,0))-coalesce((select sum(m.allocated_amount) from public.restaurant_bank_match_allocations m where m.bank_transaction_id=v_tx.id and m.status in ('approved','proposed')),0),0) into v_available;
    if v_requested+v_amount>v_available then raise exception 'Bank row is overallocated' using errcode='23514'; end if;
    insert into public.restaurant_bank_match_allocations(lodge_id,bank_transaction_id,journal_entry_id,journal_line_id,allocated_amount,proposer_id,evidence,reason)
    values(p_lodge_id,v_tx.id,v_entry,v_line,v_amount,v_actor,coalesce(p_evidence,'{}'::jsonb),btrim(p_reason)) returning id into v_id;
    v_ids:=v_ids||jsonb_build_array(v_id); v_requested:=v_requested+v_amount;
  end loop;
  return jsonb_build_object('success',true,'data',jsonb_build_object('allocation_ids',v_ids,'status','proposed'));
end
$$;

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
  if p_approve and not exists(select 1 from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status in ('proposed','rejected')) and coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='approved'),0)=abs(coalesce(v_tx.signed_amount,0)) then update public.restaurant_bank_transactions set is_reconciled=true,reconciled_entry_id=v_entry.id where id=v_tx.id; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status',case when p_approve then 'approved' else 'rejected' end,'reviewer_id',v_actor));
end
$$;

revoke all on function public.restaurant_prepare_return_tender_correction(),public.propose_bank_match_allocations_v1(uuid,uuid,jsonb,text,jsonb),public.review_bank_match_allocation_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.restaurant_prepare_return_tender_correction(),public.propose_bank_match_allocations_v1(uuid,uuid,jsonb,text,jsonb),public.review_bank_match_allocation_v1(uuid,uuid,boolean,text) to service_role;

commit;
