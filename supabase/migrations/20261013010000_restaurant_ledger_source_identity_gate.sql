-- Match financial source postings to the exact authoritative source row.
-- The previous coverage reader joined by posting family and date only, so a
-- different same-day source row could satisfy the expected row count. It also
-- counted journal lines without proving that the linked entry was posted in
-- the same lodge and on the source business date.
begin;

create or replace function public.restaurant_financial_source_expected_ids_v3(
  p_lodge_id uuid,
  p_source_type text,
  p_start_date date,
  p_end_date date
)
returns table(source_id uuid, business_date date)
language sql
stable
security definer
set search_path=public
as $$
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='pos_sale' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale' and coalesce(o.total,0)>=0
  union all
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='pos_return' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
     and o.status in ('completed','settled') and (coalesce(o.transaction_type,'sale')='return' or coalesce(o.total,0)<0)
  union all
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='pos_void' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
     and o.status='voided'
  union all
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='voucher_redemption' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
     and (lower(coalesce(o.payment_method,''))='voucher' or exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p
        where lower(coalesce(p->>'method',''))='voucher'))
  union all
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='voucher_return' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='return'
     and (lower(coalesce(o.payment_method,''))='voucher' or exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p
        where lower(coalesce(p->>'method',''))='voucher'))
  union all
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='customer_account_charge' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
     and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
     and (lower(coalesce(o.payment_method,'')) in ('account','ar') or exists(
       select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p
        where lower(coalesce(p->>'method','')) in ('account','ar')))
  union all
  select o.id, coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date)
    from public.pos_orders o
   where p_source_type='inventory_depletion' and o.lodge_id=p_lodge_id
     and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
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
  select x.id, x.posted_at::date from public.inventory_stocktakes x
   where p_source_type='inventory_count' and x.lodge_id=p_lodge_id and x.status='posted' and x.posted_at::date between p_start_date and p_end_date
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
  select p.id, coalesce(p.paid_at::date,p.end_date) from public.restaurant_pay_periods p
   where p_source_type='payroll_settlement' and p.lodge_id=p_lodge_id
     and coalesce(p.paid_at::date,p.end_date) between p_start_date and p_end_date and p.settlement_status in ('settled','reconciled')
  union all
  select a.id, a.business_date from public.restaurant_tax_adjustments a
   where p_source_type='tax_adjustment' and a.lodge_id=p_lodge_id and a.business_date between p_start_date and p_end_date and a.status='approved'
  union all
  select e.id, e.entry_date from public.restaurant_journal_entries e
   where p_source_type='manual_journal' and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
     and coalesce(e.source_type,'') in ('manual','manual_journal');
$$;

