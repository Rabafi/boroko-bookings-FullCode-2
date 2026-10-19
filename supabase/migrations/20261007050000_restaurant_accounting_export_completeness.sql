-- Accounting export remediation: derive AP, bank, and tax completeness from
-- the authoritative subledgers and their immutable server evidence.
begin;

create or replace function public.get_restaurant_ap_export_v3(p_lodge_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_filters jsonb := coalesce(p_filters,'{}'::jsonb);
  v_cutoff date;
  v_supplier uuid;
  v_data jsonb;
  v_complete boolean;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.export');
  if jsonb_typeof(v_filters) <> 'object'
     or exists(select 1 from jsonb_object_keys(v_filters) k where k not in ('cutoff_date','supplier_id')) then
    raise exception 'AP export accepts only cutoff_date and supplier_id filters' using errcode='22023';
  end if;
  begin
    v_cutoff := coalesce(nullif(v_filters->>'cutoff_date','')::date,public.get_lodge_business_date(p_lodge_id));
    v_supplier := nullif(v_filters->>'supplier_id','')::uuid;
  exception when others then
    raise exception 'AP export cutoff_date or supplier_id is malformed' using errcode='22023';
  end;
  if v_cutoff is null then raise exception 'AP export cutoff date could not be resolved' using errcode='22023'; end if;
  if v_supplier is not null and not exists(select 1 from public.restaurant_suppliers s where s.id=v_supplier and s.lodge_id=p_lodge_id) then
    raise exception 'Supplier was not found in the current lodge' using errcode='42501';
  end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return public._restaurant_record_accounting_export_v3(p_lodge_id,'ap',jsonb_build_object('cutoff_date',v_cutoff,'supplier_id',v_supplier),
      jsonb_build_object('dataset_policy_version','accounting-export-completeness-v1','source_coverage_status','incomplete','row_counts',jsonb_build_object(),'completeness_reasons',jsonb_build_array(jsonb_build_object('code','ACCOUNTING_NOT_ACTIVE','message','Accounting is not active for this lodge.','affected_ids','[]'::jsonb,'count',0))),false,'ACCOUNTING NOT ACTIVE','incomplete','not_applicable');
  end if;

  with cfg as (
    select s.*,pa.account_type payable_type,pa.is_active payable_active,
           ia.account_type input_tax_type,ia.is_active input_tax_active
      from public.restaurant_ap_gl_settings s
      left join public.restaurant_accounts pa on pa.id=s.payable_account_id and pa.lodge_id=p_lodge_id
      left join public.restaurant_accounts ia on ia.id=s.input_tax_account_id and ia.lodge_id=p_lodge_id
     where s.lodge_id=p_lodge_id
  ), recognized as (
    select b.*,
           coalesce((select sum(x.amount) from public.restaurant_bill_payments x where x.bill_id=b.id and x.lodge_id=p_lodge_id and x.payment_date<=v_cutoff),0)::numeric(18,2) paid_at_cutoff,
           coalesce((select sum(x.amount) from public.restaurant_bill_payments x where x.bill_id=b.id and x.lodge_id=p_lodge_id),0)::numeric(18,2) paid_recorded,
           coalesce((select sum(n.total) from public.restaurant_ap_credit_notes n where n.bill_id=b.id and n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff),0)::numeric(18,2) credits_at_cutoff
      from public.restaurant_bills b
     where b.lodge_id=p_lodge_id and b.bill_date<=v_cutoff
       and b.status in ('approved','partially_paid','paid','overdue')
  ), amounts as (
    select r.*,
           greatest(round(r.total-r.paid_at_cutoff-r.credits_at_cutoff,2),0)::numeric(18,2) open_at_cutoff
      from recognized r
  ), ap_gl as (
    select coalesce(sum(l.credit-l.debit),0)::numeric(18,2) balance,
           coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('line',to_jsonb(l)) order by e.entry_date,e.created_at,e.id,l.id),'[]'::jsonb) lines,
           count(distinct e.id)::integer entry_count,
           count(*)::integer line_count
      from cfg c
      left join public.restaurant_journal_lines l on l.account_id=c.payable_account_id
      left join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=v_cutoff
     where c.payable_account_id is not null and e.id is not null
  ), bill_posting_issues as (
    select r.id, count(s.id) posting_count,
           count(s.id) filter(where s.status='posted' and s.journal_entry_id=r.accrual_journal_entry_id and r.accrual_journal_entry_id is not null) exact_count
      from amounts r left join public.restaurant_financial_source_postings s
        on s.lodge_id=p_lodge_id and s.source_type='ap_bill' and s.source_id=r.id
     group by r.id
  ), payment_posting_issues as (
    select x.id,count(s.id) posting_count,
           count(s.id) filter(where s.status='posted' and s.journal_entry_id=x.journal_entry_id and x.journal_entry_id is not null) exact_count
      from public.restaurant_bill_payments x
      join public.restaurant_bills b on b.id=x.bill_id and b.lodge_id=p_lodge_id and b.status in ('approved','partially_paid','paid','overdue')
      left join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='ap_payment' and s.source_id=x.id
     where x.lodge_id=p_lodge_id and x.payment_date<=v_cutoff
     group by x.id
  ), credit_posting_issues as (
    select n.id,count(s.id) posting_count,
           count(s.id) filter(where s.status='posted' and s.journal_entry_id=n.reversal_journal_entry_id and n.reversal_journal_entry_id is not null) exact_count
      from public.restaurant_ap_credit_notes n
      join public.restaurant_bills b on b.id=n.bill_id and b.lodge_id=p_lodge_id and b.status in ('approved','partially_paid','paid','overdue')
      left join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='ap_credit_note' and s.source_id=n.id
     where n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff
     group by n.id
  ), summary as (
    select count(*)::integer recognized_count,round(coalesce(sum(open_at_cutoff),0),2)::numeric(18,2) subledger_open,
           count(*) filter(where currency<>'BWP')::integer non_bwp_count,
           round(coalesce(sum(tax_amount),0),2)::numeric(18,2) tax_total
      from amounts
  ), pending_credit as (
    select count(*)::integer pending_count,coalesce(jsonb_agg(id),'[]'::jsonb) ids
      from public.restaurant_ap_credit_notes
     where lodge_id=p_lodge_id and status='submitted' and note_date<=v_cutoff
  ), issues as (
    select 'AP_CONTROL_UNCONFIGURED'::text code,'Configure an active lodge-owned payable control account and, when tax is present, an active input-tax account.'::text message,'[]'::jsonb affected_ids,1::integer affected_count
     where not exists(select 1 from cfg c where c.payable_account_id is not null and c.payable_type='liability' and c.payable_active and (c.input_tax_account_id is null or (c.input_tax_type='asset' and c.input_tax_active)))
    union all
    select 'AP_NO_RECOGNIZED_SOURCES','No recognized AP liabilities exist at this cutoff; zero totals alone cannot certify completeness.','[]'::jsonb,0
     where (select recognized_count from summary)=0
    union all
    select 'AP_CONTROL_DIFFERENCE','Recognized AP subledger liability differs from the complete posted payable control-account balance at cutoff.',jsonb_build_array(coalesce((select payable_account_id from cfg),'00000000-0000-0000-0000-000000000000'::uuid)),1
     where round((select subledger_open from summary)-coalesce((select balance from ap_gl),0),2)<>0
    union all
    select 'AP_CURRENCY_UNSUPPORTED','Recognized AP liability uses a currency without an authoritative export conversion contract.',coalesce((select jsonb_agg(id) from amounts where currency<>'BWP'),'[]'::jsonb),(select non_bwp_count from summary)
     where (select non_bwp_count from summary)>0
    union all
    select 'AP_EVIDENCE_MISSING','A recognized bill or approved credit note lacks a document reference and content hash.',
      coalesce((select jsonb_agg(z.id) from (select r.id from amounts r where not ((nullif(btrim(r.source_document_ref),'') is not null and nullif(btrim(r.source_document_hash),'') is not null) or exists(select 1 from public.restaurant_ap_document_evidence ev where ev.lodge_id=p_lodge_id and ev.bill_id=r.id and ev.credit_note_id is null and nullif(btrim(ev.content_hash),'') is not null)) union all select n.id from public.restaurant_ap_credit_notes n where n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff and not ((nullif(btrim(n.source_document_ref),'') is not null and nullif(btrim(n.source_document_hash),'') is not null) or exists(select 1 from public.restaurant_ap_document_evidence ev where ev.lodge_id=p_lodge_id and ev.bill_id=n.bill_id and ev.credit_note_id=n.id and nullif(btrim(ev.content_hash),'') is not null))) z),'[]'::jsonb),
      (select count(*)::integer from (select r.id from amounts r where not ((nullif(btrim(r.source_document_ref),'') is not null and nullif(btrim(r.source_document_hash),'') is not null) or exists(select 1 from public.restaurant_ap_document_evidence ev where ev.lodge_id=p_lodge_id and ev.bill_id=r.id and ev.credit_note_id is null and nullif(btrim(ev.content_hash),'') is not null)) union all select n.id from public.restaurant_ap_credit_notes n where n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff and not ((nullif(btrim(n.source_document_ref),'') is not null and nullif(btrim(n.source_document_hash),'') is not null) or exists(select 1 from public.restaurant_ap_document_evidence ev where ev.lodge_id=p_lodge_id and ev.bill_id=n.bill_id and ev.credit_note_id=n.id and nullif(btrim(ev.content_hash),'') is not null))) z)
     where exists(select 1 from amounts r where not ((nullif(btrim(r.source_document_ref),'') is not null and nullif(btrim(r.source_document_hash),'') is not null) or exists(select 1 from public.restaurant_ap_document_evidence ev where ev.lodge_id=p_lodge_id and ev.bill_id=r.id and ev.credit_note_id is null and nullif(btrim(ev.content_hash),'') is not null)) union all select 1 from public.restaurant_ap_credit_notes n where n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff and not ((nullif(btrim(n.source_document_ref),'') is not null and nullif(btrim(n.source_document_hash),'') is not null) or exists(select 1 from public.restaurant_ap_document_evidence ev where ev.lodge_id=p_lodge_id and ev.bill_id=n.bill_id and ev.credit_note_id=n.id and nullif(btrim(ev.content_hash),'') is not null)))
    union all
    select 'MISSING_POSTED_SOURCE','A recognized bill, payment, or approved credit has no single posted source journal matching its subledger row.',coalesce((select jsonb_agg(id) from (select id from bill_posting_issues where exact_count=0 union all select id from payment_posting_issues where exact_count=0 union all select id from credit_posting_issues where exact_count=0) z),'[]'::jsonb),(select count(*)::integer from (select id from bill_posting_issues where exact_count=0 union all select id from payment_posting_issues where exact_count=0 union all select id from credit_posting_issues where exact_count=0) z)
     where exists(select 1 from bill_posting_issues where exact_count=0 union all select 1 from payment_posting_issues where exact_count=0 union all select 1 from credit_posting_issues where exact_count=0)
    union all
    select 'DUPLICATE_POSTED_SOURCE','More than one source-posting record exists for one AP operation.',coalesce((select jsonb_agg(id) from (select id from bill_posting_issues where posting_count>1 union all select id from payment_posting_issues where posting_count>1 union all select id from credit_posting_issues where posting_count>1) z),'[]'::jsonb),(select count(*)::integer from (select id from bill_posting_issues where posting_count>1 union all select id from payment_posting_issues where posting_count>1 union all select id from credit_posting_issues where posting_count>1) z)
     where exists(select 1 from bill_posting_issues where posting_count>1 union all select 1 from payment_posting_issues where posting_count>1 union all select 1 from credit_posting_issues where posting_count>1)
    union all
    select 'AP_AMOUNT_PAID_MISMATCH','Bill amount_paid does not equal its complete recorded payment subledger.',coalesce((select jsonb_agg(id) from amounts where round(amount_paid-paid_recorded,2)<>0),'[]'::jsonb),(select count(*)::integer from amounts where round(amount_paid-paid_recorded,2)<>0)
     where exists(select 1 from amounts where round(amount_paid-paid_recorded,2)<>0)
    union all
    select 'AP_CREDIT_REVIEW_PENDING','Submitted supplier credits are awaiting independent approval and may change payable exposure.',ids,pending_count
      from pending_credit where pending_count>0
    union all
    select 'AP_LINE_MISSING','A recognized bill has no itemized source lines.',coalesce((select jsonb_agg(r.id) from amounts r where not exists(select 1 from public.restaurant_bill_items i where i.bill_id=r.id and i.lodge_id=p_lodge_id)),'[]'::jsonb),(select count(*)::integer from amounts r where not exists(select 1 from public.restaurant_bill_items i where i.bill_id=r.id and i.lodge_id=p_lodge_id))
     where exists(select 1 from amounts r where not exists(select 1 from public.restaurant_bill_items i where i.bill_id=r.id and i.lodge_id=p_lodge_id))
  ), reason_set as (
    select coalesce(jsonb_agg(jsonb_build_object('code',code,'message',message,'affected_ids',affected_ids,'count',affected_count) order by code),'[]'::jsonb) reasons from issues
  ), payload as (
    select jsonb_build_object(
      'dataset_policy_version','accounting-export-completeness-v1',
      'cutoff',v_cutoff,
      'actual_filters',jsonb_build_object('cutoff_date',v_cutoff,'supplier_id',v_supplier),
      'scope','whole_lodge_payable_control_with_optional_supplier_detail_slice',
      'bills',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object(
        'open_at_cutoff',greatest(round(b.total-b.amount_paid-(select coalesce(sum(n.total),0) from public.restaurant_ap_credit_notes n where n.bill_id=b.id and n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff),2),0),
        'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.restaurant_bill_items i where i.bill_id=b.id and i.lodge_id=p_lodge_id),'[]'::jsonb),
        'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.payment_date,x.created_at,x.id) from public.restaurant_bill_payments x where x.bill_id=b.id and x.lodge_id=p_lodge_id and x.payment_date<=v_cutoff),'[]'::jsonb),
        'credit_notes',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(ni) order by ni.id) from public.restaurant_ap_credit_note_items ni where ni.credit_note_id=n.id and ni.lodge_id=p_lodge_id),'[]'::jsonb)) order by n.note_date,n.created_at,n.id) from public.restaurant_ap_credit_notes n where n.bill_id=b.id and n.lodge_id=p_lodge_id and n.note_date<=v_cutoff),'[]'::jsonb),
        'evidence',coalesce((select jsonb_agg(to_jsonb(ev) order by ev.created_at,ev.id) from public.restaurant_ap_document_evidence ev where ev.bill_id=b.id and ev.lodge_id=p_lodge_id),'[]'::jsonb)
      ) order by b.bill_date,b.created_at,b.id) from public.restaurant_bills b where b.lodge_id=p_lodge_id and b.bill_date<=v_cutoff and (v_supplier is null or b.supplier_id=v_supplier)),'[]'::jsonb),
      'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.payment_date,x.created_at,x.id) from public.restaurant_bill_payments x join public.restaurant_bills b on b.id=x.bill_id and b.lodge_id=p_lodge_id where x.lodge_id=p_lodge_id and x.payment_date<=v_cutoff and (v_supplier is null or b.supplier_id=v_supplier)),'[]'::jsonb),
      'approved_credit_notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.note_date,n.created_at,n.id) from public.restaurant_ap_credit_notes n join public.restaurant_bills b on b.id=n.bill_id and b.lodge_id=p_lodge_id where n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff and (v_supplier is null or b.supplier_id=v_supplier)),'[]'::jsonb),
      'payable_control',jsonb_build_object('settings',coalesce((select to_jsonb(c) from cfg c),'{}'::jsonb),'account_id',(select payable_account_id from cfg),'subledger_open_recognized',(select subledger_open from summary),'posted_gl_credit_balance',coalesce((select balance from ap_gl),0),'difference',round((select subledger_open from summary)-coalesce((select balance from ap_gl),0),2),'opening_handling','full posted payable-account balance, including any posted opening/cutover journal; unrepresented legacy opening amounts cause a control difference','complete',round((select subledger_open from summary)-coalesce((select balance from ap_gl),0),2)=0),
      'posted_payable_control_lines',coalesce((select lines from ap_gl),'[]'::jsonb),
      'source_postings',coalesce((select jsonb_agg(to_jsonb(s) order by s.business_date,s.source_type,s.source_id,s.source_version) from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type in ('ap_bill','ap_payment','ap_credit_note') and s.business_date<=v_cutoff),'[]'::jsonb),
      'recognized_liability',(select subledger_open from summary),
      'recognized_bill_count',(select recognized_count from summary),
      'external_supplier_confirmation','not_present_in_source_schema',
      'purchase_order_or_grn_matching','not_asserted_source_tables_not_present',
      'row_counts',jsonb_build_object('bills',(select count(*)::integer from public.restaurant_bills b where b.lodge_id=p_lodge_id and b.bill_date<=v_cutoff and (v_supplier is null or b.supplier_id=v_supplier)),'recognized_bills',(select recognized_count from summary),'payments',(select count(*)::integer from public.restaurant_bill_payments x join public.restaurant_bills b on b.id=x.bill_id and b.lodge_id=p_lodge_id where x.lodge_id=p_lodge_id and x.payment_date<=v_cutoff and (v_supplier is null or b.supplier_id=v_supplier)),'approved_credit_notes',(select count(*)::integer from public.restaurant_ap_credit_notes n join public.restaurant_bills b on b.id=n.bill_id and b.lodge_id=p_lodge_id where n.lodge_id=p_lodge_id and n.status='approved' and n.note_date<=v_cutoff and (v_supplier is null or b.supplier_id=v_supplier)),'posted_control_entries',coalesce((select entry_count from ap_gl),0),'posted_control_lines',coalesce((select line_count from ap_gl),0),'supplier_statement_records',0,'unresolved_credit_reviews',(select pending_count from pending_credit)),
      'completeness_reasons',(select reasons from reason_set)
    ) data
  )
  select p.data, jsonb_array_length(p.data->'completeness_reasons')=0 and (select recognized_count from summary)>0
    into v_data,v_complete from payload p;

  return public._restaurant_record_accounting_export_v3(p_lodge_id,'ap',jsonb_build_object('cutoff_date',v_cutoff,'supplier_id',v_supplier),v_data,v_complete,
    case when v_complete then 'CERTIFIED' else 'DRAFT / AP CONTROL RECONCILIATION REQUIRED' end,
    case when v_complete then 'complete' else 'incomplete' end,'not_applicable');
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
  ),
  tx_json as (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date,t.id),'[]'::jsonb) rows,
           count(*)::integer row_count,
           count(*) filter(where t.balance_after is null or not t.is_reconciled or t.reconciliation_id is distinct from v_reconciliation)::integer bad_rows,
           coalesce(sum(t.debit-t.credit),0)::numeric(18,2) movement,
           max(t.balance_after) filter(where t.id=(select z.id from public.restaurant_bank_transactions z join imp i on i.id=z.statement_import_id and z.lodge_id=p_lodge_id order by z.transaction_date desc,z.id desc limit 1))::numeric(18,2) last_balance
      from public.restaurant_bank_transactions t join imp i on i.id=t.statement_import_id and i.lodge_id=t.lodge_id
  ), sequence_rows as (
    select t.*,coalesce(lag(t.balance_after) over(order by t.transaction_date,t.id),i.opening_balance) prior_balance
      from public.restaurant_bank_transactions t join imp i on i.id=t.statement_import_id and i.lodge_id=t.lodge_id
  ), sequence_check as (
    select count(*) filter(where balance_after is null or prior_balance is null or round(prior_balance+debit-credit,2)<>round(balance_after,2))::integer bad_sequence
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
    union all select 'BANK_HASH_MISMATCH','The immutable source manifest, statement hash, or packet hash does not match its source rows.',jsonb_build_array(v_reconciliation),1 from checks where packet_hash is null or packet_hash<>encode(digest(stored_manifest::text||round(coalesce(packet_book_balance,0),2)::text||round(coalesce(packet_close,0),2)::text,'sha256'),'hex') or stored_manifest is distinct from actual_manifest or statement_hash is distinct from encode(digest(jsonb_build_object('bank_account_id',packet_bank_account_id,'transactions',raw_payload)::text,'sha256'),'hex') or import_payload_hash is distinct from encode(digest(jsonb_build_object('bank_account_id',packet_bank_account_id,'transactions',raw_payload,'file_name',import_file_name)::text,'sha256'),'hex') or packet_control_totals->>'reconciliation_id' is distinct from v_reconciliation::text or coalesce((packet_control_totals->>'statement_rows')::integer,-1)<>imported_row_count or coalesce((packet_control_totals->>'adjustment_rows')::integer,-1)<>adjustment_count or packet_control_totals->>'statement_hash' is distinct from statement_hash or packet_control_totals->>'payload_hash' is distinct from import_payload_hash
    union all select 'BANK_UNRESOLVED_ALLOCATION','One or more imported statement rows lacks an exact approved match allocation or approved evidence-backed adjustment.',jsonb_build_array(v_reconciliation),unmatched_count from checks where unmatched_count>0
    union all select 'BANK_ALLOCATION_MISMATCH','Proposed, invalid, duplicate, or unreviewed allocations remain, or allocation and adjustment both cover a row.','[]'::jsonb,proposed_allocations+bad_allocation_review+invalid_allocation_status+bad_allocation_journal+double_covered_count from checks where proposed_allocations>0 or bad_allocation_review>0 or invalid_allocation_status>0 or bad_allocation_journal>0 or double_covered_count>0
    union all select 'BANK_CONTROL_DIFFERENCE','Bank packet, reconciliation, and posted bank GL balances do not agree.',jsonb_build_array(v_reconciliation),1 from checks where round(coalesce(packet_difference,1),2)<>0 or round(coalesce(reconciliation_difference,1),2)<>0 or round(coalesce(packet_book_balance,0)-coalesce(gl_balance,0),2)<>0 or round(coalesce(reconciliation_book_balance,0)-coalesce(packet_book_balance,0),2)<>0 or packet_bank_account_id is distinct from bank_account_id or round(coalesce(packet_bank_balance,0)-coalesce(packet_close,0),2)<>0
    union all select 'BANK_PERIOD_MISMATCH','Statement opening/closing balances, imported rows, reconciliation period, or account identity do not agree.',jsonb_build_array(v_reconciliation),1 from checks where not bank_account_valid or reconciliation_date is null or imported_row_count is null or reconciliation_date<import_start or reconciliation_date>import_end or row_count<>imported_row_count or reconciled_row_count<>imported_row_count or bad_rows>0 or bad_sequence>0 or import_opening is null or packet_opening is distinct from import_opening or import_close is distinct from packet_close or round(coalesce(import_opening,0)+coalesce(movement,0)-coalesce(packet_close,0),2)<>0 or last_balance is distinct from packet_close
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
      'row_counts',jsonb_build_object('packets',(select packet_count from checks),'statement_rows',(select row_count from checks),'imported_rows',(select imported_row_count from checks),'match_allocations',jsonb_array_length((select rows from allocations)),'adjustments',(select adjustment_count from checks),'unresolved_exceptions',(select open_exception_count from checks),'unmatched_prior_rows',(select unmatched_prior_count from checks)),
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

create or replace function public.get_restaurant_tax_export_v3(p_lodge_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_filters jsonb := coalesce(p_filters,'{}'::jsonb);
  v_return uuid;
  v_data jsonb;
  v_complete boolean;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.export');
  if jsonb_typeof(v_filters) <> 'object'
     or exists(select 1 from jsonb_object_keys(v_filters) k where k <> 'return_id') then
    raise exception 'Tax export accepts only return_id' using errcode='22023';
  end if;
  begin v_return := nullif(v_filters->>'return_id','')::uuid;
  exception when others then raise exception 'Tax export requires a valid return_id' using errcode='22023'; end;
  if v_return is null then raise exception 'Tax export requires one approved tax return_id' using errcode='22023'; end if;
  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return public._restaurant_record_accounting_export_v3(p_lodge_id,'tax',jsonb_build_object('return_id',v_return),
      jsonb_build_object('dataset_policy_version','accounting-export-completeness-v1','professional_review_required',true,'source_coverage_status','incomplete','row_counts',jsonb_build_object(),'completeness_reasons',jsonb_build_array(jsonb_build_object('code','ACCOUNTING_NOT_ACTIVE','message','Accounting is not active for this lodge.','affected_ids','[]'::jsonb,'count',0))),false,'ACCOUNTING NOT ACTIVE','incomplete','not_applicable');
  end if;

  with ret as (
    select r.* from public.restaurant_tax_returns r where r.id=v_return and r.lodge_id=p_lodge_id
  ), cfg as (
    select c.* from public.restaurant_tax_configurations c join ret r on r.configuration_id=c.id and r.lodge_id=c.lodge_id
  ), allocations as (
    select a.* from public.restaurant_tax_detail_allocations a join ret r on r.id=a.tax_return_id and r.lodge_id=a.lodge_id
  ), expected as (
    select case when lower(coalesce(o.transaction_type,'sale'))='return' then 'pos_return' else 'pos_sale' end::text source_type,
           o.id source_id,i.id source_line_id,coalesce(o.business_date,(o.completed_at at time zone 'Africa/Gaborone')::date) business_date,
           s.source_version,s.payload_hash source_payload_hash,s.journal_entry_id,
           'output'::text direction,i.tax_code,coalesce(i.tax_treatment,case when coalesce(i.tax_allocated,0)<>0 then 'taxable' else 'out_of_scope' end) tax_treatment,
           round((case when coalesce(i.net_subtotal,0)<>0 then i.net_subtotal else coalesce(i.subtotal,0)-coalesce(i.tax_allocated,0) end)*case when lower(coalesce(o.transaction_type,'sale'))='return' then -1 else 1 end,2) taxable_base,
           round(coalesce(i.tax_allocated,0)*case when lower(coalesce(o.transaction_type,'sale'))='return' then -1 else 1 end,2) tax_amount,
           round((coalesce(i.subtotal,0)+coalesce(i.tax_allocated,0))*case when lower(coalesce(o.transaction_type,'sale'))='return' then -1 else 1 end,2) gross_amount,
           s.source_count
      from ret r join public.pos_orders o on o.lodge_id=p_lodge_id and o.status in ('completed','settled') and coalesce(o.business_date,(o.completed_at at time zone 'Africa/Gaborone')::date) between r.period_start and r.period_end
      join public.pos_order_items i on i.order_id=o.id and i.lodge_id=p_lodge_id
      left join lateral (select count(*)::integer source_count,(array_agg(sp.source_version order by sp.source_version))[1] source_version,(array_agg(sp.payload_hash order by sp.source_version))[1] payload_hash,(array_agg(sp.journal_entry_id order by sp.source_version))[1] journal_entry_id from public.restaurant_financial_source_postings sp where sp.lodge_id=p_lodge_id and sp.source_type='pos_order' and sp.source_id=o.id and sp.status='posted') s on true
    union all
    select 'ap_bill',b.id,i.id,b.bill_date,s.source_version,s.payload_hash,s.journal_entry_id,'input',i.tax_code,
           coalesce(i.tax_treatment,case when coalesce(i.tax_amount,0)<>0 then 'taxable' else 'out_of_scope' end),
           round(coalesce(i.total,0),2),round(coalesce(i.tax_amount,0),2),round(coalesce(i.total,0)+coalesce(i.tax_amount,0),2),s.source_count
      from ret r join public.restaurant_bills b on b.lodge_id=p_lodge_id and b.status in ('approved','partially_paid','paid','overdue') and b.bill_date between r.period_start and r.period_end
      join public.restaurant_bill_items i on i.bill_id=b.id and i.lodge_id=p_lodge_id
      left join lateral (select count(*)::integer source_count,(array_agg(sp.source_version order by sp.source_version))[1] source_version,(array_agg(sp.payload_hash order by sp.source_version))[1] payload_hash,(array_agg(sp.journal_entry_id order by sp.source_version))[1] journal_entry_id from public.restaurant_financial_source_postings sp where sp.lodge_id=p_lodge_id and sp.source_type='ap_bill' and sp.source_id=b.id and sp.status='posted') s on true
    union all
    select 'expense',e.id,e.id,e.date,e.source_version,coalesce(e.payload_hash,''),e.journal_entry_id,'input',e.tax_code,
           coalesce(e.tax_treatment,case when coalesce(e.tax_amount,0)<>0 then 'taxable' else 'out_of_scope' end),
           round(e.amount-e.tax_amount,2),round(e.tax_amount,2),round(e.amount,2),1
      from ret r join public.expenses e on e.lodge_id=p_lodge_id and e.status in ('posted','paid') and e.date between r.period_start and r.period_end
    union all
    select 'inventory_purchase',p.id,p.id,p.date,s.source_version,coalesce(s.payload_hash,p.payload_hash,''),s.journal_entry_id,'input',p.tax_code,
           coalesce(p.tax_treatment,case when coalesce(p.tax_amount,0)<>0 then 'taxable' else 'out_of_scope' end),
           round(p.total_cost-p.tax_amount,2),round(p.tax_amount,2),round(p.total_cost,2),s.source_count
      from ret r join public.inventory_purchases p on p.lodge_id=p_lodge_id and p.date between r.period_start and r.period_end
      left join lateral (select count(*)::integer source_count,(array_agg(sp.source_version order by sp.source_version))[1] source_version,(array_agg(sp.payload_hash order by sp.source_version))[1] payload_hash,(array_agg(sp.journal_entry_id order by sp.source_version))[1] journal_entry_id from public.restaurant_financial_source_postings sp where sp.lodge_id=p_lodge_id and sp.source_type='inventory_purchase' and sp.source_id=p.id and sp.status='posted') s on true
    union all
    select 'tax_adjustment',a.id,a.id,a.business_date,1,a.payload_hash,null,a.tax_direction,a.tax_code,a.tax_treatment,
           round(a.taxable_base*case when a.adjustment_type='credit_note' then -1 else 1 end,2),
           round(a.tax_amount*case when a.adjustment_type='credit_note' then -1 else 1 end,2),
           round(a.gross_amount*case when a.adjustment_type='credit_note' then -1 else 1 end,2),1
      from ret r join public.restaurant_tax_adjustments a on a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved'
  ), allocation_manifest as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'allocation_id',a.id,'source_type',a.source_type,'source_id',a.source_id,'source_line_id',a.source_line_id,'journal_entry_id',a.journal_entry_id,
      'business_date',a.business_date,'direction',a.tax_direction,'tax_code',a.tax_code,'tax_treatment',a.tax_treatment,'taxable_base',a.taxable_base,
      'tax_amount',a.tax_amount,'gross_amount',a.gross_amount,'source_version',a.source_version,'source_payload_hash',a.source_payload_hash,
      'configuration_hash',a.configuration_hash
    ) order by a.business_date,a.source_type,a.source_id,a.source_line_id),'[]'::jsonb) manifest
      from allocations a
  ), allocation_totals as (
    select count(*)::integer allocation_count,
           round(coalesce(sum(a.tax_amount) filter(where a.tax_direction='output'),0),2)::numeric(18,2) output_tax,
           round(coalesce(sum(a.tax_amount) filter(where a.tax_direction='input'),0),2)::numeric(18,2) input_tax,
           round(coalesce(sum(a.taxable_base) filter(where a.tax_direction='output'),0),2)::numeric(18,2) sales_base,
           round(coalesce(sum(a.taxable_base) filter(where a.tax_direction='input'),0),2)::numeric(18,2) purchase_base,
           count(*) filter(where a.tax_direction not in ('output','input','adjustment'))::integer invalid_directions,
           count(*) filter(where a.configuration_hash is distinct from (select configuration_hash from ret))::integer bad_config_allocations
      from allocations a
  ), coverage as (
    select count(*) filter(where e.source_count<>1 or e.source_payload_hash is null or (e.source_type<>'tax_adjustment' and (e.journal_entry_id is null or not exists(select 1 from public.restaurant_journal_entries j where j.id=e.journal_entry_id and j.lodge_id=p_lodge_id and j.is_posted))))::integer bad_sources,
           count(*) filter(where a.id is null or a.source_id is distinct from e.source_id or a.journal_entry_id is distinct from e.journal_entry_id or a.source_version is distinct from e.source_version or a.source_payload_hash is distinct from e.source_payload_hash or a.configuration_hash is distinct from (select configuration_hash from ret) or a.business_date is distinct from e.business_date or a.tax_direction is distinct from e.direction or a.tax_code is distinct from e.tax_code or a.tax_treatment is distinct from e.tax_treatment or round(a.taxable_base,2) is distinct from round(e.taxable_base,2) or round(a.tax_amount,2) is distinct from round(e.tax_amount,2) or round(a.gross_amount,2) is distinct from round(e.gross_amount,2))::integer missing_or_mismatched_allocations,
           count(*) filter(where a.id is null)::integer missing_allocations
      from expected e left join allocations a on a.source_type=e.source_type and a.source_id=e.source_id and a.source_line_id=e.source_line_id and a.tax_code is not distinct from e.tax_code
  ), extra_allocations as (
    select count(*)::integer row_count from allocations a left join expected e on e.source_type=a.source_type and e.source_id=a.source_id and e.source_line_id=a.source_line_id and e.tax_code is not distinct from a.tax_code where e.source_id is null
  ), duplicates as (
    select count(*)::integer row_count from (select source_type,source_id,source_line_id,tax_code from allocations group by source_type,source_id,source_line_id,tax_code having count(*)>1) d
  ), currency_issues as (
    select count(*)::integer row_count,coalesce(jsonb_agg(b.id),'[]'::jsonb) ids from ret r join public.restaurant_bills b on b.lodge_id=p_lodge_id and b.status in ('approved','partially_paid','paid','overdue') and b.bill_date between r.period_start and r.period_end where b.currency<>'BWP'
  ), controls as (
    select coalesce(sum(l.credit-l.debit) filter(where l.account_id=c.output_tax_account_id),0)::numeric(18,2) gl_output,
           coalesce(sum(l.debit-l.credit) filter(where l.account_id=c.input_tax_account_id),0)::numeric(18,2) gl_input
      from cfg c join public.restaurant_journal_entries e on e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between (select period_start from ret) and (select period_end from ret)
      join public.restaurant_journal_lines l on l.entry_id=e.id and l.account_id in (c.output_tax_account_id,c.input_tax_account_id)
  ), controls_by_type as (
    select exists(select 1 from cfg c join public.restaurant_accounts o on o.id=c.output_tax_account_id and o.lodge_id=p_lodge_id and o.is_active and o.account_type='liability' join public.restaurant_accounts i on i.id=c.input_tax_account_id and i.lodge_id=p_lodge_id and i.is_active and i.account_type='asset' join ret r on c.effective_from<=r.period_start and (c.effective_to is null or c.effective_to>=r.period_end)) valid
  ), stale as (
    select exists(select 1 from ret r where r.stale_at is not null
      or r.configuration_hash is distinct from (select encode(digest(to_jsonb(c)::text,'sha256'),'hex') from cfg c)
      or r.snapshot_hash is distinct from encode(digest(r.source_snapshot::text,'sha256'),'hex')
      or r.source_manifest_hash is distinct from encode(digest((select manifest::text from allocation_manifest),'sha256'),'hex')
      or exists(select 1 from public.restaurant_financial_source_postings s where s.lodge_id=p_lodge_id and s.source_type in ('pos_order','ap_bill','expense','expense_payment','ap_payment','payroll','payroll_settlement','inventory_purchase','inventory_stocktake','settlement','cashup') and s.business_date between r.period_start and r.period_end and s.created_at>coalesce(r.generated_at,r.prepared_at,r.created_at))
      or exists(select 1 from public.restaurant_tax_adjustments a where a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved' and a.updated_at>coalesce(r.generated_at,r.prepared_at,r.created_at))) bad
  ), reasons as (
    select 'TAX_RETURN_MISSING'::text code,'The selected return was not found in the current lodge.'::text message,'[]'::jsonb affected_ids,0::integer affected_count where not exists(select 1 from ret)
    union all select 'TAX_CONFIGURATION_MISSING','The return has no effective lodge-owned tax configuration and valid input/output control accounts.',jsonb_build_array(v_return),1 where exists(select 1 from ret) and not (select valid from controls_by_type)
    union all select 'TAX_REVIEW_PENDING','The return must be independently approved or filed before this export can certify.',jsonb_build_array(v_return),1 from ret r where r.status not in ('approved','filed') or r.approved_by is null or r.approved_by=r.prepared_by
    union all select 'TAX_REVIEW_PENDING','Filed status lacks authoritative filing actor, date, or reference.',jsonb_build_array(v_return),1 from ret r where r.status='filed' and (r.filed_by is null or r.filed_at is null or nullif(btrim(r.filing_reference),'') is null or r.filed_by=r.approved_by)
    union all select 'TAX_PERIOD_MISMATCH','The selected return period is invalid, its source snapshot period differs, or the tax configuration does not cover the full period.',jsonb_build_array(v_return),1 from ret r where r.period_start is null or r.period_end is null or r.period_end<r.period_start or r.source_snapshot->>'period_start' is distinct from r.period_start::text or r.source_snapshot->>'period_end' is distinct from r.period_end::text
    union all select 'TAX_RETURN_STALE','The working paper is marked stale or its current source/configuration snapshot changed after generation.',jsonb_build_array(v_return),1 where (select bad from stale)
    union all select 'TAX_HASH_MISMATCH','The return snapshot, allocation manifest, or configuration hash is inconsistent.',jsonb_build_array(v_return),1 from ret r where r.source_snapshot is null or r.snapshot_hash is null or r.snapshot_hash is distinct from encode(digest(r.source_snapshot::text,'sha256'),'hex') or r.source_manifest_hash is distinct from encode(digest((select manifest::text from allocation_manifest),'sha256'),'hex') or r.configuration_hash is distinct from (select encode(digest(to_jsonb(c)::text,'sha256'),'hex') from cfg c) or r.configuration_hash is distinct from (r.source_snapshot->>'configuration_hash') or coalesce((r.source_snapshot->>'allocation_count')::integer,-1)<>(select allocation_count from allocation_totals)
    union all select 'TAX_ALLOCATION_MISSING','Eligible posted source rows are absent from the tax allocation manifest or their source journal/hash/amount does not match.',coalesce((select jsonb_agg(jsonb_build_object('source_type',e.source_type,'source_id',e.source_id,'source_line_id',e.source_line_id)) from expected e left join allocations a on a.source_type=e.source_type and a.source_id=e.source_id and a.source_line_id=e.source_line_id and a.tax_code is not distinct from e.tax_code where a.id is null or a.source_id is distinct from e.source_id or a.journal_entry_id is distinct from e.journal_entry_id or a.source_version is distinct from e.source_version or a.source_payload_hash is distinct from e.source_payload_hash or round(a.tax_amount,2) is distinct from round(e.tax_amount,2)),'[]'::jsonb),(select missing_or_mismatched_allocations from coverage) where (select missing_or_mismatched_allocations from coverage)>0
    union all select 'TAX_ALLOCATION_DUPLICATE','Duplicate allocation rows exist for one source line.', '[]'::jsonb,(select row_count from duplicates) where (select row_count from duplicates)>0
    union all select 'TAX_REVIEW_PENDING','An approved tax adjustment lacks its own evidence reference, approval time, or independent approver.',coalesce((select jsonb_agg(a.id) from ret r join public.restaurant_tax_adjustments a on a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved' where a.approved_by is null or a.approved_at is null or a.approved_by=a.created_by or nullif(btrim(a.evidence_ref),'') is null),'[]'::jsonb),(select count(*)::integer from ret r join public.restaurant_tax_adjustments a on a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved' where a.approved_by is null or a.approved_at is null or a.approved_by=a.created_by or nullif(btrim(a.evidence_ref),'') is null) where exists(select 1 from ret r join public.restaurant_tax_adjustments a on a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved' where a.approved_by is null or a.approved_at is null or a.approved_by=a.created_by or nullif(btrim(a.evidence_ref),'') is null)
    union all select 'TAX_UNSUPPORTED_SOURCE','An eligible inventory purchase lacks one posted source journal or an approved AP credit note has no tax allocation contract.',coalesce((select jsonb_agg(p.id) from ret r join public.inventory_purchases p on p.lodge_id=p_lodge_id and p.date between r.period_start and r.period_end left join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=p.id and s.status='posted' where s.id is null),'[]'::jsonb)||(select ids from currency_issues)||coalesce((select jsonb_agg(n.id) from ret r join public.restaurant_ap_credit_notes n on n.lodge_id=p_lodge_id and n.status='approved' and n.note_date between r.period_start and r.period_end),'[]'::jsonb),
      (select count(*)::integer from ret r join public.inventory_purchases p on p.lodge_id=p_lodge_id and p.date between r.period_start and r.period_end left join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=p.id and s.status='posted' where s.id is null)+(select row_count from currency_issues)+(select count(*)::integer from ret r join public.restaurant_ap_credit_notes n on n.lodge_id=p_lodge_id and n.status='approved' and n.note_date between r.period_start and r.period_end)
      where (select row_count from currency_issues)>0 or exists(select 1 from ret r join public.restaurant_ap_credit_notes n on n.lodge_id=p_lodge_id and n.status='approved' and n.note_date between r.period_start and r.period_end) or exists(select 1 from ret r join public.inventory_purchases p on p.lodge_id=p_lodge_id and p.date between r.period_start and r.period_end left join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=p.id and s.status='posted' where s.id is null)
    union all select 'TAX_UNSUPPORTED_SOURCE','Tax allocations contain source rows outside the supported working-paper source classes.', '[]'::jsonb,(select row_count from extra_allocations) where (select row_count from extra_allocations)>0
    union all select 'TAX_CONTROL_DIFFERENCE','Tax detail totals do not reconcile to the exact-period posted input/output tax control-account movements.',jsonb_build_array(v_return),1 where round((select output_tax from allocation_totals where true)-coalesce((select gl_output from controls),0),2)<>0 or round((select input_tax from allocation_totals)-coalesce((select gl_input from controls),0),2)<>0
    union all select 'TAX_CONTROL_DIFFERENCE','Stored return control totals differ from its source allocation totals.',jsonb_build_array(v_return),1 from ret r where round(r.total_tax_collected-(select output_tax from allocation_totals),2)<>0 or round(r.total_input_tax-(select input_tax from allocation_totals),2)<>0 or round(r.total_sales_excl-(select sales_base from allocation_totals),2)<>0 or round(r.total_purchases_excl-(select purchase_base from allocation_totals),2)<>0 or round(r.net_tax_payable-((select output_tax from allocation_totals)-(select input_tax from allocation_totals)),2)<>0
    union all select 'TAX_NO_RECOGNIZED_SOURCES','No eligible tax source allocations exist; matching zero totals alone cannot certify completeness.',jsonb_build_array(v_return),0 where exists(select 1 from ret) and (select allocation_count from allocation_totals)=0
  ), reason_set as (
    select coalesce(jsonb_agg(jsonb_build_object('code',code,'message',message,'affected_ids',affected_ids,'count',affected_count) order by code),'[]'::jsonb) items from reasons
  ), payload as (
    select jsonb_build_object(
      'dataset_policy_version','accounting-export-completeness-v1','actual_filters',jsonb_build_object('return_id',v_return),
      'return',(select to_jsonb(r) from ret r),'configuration',(select to_jsonb(c) from cfg c),
      'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.business_date,a.source_type,a.source_id,a.source_line_id) from allocations a),'[]'::jsonb),
      'approved_adjustments',coalesce((select jsonb_agg(to_jsonb(a) order by a.business_date,a.id) from ret r join public.restaurant_tax_adjustments a on a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved'),'[]'::jsonb),
      'control_accounts',jsonb_build_object('output_gl_movement',coalesce((select gl_output from controls),0),'input_gl_movement',coalesce((select gl_input from controls),0),'output_allocation_tax',(select output_tax from allocation_totals),'input_allocation_tax',(select input_tax from allocation_totals)),
      'amendments',coalesce((select jsonb_agg(to_jsonb(a) order by a.amendment_sequence,a.created_at,a.id) from ret r join public.restaurant_tax_returns a on a.lodge_id=p_lodge_id and (a.id=r.amendment_of or a.amendment_of=r.id or (a.period_start=r.period_start and a.period_end=r.period_end))),'[]'::jsonb),
      'professional_review_required',true,'filing_state',(select status from ret),'source_snapshot_hash',(select snapshot_hash from ret),'source_manifest_hash',(select source_manifest_hash from ret),
      'row_counts',jsonb_build_object('returns',(select count(*)::integer from ret),'allocations',(select allocation_count from allocation_totals),'expected_source_lines',(select count(*)::integer from expected),'approved_adjustments',(select count(*)::integer from ret r join public.restaurant_tax_adjustments a on a.lodge_id=p_lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved'),'eligible_non_bwp_ap_sources',(select row_count from currency_issues)),
      'source_coverage_status',case when jsonb_array_length((select items from reason_set))=0 then 'complete' else 'incomplete' end,
      'completeness_reasons',(select items from reason_set)
    ) data
  )
  select p.data,jsonb_array_length(p.data->'completeness_reasons')=0 into v_data,v_complete from payload p;

  return public._restaurant_record_accounting_export_v3(p_lodge_id,'tax',jsonb_build_object('return_id',v_return),v_data,v_complete,
    case when v_complete then 'CERTIFIED / PROFESSIONAL REVIEW REQUIRED' else 'DRAFT / TAX REVIEW OR SOURCE RECONCILIATION REQUIRED' end,
    case when v_complete then 'complete' else 'incomplete' end,case when v_complete then (v_data->'return'->>'status') else 'unapproved' end);
end
$$;

-- The recorder accepts caller-supplied completeness and payload fields. It is
-- an internal definer callee; only the validated public export wrappers may use
-- it. Ordinary authenticated clients must not forge certified export runs.
revoke all on function public._restaurant_record_accounting_export_v3(uuid,text,jsonb,jsonb,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public._restaurant_record_accounting_export_v3(uuid,text,jsonb,jsonb,boolean,text,text,text) to service_role;

revoke all on function public.get_restaurant_ap_export_v3(uuid,jsonb), public.get_restaurant_bank_export_v3(uuid,jsonb), public.get_restaurant_tax_export_v3(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_restaurant_ap_export_v3(uuid,jsonb), public.get_restaurant_bank_export_v3(uuid,jsonb), public.get_restaurant_tax_export_v3(uuid,jsonb) to authenticated,service_role;

commit;




