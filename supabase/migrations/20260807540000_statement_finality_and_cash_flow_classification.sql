-- Financial truth gate 4/9: statement finality is derived from explicit
-- source coverage, cash-flow classification, balance equality, and period close.
-- Missing controls never default to true.

begin;

create or replace function public.get_restaurant_financial_statements_v2(
  p_lodge_id uuid,p_start_date date,p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_accounts jsonb;
  v_revenue numeric:=0;
  v_expense numeric:=0;
  v_assets numeric:=0;
  v_liabilities numeric:=0;
  v_equity numeric:=0;
  v_diff numeric:=0;
  v_active boolean:=false;
  v_unresolved bigint:=0;
  v_open_exceptions bigint:=0;
  v_cash_flow jsonb:='{}'::jsonb;
  v_cash_flow_complete boolean:=false;
  v_coverage jsonb:='{}'::jsonb;
  v_source_complete boolean:=false;
  v_close_status text:='open';
  v_period_status text;
  v_final boolean:=false;
  v_blocking jsonb:='[]'::jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then
    raise exception 'Statement dates are invalid' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,
      'is_active',a.is_active,'opening_balance',0,
      'historical_balance',round(case when a.account_type in('asset','expense')
        then coalesce(x.debit,0)-coalesce(x.credit,0)
        else coalesce(x.credit,0)-coalesce(x.debit,0) end,2)
    ) order by a.code),'[]'::jsonb),
    count(*) filter(where round(a.opening_balance,2)<>0 and d.id is null)
    into v_accounts,v_unresolved
    from public.restaurant_accounts a
    left join public.restaurant_opening_balance_dispositions d
      on d.account_id=a.id and d.lodge_id=p_lodge_id
    left join lateral(
      select sum(l.debit) debit,sum(l.credit) credit
      from public.restaurant_journal_lines l
      join public.restaurant_journal_entries e
        on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date
      where l.account_id=a.id
    ) x on true
   where a.lodge_id=p_lodge_id;

  select coalesce(sum(l.credit-l.debit),0) into v_revenue
    from public.restaurant_journal_lines l
    join public.restaurant_journal_entries e on e.id=l.entry_id
   where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
     and exists(select 1 from public.restaurant_accounts a where a.id=l.account_id and a.account_type='revenue');

  select coalesce(sum(l.debit-l.credit),0) into v_expense
    from public.restaurant_journal_lines l
    join public.restaurant_journal_entries e on e.id=l.entry_id
   where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
     and exists(select 1 from public.restaurant_accounts a where a.id=l.account_id and a.account_type='expense');

  select coalesce(sum(l.debit-l.credit),0) into v_assets
    from public.restaurant_journal_lines l
    join public.restaurant_journal_entries e on e.id=l.entry_id
    join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id
   where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date and a.account_type='asset';

  select coalesce(sum(l.credit-l.debit),0) into v_liabilities
    from public.restaurant_journal_lines l
    join public.restaurant_journal_entries e on e.id=l.entry_id
    join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id
   where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date and a.account_type='liability';

  select coalesce(sum(l.credit-l.debit),0) into v_equity
    from public.restaurant_journal_lines l
    join public.restaurant_journal_entries e on e.id=l.entry_id
    join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id
   where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date and a.account_type='equity';

  v_equity:=v_equity+v_revenue-v_expense;
  v_diff:=round(v_assets-(v_liabilities+v_equity),2);
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);

  with journal_cash as(
    select e.id,
      sum(case when a.cash_flow_classification='cash' then l.debit-l.credit else 0 end) cash_movement,
      array_agg(distinct a.cash_flow_classification)
        filter(where a.cash_flow_classification<>'cash' and (l.debit<>0 or l.credit<>0)) classes
    from public.restaurant_journal_entries e
    join public.restaurant_journal_lines l on l.entry_id=e.id
    join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id
    where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date
    group by e.id
  ), classified as(
    select case when cardinality(classes)=1 and classes[1] in('operating','investing','financing')
      then classes[1] else 'unclassified' end classification,cash_movement
    from journal_cash where cash_movement<>0
  )
  select coalesce(jsonb_object_agg(classification,amount),'{}'::jsonb)
    into v_cash_flow
    from(select classification,round(sum(cash_movement),2) amount from classified group by classification) q;
  v_cash_flow_complete := (v_cash_flow ? 'operating' or v_cash_flow ? 'investing' or v_cash_flow ? 'financing')
    and not (v_cash_flow ? 'unclassified');

  select public.get_restaurant_financial_source_coverage_v2(p_lodge_id,p_start_date,p_end_date)
    into v_coverage;
  v_source_complete:=coalesce((v_coverage->'data'->>'complete')::boolean,false);

  select coalesce(c.status,'open') into v_close_status
    from public.restaurant_accounting_period_closes c
   where c.lodge_id=p_lodge_id and c.period_start=p_start_date and c.period_end=p_end_date;
  select count(*) into v_open_exceptions
    from public.restaurant_reconciliation_exceptions e
   where e.lodge_id=p_lodge_id and e.status in('open','investigating') and e.severity='blocking';

  if v_unresolved>0 then v_blocking:=v_blocking||jsonb_build_array('unresolved_scalar_opening_balances'); end if;
  if not v_active then v_blocking:=v_blocking||jsonb_build_array('accounting_not_active'); end if;
  if not v_source_complete then v_blocking:=v_blocking||jsonb_build_array('source_coverage_incomplete'); end if;
  if v_diff<>0 then v_blocking:=v_blocking||jsonb_build_array('balance_sheet_difference'); end if;
  if not v_cash_flow_complete then v_blocking:=v_blocking||jsonb_build_array('cash_flow_unclassified_or_missing'); end if;
  if v_open_exceptions>0 then v_blocking:=v_blocking||jsonb_build_array('blocking_reconciliation_exceptions'); end if;
  if v_close_status<>'closed' then v_blocking:=v_blocking||jsonb_build_array('period_not_closed'); end if;

  v_period_status:=case when not v_active then 'not_active'
    when v_close_status='closed' then 'closed'
    else 'draft_uncLOSED' end;
  v_final:=v_active and v_source_complete and v_diff=0 and v_cash_flow_complete
    and v_close_status='closed' and v_open_exceptions=0 and v_unresolved=0;

  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'schema_version','financial-statements-v4','period_start',p_start_date,'period_end',p_end_date,
    'accounts',v_accounts,
    'income_statement',jsonb_build_object('revenue',round(v_revenue,2),'expenses',round(v_expense,2),'net_income',round(v_revenue-v_expense,2)),
    'balance_sheet',jsonb_build_object('assets',round(v_assets,2),'liabilities_and_equity',round(v_equity,2),'difference',v_diff),
    'cash_flow',v_cash_flow||jsonb_build_object(
      'operating',coalesce((v_cash_flow->>'operating')::numeric,0),
      'investing',coalesce((v_cash_flow->>'investing')::numeric,0),
      'financing',coalesce((v_cash_flow->>'financing')::numeric,0),
      'unclassified',coalesce((v_cash_flow->>'unclassified')::numeric,0),
      'net_change',coalesce((v_cash_flow->>'operating')::numeric,0)+coalesce((v_cash_flow->>'investing')::numeric,0)+coalesce((v_cash_flow->>'financing')::numeric,0)+coalesce((v_cash_flow->>'unclassified')::numeric,0),
      'complete',v_cash_flow_complete
    ),
    'dataset_complete',v_unresolved=0 and v_source_complete and v_diff=0,
    'source_coverage_complete',v_source_complete,
    'balanced',v_diff=0,
    'cash_flow_complete',v_cash_flow_complete,
    'period_status',v_period_status,
    'financially_final',v_final,
    'blocking_exceptions',v_blocking,
    'source_coverage',v_coverage->'data'
  ));
end
$$;

create or replace function public.get_restaurant_financial_statements_v3(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.get_restaurant_financial_statements_v2(p_lodge_id,p_start_date,p_end_date);
end
$$;

revoke all on function public.get_restaurant_financial_statements_v2(uuid,date,date),public.get_restaurant_financial_statements_v3(uuid,date,date) from public,anon,authenticated;
grant execute on function public.get_restaurant_financial_statements_v2(uuid,date,date),public.get_restaurant_financial_statements_v3(uuid,date,date) to service_role;

commit;
