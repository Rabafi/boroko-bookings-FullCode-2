-- Keep matched statement rows selectable until packet completion seals reconciliation.
begin;
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
  if p_approve and not exists(select 1 from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='proposed') and coalesce((select sum(allocated_amount) from public.restaurant_bank_match_allocations where bank_transaction_id=v_tx.id and status='approved'),0)=abs(coalesce(v_tx.signed_amount,0)) then
    -- Matching evidence is staged until an independently reviewed packet is completed.
    update public.restaurant_bank_transactions set reconciled_entry_id=v_entry.id where id=v_tx.id;
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_row.id,'status',case when p_approve then 'approved' else 'rejected' end,'reviewer_id',v_actor));
end
$$;
commit;
