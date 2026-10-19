-- Forward correction: preserve candidate 20261013010000 unchanged. This file
-- has its own transaction and must not be tested under an outer rollback.
-- Missing provenance is not a zero-row completeness proof. Non-manual classes
-- remain unverified until immutable producer intent/account allocation exists.
-- POS producer fallback is completed_at in the configured lodge timezone, then
-- current business date. Neither historic timezone nor fallback date is saved
-- independently for legacy null business_date rows: retain them in every range.
-- Stocktake uses pre-update posted_at::date/current business date; settlement
-- uses requested settlement date/end_date. Processing timestamps prove neither.
begin;

-- The governed draft stores the producer's canonical inputs. Protect them at
-- the table boundary as well as through client DML revocation, so the verifier
-- never mistakes a mutable business-row digest for immutable provenance.
create or replace function public.restaurant_manual_journal_preserve_evidence_v4()
returns trigger language plpgsql set search_path=public as $$
begin
  if row(old.id,old.lodge_id,old.entry_date,old.description,old.reference_number,old.source_type,old.lines,
         old.evidence_ref,old.operation_id,old.payload_hash,old.created_by,old.created_at)
     is distinct from row(new.id,new.lodge_id,new.entry_date,new.description,new.reference_number,new.source_type,new.lines,
         new.evidence_ref,new.operation_id,new.payload_hash,new.created_by,new.created_at)
     or (old.approved_by is not null and row(old.approved_by,old.approved_at) is distinct from row(new.approved_by,new.approved_at))
     or (old.journal_entry_id is not null and row(old.journal_entry_id,old.posted_by,old.posted_at) is distinct from row(new.journal_entry_id,new.posted_by,new.posted_at)) then
    raise exception 'Original manual journal inputs and established approval/posting evidence are immutable; use governed reversal or reconciliation' using errcode='55000';
  end if;
  return new;
end
$$;
drop trigger if exists restaurant_manual_journal_preserve_evidence_v4 on public.restaurant_manual_journal_drafts;
create trigger restaurant_manual_journal_preserve_evidence_v4 before update on public.restaurant_manual_journal_drafts
  for each row execute function public.restaurant_manual_journal_preserve_evidence_v4();
revoke all on function public.restaurant_manual_journal_preserve_evidence_v4() from public,anon,authenticated;

