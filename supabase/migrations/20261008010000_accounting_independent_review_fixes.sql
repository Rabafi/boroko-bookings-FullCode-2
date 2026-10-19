-- REV-02: preserve statement input order through import, reconciliation and immutable packet export.
begin;
alter table public.restaurant_bank_transactions add column if not exists source_row_ordinal integer;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.restaurant_bank_transactions'::regclass and conname='restaurant_bank_transactions_source_row_ordinal_positive') then
    alter table public.restaurant_bank_transactions add constraint restaurant_bank_transactions_source_row_ordinal_positive check(source_row_ordinal is null or source_row_ordinal>0);
  end if;
end $$;
create unique index if not exists restaurant_bank_transactions_import_ordinal_uidx on public.restaurant_bank_transactions(statement_import_id,source_row_ordinal) where statement_import_id is not null and source_row_ordinal is not null;
create or replace function public.prevent_restaurant_bank_source_order_mutation_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.statement_import_id is distinct from old.statement_import_id or new.source_row_ordinal is distinct from old.source_row_ordinal then
    raise exception 'Imported statement row identity and source ordinal are immutable' using errcode='55000';
  end if;
  return new;
end
$$;
drop trigger if exists restaurant_bank_source_order_immutable on public.restaurant_bank_transactions;
create trigger restaurant_bank_source_order_immutable before update on public.restaurant_bank_transactions for each row execute function public.prevent_restaurant_bank_source_order_mutation_v1();
create or replace function public.import_bank_statement_v3(
  p_lodge_id uuid,p_bank_account_id uuid,p_rows jsonb,p_file_name text,p_operation_id text,
  p_opening_balance numeric,p_closing_balance numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_hash text; v_import uuid; v_existing record; v_row jsonb; v_prev numeric:=p_opening_balance;
  v_after numeric; v_debit numeric; v_credit numeric; v_date date; v_index integer:=0; v_ordinal integer;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_opening_balance is null or p_closing_balance is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or nullif(btrim(p_operation_id),'') is null then raise exception 'Opening/closing evidence, rows and stable operation ID are required' using errcode='22023'; end if;
  if not exists(select 1 from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id and is_active) then raise exception 'Bank account is invalid for the lodge' using errcode='42501'; end if;
  -- Preserve the pre-ordinal payload hash exactly so old retries replay unchanged.
  v_hash:=encode(digest(jsonb_build_object('bank_account_id',p_bank_account_id,'rows',p_rows,'opening_balance',round(p_opening_balance,2),'closing_balance',round(p_closing_balance,2))::text,'sha256'),'hex');
  select id,payload_hash into v_existing from public.restaurant_bank_statement_imports where lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and operation_idempotency_key=p_operation_id for update;
  if found then if v_existing.payload_hash<>v_hash then raise exception 'Bank import operation ID conflicts with different payload' using errcode='23505'; end if; return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true)); end if;
  insert into public.restaurant_bank_statement_imports(lodge_id,bank_account_id,statement_hash,file_name,row_count,imported_by,raw_payload,payload_hash,period_start,period_end,operation_idempotency_key,opening_balance,closing_balance,balance_policy)
  values(p_lodge_id,p_bank_account_id,v_hash,nullif(btrim(p_file_name),''),jsonb_array_length(p_rows),v_actor,p_rows,v_hash,nullif(p_rows->0->>'transaction_date','')::date,nullif(p_rows->(jsonb_array_length(p_rows)-1)->>'transaction_date','')::date,p_operation_id,p_opening_balance,p_closing_balance,'every_row_balance_after') returning id into v_import;
  for v_row,v_ordinal in select value,ordinality::integer from jsonb_array_elements(p_rows) with ordinality as rows(value,ordinality) order by ordinality loop
    v_date:=nullif(v_row->>'transaction_date','')::date; v_debit:=coalesce(nullif(v_row->>'debit','')::numeric,0); v_credit:=coalesce(nullif(v_row->>'credit','')::numeric,0); v_after:=nullif(v_row->>'balance_after','')::numeric;
    if v_date is null or nullif(btrim(v_row->>'description'),'') is null or v_after is null or not ((v_debit>0 and v_credit=0) or (v_credit>0 and v_debit=0)) then raise exception 'Every imported row requires date, description, one debit/credit and balance_after' using errcode='22023'; end if;
    if round(v_after-(v_prev+v_credit-v_debit),2)<>0 then raise exception 'Bank running balance does not equal previous_balance + credit - debit at row %',v_ordinal using errcode='23514'; end if;
    insert into public.restaurant_bank_transactions(lodge_id,bank_account_id,transaction_date,description,debit,credit,balance_after,previous_balance,signed_amount,reference_number,category,fingerprint,statement_import_id,source_row_ordinal)
    values(p_lodge_id,p_bank_account_id,v_date,btrim(v_row->>'description'),v_debit,v_credit,v_after,v_prev,round(v_credit-v_debit,2),nullif(btrim(v_row->>'reference_number'),''),nullif(btrim(v_row->>'category'),''),encode(digest(concat_ws('|',p_bank_account_id::text,v_date,btrim(v_row->>'description'),v_debit,v_credit,v_after),'sha256'),'hex'),v_import,v_ordinal);
    v_prev:=v_after; v_index:=v_index+1;
  end loop;
  if round(v_prev-p_closing_balance,2)<>0 then raise exception 'Bank closing balance evidence does not equal the final row balance' using errcode='23514'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_import,'replayed',false,'row_count',v_index,'opening_balance',p_opening_balance,'closing_balance',p_closing_balance,'signed_amount_policy','credit - debit','balance_policy','every_row_balance_after','payload_hash',v_hash));
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
  if exists(select 1 from public.restaurant_bank_transactions where statement_import_id=v_r.statement_import_id and lodge_id=p_lodge_id and source_row_ordinal is null) then raise exception 'Statement row order is unverified for this legacy import; re-import the original statement before completion' using errcode='23514'; end if;
  select coalesce(sum(l.debit-l.credit),0) into v_book from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=v_r.reconciliation_date and l.account_id=v_bank.account_id;
  if round(v_r.statement_balance-v_book,2) <> 0 then raise exception 'Reconciliation difference must be zero at completion' using errcode='23514'; end if;
  select count(*) filter(where balance_after is null), count(*) filter(where previous_balance is not null and round(previous_balance - debit + credit,2) <> round(balance_after,2))
    into v_bad_rows, v_bad_sequence
    from (select t.id,t.debit,t.credit,t.balance_after,lag(t.balance_after) over(order by t.source_row_ordinal) as previous_balance from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id) q;
  if v_bad_rows > 0 or v_bad_sequence > 0 then raise exception 'Statement opening plus movements do not reproduce every imported closing balance' using errcode='23514'; end if;
  select t.balance_after into v_close from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id order by t.source_row_ordinal desc limit 1;
  if v_close is null or round(v_close,2) <> round(v_r.statement_balance,2) then raise exception 'Entered statement closing balance does not match imported balance_after evidence' using errcode='23514'; end if;
  select count(*) into v_open from public.restaurant_bank_transactions where lodge_id=p_lodge_id and bank_account_id=v_r.bank_account_id and transaction_date<=v_r.reconciliation_date and not is_reconciled and reconciliation_id is distinct from p_reconciliation_id;
  if v_open > 0 then raise exception 'Earlier unmatched bank transactions prevent completion' using errcode='23514'; end if;
  if exists(select 1 from public.restaurant_reconciliation_adjustments where reconciliation_id=p_reconciliation_id and (statement_transaction_id is null or evidence_ref is null or journal_entry_id is null)) then raise exception 'Every reconciliation adjustment requires row-level evidence and a journal' using errcode='23514'; end if;
  update public.restaurant_reconciliation_adjustments set approved_by=v_actor,approved_at=now() where reconciliation_id=p_reconciliation_id;
  update public.restaurant_bank_transactions set is_reconciled=true where reconciliation_id=p_reconciliation_id and lodge_id=p_lodge_id;
  v_manifest := jsonb_build_object(
    'reconciliation_id',p_reconciliation_id,'import',v_import,
    'transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by t.source_row_ordinal),'[]'::jsonb) from public.restaurant_bank_transactions t where t.reconciliation_id=p_reconciliation_id and t.lodge_id=p_lodge_id),
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
    'complete',v_r.reconciled_by,v_actor,now(),now(),round(v_close + coalesce((select sum(t.debit-t.credit) from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id),0),2),v_close,v_manifest,v_packet_hash
  ) returning id into v_packet;
  update public.restaurant_bank_reconciliations set status='completed',difference=0,book_balance=v_book,notes=nullif(btrim(p_notes),''),completed_by=v_actor,completed_at=now() where id=p_reconciliation_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_reconciliation.completed','restaurant_bank_reconciliations',p_reconciliation_id,to_jsonb(v_r),jsonb_build_object('book_balance',v_book,'packet_id',v_packet,'period_lock_created',false,'packet_hash',v_packet_hash),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('book_balance',v_book,'packet_id',v_packet,'period_lock_created',false,'packet_hash',v_packet_hash,'statement_closing_balance',v_close));
