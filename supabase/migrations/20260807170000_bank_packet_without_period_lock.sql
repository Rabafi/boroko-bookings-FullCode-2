-- Completing a bank-account reconciliation produces a packet. It does not
-- insert a lodge-wide accounting period lock; period close is a separate gate.

begin;

create or replace function public.complete_bank_reconciliation_v2(p_lodge_id uuid,p_reconciliation_id uuid,p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_r public.restaurant_bank_reconciliations%rowtype;v_bank public.restaurant_bank_accounts%rowtype;v_book numeric;v_open int;v_hash text;v_packet uuid;v_statement_evidence text;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_r from public.restaurant_bank_reconciliations where id=p_reconciliation_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Reconciliation not found' using errcode='P0002'; end if;
  if v_r.status='completed' then return jsonb_build_object('success',true,'data',jsonb_build_object('reconciliation_id',p_reconciliation_id,'replayed',true)); end if;
  if v_r.status<>'draft' then raise exception 'Draft reconciliation not found' using errcode='22023'; end if;
  if v_r.reconciled_by=v_actor then raise exception 'Reconciliation preparer cannot complete it' using errcode='42501'; end if;
  select * into v_bank from public.restaurant_bank_accounts where id=v_r.bank_account_id and lodge_id=p_lodge_id for update;
  select coalesce(sum(l.debit-l.credit),0) into v_book from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=v_r.reconciliation_date and l.account_id=v_bank.account_id;
  if round(v_r.statement_balance-v_book,2)<>0 then raise exception 'Reconciliation difference must be zero at completion' using errcode='23514'; end if;
  select count(*) into v_open from public.restaurant_bank_transactions where lodge_id=p_lodge_id and bank_account_id=v_r.bank_account_id and transaction_date<=v_r.reconciliation_date and not is_reconciled and reconciliation_id is distinct from p_reconciliation_id;
  if v_open>0 then raise exception 'Earlier unmatched bank transactions prevent completion' using errcode='23514'; end if;
  select coalesce(nullif(i.payload_hash,''),nullif(i.statement_hash,'')) into v_statement_evidence from public.restaurant_bank_statement_imports i where i.id=v_r.statement_import_id and i.lodge_id=p_lodge_id;
  if v_statement_evidence is null then raise exception 'Immutable statement import evidence is required' using errcode='23503'; end if;
  v_hash:=v_statement_evidence;
  insert into public.restaurant_bank_reconciliation_packets(lodge_id,bank_account_id,statement_import_id,statement_hash,book_balance,bank_balance,difference,control_totals,status,prepared_by,reviewed_by,completed_at)
  values(p_lodge_id,v_r.bank_account_id,v_r.statement_import_id,v_hash,v_book,v_r.statement_balance,0,jsonb_build_object('reconciliation_id',p_reconciliation_id,'statement_rows',(select count(*) from public.restaurant_bank_transactions where reconciliation_id=p_reconciliation_id),'matched_rows',(select count(*) from public.restaurant_bank_transactions where reconciliation_id=p_reconciliation_id and reconciled_entry_id is not null),'exception_rows',(select count(*) from public.restaurant_bank_transactions where reconciliation_id=p_reconciliation_id and exception_reason is not null),'notes',p_notes),'complete',v_r.reconciled_by,v_actor,now()) returning id into v_packet;
  update public.restaurant_bank_transactions set is_reconciled=true where reconciliation_id=p_reconciliation_id and lodge_id=p_lodge_id;
  update public.restaurant_bank_reconciliations set status='completed',difference=0,book_balance=v_book,notes=nullif(btrim(p_notes),''),completed_by=v_actor,completed_at=now() where id=p_reconciliation_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_reconciliation.completed','restaurant_bank_reconciliations',p_reconciliation_id,to_jsonb(v_r),jsonb_build_object('book_balance',v_book,'packet_id',v_packet,'period_lock_created',false),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('book_balance',v_book,'packet_id',v_packet,'period_lock_created',false));
end
$$;

revoke all on function public.complete_bank_reconciliation_v2(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_bank_reconciliation_v2(uuid,uuid,text) to authenticated,service_role;

commit;