create or replace function public.restaurant_financial_source_population_v4(
  p_lodge_id uuid,p_source_type text,p_start_date date,p_end_date date
)
returns table(source_id uuid,business_date date)
language sql stable security definer set search_path=public as $$
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='pos_sale' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale' and coalesce(o.total,0)>=0
  union all
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='pos_return' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status in ('completed','settled') and (coalesce(o.transaction_type,'sale')='return' or coalesce(o.total,0)<0)
  union all
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='pos_void' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status='voided'
  union all
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='voucher_redemption' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
     and (lower(coalesce(o.payment_method,''))='voucher' or exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p
        where lower(coalesce(p->>'method',''))='voucher'))
  union all
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='voucher_return' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='return'
     and (lower(coalesce(o.payment_method,''))='voucher' or exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p
        where lower(coalesce(p->>'method',''))='voucher'))
  union all
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='customer_account_charge' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
     and (lower(coalesce(o.payment_method,'')) in ('account','ar') or exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p
        where lower(coalesce(p->>'method','')) in ('account','ar')))
  union all
  select o.id, o.business_date
    from public.pos_orders o
   where p_source_type='inventory_depletion' and o.lodge_id=p_lodge_id
     and (o.business_date between p_start_date and p_end_date or o.business_date is null)
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
     and exists(select 1 from public.pos_order_items i where i.order_id=o.id and i.lodge_id=p_lodge_id)
  union all
  select e.id, e.date from public.expenses e
   where p_source_type='direct_expense' and e.lodge_id=p_lodge_id and e.date between p_start_date and p_end_date
     and e.status in ('posted','paid','reversed')
  union all
  select b.id, b.bill_date from public.restaurant_bills b
   where p_source_type='ap_bill' and b.lodge_id=p_lodge_id and b.bill_date between p_start_date and p_end_date
     and b.status in ('approved','partially_paid','paid','overdue')
  union all
  select bp.id, bp.payment_date from public.restaurant_bill_payments bp
   where p_source_type='ap_payment' and bp.lodge_id=p_lodge_id and bp.payment_date between p_start_date and p_end_date
  union all
  select n.id, n.note_date from public.restaurant_ap_credit_notes n
   where p_source_type='ap_credit_note' and n.lodge_id=p_lodge_id and n.note_date between p_start_date and p_end_date and n.status='approved'
  union all
  select p.id, p.date from public.inventory_purchases p
   where p_source_type='inventory_receipt' and p.lodge_id=p_lodge_id and p.date between p_start_date and p_end_date
  union all
  select x.id, null::date from public.inventory_stocktakes x
   where p_source_type='inventory_count' and x.lodge_id=p_lodge_id and x.status='posted' 
     and exists(select 1 from public.inventory_stocktake_lines l where l.stocktake_id=x.id and l.lodge_id=p_lodge_id and coalesce(l.variance_cost,0)<>0)
  union all
  select s.id, coalesce(s.settlement_date,s.business_date) from public.restaurant_settlement_reconciliations s
   where p_source_type='settlement_and_fees' and s.lodge_id=p_lodge_id
     and coalesce(s.settlement_date,s.business_date) between p_start_date and p_end_date
  union all
  select c.id, c.date from public.pos_cashup_sessions c
   where p_source_type='cashup_variance' and c.lodge_id=p_lodge_id and c.date between p_start_date and p_end_date and coalesce(c.cash_over_short,0)<>0
  union all
  select p.id, p.end_date from public.restaurant_pay_periods p
   where p_source_type='payroll_accrual' and p.lodge_id=p_lodge_id and p.end_date between p_start_date and p_end_date
     and p.status in ('approved','paid','closed')
  union all
  select p.id, null::date from public.restaurant_pay_periods p
   where p_source_type='payroll_settlement' and p.lodge_id=p_lodge_id
      and p.settlement_status in ('settled','reconciled')
  union all
  select a.id, a.business_date from public.restaurant_tax_adjustments a
   where p_source_type='tax_adjustment' and a.lodge_id=p_lodge_id and a.business_date between p_start_date and p_end_date and a.status='approved'
  union all
  select d.id, d.entry_date from public.restaurant_manual_journal_drafts d
   where p_source_type='manual_journal' and d.lodge_id=p_lodge_id and d.status='posted'
     and d.entry_date between p_start_date and p_end_date
  union all
  -- Legacy journals have no independently governed draft payload. Keep them
  -- visible; never manufacture a draft or hash from their current journal.
  select j.id,j.entry_date from public.restaurant_journal_entries j
   where p_source_type='manual_journal' and j.lodge_id=p_lodge_id and j.is_posted
     and j.entry_date between p_start_date and p_end_date and j.source_type in ('manual','manual_journal')
     and not exists(select 1 from public.restaurant_manual_journal_drafts d where d.lodge_id=p_lodge_id and d.journal_entry_id=j.id and d.status='posted');
$$;

-- Snapshot and identity readers consume this SAME population, including
-- unresolved business dates in every range. Never infer a historical posting
-- date from a processing timestamp, journal date, or today's configuration.
create or replace function public.restaurant_financial_source_expected_ids_v3(
  p_lodge_id uuid,p_source_type text,p_start_date date,p_end_date date
)
returns table(source_id uuid,business_date date)
language sql stable security definer set search_path=public as $$
  select * from public.restaurant_financial_source_population_v4(p_lodge_id,p_source_type,p_start_date,p_end_date);
$$;

create or replace function public.restaurant_financial_source_snapshot(
  p_lodge_id uuid,p_source_type text,p_start_date date,p_end_date date
)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('row_count',count(*),'total',null,
    'source_ids',coalesce(jsonb_agg(jsonb_build_object('source_id',source_id,'business_date',business_date) order by source_id),'[]'::jsonb),
    'unresolved_business_dates',count(*) filter(where business_date is null),
    'amount_status','unverified; class reconciliation is separate from population')
  from public.restaurant_financial_source_population_v4(p_lodge_id,p_source_type,p_start_date,p_end_date);
