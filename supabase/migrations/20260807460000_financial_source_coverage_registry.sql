-- Financial truth gate 5/9: every enabled financial source has an explicit
-- source-coverage row. Missing contracts are blocking, never silently absent.

begin;

alter table public.restaurant_financial_source_postings
  add column if not exists source_amount numeric(18,2),
  add column if not exists subledger_status text not null default 'unknown',
  add column if not exists gl_status text not null default 'unknown';

create table if not exists public.restaurant_financial_source_registry (
  source_type text primary key,
  enabled_product text not null,
  authoritative_mutation text not null,
  required_subledger text not null,
  required_gl_posting text not null,
  expected_report text not null,
  applicable_from date,
  posting_contract text not null default 'unsupported',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.restaurant_financial_source_registry enable row level security;
revoke all on table public.restaurant_financial_source_registry from public,anon,authenticated;
grant select on table public.restaurant_financial_source_registry to service_role;

insert into public.restaurant_financial_source_registry(source_type,enabled_product,authoritative_mutation,required_subledger,required_gl_posting,expected_report,posting_contract)
values
 ('pos_sale','bar_pos','create_pos_order_v3','pos_tender,inventory','revenue,tax,tips,cogs','pos_transaction_detail','implemented'),
 ('pos_return','bar_pos','create_pos_return_v3','tender,inventory,cogs','reverse_revenue,tax,tips,cogs','pos_transaction_detail','implemented'),
 ('pos_void','bar_pos','approve_pos_void_with_pin','tender,inventory,cogs','reverse_revenue,tax,tips,cogs','pos_transaction_detail','implemented'),
 ('voucher_issue','growth','create_restaurant_voucher','voucher_liability','voucher_liability','voucher_register','unsupported'),
 ('voucher_redemption','growth','create_pos_order_v3','voucher_liability','voucher_liability,revenue','pos_transaction_detail','implemented'),
 ('voucher_return','growth','create_pos_return_v3','voucher_liability','voucher_liability,revenue','pos_transaction_detail','implemented'),
 ('voucher_expiry','growth','expire_restaurant_voucher','voucher_liability','voucher_liability','voucher_register','unsupported'),
 ('customer_account_charge','growth','create_pos_order_v3','customer_ar','ar,revenue','customer_account_statement','implemented'),
 ('customer_account_payment','growth','record_customer_account_payment','customer_ar','ar,cash','customer_account_statement','unsupported'),
 ('customer_account_refund','growth','refund_customer_account','customer_ar','ar,cash','customer_account_statement','unsupported'),
 ('booking_invoice','base_lodge','create_booking_invoice','folio','revenue,ar','invoice_register','unsupported'),
 ('booking_folio_charge','base_lodge','create_booking_folio_charge','folio','revenue,ar','invoice_register','unsupported'),
 ('booking_payment','base_lodge','record_booking_payment','payment','cash,ar','payment_register','unsupported'),
 ('booking_refund','base_lodge','refund_booking_payment','payment','cash,ar','refund_register','unsupported'),
 ('customer_credit_receipt','growth','record_customer_credit_receipt','credit','cash,credit','customer_credit_statement','unsupported'),
 ('customer_credit_allocation','growth','allocate_customer_credit','credit','credit,ar','customer_credit_statement','unsupported'),
 ('customer_credit_refund','growth','refund_customer_credit','credit','credit,cash','customer_credit_statement','unsupported'),
 ('conference_event_revenue','base_lodge','create_conference_booking','event_folio','revenue,ar','event_register','unsupported'),
 ('day_use_revenue','base_lodge','create_day_use_entry','day_use','revenue,cash','day_use_register','unsupported'),
 ('direct_expense','accounting','post_expense','expense','expense,cash_or_ap','expense_register','implemented'),
 ('ap_bill','accounting','submit_restaurant_bill','ap','expense,ap','ap_detail','implemented'),
 ('ap_payment','accounting','record_restaurant_bill_payment_v2','ap','ap,cash','ap_detail','implemented'),
 ('ap_credit_note','accounting','approve_restaurant_ap_credit_note_v2','ap','expense,ap,tax','ap_detail','implemented'),
 ('maintenance_cost','base_lodge','post_maintenance_cost','maintenance','expense,ap','maintenance_register','unsupported'),
 ('supplies_purchase','base_lodge','record_supplies_purchase','inventory_or_expense','inventory,ap','stock_register','unsupported'),
 ('inventory_receipt','bar_pos','post_inventory_purchase','inventory','inventory,ap','stock_register','implemented'),
 ('inventory_count','bar_pos','post_inventory_stocktake_session','inventory','inventory,cogs','stock_register','implemented'),
 ('inventory_depletion','bar_pos','create_pos_order_v3','inventory','cogs,inventory','pos_transaction_detail','implemented'),
 ('inventory_writeoff','bar_pos','record_inventory_writeoff','inventory','cogs,inventory','stock_register','unsupported'),
 ('settlement_and_fees','accounting','record_restaurant_settlement','settlement','clearing,bank,fees','settlement_register','implemented'),
 ('cashup_variance','bar_pos','finalize_pos_shift_cashup_v2','cashup','cash_variance','cashup_register','implemented'),
 ('payroll_accrual','accounting','post_restaurant_payroll_to_gl_v2','payroll','payroll_liabilities','payroll_register','implemented'),
 ('payroll_settlement','accounting','settle_restaurant_payroll_v3','payroll','payroll_liabilities,bank','payroll_register','implemented'),
 ('tax_adjustment','accounting','approve_restaurant_tax_adjustment','tax','tax_control','tax_working_paper','implemented'),
 ('manual_journal','accounting','create_restaurant_journal_entry','general_ledger','general_ledger','general_ledger','implemented')
on conflict(source_type) do update set enabled_product=excluded.enabled_product,authoritative_mutation=excluded.authoritative_mutation,required_subledger=excluded.required_subledger,required_gl_posting=excluded.required_gl_posting,expected_report=excluded.expected_report,posting_contract=excluded.posting_contract;

create or replace function public.get_restaurant_financial_source_coverage_v2(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_active boolean:=public.restaurant_accounting_is_active(p_lodge_id);
  v_effective date;
  v_rows jsonb;
  v_missing jsonb;
  v_complete boolean;
begin
  select effective_from into v_effective from public.restaurant_accounting_activation where lodge_id=p_lodge_id and status='active';
  if not v_active then return jsonb_build_object('success',true,'data',jsonb_build_object('status','not_active','complete',false,'source_coverage_complete',false,'rows','[]'::jsonb)); end if;
  with coverage as (
    select r.source_type,r.enabled_product,r.authoritative_mutation,r.required_subledger,r.required_gl_posting,r.expected_report,r.posting_contract,r.enabled,
      count(s.id) filter(where s.business_date between p_start_date and p_end_date) source_rows,
      count(s.id) filter(where s.business_date between p_start_date and p_end_date and s.status='posted') posted_rows,
      count(s.id) filter(where s.business_date between p_start_date and p_end_date and s.status='pending') pending_rows,
      count(s.id) filter(where s.business_date between p_start_date and p_end_date and s.status='exception') failed_rows,
      count(s.id) filter(where s.business_date between p_start_date and p_end_date and s.journal_entry_id is null) unsupported_rows,
      coalesce(sum(s.source_amount) filter(where s.business_date between p_start_date and p_end_date and s.subledger_status='posted'),0) subledger_total,
      coalesce(sum((select sum(l.debit) from public.restaurant_journal_lines l where l.entry_id=s.journal_entry_id)) filter(where s.business_date between p_start_date and p_end_date and s.gl_status='posted'),0) gl_total
    from public.restaurant_financial_source_registry r left join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type=r.source_type
    group by r.source_type,r.enabled_product,r.authoritative_mutation,r.required_subledger,r.required_gl_posting,r.expected_report,r.posting_contract,r.enabled
  )
  select coalesce(jsonb_agg(jsonb_build_object('source_type',source_type,'enabled_product',enabled_product,'authoritative_mutation',authoritative_mutation,'required_subledger',required_subledger,'required_gl_posting',required_gl_posting,'expected_report',expected_report,'source_rows',source_rows,'posted_rows',posted_rows,'pending_rows',pending_rows,'failed_rows',failed_rows,'unsupported_rows',unsupported_rows,'subledger_total',round(subledger_total,2),'gl_total',round(gl_total,2),'difference',round(subledger_total-gl_total,2),'status',case when not enabled then 'disabled' when posting_contract='unsupported' then 'unsupported' when pending_rows>0 or failed_rows>0 or unsupported_rows>0 or round(subledger_total-gl_total,2)<>0 then 'incomplete' else 'complete' end) order by source_type),'[]'::jsonb),coalesce(jsonb_agg(jsonb_build_object('source_type',source_type,'reason',case when posting_contract='unsupported' then 'enabled source has no posting contract' else 'source or subledger-to-GL evidence is incomplete' end) order by source_type) filter(where enabled and (posting_contract='unsupported' or pending_rows>0 or failed_rows>0 or unsupported_rows>0 or round(subledger_total-gl_total,2)<>0)),'[]'::jsonb)
    into v_rows,v_missing from coverage;
  v_complete:=v_effective is not null and jsonb_array_length(v_missing)=0;
  return jsonb_build_object('success',true,'data',jsonb_build_object('status',case when v_complete then 'complete' else 'incomplete' end,'complete',v_complete,'accounting_active',v_active,'effective_from',v_effective,'source_coverage_complete',v_complete,'missing',v_missing,'rows',v_rows,'formula','accounting_active AND effective_from IS NOT NULL AND no missing sources AND no unsupported sources AND no pending/failed postings AND all subledger-to-GL controls reconcile'));
end
$$;

revoke all on function public.get_restaurant_financial_source_coverage_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.get_restaurant_financial_source_coverage_v2(uuid,date,date) to service_role;

commit;
