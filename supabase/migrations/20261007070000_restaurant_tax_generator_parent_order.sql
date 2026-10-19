-- Repair current tax generator FK ordering and serialize first generation per lodge/period.
-- Also require an active input-tax control when recognized AP tax exists.
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
     where not exists(select 1 from cfg c where c.payable_account_id is not null and c.payable_type='liability' and c.payable_active and (coalesce((select tax_total from summary),0)=0 or (c.input_tax_account_id is not null and c.input_tax_type='asset' and c.input_tax_active)))
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

create or replace function public._generate_restaurant_tax_working_paper(
  p_lodge_id uuid,
  p_period_start date,
  p_period_end date,
  p_configuration_id uuid,
  p_target_return_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_cfg public.restaurant_tax_configurations%rowtype;
  v_existing public.restaurant_tax_returns%rowtype; v_id uuid;
  v_config_hash text; v_manifest jsonb; v_manifest_hash text; v_snapshot jsonb; v_hash text;
  v_output numeric := 0; v_input numeric := 0; v_sales numeric := 0; v_purchases numeric := 0;
  v_row record; v_sign numeric; v_base numeric; v_tax numeric;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text || ':tax:' || p_period_start::text || ':' || p_period_end::text, 0));
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Valid tax period is required' using errcode='22023';
  end if;
  select * into v_cfg from public.restaurant_tax_configurations
   where id=p_configuration_id and lodge_id=p_lodge_id
     and effective_from<=p_period_start and (effective_to is null or effective_to>=p_period_end);
  if not found then raise exception 'Tax configuration is not effective for the full period' using errcode='23503'; end if;
  v_config_hash := encode(digest(to_jsonb(v_cfg)::text,'sha256'),'hex');
  if p_target_return_id is null then
    select * into v_existing from public.restaurant_tax_returns
     where lodge_id=p_lodge_id and period_start=p_period_start and period_end=p_period_end and amendment_of is null for update;
  else
    select * into v_existing from public.restaurant_tax_returns
     where id=p_target_return_id and lodge_id=p_lodge_id for update;
    if not found or v_existing.amendment_of is null or v_existing.period_start<>p_period_start or v_existing.period_end<>p_period_end then
      raise exception 'Tax amendment target is invalid' using errcode='23514';
    end if;
  end if;
  if found and v_existing.status <> 'draft' then
    raise exception 'Reviewed, approved, or filed tax working papers are immutable; create an amendment' using errcode='55000';
  end if;
  v_id := coalesce(v_existing.id,coalesce(p_target_return_id,gen_random_uuid()));
  -- Allocations have a foreign key to the parent return. Create a transactional
  -- draft shell before inserting line evidence; any later error rolls it back.
  if p_target_return_id is null and v_existing.id is null then
    insert into public.restaurant_tax_returns(
      id,lodge_id,period_start,period_end,tax_rate,status,configuration_id,jurisdiction_code,rule_version,
      source_snapshot,snapshot_hash,source_manifest_hash,configuration_hash,prepared_by,prepared_at,generated_at,updated_at
    ) values (
      v_id,p_lodge_id,p_period_start,p_period_end,0,'draft',v_cfg.id,v_cfg.jurisdiction_code,v_cfg.rule_version,
      '{}'::jsonb,encode(digest('{}','sha256'),'hex'),encode(digest('[]','sha256'),'hex'),v_config_hash,v_actor,now(),now(),now()
    );
  end if;
  delete from public.restaurant_tax_detail_allocations where tax_return_id=v_id;

  for v_row in
    select o.id source_id,o.transaction_type,coalesce(o.business_date,(o.completed_at at time zone 'Africa/Gaborone')::date) business_date,
           i.id source_line_id,i.subtotal,i.gross_subtotal,i.net_subtotal,i.tax_allocated,i.tax_code,i.tax_treatment,
           s.journal_entry_id,s.source_version,s.payload_hash
      from public.pos_orders o
      join public.pos_order_items i on i.order_id=o.id and i.lodge_id=p_lodge_id
      join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='pos_order' and s.source_id=o.id and s.status='posted'
     where o.lodge_id=p_lodge_id and o.status in('completed','settled')
       and coalesce(o.business_date,(o.completed_at at time zone 'Africa/Gaborone')::date) between p_period_start and p_period_end
  loop
    v_sign:=case when lower(coalesce(v_row.transaction_type,'sale'))='return' then -1 else 1 end;
    v_tax:=round(coalesce(v_row.tax_allocated,0)*v_sign,2);
    v_base:=round((case when coalesce(v_row.net_subtotal,0)<>0 then v_row.net_subtotal else coalesce(v_row.subtotal,0)-coalesce(v_row.tax_allocated,0) end)*v_sign,2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
      taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
    ) values (
      p_lodge_id,v_id,case when v_sign<0 then 'pos_return' else 'pos_sale' end,v_row.source_id,v_row.source_line_id,v_row.journal_entry_id,v_row.business_date,
      'output',v_row.tax_code,coalesce(v_row.tax_treatment,case when v_tax<>0 then 'taxable' else 'out_of_scope' end),v_base,v_tax,
      round((coalesce(v_row.subtotal,0)+coalesce(v_row.tax_allocated,0))*v_sign,2),coalesce(v_row.source_version,1),coalesce(v_row.payload_hash,''),v_config_hash
    );
  end loop;

  for v_row in
    select b.id source_id,b.bill_date business_date,i.id source_line_id,i.total,i.tax_amount,i.tax_code,i.tax_treatment,
           b.accrual_journal_entry_id journal_entry_id,s.source_version,s.payload_hash
      from public.restaurant_bills b
      join public.restaurant_bill_items i on i.bill_id=b.id and i.lodge_id=p_lodge_id
      join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='ap_bill' and s.source_id=b.id and s.status='posted'
     where b.lodge_id=p_lodge_id and b.status in('approved','partially_paid','paid','overdue') and b.bill_date between p_period_start and p_period_end
  loop
    v_tax:=round(coalesce(v_row.tax_amount,0),2); v_base:=round(coalesce(v_row.total,0),2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
      taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
    ) values (
      p_lodge_id,v_id,'ap_bill',v_row.source_id,v_row.source_line_id,v_row.journal_entry_id,v_row.business_date,'input',v_row.tax_code,
      coalesce(v_row.tax_treatment,case when v_tax<>0 then 'taxable' else 'out_of_scope' end),v_base,v_tax,round(v_base+v_tax,2),coalesce(v_row.source_version,1),coalesce(v_row.payload_hash,''),v_config_hash
    );
  end loop;

  insert into public.restaurant_tax_detail_allocations(
    lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
    taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
  )
  select p_lodge_id,v_id,'expense',e.id,e.id,e.journal_entry_id,e.date,'input',e.tax_code,
         coalesce(e.tax_treatment,case when e.tax_amount<>0 then 'taxable' else 'out_of_scope' end),round(e.amount-e.tax_amount,2),round(e.tax_amount,2),e.amount,e.source_version,coalesce(e.payload_hash,''),v_config_hash
    from public.expenses e
   where e.lodge_id=p_lodge_id and e.status in('posted','paid') and e.journal_entry_id is not null and e.date between p_period_start and p_period_end;

  insert into public.restaurant_tax_detail_allocations(
    lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
    taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
  )
  select p_lodge_id,v_id,'inventory_purchase',p.id,p.id,s.journal_entry_id,p.date,'input',p.tax_code,
         coalesce(p.tax_treatment,case when p.tax_amount<>0 then 'taxable' else 'out_of_scope' end),round(p.total_cost-p.tax_amount,2),round(p.tax_amount,2),p.total_cost,1,coalesce(s.payload_hash,p.payload_hash,''),v_config_hash
    from public.inventory_purchases p
    join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=p.id and s.status='posted'
   where p.lodge_id=p_lodge_id and p.date between p_period_start and p_period_end;

  -- Approved debit/credit notes and tax adjustments are explicit tax sources,
  -- not inferred from account totals.  Credit notes reverse their direction.
  for v_row in
    select a.* from public.restaurant_tax_adjustments a
     where a.lodge_id=p_lodge_id and a.business_date between p_period_start and p_period_end and a.status='approved'
     order by a.business_date,a.id
  loop
    v_sign:=case when v_row.adjustment_type='credit_note' then -1 else 1 end;
    v_tax:=round(v_row.tax_amount*v_sign,2); v_base:=round(v_row.taxable_base*v_sign,2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
      taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
    ) values (
      p_lodge_id,v_id,'tax_adjustment',v_row.id,v_row.id,null,v_row.business_date,v_row.tax_direction,v_row.tax_code,v_row.tax_treatment,
      v_base,v_tax,round(v_row.gross_amount*v_sign,2),1,v_row.payload_hash,v_config_hash
    );
  end loop;

  select coalesce(sum(t.tax_amount) filter(where t.tax_direction='output'),0),coalesce(sum(t.tax_amount) filter(where t.tax_direction='input'),0),
         coalesce(sum(t.taxable_base) filter(where t.tax_direction='output'),0),coalesce(sum(t.taxable_base) filter(where t.tax_direction='input'),0)
    into v_output,v_input,v_sales,v_purchases
    from public.restaurant_tax_detail_allocations t where t.tax_return_id=v_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id',t.id,'source_type',t.source_type,'source_id',t.source_id,'source_line_id',t.source_line_id,'journal_entry_id',t.journal_entry_id,
    'business_date',t.business_date,'direction',t.tax_direction,'tax_code',t.tax_code,'tax_treatment',t.tax_treatment,'taxable_base',t.taxable_base,
    'tax_amount',t.tax_amount,'gross_amount',t.gross_amount,'source_version',t.source_version,'source_payload_hash',t.source_payload_hash,
    'configuration_hash',t.configuration_hash
  ) order by t.business_date,t.source_type,t.source_id,t.source_line_id),'[]'::jsonb) into v_manifest
    from public.restaurant_tax_detail_allocations t where t.tax_return_id=v_id;
  v_manifest_hash:=encode(digest(v_manifest::text,'sha256'),'hex');
  v_snapshot:=jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'configuration_id',v_cfg.id,'jurisdiction_code',v_cfg.jurisdiction_code,
    'rule_version',v_cfg.rule_version,'configuration_hash',v_config_hash,'sales_ex_tax',round(v_sales,2),'output_tax',round(v_output,2),
    'purchases_ex_tax',round(v_purchases,2),'input_tax',round(v_input,2),'net_tax_payable',round(v_output-v_input,2),
    'source_manifest_hash',v_manifest_hash,'allocation_count',jsonb_array_length(v_manifest),'generated_at',now());
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
  if p_target_return_id is null then
    insert into public.restaurant_tax_returns(
      id,lodge_id,period_start,period_end,tax_rate,total_sales_incl,total_sales_excl,total_tax_collected,total_purchases_incl,total_purchases_excl,total_input_tax,
      net_tax_payable,status,configuration_id,jurisdiction_code,rule_version,source_snapshot,snapshot_hash,source_manifest_hash,configuration_hash,prepared_by,prepared_at,generated_at,stale_at,updated_at
    ) values (
      v_id,p_lodge_id,p_period_start,p_period_end,0,v_sales+v_output,v_sales,v_output,v_purchases+v_input,v_purchases,v_input,v_output-v_input,'draft',v_cfg.id,v_cfg.jurisdiction_code,v_cfg.rule_version,
      v_snapshot,v_hash,v_manifest_hash,v_config_hash,v_actor,now(),now(),null,now()
    ) on conflict (lodge_id,period_start,period_end) where amendment_of is null do update set
      total_sales_incl=excluded.total_sales_incl,total_sales_excl=excluded.total_sales_excl,total_tax_collected=excluded.total_tax_collected,
      total_purchases_incl=excluded.total_purchases_incl,total_purchases_excl=excluded.total_purchases_excl,total_input_tax=excluded.total_input_tax,
      net_tax_payable=excluded.net_tax_payable,configuration_id=excluded.configuration_id,jurisdiction_code=excluded.jurisdiction_code,rule_version=excluded.rule_version,
      source_snapshot=excluded.source_snapshot,snapshot_hash=excluded.snapshot_hash,source_manifest_hash=excluded.source_manifest_hash,configuration_hash=excluded.configuration_hash,
      prepared_by=excluded.prepared_by,prepared_at=excluded.prepared_at,generated_at=excluded.generated_at,stale_at=null,updated_at=now();
  else
    update public.restaurant_tax_returns set
      total_sales_incl=v_sales+v_output,total_sales_excl=v_sales,total_tax_collected=v_output,
      total_purchases_incl=v_purchases+v_input,total_purchases_excl=v_purchases,total_input_tax=v_input,
      net_tax_payable=v_output-v_input,status='draft',configuration_id=v_cfg.id,jurisdiction_code=v_cfg.jurisdiction_code,
      rule_version=v_cfg.rule_version,source_snapshot=v_snapshot,snapshot_hash=v_hash,source_manifest_hash=v_manifest_hash,
      configuration_hash=v_config_hash,prepared_by=v_actor,prepared_at=now(),generated_at=now(),stale_at=null,updated_at=now()
    where id=v_id and lodge_id=p_lodge_id;
  end if;
  perform public.log_restaurant_financial_action(p_lodge_id,'tax_working_paper.generated','restaurant_tax_returns',v_id,null,v_snapshot,jsonb_build_object('snapshot_hash',v_hash,'source_manifest_hash',v_manifest_hash,'amendment_of',v_existing.amendment_of));
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'snapshot_hash',v_hash,'source_manifest_hash',v_manifest_hash,'source_manifest',v_manifest,'working_paper_only',true,'complete',true,'amendment_of',v_existing.amendment_of));
end
$$;

commit;