$$;

-- Internal verifier of canonical producer intent. Only the DB wrapper constructs
-- these inputs; client-supplied evidence never establishes completeness.
create or replace function public.restaurant_financial_evidence_check_v4(p_expected jsonb,p_actual jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare a jsonb; reasons jsonb:='[]'::jsonb; ok boolean;
begin
  if coalesce(p_expected->>'provenance_verified','false')<>'true'
     or coalesce(p_expected->>'approved','false')<>'true'
     or nullif(p_expected->>'source_payload_hash','') is null
     or nullif(p_expected->>'journal_payload_hash','') is null
     or nullif(p_expected->>'business_date','') is null then
    reasons:=reasons||jsonb_build_array('missing_or_invalid_canonical_provenance');
  end if;
  if jsonb_typeof(p_actual) is distinct from 'array' then
    return jsonb_build_object('complete',false,'reasons',jsonb_build_array('invalid_posting_evidence'));
  end if;
  if jsonb_array_length(p_actual)<>1 then
    return jsonb_build_object('complete',false,'reasons',reasons||jsonb_build_array(case when jsonb_array_length(p_actual)=0 then 'missing_posting' else 'duplicate_alias_or_source_version' end));
  end if;
  a:=p_actual->0;
  foreach ok in array array[
    coalesce(a->>'lodge_id' = p_expected->>'lodge_id',false),
    coalesce(a->>'source_id' = p_expected->>'source_id',false),
    coalesce(a->>'source_version' = p_expected->>'source_version',false),
    coalesce(a->>'source_payload_hash' = p_expected->>'source_payload_hash',false),
    coalesce(a->>'business_date' = p_expected->>'business_date',false),
    coalesce(a->>'journal_lodge_id' = p_expected->>'lodge_id',false),
    coalesce(a->>'journal_source_id' = p_expected->>'source_id',false),
    coalesce(a->>'journal_entry_id' = p_expected->>'journal_entry_id',false),
    coalesce(a->>'journal_date' = p_expected->>'business_date',false),
    coalesce(a->>'journal_payload_hash' = p_expected->>'journal_payload_hash',false),
    coalesce(a->>'journal_source_type' = p_expected->>'journal_source_type',false),
    coalesce(a->>'posting_key' = p_expected->>'posting_key',false),
    coalesce(a->>'is_posted','false')='true',
    coalesce(a->>'status','')='posted',
    coalesce(a->>'shared_journal_count','0')='1'
  ] loop
    if not ok then reasons:=reasons||jsonb_build_array('identity_state_date_version_hash_or_shared_journal_mismatch'); exit; end if;
  end loop;
  if jsonb_typeof(p_expected->'lines') is distinct from 'array' or jsonb_typeof(a->'lines') is distinct from 'array' then
    reasons:=reasons||jsonb_build_array('missing_class_account_allocation');
  else
    -- Account + debit + credit + memo MULTISET, preserving repeated equal values.
    -- A balanced journal on another account or for another amount is rejected.
    if exists(
      (select (l->>'account_id')::uuid,round(coalesce((l->>'debit')::numeric,0),2),round(coalesce((l->>'credit')::numeric,0),2),nullif(btrim(l->>'memo'),'') from jsonb_array_elements(p_expected->'lines') l
       except all
       select (l->>'account_id')::uuid,round(coalesce((l->>'debit')::numeric,0),2),round(coalesce((l->>'credit')::numeric,0),2),nullif(btrim(l->>'memo'),'') from jsonb_array_elements(a->'lines') l)
      union all
      (select (l->>'account_id')::uuid,round(coalesce((l->>'debit')::numeric,0),2),round(coalesce((l->>'credit')::numeric,0),2),nullif(btrim(l->>'memo'),'') from jsonb_array_elements(a->'lines') l
       except all
       select (l->>'account_id')::uuid,round(coalesce((l->>'debit')::numeric,0),2),round(coalesce((l->>'credit')::numeric,0),2),nullif(btrim(l->>'memo'),'') from jsonb_array_elements(p_expected->'lines') l)
    ) then reasons:=reasons||jsonb_build_array('class_account_direction_or_amount_mismatch'); end if;
    if jsonb_array_length(p_expected->'lines')=0 or exists(select 1 from jsonb_array_elements(p_expected->'lines') l where
      nullif(l->>'account_id','') is null or coalesce((l->>'debit')::numeric,0)<0 or coalesce((l->>'credit')::numeric,0)<0
      or (coalesce((l->>'debit')::numeric,0)>0)=(coalesce((l->>'credit')::numeric,0)>0))
      or (select sum(round(coalesce((l->>'debit')::numeric,0),2)-round(coalesce((l->>'credit')::numeric,0),2)) from jsonb_array_elements(p_expected->'lines') l)<>0
      or (select sum(round(coalesce((l->>'debit')::numeric,0),2)) from jsonb_array_elements(p_expected->'lines') l)<=0 then
      reasons:=reasons||jsonb_build_array('invalid_canonical_financial_lines');
    end if;
  end if;
  return jsonb_build_object('complete',jsonb_array_length(reasons)=0,'reasons',reasons);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('complete',false,'reasons',jsonb_build_array('malformed_financial_evidence'));
end
$$;

create or replace function public.restaurant_manual_journal_evidence_v4(p_lodge_id uuid,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d public.restaurant_manual_journal_drafts%rowtype; expected jsonb; actual jsonb; canonical_hash text; journal_hash text;
begin
  select * into d from public.restaurant_manual_journal_drafts where lodge_id=p_lodge_id and id=p_source_id and status='posted';
  if not found then return jsonb_build_object('complete',false,'reasons',jsonb_build_array('legacy_manual_journal_without_governed_draft')); end if;
  -- These are the original canonical producer recipes, from the preserved draft
  -- inputs. Never digest to_jsonb(current_business_row) to create provenance.
  canonical_hash:=encode(digest(jsonb_build_object(
    'lodge_id',d.lodge_id,'entry_date',d.entry_date,'description',btrim(d.description),
    'reference_number',nullif(btrim(d.reference_number),''),'lines',d.lines,
    'evidence_ref',btrim(d.evidence_ref),'operation_id',d.operation_id
  )::text,'sha256'),'hex');
  journal_hash:=encode(digest(jsonb_build_object(
    'lodge_id',d.lodge_id,'entry_date',d.entry_date,'description',btrim(d.description),
    'source_type','manual'::text,'source_id',d.id,'reference_number',nullif(btrim(d.reference_number),''),
    'lines',d.lines,'reversal_of',null
  )::text,'sha256'),'hex');
  expected:=jsonb_build_object('lodge_id',d.lodge_id,'source_id',d.id,'business_date',d.entry_date,
    'journal_entry_id',d.journal_entry_id,
    'source_version',1, -- governed manual-draft v1; this producer has no tracker version
    'source_payload_hash',canonical_hash,'journal_payload_hash',journal_hash,
    'journal_source_type','manual','posting_key','manual-journal:'||d.id::text,'lines',d.lines,
    'provenance_verified',d.payload_hash=canonical_hash and d.operation_id is not null and d.journal_entry_id is not null
      and nullif(btrim(d.evidence_ref),'') is not null and d.posted_by is not null and d.posted_at is not null
      and not exists(select 1 from jsonb_array_elements(d.lines) l left join public.restaurant_accounts a
        on a.id=(l->>'account_id')::uuid and a.lodge_id=d.lodge_id where a.id is null),
    'approved',d.created_by is not null and d.approved_by is not null and d.approved_by<>d.created_by and d.approved_at is not null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'lodge_id',d.lodge_id,'source_id',d.id,'business_date',d.entry_date,'source_version',1,'source_payload_hash',d.payload_hash,
    'journal_lodge_id',j.lodge_id,'journal_source_id',j.source_id,'journal_date',j.entry_date,
    'journal_entry_id',j.id,
    'journal_payload_hash',j.payload_hash,'journal_source_type',j.source_type,'posting_key',j.posting_key,
    'is_posted',j.is_posted,'status',case when j.is_posted then 'posted' else 'pending' end,
    'shared_journal_count',(select count(*) from public.restaurant_manual_journal_drafts x where x.journal_entry_id=j.id)
      +(select count(*) from public.restaurant_financial_source_postings s where s.journal_entry_id=j.id),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('account_id',l.account_id,'debit',l.debit,'credit',l.credit,'memo',l.memo)),'[]'::jsonb)
      from public.restaurant_journal_lines l where l.entry_id=j.id)
  )),'[]'::jsonb) into actual from public.restaurant_journal_entries j
  where j.id=d.journal_entry_id or (j.source_id=d.id and j.source_type in ('manual','manual_journal'));
  return public.restaurant_financial_evidence_check_v4(expected,actual)||jsonb_build_object(
    'source_id',d.id,'business_date',d.entry_date,'contract','governed_manual_draft_v1',
    'control_total',(select sum(round(coalesce((l->>'debit')::numeric,0),2)) from jsonb_array_elements(d.lines) l));