end
$$;
create or replace function public.get_restaurant_bank_export_v3(p_lodge_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_filters jsonb := coalesce(p_filters,'{}'::jsonb);
  v_reconciliation uuid;
  v_data jsonb;
  v_complete boolean;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.export');
  if jsonb_typeof(v_filters) <> 'object'
     or exists(select 1 from jsonb_object_keys(v_filters) k where k <> 'reconciliation_id') then
    raise exception 'Bank export accepts only reconciliation_id' using errcode='22023';
  end if;
  begin v_reconciliation := nullif(v_filters->>'reconciliation_id','')::uuid;
  exception when others then raise exception 'Bank export requires a valid reconciliation_id' using errcode='22023'; end;
  if v_reconciliation is null then raise exception 'Bank export requires a completed reconciliation_id' using errcode='22023'; end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return public._restaurant_record_accounting_export_v3(p_lodge_id,'bank',jsonb_build_object('reconciliation_id',v_reconciliation),
      jsonb_build_object('dataset_policy_version','accounting-export-completeness-v1','source_coverage_status','incomplete','row_counts',jsonb_build_object(),'completeness_reasons',jsonb_build_array(jsonb_build_object('code','ACCOUNTING_NOT_ACTIVE','message','Accounting is not active for this lodge.','affected_ids','[]'::jsonb,'count',0))),false,'ACCOUNTING NOT ACTIVE','incomplete','not_applicable');
  end if;

  with packet_rows as (
    select p.* from public.restaurant_bank_reconciliation_packets p
     where p.lodge_id=p_lodge_id and p.control_totals->>'reconciliation_id'=v_reconciliation::text
  ), packet as (
    select p.* from packet_rows p order by p.created_at desc,p.id limit 1
  ), packet_stats as (select count(*)::integer packet_count from packet_rows),
  rec as (
    select r.* from public.restaurant_bank_reconciliations r where r.id=v_reconciliation and r.lodge_id=p_lodge_id
  ), imp as (
    select i.* from public.restaurant_bank_statement_imports i join rec r on r.statement_import_id=i.id and r.lodge_id=i.lodge_id
  ), transaction_order as (
    select t.*,
      case when t.source_row_ordinal is not null then t.source_row_ordinal
           else (select m.ordinality::integer from packet p cross join lateral jsonb_array_elements(p.source_manifest->'transactions') with ordinality as m(value,ordinality) where m.value->>'id'=t.id::text limit 1)
      end packet_row_ordinal
      from public.restaurant_bank_transactions t join imp i on i.id=t.statement_import_id and i.lodge_id=t.lodge_id
  ), tx_json as (
    select coalesce(jsonb_agg(case when t.source_row_ordinal is null then to_jsonb(t)-'source_row_ordinal'-'packet_row_ordinal' else to_jsonb(t)-'packet_row_ordinal' end order by t.packet_row_ordinal nulls last),'[]'::jsonb) rows,
           count(*)::integer row_count,
           count(*) filter(where t.balance_after is null or not t.is_reconciled or t.reconciliation_id is distinct from v_reconciliation)::integer bad_rows,
           coalesce(sum(t.debit-t.credit),0)::numeric(18,2) movement,
           max(t.balance_after) filter(where t.id=(select z.id from transaction_order z order by z.packet_row_ordinal desc nulls last limit 1))::numeric(18,2) last_balance,
            count(*) filter(where t.source_row_ordinal is null)::integer unverified_order_count
      from transaction_order t
  ), sequence_rows as (
    select t.*,coalesce(lag(t.balance_after) over(order by t.packet_row_ordinal nulls last),i.opening_balance) prior_balance
      from transaction_order t join imp i on i.id=t.statement_import_id and i.lodge_id=t.lodge_id
  ), sequence_check as (
    select count(*) filter(where balance_after is null or prior_balance is null or round(prior_balance-debit+credit,2)<>round(balance_after,2))::integer bad_sequence
      from sequence_rows
  ),
  allocations as (
    select coalesce(jsonb_agg(to_jsonb(a) order by a.bank_transaction_id,a.journal_entry_id,a.id),'[]'::jsonb) rows,
           count(*) filter(where a.status='proposed')::integer proposed_count,
           count(*) filter(where a.status='approved' and (a.reviewer_id is null or a.reviewer_id=a.proposer_id or a.reviewed_at is null))::integer bad_review_count,
           count(*) filter(where a.status not in ('approved','rejected','proposed'))::integer invalid_status_count,
           count(*) filter(where a.status='approved' and (not exists(select 1 from public.restaurant_journal_entries e where e.id=a.journal_entry_id and e.lodge_id=p_lodge_id and e.is_posted) or (a.journal_line_id is not null and not exists(select 1 from public.restaurant_journal_lines l where l.id=a.journal_line_id and l.entry_id=a.journal_entry_id))))::integer bad_journal_count
      from public.restaurant_bank_match_allocations a join public.restaurant_bank_transactions t on t.id=a.bank_transaction_id and t.lodge_id=p_lodge_id
      join imp i on i.id=t.statement_import_id
  ), adjustments as (
    select coalesce(jsonb_agg(to_jsonb(a) order by a.statement_transaction_id,a.id),'[]'::jsonb) rows,
           count(*)::integer row_count,
           count(*) filter(where a.statement_transaction_id is null or nullif(btrim(a.evidence_ref),'') is null or nullif(btrim(a.reason),'') is null or a.approved_by is null or a.approved_at is null or a.approved_by=a.created_by or not exists(select 1 from public.restaurant_bank_transactions t where t.id=a.statement_transaction_id and t.lodge_id=p_lodge_id and t.reconciliation_id=v_reconciliation) or not exists(select 1 from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_bank_accounts b on b.id=(select bank_account_id from packet) and b.lodge_id=p_lodge_id where e.id=a.journal_entry_id and e.lodge_id=p_lodge_id and e.is_posted and l.account_id=b.account_id))::integer bad_rows
      from public.restaurant_reconciliation_adjustments a where a.lodge_id=p_lodge_id and a.reconciliation_id=v_reconciliation
  ), coverage as (
    select count(*) filter(where
        coalesce((select sum(a.allocated_amount) from public.restaurant_bank_match_allocations a where a.bank_transaction_id=t.id and a.lodge_id=p_lodge_id and a.status='approved'),0)<>abs(coalesce(t.signed_amount,t.credit-t.debit))
        and not exists(select 1 from public.restaurant_reconciliation_adjustments a where a.reconciliation_id=v_reconciliation and a.lodge_id=p_lodge_id and a.statement_transaction_id=t.id and a.approved_by is not null and a.approved_at is not null and nullif(btrim(a.evidence_ref),'') is not null and nullif(btrim(a.reason),'') is not null)
      )::integer unmatched_count,
      count(*) filter(where exists(select 1 from public.restaurant_reconciliation_adjustments a where a.reconciliation_id=v_reconciliation and a.lodge_id=p_lodge_id and a.statement_transaction_id=t.id) and coalesce((select sum(a.allocated_amount) from public.restaurant_bank_match_allocations a where a.bank_transaction_id=t.id and a.lodge_id=p_lodge_id and a.status='approved'),0)>0)::integer double_covered_count
      from public.restaurant_bank_transactions t join imp i on i.id=t.statement_import_id and i.lodge_id=t.lodge_id
  ), gl as (
    select coalesce(sum(l.debit-l.credit),0)::numeric(18,2) balance
      from rec r join public.restaurant_bank_accounts b on b.id=r.bank_account_id and b.lodge_id=p_lodge_id
      join public.restaurant_journal_lines l on l.account_id=b.account_id
      join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=r.reconciliation_date
  ),
  unmatched_prior as (
    select count(*)::integer row_count from rec r join public.restaurant_bank_transactions t on t.lodge_id=p_lodge_id and t.bank_account_id=r.bank_account_id and t.transaction_date<=r.reconciliation_date and not t.is_reconciled and t.reconciliation_id is distinct from r.id
  ), exceptions as (
    select count(*)::integer row_count from public.restaurant_reconciliation_exceptions e
     where e.lodge_id=p_lodge_id and e.severity in ('error','blocking') and e.status not in ('resolved','accepted')
       and exists(select 1 from public.restaurant_bank_transactions t join imp i on i.id=t.statement_import_id where t.id=e.source_id and t.lodge_id=p_lodge_id)
  ), actual_manifest as (
    select jsonb_build_object(
      'reconciliation_id',v_reconciliation,
      'import',(select jsonb_build_object('id',i.id,'statement_hash',i.statement_hash,'payload_hash',i.payload_hash,'row_count',i.row_count,'period_start',i.period_start,'period_end',i.period_end) from imp i),
      'transactions',(select rows from tx_json),
      'adjustments',(select rows from adjustments),
      'reviewed_by',(select p.reviewed_by from packet p)
    ) manifest
  ), checks as (
    select ps.packet_count,
      coalesce((select r.status from rec r),'') reconciliation_status,
      (select r.reconciliation_date from rec r) reconciliation_date,
      (select r.bank_account_id from rec r) bank_account_id,
      (select r.book_balance from rec r) reconciliation_book_balance,
      (select r.difference from rec r) reconciliation_difference,
      (select p.status from packet p) packet_status,
      (select p.prepared_by from packet p) prepared_by,
      (select p.reviewed_by from packet p) reviewed_by,
      (select p.bank_account_id from packet p) packet_bank_account_id,
      (select p.statement_import_id from packet p) packet_import_id,
      (select p.book_balance from packet p) packet_book_balance,
      (select p.bank_balance from packet p) packet_bank_balance,
      (select p.difference from packet p) packet_difference,
      (select p.opening_balance from packet p) packet_opening,
      (select p.statement_closing_balance from packet p) packet_close,
      (select p.source_manifest from packet p) stored_manifest,
      (select p.packet_hash from packet p) packet_hash,
      (select i.statement_hash from imp i) statement_hash,
      (select i.payload_hash from imp i) import_payload_hash,
      (select i.raw_payload from imp i) raw_payload,
      (select i.period_start from imp i) import_start,
      (select i.period_end from imp i) import_end,
      (select i.file_name from imp i) import_file_name,
      (select p.control_totals from packet p) packet_control_totals,
      (select i.row_count from imp i) imported_row_count,
      (select i.opening_balance from imp i) import_opening,
      (select i.closing_balance from imp i) import_close,
      (select count(*)::integer from public.restaurant_bank_transactions t join imp i on i.id=t.statement_import_id and i.lodge_id=t.lodge_id where t.lodge_id=p_lodge_id and t.reconciliation_id=v_reconciliation) reconciled_row_count,
      (select row_count from tx_json) row_count,
      (select unverified_order_count from tx_json) unverified_order_count,
      (select bad_rows from tx_json) bad_rows,
      (select bad_sequence from sequence_check) bad_sequence,
      (select movement from tx_json) movement,
      (select last_balance from tx_json) last_balance,
      (select row_count from adjustments) adjustment_count,
      (select bad_rows from adjustments) bad_adjustments,
      (select proposed_count from allocations) proposed_allocations,
      (select bad_review_count from allocations) bad_allocation_review,
      (select invalid_status_count from allocations) invalid_allocation_status,
      (select bad_journal_count from allocations) bad_allocation_journal,
      (select unmatched_count from coverage) unmatched_count,
      (select double_covered_count from coverage) double_covered_count,
      (select balance from gl) gl_balance,
      (select row_count from unmatched_prior) unmatched_prior_count,
      (select row_count from exceptions) open_exception_count,
      (select manifest from actual_manifest) actual_manifest,
      exists(select 1 from packet p join public.restaurant_bank_accounts b on b.id=p.bank_account_id and b.lodge_id=p_lodge_id and b.is_active join public.restaurant_accounts a on a.id=b.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset') bank_account_valid
      from packet_stats ps
  ), issues as (
    select 'BANK_PACKET_MISSING'::text code,'No immutable reconciliation packet exists for the selected reconciliation.'::text message,'[]'::jsonb affected_ids,0::integer affected_count from checks where packet_count=0
    union all select 'BANK_PACKET_INVALID','Exactly one complete packet and completed reconciliation are required.',jsonb_build_array(v_reconciliation),packet_count from checks where packet_count<>1 or packet_status<>'complete' or reconciliation_status<>'completed'
    union all select 'BANK_REVIEW_PENDING','An independent bank reviewer is required.',jsonb_build_array(v_reconciliation),1 from checks where reviewed_by is null or prepared_by is null or reviewed_by=prepared_by
    union all select 'BANK_IMPORT_MISSING','The selected packet is not linked to a lodge-owned statement import.',jsonb_build_array(v_reconciliation),1 from checks where packet_import_id is null or not exists(select 1 from imp) or packet_import_id is distinct from (select id from imp) or import_payload_hash is null
    union all select 'BANK_HASH_MISMATCH','The immutable source manifest, statement hash, or packet hash does not match its source rows.',jsonb_build_array(v_reconciliation),1 from checks where packet_hash is null or packet_hash<>encode(digest(stored_manifest::text||round(coalesce(packet_book_balance,0),2)::text||round(coalesce(packet_close,0),2)::text,'sha256'),'hex') or stored_manifest is distinct from actual_manifest or statement_hash is distinct from encode(digest(jsonb_build_object('bank_account_id',packet_bank_account_id,'rows',raw_payload,'opening_balance',import_opening,'closing_balance',import_close)::text,'sha256'),'hex') or import_payload_hash is distinct from encode(digest(jsonb_build_object('bank_account_id',packet_bank_account_id,'rows',raw_payload,'opening_balance',import_opening,'closing_balance',import_close)::text,'sha256'),'hex') or packet_control_totals->>'reconciliation_id' is distinct from v_reconciliation::text or coalesce((packet_control_totals->>'statement_rows')::integer,-1)<>imported_row_count or coalesce((packet_control_totals->>'adjustment_rows')::integer,-1)<>adjustment_count or packet_control_totals->>'statement_hash' is distinct from statement_hash or packet_control_totals->>'payload_hash' is distinct from import_payload_hash
    union all select 'BANK_ORDER_UNVERIFIED','Source statement row order is unavailable for one or more legacy imported rows. Re-import the original statement to establish ordinal evidence before certification.',jsonb_build_array(v_reconciliation),unverified_order_count from checks where unverified_order_count>0
    union all select 'BANK_UNRESOLVED_ALLOCATION','One or more imported statement rows lacks an exact approved match allocation or approved evidence-backed adjustment.',jsonb_build_array(v_reconciliation),unmatched_count from checks where unmatched_count>0
    union all select 'BANK_ALLOCATION_MISMATCH','Proposed, invalid, duplicate, or unreviewed allocations remain, or allocation and adjustment both cover a row.','[]'::jsonb,proposed_allocations+bad_allocation_review+invalid_allocation_status+bad_allocation_journal+double_covered_count from checks where proposed_allocations>0 or bad_allocation_review>0 or invalid_allocation_status>0 or bad_allocation_journal>0 or double_covered_count>0
    union all select 'BANK_CONTROL_DIFFERENCE','Bank packet, reconciliation, and posted bank GL balances do not agree.',jsonb_build_array(v_reconciliation),1 from checks where round(coalesce(packet_difference,1),2)<>0 or round(coalesce(reconciliation_difference,1),2)<>0 or round(coalesce(packet_book_balance,0)-coalesce(gl_balance,0),2)<>0 or round(coalesce(reconciliation_book_balance,0)-coalesce(packet_book_balance,0),2)<>0 or packet_bank_account_id is distinct from bank_account_id or round(coalesce(packet_bank_balance,0)-coalesce(packet_close,0),2)<>0
    union all select 'BANK_PERIOD_MISMATCH','Statement opening/closing balances, imported rows, reconciliation period, or account identity do not agree.',jsonb_build_array(v_reconciliation),1 from checks where not bank_account_valid or reconciliation_date is null or imported_row_count is null or reconciliation_date<import_start or reconciliation_date>import_end or row_count<>imported_row_count or reconciled_row_count<>imported_row_count or bad_rows>0 or bad_sequence>0 or import_opening is null or packet_opening is distinct from import_opening or import_close is distinct from packet_close or round(coalesce(import_opening,0)-coalesce(movement,0)-coalesce(packet_close,0),2)<>0 or last_balance is distinct from packet_close
    union all select 'BANK_UNMATCHED_TRANSACTION','Earlier unreconciled bank rows prevent a complete packet.',jsonb_build_array(v_reconciliation),unmatched_prior_count from checks where unmatched_prior_count>0
    union all select 'BANK_ADJUSTMENT_EVIDENCE_MISSING','Every adjustment must have independent approval, evidence, reason, and a posted lodge-owned bank journal.',jsonb_build_array(v_reconciliation),bad_adjustments from checks where bad_adjustments>0
    union all select 'BANK_EXCEPTION_PRESENT','Unresolved blocking exceptions are linked to this statement import.',jsonb_build_array(v_reconciliation),open_exception_count from checks where open_exception_count>0
    union all select 'BANK_NO_STATEMENT_ROWS','An empty bank packet cannot certify completeness.',jsonb_build_array(v_reconciliation),0 from checks where row_count=0
  ), reason_set as (
    select coalesce(jsonb_agg(jsonb_build_object('code',code,'message',message,'affected_ids',affected_ids,'count',affected_count) order by code),'[]'::jsonb) reasons from issues
  ), payload as (
    select jsonb_build_object(
      'dataset_policy_version','accounting-export-completeness-v1','actual_filters',jsonb_build_object('reconciliation_id',v_reconciliation),
      'packet',(select to_jsonb(p) from packet p),'reconciliation',(select to_jsonb(r) from rec r),'statement_import',(select to_jsonb(i) from imp i),
      'transactions',(select rows from tx_json),'match_allocations',(select rows from allocations),'adjustments',(select rows from adjustments),
      'posted_book_balance',(select gl_balance from checks),'unresolved_exception_count',(select open_exception_count from checks),
      'row_counts',jsonb_build_object('packets',(select packet_count from checks),'statement_rows',(select row_count from checks),'imported_rows',(select imported_row_count from checks),'order_unverified_rows',(select unverified_order_count from checks),'match_allocations',jsonb_array_length((select rows from allocations)),'adjustments',(select adjustment_count from checks),'unresolved_exceptions',(select open_exception_count from checks),'unmatched_prior_rows',(select unmatched_prior_count from checks)),
      'source_coverage_status',case when jsonb_array_length((select reasons from reason_set))=0 then 'complete' else 'incomplete' end,
      'completeness_reasons',(select reasons from reason_set)
    ) data
  )
  select p.data,jsonb_array_length(p.data->'completeness_reasons')=0 into v_data,v_complete from payload p;

  return public._restaurant_record_accounting_export_v3(p_lodge_id,'bank',jsonb_build_object('reconciliation_id',v_reconciliation),v_data,v_complete,
    case when v_complete then 'CERTIFIED' else 'DRAFT / BANK PACKET RECONCILIATION REQUIRED' end,
    case when v_complete then 'complete' else 'incomplete' end,case when v_complete then 'reconciled' else 'unreconciled' end);
end
$$;
commit;