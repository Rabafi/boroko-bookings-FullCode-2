-- Bank evidence hardening. A bank reconciliation is an evidence packet; it
-- does not close the lodge accounting period.

begin;

alter table public.restaurant_bank_statement_imports
  add column if not exists operation_idempotency_key text;
alter table public.restaurant_reconciliation_adjustments
  add column if not exists statement_transaction_id uuid references public.restaurant_bank_transactions(id) on delete restrict,
  add column if not exists evidence_ref text,
  add column if not exists approved_by uuid references public.users(id),
  add column if not exists approved_at timestamptz;
create unique index if not exists restaurant_reconciliation_adjustment_row_uidx
  on public.restaurant_reconciliation_adjustments(reconciliation_id, statement_transaction_id)
  where statement_transaction_id is not null;
alter table public.restaurant_match_proposals
  add column if not exists match_reason text;
create unique index if not exists restaurant_match_proposals_approved_row_uidx
  on public.restaurant_match_proposals(bank_transaction_id)
  where status = 'approved';

alter table public.restaurant_bank_reconciliation_packets
  add column if not exists opening_balance numeric(18,2),
  add column if not exists statement_closing_balance numeric(18,2),
  add column if not exists source_manifest jsonb not null default '{}'::jsonb,
  add column if not exists packet_hash text,
  add column if not exists report_run_id uuid references public.restaurant_report_runs(id) on delete restrict,
  add column if not exists reviewed_at timestamptz;

create or replace function public._restaurant_block_bank_packet_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Completed bank reconciliation packets are immutable; create a governed amendment packet' using errcode='55000';
end
$$;
revoke all on function public._restaurant_block_bank_packet_mutation() from public,anon,authenticated;
drop trigger if exists restaurant_bank_reconciliation_packets_immutable on public.restaurant_bank_reconciliation_packets;
create trigger restaurant_bank_reconciliation_packets_immutable
before update or delete on public.restaurant_bank_reconciliation_packets
for each row execute function public._restaurant_block_bank_packet_mutation();

-- Normalize import identity: statement_hash is derived from bank identity and
-- normalized row JSON; the operation key is retained solely for retry lookup.
create or replace function public.import_bank_statement_v2(
  p_lodge_id uuid, p_bank_account_id uuid, p_transactions jsonb,
  p_file_name text, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_hash text; v_statement_hash text; v_import uuid; v_existing record;
  v_tx jsonb; v_fp text; v_count integer := 0; v_start date; v_end date;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if jsonb_typeof(p_transactions) <> 'array' or jsonb_array_length(p_transactions) = 0 or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Statement rows and idempotency key are required' using errcode='22023';
  end if;
  if not exists (select 1 from public.restaurant_bank_accounts b join public.restaurant_accounts a on a.id=b.account_id and a.lodge_id=p_lodge_id and a.is_active where b.id=p_bank_account_id and b.lodge_id=p_lodge_id and b.is_active) then
    raise exception 'Active lodge bank/GL account not found' using errcode='23503';
  end if;
  v_hash := encode(digest(jsonb_build_object('bank_account_id',p_bank_account_id,'transactions',p_transactions,'file_name',p_file_name)::text,'sha256'),'hex');
  v_statement_hash := encode(digest(jsonb_build_object('bank_account_id',p_bank_account_id,'transactions',p_transactions)::text,'sha256'),'hex');
  select id,payload_hash into v_existing from public.restaurant_bank_statement_imports where lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and operation_idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then raise exception 'Statement retry key conflicts with different evidence' using errcode='23505'; end if;
    return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true));
  end if;
  if exists (select 1 from public.restaurant_bank_statement_imports where bank_account_id=p_bank_account_id and statement_hash=v_statement_hash) then
    raise exception 'This bank statement file and normalized rows were already imported' using errcode='23505';
  end if;
  for v_tx in select value from jsonb_array_elements(p_transactions) loop
    if nullif(btrim(v_tx->>'description'),'') is null or nullif(v_tx->>'transaction_date','') is null or
       not ((coalesce((v_tx->>'debit')::numeric,0)>0 and coalesce((v_tx->>'credit')::numeric,0)=0) or (coalesce((v_tx->>'credit')::numeric,0)>0 and coalesce((v_tx->>'debit')::numeric,0)=0)) then
      raise exception 'Each statement row requires a date, description, and one positive debit or credit' using errcode='22023';
    end if;
    v_start := least(coalesce(v_start,(v_tx->>'transaction_date')::date),(v_tx->>'transaction_date')::date);
    v_end := greatest(coalesce(v_end,(v_tx->>'transaction_date')::date),(v_tx->>'transaction_date')::date);
  end loop;
  insert into public.restaurant_bank_statement_imports(
    lodge_id,bank_account_id,statement_hash,file_name,row_count,imported_by,raw_payload,
    payload_hash,period_start,period_end,operation_idempotency_key
  ) values (p_lodge_id,p_bank_account_id,v_statement_hash,nullif(btrim(p_file_name),''),jsonb_array_length(p_transactions),v_actor,p_transactions,v_hash,v_start,v_end,p_idempotency_key)
  returning id into v_import;
  for v_tx in select value from jsonb_array_elements(p_transactions) loop
    v_fp := encode(digest(concat_ws('|',p_bank_account_id::text,v_tx->>'transaction_date',btrim(v_tx->>'description'),coalesce(v_tx->>'debit','0'),coalesce(v_tx->>'credit','0'),coalesce(v_tx->>'balance_after',''),coalesce(v_tx->>'reference_number','')),'sha256'),'hex');
    insert into public.restaurant_bank_transactions(
      lodge_id,bank_account_id,transaction_date,description,debit,credit,balance_after,reference_number,category,fingerprint,statement_import_id
    ) values (
      p_lodge_id,p_bank_account_id,(v_tx->>'transaction_date')::date,btrim(v_tx->>'description'),coalesce((v_tx->>'debit')::numeric,0),coalesce((v_tx->>'credit')::numeric,0),nullif(v_tx->>'balance_after','')::numeric,nullif(btrim(v_tx->>'reference_number'),''),nullif(btrim(v_tx->>'category'),''),v_fp,v_import
    );
    v_count := v_count + 1;
  end loop;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_statement.imported','restaurant_bank_statement_imports',v_import,null,jsonb_build_object('row_count',v_count,'payload_hash',v_hash,'statement_hash',v_statement_hash),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_import,'imported',v_count,'replayed',false,'statement_hash',v_statement_hash,'payload_hash',v_hash));