end
$$;

-- Census starts from actual postings as well as expected sources. Unexpected
-- rows, aliases, stale versions and foreign/unposted journals cannot vanish.
create or replace function public.restaurant_financial_posting_exceptions_v4(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language sql stable security definer set search_path=public as $$
  with expected as materialized (
    select r.source_type,r.posting_source_types,e.* from public.restaurant_financial_source_registry r
    cross join lateral public.restaurant_financial_source_population_v4(p_lodge_id,r.source_type,p_start_date,p_end_date) e where r.enabled
  ), census as (
    select s.*,j.lodge_id journal_lodge,j.is_posted,j.entry_date journal_date,
      (select count(*) from expected e where s.source_type=any(e.posting_source_types) and e.source_id=s.source_id) owners,
      (select count(*) from public.restaurant_financial_source_postings x where x.journal_entry_id=s.journal_entry_id)
       +(select count(*) from public.restaurant_manual_journal_drafts d where d.journal_entry_id=s.journal_entry_id) journal_owners,
      (select count(*) from public.restaurant_financial_source_postings x where x.lodge_id=s.lodge_id and x.source_type=s.source_type and x.source_id=s.source_id) versions
    from public.restaurant_financial_source_postings s left join public.restaurant_journal_entries j on j.id=s.journal_entry_id
    where (s.lodge_id=p_lodge_id or j.lodge_id=p_lodge_id) and (s.business_date between p_start_date and p_end_date or j.entry_date between p_start_date and p_end_date
      or exists(select 1 from expected e where s.source_type=any(e.posting_source_types) and e.source_id=s.source_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object('posting_id',case when lodge_id=p_lodge_id then id else null end,
    'source_type',source_type,'source_id',case when lodge_id=p_lodge_id then source_id else null end,'source_version',source_version,
    'business_date',business_date,'status',status,'journal_entry_id',journal_entry_id,
    'reasons',jsonb_build_array('producer_canonical_provenance_and_class_allocation_unverified')
      ||case when lodge_id is distinct from p_lodge_id then jsonb_build_array('foreign_source_lodge_reference') else '[]'::jsonb end
      ||case when owners=0 then jsonb_build_array('unexpected_or_orphan_posting') else '[]'::jsonb end
      ||case when owners>1 then jsonb_build_array('ambiguous_posting_alias') else '[]'::jsonb end
      ||case when status<>'posted' then jsonb_build_array('pending_failed_exception_or_reversed_posting') else '[]'::jsonb end
      ||case when journal_lodge is distinct from p_lodge_id or is_posted is distinct from true or journal_date is distinct from business_date
        then jsonb_build_array('foreign_unposted_or_wrong_date_journal') else '[]'::jsonb end
      ||case when journal_owners>1 then jsonb_build_array('duplicate_alias_or_shared_journal') else '[]'::jsonb end
      ||case when versions>1 then jsonb_build_array('stale_or_duplicate_source_version') else '[]'::jsonb end
      ||case when nullif(payload_hash,'') is null then jsonb_build_array('missing_legacy_payload_hash') else '[]'::jsonb end
  ) order by source_type,source_id,source_version),'[]'::jsonb)
  ||(select coalesce(jsonb_agg(jsonb_build_object('journal_entry_id',j.id,'source_type',j.source_type,'source_id',j.source_id,
      'business_date',j.entry_date,'reasons',jsonb_build_array('journal_without_governed_source_evidence'))),'[]'::jsonb)
    from public.restaurant_journal_entries j where j.lodge_id=p_lodge_id and j.entry_date between p_start_date and p_end_date
      and not exists(select 1 from public.restaurant_financial_source_postings s where s.journal_entry_id=j.id)
      and not exists(select 1 from public.restaurant_manual_journal_drafts d where d.lodge_id=p_lodge_id and d.journal_entry_id=j.id and d.status='posted'))
  from census;
$$;

create or replace function public.get_restaurant_financial_source_coverage_v2(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r record; e record; result jsonb; rows jsonb:='[]'::jsonb; missing jsonb:='[]'::jsonb; details jsonb;
  exceptions jsonb; expected_count bigint; posted_count bigint; unresolved_count bigint; total numeric; verified_total numeric;
  row_status text; reason text; effective date; active boolean; complete boolean;
begin
  if p_lodge_id is null or p_start_date is null or p_end_date is null or p_end_date<p_start_date then
    raise exception 'Valid lodge and coverage period are required' using errcode='22023';
  end if;
  active:=public.restaurant_accounting_is_active(p_lodge_id);
  select effective_from into effective from public.restaurant_accounting_activation where lodge_id=p_lodge_id and status='active';
  exceptions:=public.restaurant_financial_posting_exceptions_v4(p_lodge_id,p_start_date,p_end_date);
  for r in select * from public.restaurant_financial_source_registry order by source_type loop
    expected_count:=0; posted_count:=0; unresolved_count:=0; total:=0; verified_total:=0; details:='[]'::jsonb;
    for e in select * from public.restaurant_financial_source_population_v4(p_lodge_id,r.source_type,p_start_date,p_end_date) loop
      expected_count:=expected_count+1;
      if e.business_date is null then unresolved_count:=unresolved_count+1; end if;
      if r.source_type='manual_journal' then
        result:=public.restaurant_manual_journal_evidence_v4(p_lodge_id,e.source_id);
        if result->>'complete'='true' then posted_count:=posted_count+1; verified_total:=verified_total+(result->>'control_total')::numeric; end if;
        total:=total+coalesce((result->>'control_total')::numeric,0);
      else
        result:=jsonb_build_object('complete',false,'reasons',jsonb_build_array(
          case when r.source_type in ('voucher_redemption','voucher_return','customer_account_charge','inventory_depletion')
            then 'tender_or_cost_specific_contract_unsupported' else 'producer_canonical_provenance_and_class_allocation_unverified' end));
      end if;
      details:=details||jsonb_build_array(result||jsonb_build_object('source_id',e.source_id,'business_date',e.business_date));
    end loop;
    reason:=case
      when r.source_type in ('voucher_redemption','voucher_return','customer_account_charge','inventory_depletion') then 'tender_or_cost_specific_contract_unsupported'
      when r.source_type<>'manual_journal' then 'producer_canonical_provenance_and_class_allocation_unverified'
      when r.posting_contract='unsupported' then 'registry_contract_unsupported'
      when expected_count<>posted_count then 'exact_governed_manual_journal_reconciliation_failed'
      else null end;
    row_status:=case when not r.enabled then 'disabled' when reason is null then 'complete' else 'unsupported' end;
    rows:=rows||jsonb_build_array(jsonb_build_object('source_type',r.source_type,'enabled_product',r.enabled_product,
      'authoritative_mutation',r.authoritative_mutation,'required_subledger',r.required_subledger,'required_gl_posting',r.required_gl_posting,
      'expected_report',r.expected_report,'posting_source_types',r.posting_source_types,
      'source_rows',expected_count,'expected_rows',expected_count,'posted_rows',posted_count,
      'pending_rows',(select count(*) from jsonb_array_elements(exceptions) x where x->>'source_type'=any(r.posting_source_types) and x->>'status'='pending'),
      'failed_rows',(select count(*) from jsonb_array_elements(exceptions) x where x->>'source_type'=any(r.posting_source_types) and x->>'status' in ('exception','failed','reversed')),
      'unsupported_rows',expected_count-posted_count,'unresolved_business_dates',unresolved_count,
      'subledger_total',case when r.source_type='manual_journal' and expected_count=posted_count then total else null end,
      'gl_total',case when r.source_type='manual_journal' and expected_count=posted_count then verified_total else null end,
      'difference',case when r.source_type='manual_journal' and expected_count=posted_count then total-verified_total else null end,
      'status',row_status,'reason',reason,'source_evidence',details));
    if r.enabled and reason is not null then missing:=missing||jsonb_build_array(jsonb_build_object('source_type',r.source_type,'reason',reason)); end if;
  end loop;
  if jsonb_array_length(exceptions)>0 then missing:=missing||jsonb_build_array(jsonb_build_object('source_type','posting_census','reason','actual_postings_require_verified_producer_contract','count',jsonb_array_length(exceptions))); end if;
  -- Never claim completeness from an empty or missing registry.
  if not exists(select 1 from public.restaurant_financial_source_registry where enabled) then
    missing:=missing||jsonb_build_array(jsonb_build_object('source_type','registry','reason','no_enabled_verified_source_registry'));
  end if;
  complete:=active and effective is not null and jsonb_array_length(missing)=0;
  return jsonb_build_object('success',true,'data',jsonb_build_object('status',case when not active then 'not_active' when complete then 'complete' else 'incomplete' end,
    'complete',complete,'source_coverage_complete',complete,'accounting_active',active,'effective_from',effective,
    'contract_version',4,'rows',rows,'missing',missing,'posting_exceptions',exceptions,
    'formula','active AND effective date AND every enabled family has verified immutable producer intent and exact financial lines AND no unexpected/exceptional postings'));
end
$$;

-- The desktop and close/checker paths call this older named wrapper. Route them
-- to the same v4 contract used by Statements; preserve its existing ACL exactly.
create or replace function public.get_restaurant_financial_source_coverage(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  return public.get_restaurant_financial_source_coverage_v2(p_lodge_id,p_start_date,p_end_date);
end
$$;

update public.restaurant_financial_source_registry set posting_contract='unsupported'
  where source_type in ('voucher_redemption','voucher_return','customer_account_charge','inventory_depletion');

revoke all on function public.restaurant_financial_source_population_v4(uuid,text,date,date),
  public.restaurant_financial_source_expected_ids_v3(uuid,text,date,date),public.restaurant_financial_source_snapshot(uuid,text,date,date),
  public.restaurant_financial_evidence_check_v4(jsonb,jsonb),public.restaurant_manual_journal_evidence_v4(uuid,uuid),
  public.restaurant_financial_posting_exceptions_v4(uuid,date,date),public.get_restaurant_financial_source_coverage_v2(uuid,date,date)
  from public,anon,authenticated;
grant execute on function public.restaurant_financial_source_population_v4(uuid,text,date,date),
  public.restaurant_financial_source_expected_ids_v3(uuid,text,date,date),public.restaurant_financial_source_snapshot(uuid,text,date,date),
  public.restaurant_financial_evidence_check_v4(jsonb,jsonb),public.restaurant_manual_journal_evidence_v4(uuid,uuid),
  public.restaurant_financial_posting_exceptions_v4(uuid,date,date),public.get_restaurant_financial_source_coverage_v2(uuid,date,date)
  to service_role;
commit;
