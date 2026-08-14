-- Financial truth gate 2/9: historical accounts remain reportable and the
-- deprecated scalar opening_balance cannot silently affect statements.

begin;

create table if not exists public.restaurant_opening_balance_dispositions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  scalar_before numeric(18,2) not null,
  disposition text not null check (disposition in ('posted_once','equivalent_journal')),
  journal_entry_id uuid not null references public.restaurant_journal_entries(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb,
  resolved_by uuid references public.users(id),
  resolved_at timestamptz not null default now(),
  unique(lodge_id, account_id)
);
alter table public.restaurant_opening_balance_dispositions enable row level security;
revoke all on table public.restaurant_opening_balance_dispositions from public, anon, authenticated;
grant select, insert, update on public.restaurant_opening_balance_dispositions to service_role;

create or replace function public.get_restaurant_opening_balance_audit(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_rows jsonb; v_unresolved bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id',a.id,'code',a.code,'name',a.name,'scalar_opening_balance',round(a.opening_balance,2),
    'equivalent_journal_id',(select e.id from public.restaurant_journal_entries e where e.lodge_id=p_lodge_id and e.source_type='opening_balance' and e.source_id=a.id and e.is_posted order by e.entry_date,e.created_at limit 1),
    'disposition',d.disposition,'resolved',round(a.opening_balance,2)=0 or d.id is not null
  ) order by a.code),'[]'::jsonb), count(*) filter(where round(a.opening_balance,2)<>0 and d.id is null)
    into v_rows,v_unresolved
    from public.restaurant_accounts a
    left join public.restaurant_opening_balance_dispositions d on d.account_id=a.id and d.lodge_id=p_lodge_id
   where a.lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('policy','dated_double_entry_journal_only','scalar_ignored_by_statements',true,'unresolved_count',v_unresolved,'complete',v_unresolved=0,'rows',v_rows));
end
$$;

create or replace function public.resolve_restaurant_legacy_opening_balance(
  p_lodge_id uuid, p_account_id uuid, p_equity_account_id uuid, p_entry_date date,
  p_disposition text, p_evidence jsonb default '{}'::jsonb, p_operation_key text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_account public.restaurant_accounts%rowtype; v_journal uuid; v_before numeric;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  select * into v_account from public.restaurant_accounts where id=p_account_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Opening-balance account was not found' using errcode='P0002'; end if;
  v_before:=round(v_account.opening_balance,2);
  if v_before=0 then return jsonb_build_object('success',true,'data',jsonb_build_object('account_id',p_account_id,'resolved',true,'replayed',true)); end if;
  if p_disposition not in ('posted_once','equivalent_journal') then raise exception 'Opening-balance disposition is required' using errcode='22023'; end if;
  if p_disposition='posted_once' then
    if p_equity_account_id is null or p_entry_date is null then raise exception 'Posted-once disposition requires equity account and date' using errcode='22023'; end if;
    v_journal:=(public.post_restaurant_opening_balance(p_lodge_id,p_account_id,p_equity_account_id,p_entry_date,v_before,coalesce(p_operation_key,'legacy-opening:'||p_account_id::text))->'data'->>'entry_id')::uuid;
  else
    v_journal:=nullif((p_evidence->>'journal_entry_id'),'')::uuid;
    if v_journal is null or not exists(select 1 from public.restaurant_journal_entries e where e.id=v_journal and e.lodge_id=p_lodge_id and e.source_type='opening_balance' and e.is_posted and exists(select 1 from public.restaurant_journal_lines l where l.entry_id=e.id and l.account_id=p_account_id)) then
      raise exception 'Equivalent posted opening journal evidence is required' using errcode='55000';
    end if;
  end if;
  insert into public.restaurant_opening_balance_dispositions(lodge_id,account_id,scalar_before,disposition,journal_entry_id,evidence,resolved_by)
  values(p_lodge_id,p_account_id,v_before,p_disposition,v_journal,coalesce(p_evidence,'{}'::jsonb),v_actor)
  on conflict(lodge_id,account_id) do update set scalar_before=excluded.scalar_before,disposition=excluded.disposition,journal_entry_id=excluded.journal_entry_id,evidence=excluded.evidence,resolved_by=excluded.resolved_by,resolved_at=now();
  update public.restaurant_accounts set opening_balance=0,updated_at=now() where id=p_account_id and lodge_id=p_lodge_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'opening_balance.scalar_resolved','restaurant_accounts',p_account_id,jsonb_build_object('opening_balance',v_before),jsonb_build_object('opening_balance',0,'journal_entry_id',v_journal,'disposition',p_disposition,'evidence',p_evidence),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('account_id',p_account_id,'journal_entry_id',v_journal,'scalar_before',v_before,'scalar_after',0,'disposition',p_disposition,'replayed',false));