revoke all on function public.restaurant_financial_source_expected_ids_v3(uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.restaurant_financial_source_expected_ids_v3(uuid,text,date,date) to service_role;

-- These aggregates count the entire POS order for voucher/customer-account
-- tender and inventory depletion. They cannot prove the tender-specific or
-- cost-specific amount, so prevent them from certifying source completeness.
update public.restaurant_financial_source_registry
   set posting_contract='unsupported'
 where enabled and posting_contract<>'unsupported'
   and source_type in ('voucher_redemption','voucher_return','customer_account_charge','inventory_depletion');

create or replace function public.get_restaurant_financial_source_coverage_v2(
  p_lodge_id uuid,p_start_date date,p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_active boolean:=public.restaurant_accounting_is_active(p_lodge_id);
  v_effective date;
  v_rows jsonb;
  v_missing jsonb;
  v_complete boolean;
begin
  select effective_from into v_effective from public.restaurant_accounting_activation
   where lodge_id=p_lodge_id and status='active';
  if not v_active then
    return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'accounting_active',false,'source_coverage_complete',false,'rows','[]'::jsonb,'missing','[]'::jsonb));
  end if;
  with coverage as (
    select r.source_type,r.enabled_product,r.authoritative_mutation,r.required_subledger,r.required_gl_posting,
      r.expected_report,r.posting_contract,r.enabled,r.posting_source_types,
      (snap->>'row_count')::bigint expected_rows,(snap->>'total')::numeric subledger_total,
      count(distinct e.source_id) filter(where s.status='posted' and je.id is not null) posted_rows,
      count(s.id) filter(where s.status='pending') pending_rows,
      count(s.id) filter(where s.status in ('exception','failed')) failed_rows,
      count(distinct e.source_id) filter(where s.status='posted' and (s.journal_entry_id is null or je.id is null)) unsupported_rows,
      coalesce(sum((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=je.id))
        filter(where s.status='posted' and je.id is not null),0) gl_total
    from public.restaurant_financial_source_registry r
    cross join lateral public.restaurant_financial_source_snapshot(p_lodge_id,r.source_type,p_start_date,p_end_date) snap
    left join lateral public.restaurant_financial_source_expected_ids_v3(p_lodge_id,r.source_type,p_start_date,p_end_date) e on true
    left join public.restaurant_financial_source_postings s
      on s.lodge_id=p_lodge_id and s.source_type=any(r.posting_source_types)
     and s.source_id=e.source_id and s.business_date=e.business_date
    left join public.restaurant_journal_entries je
      on je.id=s.journal_entry_id and je.lodge_id=p_lodge_id and je.is_posted and je.entry_date=s.business_date
    group by r.source_type,r.enabled_product,r.authoritative_mutation,r.required_subledger,r.required_gl_posting,
      r.expected_report,r.posting_contract,r.enabled,r.posting_source_types,snap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'source_type',source_type,'enabled_product',enabled_product,'authoritative_mutation',authoritative_mutation,
      'required_subledger',required_subledger,'required_gl_posting',required_gl_posting,'expected_report',expected_report,
      'posting_source_types',posting_source_types,'source_rows',expected_rows,'expected_rows',expected_rows,
      'posted_rows',posted_rows,'pending_rows',pending_rows,'failed_rows',failed_rows,
      'unsupported_rows',greatest(unsupported_rows,expected_rows-posted_rows,0),
      'subledger_total',round(coalesce(subledger_total,0),2),'gl_total',round(coalesce(gl_total,0),2),
      'difference',round(coalesce(subledger_total,0)-coalesce(gl_total,0),2),
      'status',case when not enabled then 'disabled' when posting_contract='unsupported' then 'unsupported'
        when unsupported_rows>0 or expected_rows>posted_rows or pending_rows>0 or failed_rows>0
          or round(coalesce(subledger_total,0)-coalesce(gl_total,0),2)<>0 then 'incomplete' else 'complete' end
    ) order by source_type),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('source_type',source_type,'reason',case
      when posting_contract='unsupported' then 'enabled source has no supported posting contract'
      when unsupported_rows>0 then 'posted source has no same-lodge posted journal entry on the source business date'
      when expected_rows>posted_rows then 'authoritative source rows are missing an exact-identity posted subledger/GL record'
      when pending_rows>0 or failed_rows>0 then 'pending or failed source postings exist'
      when round(coalesce(subledger_total,0)-coalesce(gl_total,0),2)<>0 then 'subledger-to-GL control does not reconcile'
      else 'source coverage is incomplete' end) order by source_type)
      filter(where enabled and (posting_contract='unsupported' or expected_rows>posted_rows or pending_rows>0 or failed_rows>0 or unsupported_rows>0 or round(coalesce(subledger_total,0)-coalesce(gl_total,0),2)<>0)),'[]'::jsonb)
    into v_rows,v_missing from coverage;
  v_complete:=v_effective is not null and jsonb_array_length(v_missing)=0;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'status',case when v_complete then 'complete' else 'incomplete' end,'complete',v_complete,
    'accounting_active',v_active,'effective_from',v_effective,'source_coverage_complete',v_complete,
    'missing',v_missing,'rows',v_rows,
    'formula','accounting_active AND effective_from IS NOT NULL AND no missing exact-identity sources AND no unsupported sources AND no pending/failed postings AND all subledger-to-GL controls reconcile'
  ));
end
$$;

revoke all on function public.get_restaurant_financial_source_coverage_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.get_restaurant_financial_source_coverage_v2(uuid,date,date) to service_role;

commit;
