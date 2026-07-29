-- Restaurant Accounting atomic budgets and ledger-derived statements rebuild.
-- Operator grants remain revoked.

begin;

create table if not exists public.restaurant_budget_operations(
 id uuid primary key default gen_random_uuid(),
 lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
 operation_key text not null,
 payload_hash text not null,
 result jsonb not null,
 created_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 unique(lodge_id,operation_key)
);
alter table public.restaurant_budget_operations enable row level security;
revoke all on table public.restaurant_budget_operations from public,anon,authenticated;
grant select,insert on table public.restaurant_budget_operations to service_role;

create or replace function public.save_restaurant_budget_matrix_v2(
 p_lodge_id uuid,p_year integer,p_entries jsonb,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_hash text;v_existing record;v_e jsonb;v_count int:=0;v_result jsonb;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if p_year<2000 or p_year>2100 or jsonb_typeof(p_entries)<>'array' or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Valid year, budget entries and idempotency key are required' using errcode='22023';end if;
 v_hash:=encode(digest(jsonb_build_object('year',p_year,'entries',p_entries)::text,'sha256'),'hex');
 select payload_hash,result into v_existing from public.restaurant_budget_operations where lodge_id=p_lodge_id and operation_key=p_idempotency_key;
 if found then
  if v_existing.payload_hash<>v_hash then raise exception 'Budget idempotency key conflicts with a different matrix' using errcode='23505';end if;
  return v_existing.result||jsonb_build_object('replayed',true);
 end if;
 for v_e in select value from jsonb_array_elements(p_entries) loop
  if coalesce((v_e->>'month')::int,0) not between 1 and 12 or coalesce((v_e->>'amount')::numeric,0)<0 or not exists(select 1 from public.restaurant_accounts where id=(v_e->>'account_id')::uuid and lodge_id=p_lodge_id and is_active) then raise exception 'Every budget entry requires an active lodge account, month 1-12, and non-negative amount' using errcode='23503';end if;
 end loop;
 for v_e in select value from jsonb_array_elements(p_entries) loop
  insert into public.restaurant_budgets(lodge_id,account_id,account_name,period_year,period_month,budget_amount,notes,updated_at)
  select p_lodge_id,a.id,a.name,p_year,(v_e->>'month')::int,round((v_e->>'amount')::numeric,2),nullif(btrim(v_e->>'notes'),''),now() from public.restaurant_accounts a where a.id=(v_e->>'account_id')::uuid and a.lodge_id=p_lodge_id
  on conflict(lodge_id,account_id,period_year,period_month) do update set budget_amount=excluded.budget_amount,notes=excluded.notes,updated_at=now();
  v_count:=v_count+1;
 end loop;
 v_result:=jsonb_build_object('success',true,'data',jsonb_build_object('saved',v_count),'replayed',false);
 insert into public.restaurant_budget_operations(lodge_id,operation_key,payload_hash,result,created_by) values(p_lodge_id,p_idempotency_key,v_hash,v_result,v_actor);
 return v_result;
end $$;

create or replace function public.create_restaurant_budget_template_v2(
 p_lodge_id uuid,p_name text,p_description text,p_lines jsonb,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;v_l jsonb;v_hash text;v_existing record;v_result jsonb;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if nullif(btrim(p_name),'') is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Template name, lines and idempotency key are required' using errcode='22023';end if;
 v_hash:=encode(digest(jsonb_build_object('name',btrim(p_name),'description',p_description,'lines',p_lines)::text,'sha256'),'hex');
 select payload_hash,result into v_existing from public.restaurant_budget_operations where lodge_id=p_lodge_id and operation_key=p_idempotency_key;
 if found then if v_existing.payload_hash<>v_hash then raise exception 'Template idempotency key conflicts with different content' using errcode='23505';end if;return v_existing.result||jsonb_build_object('replayed',true);end if;
 for v_l in select value from jsonb_array_elements(p_lines) loop
  if coalesce((v_l->>'default_amount')::numeric,0)<0 or not exists(select 1 from public.restaurant_accounts where id=(v_l->>'account_id')::uuid and lodge_id=p_lodge_id and is_active) then raise exception 'Template lines require active lodge accounts and non-negative amounts' using errcode='23503';end if;
 end loop;
 insert into public.restaurant_budget_templates(lodge_id,name,description) values(p_lodge_id,btrim(p_name),nullif(btrim(p_description),'')) returning id into v_id;
 insert into public.restaurant_budget_template_lines(template_id,account_id,account_name,monthly_amount)
 select v_id,a.id,a.name,round((x->>'default_amount')::numeric,2) from jsonb_array_elements(p_lines)x join public.restaurant_accounts a on a.id=(x->>'account_id')::uuid and a.lodge_id=p_lodge_id;
 v_result:=jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id),'replayed',false);
 insert into public.restaurant_budget_operations(lodge_id,operation_key,payload_hash,result,created_by) values(p_lodge_id,p_idempotency_key,v_hash,v_result,v_actor);
 return v_result;