end
$$;

create or replace function public.review_bank_match_v2(p_lodge_id uuid,p_proposal_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_p public.restaurant_match_proposals%rowtype; v_t public.restaurant_bank_transactions%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_p from public.restaurant_match_proposals where id=p_proposal_id and lodge_id=p_lodge_id for update;
  if not found or v_p.status <> 'pending' then raise exception 'Pending match proposal not found' using errcode='22023'; end if;
  if v_p.proposed_by = v_actor then raise exception 'Match proposer cannot approve the same match' using errcode='42501'; end if;
  select * into v_t from public.restaurant_bank_transactions where id=v_p.bank_transaction_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Bank transaction evidence was not found' using errcode='P0002'; end if;
  if p_approve and (v_t.is_reconciled or v_t.reconciled_entry_id is not null) then raise exception 'Bank row is already reconciled to a journal' using errcode='23505'; end if;
  update public.restaurant_match_proposals set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=v_actor,reviewed_at=now(),match_reason=coalesce(match_reason,case when p_approve then 'reviewed amount/date/journal evidence' else 'review rejected' end) where id=p_proposal_id;
  if p_approve then update public.restaurant_bank_transactions set reconciled_entry_id=v_p.journal_entry_id where id=v_p.bank_transaction_id and lodge_id=p_lodge_id and not is_reconciled and reconciled_entry_id is null; end if;
  perform public.log_restaurant_financial_action(p_lodge_id,case when p_approve then 'bank_match.approved' else 'bank_match.rejected' end,'restaurant_match_proposals',p_proposal_id,to_jsonb(v_p),jsonb_build_object('reviewed_by',v_actor,'one_to_one_statement_row',true),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',p_proposal_id,'status',case when p_approve then 'approved' else 'rejected' end));
end
$$;

create or replace function public.create_bank_reconciliation_v2(
  p_lodge_id uuid,p_bank_account_id uuid,p_statement_import_id uuid,p_statement_balance numeric,
  p_reconciliation_date date,p_transaction_ids uuid[],p_adjustments jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_bank public.restaurant_bank_accounts%rowtype; v_id uuid; v_book numeric; v_diff numeric; v_count int; v_adj jsonb; v_tx uuid;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  select * into v_bank from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id and is_active for update;
  if not found or p_reconciliation_date is null or p_statement_balance is null or coalesce(array_length(p_transaction_ids,1),0)=0 then raise exception 'Active bank account, statement balance/date, and transactions are required' using errcode='22023'; end if;
  if not exists(select 1 from public.restaurant_bank_statement_imports where id=p_statement_import_id and lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and period_end<=p_reconciliation_date) then raise exception 'Statement import evidence does not match this reconciliation' using errcode='23503'; end if;
  select count(*) into v_count from public.restaurant_bank_transactions where id=any(p_transaction_ids) and lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and statement_import_id=p_statement_import_id and not is_reconciled and reconciliation_id is null and (reconciled_entry_id is not null or exception_reason is not null);
  if v_count <> array_length(p_transaction_ids,1) then raise exception 'Every selected statement row needs an approved match or documented exception' using errcode='23514'; end if;
  select coalesce(sum(l.debit-l.credit),0) into v_book from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_reconciliation_date and l.account_id=v_bank.account_id;
  v_diff := round(p_statement_balance-v_book,2);
  insert into public.restaurant_bank_reconciliations(lodge_id,bank_account_id,reconciliation_date,statement_balance,book_balance,difference,status,reconciled_by,statement_import_id)
  values(p_lodge_id,p_bank_account_id,p_reconciliation_date,p_statement_balance,v_book,v_diff,'draft',v_actor,p_statement_import_id) returning id into v_id;
  update public.restaurant_bank_transactions set reconciliation_id=v_id where id=any(p_transaction_ids) and lodge_id=p_lodge_id;
  for v_adj in select value from jsonb_array_elements(coalesce(p_adjustments,'[]'::jsonb)) loop
    v_tx := nullif(v_adj->>'statement_transaction_id','')::uuid;
    if v_tx is null or not (v_tx=any(p_transaction_ids)) or nullif(btrim(v_adj->>'reason'),'') is null or nullif(btrim(v_adj->>'evidence_ref'),'') is null or
       not exists(select 1 from public.restaurant_bank_transactions t where t.id=v_tx and t.lodge_id=p_lodge_id and t.reconciliation_id=v_id and t.exception_reason is not null) or
       not exists(select 1 from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.id=(v_adj->>'journal_entry_id')::uuid and e.lodge_id=p_lodge_id and l.account_id=v_bank.account_id) then
      raise exception 'Every reconciliation adjustment requires one selected statement row, evidence, reason, and a bank-account journal' using errcode='23514';
    end if;
    insert into public.restaurant_reconciliation_adjustments(lodge_id,reconciliation_id,statement_transaction_id,journal_entry_id,reason,evidence_ref,created_by)
    values(p_lodge_id,v_id,v_tx,(v_adj->>'journal_entry_id')::uuid,btrim(v_adj->>'reason'),btrim(v_adj->>'evidence_ref'),v_actor);
  end loop;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'book_balance',v_book,'difference',v_diff,'period_lock_created',false));
end
$$;

create or replace function public.complete_bank_reconciliation_v2(p_lodge_id uuid,p_reconciliation_id uuid,p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_r public.restaurant_bank_reconciliations%rowtype; v_bank public.restaurant_bank_accounts%rowtype;
  v_book numeric; v_close numeric; v_bad_rows integer; v_bad_sequence integer; v_open integer;
  v_import jsonb; v_manifest jsonb; v_packet uuid; v_packet_hash text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.bank_approve');
  select * into v_r from public.restaurant_bank_reconciliations where id=p_reconciliation_id and lodge_id=p_lodge_id for update;
  if not found or v_r.status <> 'draft' then raise exception 'Draft reconciliation not found' using errcode='22023'; end if;
  if v_r.reconciled_by = v_actor then raise exception 'Reconciliation preparer cannot complete it' using errcode='42501'; end if;
  select * into v_bank from public.restaurant_bank_accounts where id=v_r.bank_account_id and lodge_id=p_lodge_id for update;
  select jsonb_build_object('id',i.id,'statement_hash',i.statement_hash,'payload_hash',i.payload_hash,'row_count',i.row_count,'period_start',i.period_start,'period_end',i.period_end)
    into v_import from public.restaurant_bank_statement_imports i where i.id=v_r.statement_import_id and i.lodge_id=p_lodge_id;
  if v_import is null then raise exception 'Immutable statement import evidence is required' using errcode='23503'; end if;
  select coalesce(sum(l.debit-l.credit),0) into v_book from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=v_r.reconciliation_date and l.account_id=v_bank.account_id;
  if round(v_r.statement_balance-v_book,2) <> 0 then raise exception 'Reconciliation difference must be zero at completion' using errcode='23514'; end if;
  select count(*) filter(where balance_after is null), count(*) filter(where previous_balance is not null and round(previous_balance + debit - credit,2) <> round(balance_after,2))
    into v_bad_rows, v_bad_sequence
    from (select t.*,lag(t.balance_after) over(order by t.transaction_date,t.id) previous_balance from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id) q;
  if v_bad_rows > 0 or v_bad_sequence > 0 then raise exception 'Statement opening plus movements do not reproduce every imported closing balance' using errcode='23514'; end if;
  select t.balance_after into v_close from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id order by t.transaction_date desc,t.id desc limit 1;
  if v_close is null or round(v_close,2) <> round(v_r.statement_balance,2) then raise exception 'Entered statement closing balance does not match imported balance_after evidence' using errcode='23514'; end if;
  select count(*) into v_open from public.restaurant_bank_transactions where lodge_id=p_lodge_id and bank_account_id=v_r.bank_account_id and transaction_date<=v_r.reconciliation_date and not is_reconciled and reconciliation_id is distinct from p_reconciliation_id;
  if v_open > 0 then raise exception 'Earlier unmatched bank transactions prevent completion' using errcode='23514'; end if;
  if exists(select 1 from public.restaurant_reconciliation_adjustments where reconciliation_id=p_reconciliation_id and (statement_transaction_id is null or evidence_ref is null or journal_entry_id is null)) then raise exception 'Every reconciliation adjustment requires row-level evidence and a journal' using errcode='23514'; end if;
  update public.restaurant_reconciliation_adjustments set approved_by=v_actor,approved_at=now() where reconciliation_id=p_reconciliation_id;
  update public.restaurant_bank_transactions set is_reconciled=true where reconciliation_id=p_reconciliation_id and lodge_id=p_lodge_id;
  v_manifest := jsonb_build_object(
    'reconciliation_id',p_reconciliation_id,'import',v_import,
    'transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date,t.id),'[]'::jsonb) from public.restaurant_bank_transactions t where t.reconciliation_id=p_reconciliation_id and t.lodge_id=p_lodge_id),
    'adjustments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.statement_transaction_id),'[]'::jsonb) from public.restaurant_reconciliation_adjustments a where a.reconciliation_id=p_reconciliation_id and a.lodge_id=p_lodge_id),
    'reviewed_by',v_actor
  );
  v_packet_hash := encode(digest(v_manifest::text||round(v_book,2)::text||round(v_close,2)::text,'sha256'),'hex');
  insert into public.restaurant_bank_reconciliation_packets(
    lodge_id,bank_account_id,statement_import_id,statement_hash,book_balance,bank_balance,difference,
    control_totals,status,prepared_by,reviewed_by,reviewed_at,completed_at,opening_balance,statement_closing_balance,source_manifest,packet_hash
  ) values (
    p_lodge_id,v_r.bank_account_id,v_r.statement_import_id,v_import->>'statement_hash',v_book,v_r.statement_balance,0,
    jsonb_build_object('reconciliation_id',p_reconciliation_id,'statement_rows',jsonb_array_length(v_manifest->'transactions'),'adjustment_rows',jsonb_array_length(v_manifest->'adjustments'),'statement_hash',v_import->>'statement_hash','payload_hash',v_import->>'payload_hash'),
    'complete',v_r.reconciled_by,v_actor,now(),now(),round(v_close - coalesce((select sum(t.debit-t.credit) from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id),0),2),v_close,v_manifest,v_packet_hash
  ) returning id into v_packet;
  update public.restaurant_bank_reconciliations set status='completed',difference=0,book_balance=v_book,notes=nullif(btrim(p_notes),''),completed_by=v_actor,completed_at=now() where id=p_reconciliation_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_reconciliation.completed','restaurant_bank_reconciliations',p_reconciliation_id,to_jsonb(v_r),jsonb_build_object('book_balance',v_book,'packet_id',v_packet,'period_lock_created',false,'packet_hash',v_packet_hash),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('book_balance',v_book,'packet_id',v_packet,'period_lock_created',false,'packet_hash',v_packet_hash,'statement_closing_balance',v_close));
end
$$;

create or replace function public.get_restaurant_bank_reconciliation_packet_v2(p_lodge_id uuid,p_reconciliation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_packet jsonb; v_tx jsonb; v_adj jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select to_jsonb(p) into v_packet from public.restaurant_bank_reconciliation_packets p where p.lodge_id=p_lodge_id and p.control_totals->>'reconciliation_id'=p_reconciliation_id::text;
  if v_packet is null then select to_jsonb(p) into v_packet from public.restaurant_bank_reconciliation_packets p join public.restaurant_bank_reconciliations r on r.statement_import_id=p.statement_import_id and r.id=p_reconciliation_id where p.lodge_id=p_lodge_id; end if;
  if v_packet is null then raise exception 'Reconciliation packet not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date,t.id),'[]'::jsonb) into v_tx from public.restaurant_bank_transactions t where t.reconciliation_id=p_reconciliation_id and t.lodge_id=p_lodge_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.statement_transaction_id),'[]'::jsonb) into v_adj from public.restaurant_reconciliation_adjustments a where a.reconciliation_id=p_reconciliation_id and a.lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('packet',v_packet,'transactions',v_tx,'adjustments',v_adj,'complete',true,'packet_hash',v_packet->>'packet_hash'));
end
$$;

revoke all on function public.get_restaurant_bank_reconciliation_packet_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_restaurant_bank_reconciliation_packet_v2(uuid,uuid) to authenticated,service_role;

commit;
