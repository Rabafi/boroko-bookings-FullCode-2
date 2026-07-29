-- Read-only workspace projections for rebuilt Restaurant Accounting. No operator grants restored.

begin;

create or replace function public.get_restaurant_ledger_workspace_v2(p_lodge_id uuid,p_start_date date default null,p_end_date date default null,p_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 if p_account_id is not null and not exists(select 1 from public.restaurant_accounts where id=p_account_id and lodge_id=p_lodge_id)then raise exception 'Ledger account belongs to another lodge or is missing' using errcode='23503';end if;
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'entries',coalesce((select jsonb_agg(x order by x.entry_date desc,x.created_at desc)from(
   select e.id,e.entry_date,e.description,e.source_type,e.source_id,e.reference_number,e.posting_key,e.reversal_of,e.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'account_id',l.account_id,'account_code',a.code,'account_name',a.name,'debit',l.debit,'credit',l.credit,'memo',l.memo)order by l.id)from public.restaurant_journal_lines l join public.restaurant_accounts a on a.id=l.account_id where l.entry_id=e.id),'[]'::jsonb)lines
   from public.restaurant_journal_entries e where e.lodge_id=p_lodge_id and e.is_posted and(p_start_date is null or e.entry_date>=p_start_date)and(p_end_date is null or e.entry_date<=p_end_date)and(p_account_id is null or exists(select 1 from public.restaurant_journal_lines l where l.entry_id=e.id and l.account_id=p_account_id))limit 500
  )x),'[]'::jsonb),
  'trial_balance',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'debit',coalesce(t.debit,0),'credit',coalesce(t.credit,0),'balance',case when a.account_type in('asset','expense')then coalesce(t.debit,0)-coalesce(t.credit,0)else coalesce(t.credit,0)-coalesce(t.debit,0)end)order by a.code)
   from public.restaurant_accounts a left join lateral(select round(sum(l.debit),2)debit,round(sum(l.credit),2)credit from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.id and e.lodge_id=p_lodge_id and e.is_posted and(p_end_date is null or e.entry_date<=p_end_date))t on true where a.lodge_id=p_lodge_id and(coalesce(t.debit,0)<>0 or coalesce(t.credit,0)<>0 or a.is_active)),'[]'::jsonb)
 ));
end $$;

create or replace function public.get_restaurant_ap_workspace_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'bills',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)order by i.id)from public.restaurant_bill_items i where i.bill_id=b.id and i.lodge_id=p_lodge_id),'[]'::jsonb),'payments',coalesce((select jsonb_agg(to_jsonb(p)order by p.payment_date,p.created_at)from public.restaurant_bill_payments p where p.bill_id=b.id and p.lodge_id=p_lodge_id),'[]'::jsonb))order by b.bill_date desc,b.created_at desc)from public.restaurant_bills b where b.lodge_id=p_lodge_id),'[]'::jsonb),
  'summary',coalesce((select jsonb_build_object('total_outstanding',round(sum(greatest(total-amount_paid,0)),2),'overdue_outstanding',round(sum(case when due_date<current_date and status not in('paid','cancelled')then greatest(total-amount_paid,0)else 0 end),2),'open_bills',count(*)filter(where status not in('paid','cancelled')))from public.restaurant_bills where lodge_id=p_lodge_id),'{}'::jsonb)
 ));
end $$;

create or replace function public.get_restaurant_bank_workspace_v2(p_lodge_id uuid,p_bank_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 if p_bank_account_id is not null and not exists(select 1 from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id)then raise exception 'Bank account belongs to another lodge or is missing' using errcode='23503';end if;
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'accounts',coalesce((select jsonb_agg(to_jsonb(a)order by a.name)from public.restaurant_bank_accounts a where a.lodge_id=p_lodge_id),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('proposal',coalesce((select to_jsonb(p)from public.restaurant_bank_match_proposals p where p.bank_transaction_id=t.id order by p.created_at desc limit 1),'null'::jsonb))order by t.transaction_date desc,t.imported_at desc)from public.restaurant_bank_transactions t where t.lodge_id=p_lodge_id and(p_bank_account_id is null or t.bank_account_id=p_bank_account_id)),'[]'::jsonb),
  'reconciliations',coalesce((select jsonb_agg(to_jsonb(r)order by r.reconciliation_date desc,r.created_at desc)from public.restaurant_bank_reconciliations r where r.lodge_id=p_lodge_id and(p_bank_account_id is null or r.bank_account_id=p_bank_account_id)),'[]'::jsonb)
 ));
end $$;

create or replace function public.get_restaurant_tax_working_papers_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'configurations',coalesce((select jsonb_agg(to_jsonb(c)order by c.effective_from desc)from public.restaurant_tax_configurations c where c.lodge_id=p_lodge_id),'[]'::jsonb),
  'working_papers',coalesce((select jsonb_agg(to_jsonb(r)order by r.period_end desc,r.created_at desc)from public.restaurant_tax_returns r where r.lodge_id=p_lodge_id),'[]'::jsonb)
 ));
end $$;

create or replace function public.get_restaurant_payroll_workspace_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.payroll_view');
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'periods',coalesce((select jsonb_agg(to_jsonb(p)order by p.end_date desc,p.created_at desc)from public.restaurant_pay_periods p where p.lodge_id=p_lodge_id),'[]'::jsonb),
  'configurations',coalesce((select jsonb_agg(to_jsonb(c)order by c.effective_from desc)from public.restaurant_payroll_statutory_configurations c where c.lodge_id=p_lodge_id),'[]'::jsonb),
  'terms',coalesce((select jsonb_agg(to_jsonb(e)-'bank_account_number'-'bank_branch_code'||jsonb_build_object('has_bank_details',nullif(e.bank_account_number,'')is not null)order by e.staff_user_id,e.effective_from desc)from public.restaurant_payroll_employment_terms e where e.lodge_id=p_lodge_id),'[]'::jsonb),
  'time_inputs',coalesce((select jsonb_agg(to_jsonb(t)order by t.entered_at desc)from public.restaurant_payroll_time_inputs t where t.lodge_id=p_lodge_id),'[]'::jsonb),
  'gl_settings',coalesce((select to_jsonb(g)from public.restaurant_payroll_gl_settings g where g.lodge_id=p_lodge_id),'null'::jsonb)
 ));
end $$;

do $$declare r record;begin
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('get_restaurant_ledger_workspace_v2','get_restaurant_ap_workspace_v2','get_restaurant_bank_workspace_v2','get_restaurant_tax_working_papers_v2','get_restaurant_payroll_workspace_v2')
 loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);execute format('grant execute on function %s to service_role',r.sig);end loop;
end $$;

commit;