end $$;

create or replace function public.apply_restaurant_budget_template_v2(
 p_lodge_id uuid,p_template_id uuid,p_year integer,p_month integer,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_hash text;v_existing record;v_count int;v_result jsonb;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if p_year not between 2000 and 2100 or p_month not between 1 and 12 or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Valid year, month and idempotency key are required' using errcode='22023';end if;
 if not exists(select 1 from public.restaurant_budget_templates where id=p_template_id and lodge_id=p_lodge_id) then raise exception 'Budget template belongs to another lodge or is missing' using errcode='23503';end if;
 if exists(select 1 from public.restaurant_budget_template_lines l left join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id and a.is_active where l.template_id=p_template_id and a.id is null) then raise exception 'Template contains inactive or cross-lodge accounts' using errcode='23503';end if;
 v_hash:=encode(digest(jsonb_build_object('template_id',p_template_id,'year',p_year,'month',p_month)::text,'sha256'),'hex');
 select payload_hash,result into v_existing from public.restaurant_budget_operations where lodge_id=p_lodge_id and operation_key=p_idempotency_key;
 if found then if v_existing.payload_hash<>v_hash then raise exception 'Template application key conflicts with different parameters' using errcode='23505';end if;return v_existing.result||jsonb_build_object('replayed',true);end if;
 insert into public.restaurant_budgets(lodge_id,account_id,account_name,period_year,period_month,budget_amount,updated_at)
 select p_lodge_id,l.account_id,l.account_name,p_year,p_month,l.monthly_amount,now() from public.restaurant_budget_template_lines l where l.template_id=p_template_id
 on conflict(lodge_id,account_id,period_year,period_month) do update set budget_amount=excluded.budget_amount,updated_at=now();
 get diagnostics v_count=row_count;
 v_result:=jsonb_build_object('success',true,'data',jsonb_build_object('applied',v_count),'replayed',false);
 insert into public.restaurant_budget_operations(lodge_id,operation_key,payload_hash,result,created_by) values(p_lodge_id,p_idempotency_key,v_hash,v_result,v_actor);
 return v_result;
end $$;

create or replace function public.get_restaurant_budget_matrix_v2(p_lodge_id uuid,p_year integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 return jsonb_build_object('success',true,'data',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'months',coalesce((select jsonb_object_agg(b.period_month,b.budget_amount) from public.restaurant_budgets b where b.lodge_id=p_lodge_id and b.account_id=a.id and b.period_year=p_year),'{}'::jsonb)) order by a.code) from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense')),'[]'::jsonb));
end $$;

create or replace function public.get_restaurant_financial_statements_v2(p_lodge_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_assets jsonb;v_liabilities jsonb;v_equity jsonb;v_revenue jsonb;v_expenses jsonb;v_cashflow jsonb;v_assets_total numeric;v_liab_total numeric;v_equity_total numeric;v_rev_total numeric;v_exp_total numeric;v_earnings numeric;
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 if p_start_date is null or p_end_date<p_start_date then raise exception 'Valid statement dates are required' using errcode='22023';end if;
 with balances as(select a.id,a.code,a.name,a.account_type,a.is_active,case when a.account_type in('asset','expense') then coalesce(sum(l.debit-l.credit),0) else coalesce(sum(l.credit-l.debit),0) end balance from public.restaurant_accounts a left join public.restaurant_journal_lines l on l.account_id=a.id left join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date<=p_end_date where a.lodge_id=p_lodge_id group by a.id)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'balance',balance,'is_active',is_active) order by code)filter(where account_type='asset'),'[]'),coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'balance',balance,'is_active',is_active) order by code)filter(where account_type='liability'),'[]'),coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'balance',balance,'is_active',is_active) order by code)filter(where account_type='equity'),'[]'),coalesce(sum(balance)filter(where account_type='asset'),0),coalesce(sum(balance)filter(where account_type='liability'),0),coalesce(sum(balance)filter(where account_type='equity'),0)
 into v_assets,v_liabilities,v_equity,v_assets_total,v_liab_total,v_equity_total from balances where balance<>0 or is_active;
 with period as(select a.id,a.code,a.name,a.account_type,a.is_active,case when a.account_type='revenue' then coalesce(sum(l.credit-l.debit),0) else coalesce(sum(l.debit-l.credit),0) end amount from public.restaurant_accounts a left join public.restaurant_journal_lines l on l.account_id=a.id left join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date where a.lodge_id=p_lodge_id and a.account_type in('revenue','expense') group by a.id)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'amount',amount,'is_active',is_active)order by code)filter(where account_type='revenue'),'[]'),coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'amount',amount,'is_active',is_active)order by code)filter(where account_type='expense'),'[]'),coalesce(sum(amount)filter(where account_type='revenue'),0),coalesce(sum(amount)filter(where account_type='expense'),0)
 into v_revenue,v_expenses,v_rev_total,v_exp_total from period where amount<>0 or is_active;
 v_earnings:=v_rev_total-v_exp_total;
 with journal_cash as(select e.id,sum(case when a.cash_flow_classification='cash' then l.debit-l.credit else 0 end) cash_movement,array_agg(distinct a.cash_flow_classification)filter(where a.cash_flow_classification<>'cash' and (l.debit<>0 or l.credit<>0)) classes from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_start_date and p_end_date group by e.id),classified as(select case when cardinality(classes)=1 and classes[1] in('operating','investing','financing') then classes[1] else 'unclassified' end classification,cash_movement from journal_cash where cash_movement<>0)
 select coalesce(jsonb_object_agg(classification,amount),'{}') into v_cashflow from(select classification,sum(cash_movement)amount from classified group by classification)x;
 return jsonb_build_object('success',true,'data',jsonb_build_object('period',jsonb_build_object('start',p_start_date,'end',p_end_date),'balance_sheet',jsonb_build_object('assets',v_assets,'liabilities',v_liabilities,'equity',v_equity,'current_period_earnings',v_earnings,'assets_total',v_assets_total,'liabilities_and_equity_total',v_liab_total+v_equity_total+v_earnings,'difference',v_assets_total-(v_liab_total+v_equity_total+v_earnings)),'income_statement',jsonb_build_object('revenue',v_revenue,'expenses',v_expenses,'revenue_total',v_rev_total,'expense_total',v_exp_total,'net_income',v_earnings),'cash_flow',coalesce(v_cashflow,'{}'::jsonb)));
end $$;

revoke all on function public.save_restaurant_budget_matrix_v2(uuid,integer,jsonb,text) from public,anon,authenticated;
revoke all on function public.create_restaurant_budget_template_v2(uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.apply_restaurant_budget_template_v2(uuid,uuid,integer,integer,text) from public,anon,authenticated;
revoke all on function public.get_restaurant_budget_matrix_v2(uuid,integer) from public,anon,authenticated;
revoke all on function public.get_restaurant_financial_statements_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.save_restaurant_budget_matrix_v2(uuid,integer,jsonb,text) to service_role;
grant execute on function public.create_restaurant_budget_template_v2(uuid,text,text,jsonb,text) to service_role;
grant execute on function public.apply_restaurant_budget_template_v2(uuid,uuid,integer,integer,text) to service_role;
grant execute on function public.get_restaurant_budget_matrix_v2(uuid,integer) to service_role;
grant execute on function public.get_restaurant_financial_statements_v2(uuid,date,date) to service_role;

commit;
