-- Financial truth gate 7/9: source coverage counts the authoritative
-- population first. A missing posting must remain visible as a blocking
-- exception. This is forward-only after the 20260807410000 boundary.

begin;

alter table public.restaurant_financial_source_registry
  add column if not exists posting_source_types text[] not null default '{}'::text[];

update public.restaurant_financial_source_registry
set posting_source_types = case source_type
  when 'pos_sale' then array['pos_order']::text[]
  when 'pos_return' then array['pos_order']::text[]
  when 'pos_void' then array['pos_order']::text[]
  when 'voucher_redemption' then array['pos_order']::text[]
  when 'voucher_return' then array['pos_order']::text[]
  when 'customer_account_charge' then array['pos_order']::text[]
  when 'direct_expense' then array['expense']::text[]
  when 'ap_bill' then array['ap_bill']::text[]
  when 'ap_payment' then array['ap_payment']::text[]
  when 'ap_credit_note' then array['ap_credit_note']::text[]
  when 'inventory_receipt' then array['inventory_purchase']::text[]
  when 'inventory_count' then array['inventory_stocktake']::text[]
  when 'inventory_depletion' then array['pos_order']::text[]
  when 'settlement_and_fees' then array['settlement']::text[]
  when 'cashup_variance' then array['cashup']::text[]
  when 'payroll_accrual' then array['payroll']::text[]
  when 'payroll_settlement' then array['payroll_settlement']::text[]
  when 'tax_adjustment' then array['tax_adjustment']::text[]
  when 'manual_journal' then array['manual','manual_journal']::text[]
  else '{}'::text[]
end;