end
$$;

create or replace function public._restaurant_guard_account_deactivation(p_id uuid,p_lodge_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.restaurant_pos_gl_mappings m where m.lodge_id=p_lodge_id and m.account_id=p_id and (m.effective_to is null or m.effective_to>=current_date)) then raise exception 'Mapped accounts cannot be deactivated while a mapping is active' using errcode='55000'; end if;
  if exists(select 1 from public.restaurant_bank_accounts b where b.lodge_id=p_lodge_id and b.account_id=p_id and b.is_active) then raise exception 'Bank control accounts cannot be deactivated' using errcode='55000'; end if;
  if exists(select 1 from public.restaurant_ap_gl_settings s where s.lodge_id=p_lodge_id and p_id in(s.payable_account_id,s.input_tax_account_id)) then raise exception 'AP control accounts cannot be deactivated' using errcode='55000'; end if;
  if exists(select 1 from public.restaurant_payroll_gl_settings s where s.lodge_id=p_lodge_id and p_id in(s.payroll_expense_account_id,s.net_payable_account_id,s.tax_payable_account_id,s.deductions_payable_account_id)) then raise exception 'Payroll control accounts cannot be deactivated' using errcode='55000'; end if;
end
$$;

create or replace function public.update_restaurant_account(p_id uuid,p_lodge_id uuid,p_name text default null,p_description text default null,p_is_active boolean default null,p_opening_balance numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_before public.restaurant_accounts%rowtype; v_after public.restaurant_accounts%rowtype;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_opening_balance is not null then raise exception 'Opening balances are dated journal evidence, not a scalar account field' using errcode='22023'; end if;
  select * into v_before from public.restaurant_accounts where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Account not found' using errcode='P0002'; end if;
  if p_is_active=false and v_before.is_active then perform public._restaurant_guard_account_deactivation(p_id,p_lodge_id); end if;
  update public.restaurant_accounts set name=coalesce(nullif(btrim(p_name),''),name),description=case when p_description is null then description else nullif(btrim(p_description),'') end,is_active=coalesce(p_is_active,is_active),updated_at=now() where id=p_id returning * into v_after;
  perform public.log_restaurant_financial_action(p_lodge_id,'account_updated','account',p_id,to_jsonb(v_before),to_jsonb(v_after),jsonb_build_object('actor_id',v_actor));
  return jsonb_build_object('success',true,'data',to_jsonb(v_after));
end
$$;

create or replace function public.delete_restaurant_account(p_id uuid,p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.update_restaurant_account(p_id,p_lodge_id,null,null,false,null);
end
$$;

create or replace function public.get_restaurant_financial_statements_v2(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_accounts jsonb; v_revenue numeric; v_expense numeric; v_assets numeric; v_liabilities numeric; v_equity numeric; v_diff numeric; v_active boolean; v_unresolved bigint;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Statement dates are invalid' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'is_active',a.is_active,'opening_balance',0,'historical_balance',round(case when a.account_type in('asset','expense') then coalesce(x.debit,0)-coalesce(x.credit,0) else coalesce(x.credit,0)-coalesce(x.debit,0) end,2)) order by a.code),'[]'::jsonb),count(*) filter(where a.opening_balance<>0 and d.id is null)
    into v_accounts,v_unresolved
    from public.restaurant_accounts a
    left join public.restaurant_opening_balance_dispositions d on d.account_id=a.id and d.lodge_id=p_lodge_id
    left join lateral(select sum(l.debit) debit,sum(l.credit) credit from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date where l.account_id=a.id)x on true
   where a.lodge_id=p_lodge_id;
  select coalesce(sum(l.credit-l.debit),0) into v_revenue from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date and exists(select 1 from public.restaurant_accounts a where a.id=l.account_id and a.account_type='revenue');
  select coalesce(sum(l.debit-l.credit),0) into v_expense from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date and exists(select 1 from public.restaurant_accounts a where a.id=l.account_id and a.account_type='expense');
  select coalesce(sum(l.debit-l.credit),0) into v_assets from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where a.account_type='asset';
  select coalesce(sum(l.credit-l.debit),0) into v_liabilities from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where a.account_type='liability';
  select coalesce(sum(l.credit-l.debit),0) into v_equity from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where a.account_type='equity';
  v_equity:=v_equity+v_revenue-v_expense;
  v_diff:=round(v_assets-(v_liabilities+v_equity),2);
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);
  return jsonb_build_object('success',true,'data',jsonb_build_object('schema_version','financial-statements-v3','period_start',p_start_date,'period_end',p_end_date,'accounts',v_accounts,'income_statement',jsonb_build_object('revenue',round(v_revenue,2),'expenses',round(v_expense,2),'net_income',round(v_revenue-v_expense,2)),'balance_sheet',jsonb_build_object('assets',round(v_assets,2),'liabilities_and_equity',round(v_equity,2),'difference',v_diff),'cash_flow',jsonb_build_object('classified',false,'status','incomplete'),'dataset_complete',v_unresolved=0,'source_coverage_complete',false,'balanced',v_diff=0,'cash_flow_complete',false,'period_status',case when v_active then 'open' else 'not_active' end,'financially_final',false,'blocking_exceptions',jsonb_build_array(case when v_unresolved>0 then 'unresolved_scalar_opening_balances' else null end,case when not v_active then 'accounting_not_active' else null end,case when v_diff<>0 then 'balance_sheet_difference' else null end)));
end
$$;

create or replace function public.get_restaurant_financial_statements_v3(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.get_restaurant_financial_statements_v2(p_lodge_id,p_start_date,p_end_date);
end
$$;

create or replace function public.get_restaurant_accounting_readiness(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_activation record; v_missing jsonb:='[]'::jsonb; v_unposted integer:=0; v_open_exceptions integer:=0; v_unresolved bigint:=0; v_active boolean:=false;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select * into v_activation from public.restaurant_accounting_activation where lodge_id=p_lodge_id;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='asset' and is_active) then v_missing:=v_missing||jsonb_build_array('active asset account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='revenue' and is_active) then v_missing:=v_missing||jsonb_build_array('active revenue account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='expense' and is_active) then v_missing:=v_missing||jsonb_build_array('active expense account'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='cash' and a.account_type='asset') then v_missing:=v_missing||jsonb_build_array('cash tender mapping'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active where m.lodge_id=p_lodge_id and m.mapping_type='category' and a.account_type='revenue') then v_missing:=v_missing||jsonb_build_array('POS category revenue mapping'); end if;
  select count(*) into v_unposted from public.expenses e where e.lodge_id=p_lodge_id and e.status in ('unposted','exception');
  select count(*) into v_open_exceptions from public.restaurant_reconciliation_exceptions e where e.lodge_id=p_lodge_id and e.status in ('open','investigating') and e.severity='blocking';
  select count(*) into v_unresolved from public.restaurant_accounts a where a.lodge_id=p_lodge_id and round(a.opening_balance,2)<>0 and not exists(select 1 from public.restaurant_opening_balance_dispositions d where d.lodge_id=p_lodge_id and d.account_id=a.id);
  if v_unresolved>0 then v_missing:=v_missing||jsonb_build_array('resolved legacy scalar opening balances'); end if;
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);
  return jsonb_build_object('success',true,'data',jsonb_build_object('active',v_active,'status',coalesce(v_activation.status,'draft'),'effective_from',v_activation.effective_from,'policy_version',coalesce(v_activation.policy_version,'bar-accounting-financial-truth-v1'),'configuration_version',coalesce(v_activation.configuration_version,'unconfigured'),'missing_requirements',v_missing,'unposted_expenses',v_unposted,'blocking_exceptions',v_open_exceptions,'unresolved_scalar_opening_balances',v_unresolved,'ready',jsonb_array_length(v_missing)=0 and v_unposted=0 and v_open_exceptions=0 and v_unresolved=0));
end
$$;

revoke all on function public.get_restaurant_opening_balance_audit(uuid),public.resolve_restaurant_legacy_opening_balance(uuid,uuid,uuid,date,text,jsonb,text),public.update_restaurant_account(uuid,uuid,text,text,boolean,numeric),public.delete_restaurant_account(uuid,uuid),public.get_restaurant_financial_statements_v2(uuid,date,date),public.get_restaurant_financial_statements_v3(uuid,date,date),public.get_restaurant_accounting_readiness(uuid) from public,anon,authenticated;
grant execute on function public.get_restaurant_opening_balance_audit(uuid),public.resolve_restaurant_legacy_opening_balance(uuid,uuid,uuid,date,text,jsonb,text),public.update_restaurant_account(uuid,uuid,text,text,boolean,numeric),public.delete_restaurant_account(uuid,uuid),public.get_restaurant_financial_statements_v2(uuid,date,date),public.get_restaurant_financial_statements_v3(uuid,date,date),public.get_restaurant_accounting_readiness(uuid) to service_role;

commit;