create or replace function public.restaurant_financial_source_snapshot(
  p_lodge_id uuid, p_source_type text, p_start_date date, p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows bigint := 0;
  v_total numeric := 0;
begin
  if p_source_type='pos_sale' then
    v_rows := (select count(*)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
      and coalesce(o.total,0)>=0);
    v_total := (select coalesce(sum(abs(coalesce(o.total,0))),0)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
      and coalesce(o.total,0)>=0);
  elsif p_source_type='pos_return' then
    v_rows := (select count(*)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled')
      and (coalesce(o.transaction_type,'sale')='return' or coalesce(o.total,0)<0));
    v_total := (select coalesce(sum(abs(coalesce(o.total,0))),0)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled')
      and (coalesce(o.transaction_type,'sale')='return' or coalesce(o.total,0)<0));
  elsif p_source_type='pos_void' then
    v_rows := (select count(*)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status='voided');
    v_total := (select coalesce(sum(abs(coalesce(o.total,0))),0)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status='voided');
  elsif p_source_type in ('voucher_redemption','customer_account_charge') then
    v_rows := (select count(*)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
      and (
        (p_source_type='voucher_redemption' and (lower(coalesce(o.payment_method,''))='voucher'
          or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher')))
        or
        (p_source_type='customer_account_charge' and (lower(coalesce(o.payment_method,'')) in ('account','ar')
          or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method','')) in ('account','ar'))))
      ));
    v_total := (select coalesce(sum(abs(coalesce(o.total,0))),0)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
      and (
        (p_source_type='voucher_redemption' and (lower(coalesce(o.payment_method,''))='voucher'
          or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher')))
        or
        (p_source_type='customer_account_charge' and (lower(coalesce(o.payment_method,'')) in ('account','ar')
          or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method','')) in ('account','ar'))))
      ));
  elsif p_source_type='voucher_return' then
    v_rows := (select count(*)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='return'
      and (lower(coalesce(o.payment_method,''))='voucher' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher')));
    v_total := (select coalesce(sum(abs(coalesce(o.total,0))),0)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='return'
      and (lower(coalesce(o.payment_method,''))='voucher' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher')));
  elsif p_source_type='inventory_depletion' then
    v_rows := (select count(*)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
      and exists(select 1 from public.pos_order_items i where i.order_id=o.id and i.lodge_id=p_lodge_id));
    v_total := (select coalesce(sum(abs(coalesce(o.total,0))),0)
    from public.pos_orders o
    where o.lodge_id=p_lodge_id
      and coalesce(o.business_date,(o.created_at at time zone 'Africa/Gaborone')::date) between p_start_date and p_end_date
      and o.status in ('completed','settled') and coalesce(o.transaction_type,'sale')='sale'
      and exists(select 1 from public.pos_order_items i where i.order_id=o.id and i.lodge_id=p_lodge_id));
  elsif p_source_type='direct_expense' then
    v_rows := (select count(*)
    from public.expenses e
    where e.lodge_id=p_lodge_id and e.date between p_start_date and p_end_date
      and e.status in ('posted','paid','reversed'));
    v_total := (select coalesce(sum(abs(coalesce(e.amount,0))),0)
    from public.expenses e
    where e.lodge_id=p_lodge_id and e.date between p_start_date and p_end_date
      and e.status in ('posted','paid','reversed'));
  elsif p_source_type='ap_bill' then
    v_rows := (select count(*)
    from public.restaurant_bills b
    where b.lodge_id=p_lodge_id and b.bill_date between p_start_date and p_end_date
      and b.status in ('approved','partially_paid','paid','overdue'));
    v_total := (select coalesce(sum(abs(coalesce(b.total,0))),0)
    from public.restaurant_bills b
    where b.lodge_id=p_lodge_id and b.bill_date between p_start_date and p_end_date
      and b.status in ('approved','partially_paid','paid','overdue'));
  elsif p_source_type='ap_payment' then
    v_rows := (select count(*)
    from public.restaurant_bill_payments bp
    where bp.lodge_id=p_lodge_id and bp.payment_date between p_start_date and p_end_date);
    v_total := (select coalesce(sum(abs(coalesce(bp.amount,0))),0)
    from public.restaurant_bill_payments bp
    where bp.lodge_id=p_lodge_id and bp.payment_date between p_start_date and p_end_date);
  elsif p_source_type='ap_credit_note' then
    v_rows := (select count(*)
    from public.restaurant_ap_credit_notes n
    where n.lodge_id=p_lodge_id and n.note_date between p_start_date and p_end_date and n.status='approved');
    v_total := (select coalesce(sum(abs(coalesce(n.total,0))),0)
    from public.restaurant_ap_credit_notes n
    where n.lodge_id=p_lodge_id and n.note_date between p_start_date and p_end_date and n.status='approved');
  elsif p_source_type='inventory_receipt' then
    v_rows := (select count(*)
    from public.inventory_purchases p
    where p.lodge_id=p_lodge_id and p.date between p_start_date and p_end_date);
    v_total := (select coalesce(sum(abs(coalesce(p.total_cost,0))),0)
    from public.inventory_purchases p
    where p.lodge_id=p_lodge_id and p.date between p_start_date and p_end_date);
  elsif p_source_type='inventory_count' then
    v_rows := (select count(*)
    from public.inventory_stocktakes x
    where x.lodge_id=p_lodge_id and x.status='posted' and x.posted_at::date between p_start_date and p_end_date
      and exists(select 1 from public.inventory_stocktake_lines l where l.stocktake_id=x.id and l.lodge_id=p_lodge_id and coalesce(l.variance_cost,0)<>0));
    v_total := (select coalesce(sum((select sum(abs(coalesce(l.variance_cost,0))) from public.inventory_stocktake_lines l where l.stocktake_id=x.id and l.lodge_id=p_lodge_id)),0)
    from public.inventory_stocktakes x
    where x.lodge_id=p_lodge_id and x.status='posted' and x.posted_at::date between p_start_date and p_end_date
      and exists(select 1 from public.inventory_stocktake_lines l where l.stocktake_id=x.id and l.lodge_id=p_lodge_id and coalesce(l.variance_cost,0)<>0));
  elsif p_source_type='settlement_and_fees' then
    v_rows := (select count(*)
    from public.restaurant_settlement_reconciliations s
    where s.lodge_id=p_lodge_id and coalesce(s.settlement_date,s.business_date) between p_start_date and p_end_date);
    v_total := (select coalesce(sum(abs(coalesce(s.settled_amount,0))),0)
    from public.restaurant_settlement_reconciliations s
    where s.lodge_id=p_lodge_id and coalesce(s.settlement_date,s.business_date) between p_start_date and p_end_date);
  elsif p_source_type='cashup_variance' then
    v_rows := (select count(*)
    from public.pos_cashup_sessions c
    where c.lodge_id=p_lodge_id and c.date between p_start_date and p_end_date and coalesce(c.cash_over_short,0)<>0);
    v_total := (select coalesce(sum(abs(coalesce(c.cash_over_short,0))),0)
    from public.pos_cashup_sessions c
    where c.lodge_id=p_lodge_id and c.date between p_start_date and p_end_date and coalesce(c.cash_over_short,0)<>0);
  elsif p_source_type='payroll_accrual' then
    v_rows := (select count(*)
    from public.restaurant_pay_periods p
    where p.lodge_id=p_lodge_id and p.end_date between p_start_date and p_end_date and p.status in ('approved','paid','closed'));
    v_total := (select coalesce(sum(abs(coalesce((select sum(r.gross_pay) from public.restaurant_employee_pay_records r where r.pay_period_id=p.id and r.lodge_id=p_lodge_id),0))),0)
    from public.restaurant_pay_periods p
    where p.lodge_id=p_lodge_id and p.end_date between p_start_date and p_end_date and p.status in ('approved','paid','closed'));
  elsif p_source_type='payroll_settlement' then
    v_rows := (select count(*)
    from public.restaurant_pay_periods p
    where p.lodge_id=p_lodge_id and coalesce(p.paid_at::date,p.end_date) between p_start_date and p_end_date
      and p.settlement_status in ('settled','reconciled'));
    v_total := (select coalesce(sum(abs(coalesce((select sum(r.net_pay) from public.restaurant_employee_pay_records r where r.pay_period_id=p.id and r.lodge_id=p_lodge_id),0))),0)
    from public.restaurant_pay_periods p
    where p.lodge_id=p_lodge_id and coalesce(p.paid_at::date,p.end_date) between p_start_date and p_end_date
      and p.settlement_status in ('settled','reconciled'));
  elsif p_source_type='tax_adjustment' then
    v_rows := (select count(*)
    from public.restaurant_tax_adjustments a
    where a.lodge_id=p_lodge_id and a.business_date between p_start_date and p_end_date and a.status='approved');
    v_total := (select coalesce(sum(abs(coalesce(a.gross_amount,0))),0)
    from public.restaurant_tax_adjustments a
    where a.lodge_id=p_lodge_id and a.business_date between p_start_date and p_end_date and a.status='approved');
  elsif p_source_type='manual_journal' then
    v_rows := (select count(*)
    from public.restaurant_journal_entries e
    where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
      and coalesce(e.source_type,'') in ('manual','manual_journal'));
    v_total := (select coalesce(sum(abs(coalesce((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=e.id),0))),0)
    from public.restaurant_journal_entries e
    where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
      and coalesce(e.source_type,'') in ('manual','manual_journal'));
  end if;
  return jsonb_build_object('row_count',coalesce(v_rows,0),'total',round(coalesce(v_total,0),2));
end
$$;

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
      count(distinct s.source_id) filter(where s.status='posted') posted_rows,
      count(s.id) filter(where s.status='pending') pending_rows,
      count(s.id) filter(where s.status in ('exception','failed')) failed_rows,
      count(s.id) filter(where s.status='posted' and s.journal_entry_id is null) unsupported_rows,
      coalesce(sum((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=s.journal_entry_id)) filter(where s.status='posted' and s.journal_entry_id is not null),0) gl_total
    from public.restaurant_financial_source_registry r
    cross join lateral public.restaurant_financial_source_snapshot(p_lodge_id,r.source_type,p_start_date,p_end_date) snap
    left join public.restaurant_financial_source_postings s
      on s.lodge_id=p_lodge_id and s.source_type=any(r.posting_source_types)
     and s.business_date between p_start_date and p_end_date
    group by r.source_type,r.enabled_product,r.authoritative_mutation,r.required_subledger,r.required_gl_posting,
      r.expected_report,r.posting_contract,r.enabled,r.posting_source_types,snap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'source_type',source_type,'enabled_product',enabled_product,'authoritative_mutation',authoritative_mutation,
      'required_subledger',required_subledger,'required_gl_posting',required_gl_posting,'expected_report',expected_report,
      'posting_source_types',posting_source_types,'source_rows',expected_rows,'expected_rows',expected_rows,
      'posted_rows',posted_rows,'pending_rows',pending_rows,'failed_rows',failed_rows,
      'unsupported_rows',greatest(unsupported_rows+greatest(expected_rows-posted_rows,0),0),
      'subledger_total',round(coalesce(subledger_total,0),2),'gl_total',round(coalesce(gl_total,0),2),
      'difference',round(coalesce(subledger_total,0)-coalesce(gl_total,0),2),
      'status',case when not enabled then 'disabled' when posting_contract='unsupported' then 'unsupported'
        when expected_rows>posted_rows or pending_rows>0 or failed_rows>0 or unsupported_rows>0
          or round(coalesce(subledger_total,0)-coalesce(gl_total,0),2)<>0 then 'incomplete' else 'complete' end
    ) order by source_type),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('source_type',source_type,'reason',case
      when posting_contract='unsupported' then 'enabled source has no posting contract'
      when expected_rows>posted_rows then 'authoritative source rows are missing a posted subledger/GL record'
      when pending_rows>0 or failed_rows>0 then 'pending or failed source postings exist'
      when unsupported_rows>0 then 'posted source is missing journal evidence'
      when round(coalesce(subledger_total,0)-coalesce(gl_total,0),2)<>0 then 'subledger-to-GL control does not reconcile'
      else 'source coverage is incomplete' end) order by source_type)
      filter(where enabled and (posting_contract='unsupported' or expected_rows>posted_rows or pending_rows>0 or failed_rows>0 or unsupported_rows>0 or round(coalesce(subledger_total,0)-coalesce(gl_total,0),2)<>0)),'[]'::jsonb)
    into v_rows,v_missing from coverage;
  v_complete:=v_effective is not null and jsonb_array_length(v_missing)=0;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'status',case when v_complete then 'complete' else 'incomplete' end,'complete',v_complete,
    'accounting_active',v_active,'effective_from',v_effective,'source_coverage_complete',v_complete,
    'missing',v_missing,'rows',v_rows,
    'formula','accounting_active AND effective_from IS NOT NULL AND no missing sources AND no unsupported sources AND no pending/failed postings AND all subledger-to-GL controls reconcile'
  ));
end
$$;

-- Keep Accounting unavailable to authenticated callers until the database
-- behavioral, authorization, reconciliation and deployment evidence exists.
-- Generic POS/lodge operational report RPCs are deliberately excluded.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'get_restaurant_accounts','create_restaurant_account','update_restaurant_account','delete_restaurant_account',
      'seed_restaurant_default_accounts','set_restaurant_account_cash_flow_classification','post_restaurant_opening_balance',
      'get_restaurant_ledger_workspace_v2','get_restaurant_ledger_workspace_page_v2','get_restaurant_ledger_export_v2','get_restaurant_ledger_report_export_v2','get_restaurant_ledger_export_v3',
      'create_restaurant_journal_entry','create_restaurant_manual_journal_draft','submit_restaurant_manual_journal','approve_restaurant_manual_journal','post_restaurant_manual_journal','reverse_restaurant_journal_entry',
      'get_restaurant_pos_gl_mappings','set_restaurant_pos_gl_mapping','set_restaurant_pos_mapping_v2','set_restaurant_pos_gl_mapping_v2','post_pos_order_to_gl_v2',
      'get_restaurant_ap_workspace_v2','get_restaurant_ap_export_v2','get_restaurant_ap_export_v3','get_restaurant_supplier_statement_v2','set_restaurant_ap_gl_settings',
      'create_restaurant_bill_v3','submit_restaurant_bill','approve_restaurant_bill','record_restaurant_bill_payment_v2','create_restaurant_ap_credit_note_v2','submit_restaurant_ap_credit_note_v2','approve_restaurant_ap_credit_note_v2',
      'save_restaurant_bank_account_v2','get_restaurant_bank_workspace_v2','get_restaurant_bank_export_v2','get_restaurant_bank_export_v3','import_bank_statement_v2','import_bank_statement_v3','propose_bank_matches_v2','review_bank_match_v2','set_bank_transaction_exception','create_bank_reconciliation_v2','complete_bank_reconciliation_v2','get_restaurant_bank_reconciliation_packet_v2','match_restaurant_settlement_to_bank_transaction',
      'get_restaurant_tax_working_papers_v2','get_restaurant_tax_adjustments','get_restaurant_tax_export_v2','get_restaurant_tax_export_v3','set_restaurant_tax_configuration','generate_restaurant_tax_working_paper','create_restaurant_tax_amendment','generate_restaurant_tax_amendment_working_paper','record_restaurant_tax_adjustment','approve_restaurant_tax_adjustment','review_restaurant_tax_working_paper','approve_restaurant_tax_working_paper','record_restaurant_tax_filing','get_restaurant_tax_filing_packet_v2',
      'get_restaurant_budget_matrix_v2','get_restaurant_budget_export_v2','get_restaurant_budget_export_v3','save_restaurant_budget_matrix_v2','approve_restaurant_budget_version','create_restaurant_budget_template_v2','apply_restaurant_budget_template_v2',
      'get_restaurant_financial_statements_v2','get_restaurant_financial_statements_v3','get_restaurant_statements_export_v2','get_restaurant_statements_export_v3','get_restaurant_accounting_readiness','get_restaurant_financial_source_coverage_v2','get_restaurant_financial_source_coverage',
      'get_restaurant_payroll_workspace_v3','get_restaurant_payroll_export_v2','get_restaurant_payroll_export_v3','get_restaurant_payroll_records_v2','set_restaurant_payroll_employment_terms','set_restaurant_payroll_statutory_configuration_v3','create_restaurant_pay_period_v2','set_restaurant_payroll_time_input','approve_restaurant_payroll_time_input','calculate_restaurant_payroll_v3','approve_restaurant_payroll_v3','export_restaurant_payroll_payments_v4','set_restaurant_payroll_gl_settings','post_restaurant_payroll_to_gl_v2','settle_restaurant_payroll_v3','reconcile_restaurant_payroll_settlement_v3','close_restaurant_payroll_v3','get_restaurant_payroll_readiness_v2','set_restaurant_payroll_attendance_disposition_v3','get_restaurant_payroll_attendance_reconciliation_v3',
      'prepare_restaurant_historical_cutover','approve_restaurant_historical_cutover','apply_restaurant_historical_cutover','activate_restaurant_accounting','suspend_restaurant_accounting','prepare_restaurant_period_close','approve_restaurant_period_close','reopen_restaurant_period_close','get_restaurant_period_close',
      'start_restaurant_report_run','complete_restaurant_report_run','fail_restaurant_report_run','_restaurant_complete_accounting_export','get_accounting_report_export_v3','record_report_artifact_result','record_accounting_export_artifact_v3'
    ])
  loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end
$$;

revoke all on function public.restaurant_financial_source_snapshot(uuid,text,date,date),public.get_restaurant_financial_source_coverage_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.restaurant_financial_source_snapshot(uuid,text,date,date),public.get_restaurant_financial_source_coverage_v2(uuid,date,date) to service_role;

commit;
