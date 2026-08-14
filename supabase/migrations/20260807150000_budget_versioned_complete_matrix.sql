-- Versioned budget scenarios with an exact account x 12-month matrix.

begin;

create table if not exists public.restaurant_budget_versions(
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  period_year integer not null,
  scenario text not null default 'base',
  status text not null default 'draft' check(status in('draft','submitted','approved','frozen')),
  operation_key text not null,
  payload_hash text not null,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(lodge_id,operation_key)
);
create table if not exists public.restaurant_budget_version_lines(
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.restaurant_budget_versions(id) on delete cascade,
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  period_year integer not null,
  period_month integer not null check(period_month between 1 and 12),
  amount numeric(15,2) not null check(amount>=0),
  notes text,
  unique(version_id,account_id,period_month)
);
alter table public.restaurant_budget_versions enable row level security;
alter table public.restaurant_budget_version_lines enable row level security;
revoke all on table public.restaurant_budget_versions,public.restaurant_budget_version_lines from public,anon,authenticated;

create or replace function public.save_restaurant_budget_matrix_v2(p_lodge_id uuid,p_year integer,p_entries jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_hash text;v_existing record;v_version uuid;v_expected integer;v_provided integer;v_unique integer;v_entry jsonb;v_result jsonb;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_year not between 2000 and 2100 or jsonb_typeof(p_entries)<>'array' or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Valid year, complete entries and idempotency key are required' using errcode='22023'; end if;
  v_hash:=encode(digest(jsonb_build_object('year',p_year,'entries',p_entries)::text,'sha256'),'hex');
  select payload_hash,result into v_existing from public.restaurant_budget_operations where lodge_id=p_lodge_id and operation_key=p_idempotency_key for update;
  if found then if v_existing.payload_hash<>v_hash then raise exception 'Budget idempotency key conflicts with a different matrix' using errcode='22000'; end if; return v_existing.result||jsonb_build_object('replayed',true); end if;
  select count(*) into v_expected from public.restaurant_accounts where lodge_id=p_lodge_id and is_active and account_type in('revenue','expense');
  v_expected:=v_expected*12;v_provided:=jsonb_array_length(p_entries);
  select count(distinct (x->>'account_id')||':'||(x->>'month')) into v_unique from jsonb_array_elements(p_entries)x;
  if v_expected=0 or v_provided<>v_expected or v_unique<>v_provided then raise exception 'Budget must contain exactly one row for every active revenue/expense account in every month' using errcode='23514'; end if;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if coalesce((v_entry->>'month')::integer,0) not between 1 and 12 or coalesce((v_entry->>'amount')::numeric,-1)<0 or not exists(select 1 from public.restaurant_accounts a where a.id=(v_entry->>'account_id')::uuid and a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense')) then raise exception 'Every budget row must use an active lodge P&L account, month 1-12, and non-negative amount' using errcode='23503'; end if;
  end loop;
  insert into public.restaurant_budget_versions(lodge_id,period_year,scenario,status,operation_key,payload_hash,created_by) values(p_lodge_id,p_year,'base','draft',p_idempotency_key,v_hash,v_actor) returning id into v_version;
  insert into public.restaurant_budget_version_lines(version_id,lodge_id,account_id,period_year,period_month,amount,notes)
    select v_version,p_lodge_id,(x->>'account_id')::uuid,p_year,(x->>'month')::integer,round((x->>'amount')::numeric,2),nullif(x->>'notes','') from jsonb_array_elements(p_entries)x;
  delete from public.restaurant_budgets b using public.restaurant_accounts a where b.lodge_id=p_lodge_id and b.period_year=p_year and a.id=b.account_id and a.lodge_id=p_lodge_id and a.account_type in('revenue','expense');
  insert into public.restaurant_budgets(lodge_id,account_id,account_name,period_year,period_month,budget_amount,notes,updated_at)
    select p_lodge_id,a.id,a.name,p_year,(x->>'month')::integer,round((x->>'amount')::numeric,2),nullif(x->>'notes',''),now() from jsonb_array_elements(p_entries)x join public.restaurant_accounts a on a.id=(x->>'account_id')::uuid and a.lodge_id=p_lodge_id;
  v_result:=jsonb_build_object('success',true,'data',jsonb_build_object('version_id',v_version,'status','draft','complete_matrix',true,'rows',v_provided),'replayed',false);
  insert into public.restaurant_budget_operations(lodge_id,operation_key,payload_hash,result,created_by) values(p_lodge_id,p_idempotency_key,v_hash,v_result,v_actor);
  return v_result;
end
$$;

create or replace function public.approve_restaurant_budget_version(p_lodge_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_created uuid;v_status text;v_approved uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  select created_by,status,approved_by into v_created,v_status,v_approved from public.restaurant_budget_versions where id=p_version_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Draft budget version not found' using errcode='P0002'; end if;
  if v_status='approved' then return jsonb_build_object('success',true,'data',jsonb_build_object('version_id',p_version_id,'status','approved'),'replayed',true); end if;
  if v_status<>'draft' then raise exception 'Only a draft budget version can be approved' using errcode='55000'; end if;
  if v_created=v_actor then raise exception 'Budget preparer cannot approve the same version' using errcode='42501'; end if;
  update public.restaurant_budget_versions set status='approved',approved_by=v_actor,approved_at=now() where id=p_version_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('version_id',p_version_id,'status','approved'));
end
$$;

create or replace function public.get_restaurant_budget_matrix_v2(p_lodge_id uuid,p_year integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_version public.restaurant_budget_versions%rowtype;v_rows jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select * into v_version from public.restaurant_budget_versions where lodge_id=p_lodge_id and period_year=p_year order by case status when 'approved' then 0 when 'submitted' then 1 else 2 end,created_at desc limit 1;
  if v_version.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'version_id',v_version.id,'version_status',v_version.status,'months',coalesce((select jsonb_object_agg(l.period_month,l.amount) from public.restaurant_budget_version_lines l where l.version_id=v_version.id and l.account_id=a.id),'{}'::jsonb)) order by a.code),'[]'::jsonb) into v_rows from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense');
  else
    select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'months',coalesce((select jsonb_object_agg(b.period_month,b.budget_amount) from public.restaurant_budgets b where b.lodge_id=p_lodge_id and b.account_id=a.id and b.period_year=p_year),'{}'::jsonb)) order by a.code),'[]'::jsonb) into v_rows from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense');
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('matrix',v_rows,'version_id',v_version.id,'version_status',v_version.status,'complete',jsonb_array_length(v_rows)=(select count(*) from public.restaurant_accounts where lodge_id=p_lodge_id and is_active and account_type in('revenue','expense'))));
end
$$;

revoke all on function public.save_restaurant_budget_matrix_v2(uuid,integer,jsonb,text),public.approve_restaurant_budget_version(uuid,uuid),public.get_restaurant_budget_matrix_v2(uuid,integer) from public,anon,authenticated;
grant execute on function public.save_restaurant_budget_matrix_v2(uuid,integer,jsonb,text),public.approve_restaurant_budget_version(uuid,uuid),public.get_restaurant_budget_matrix_v2(uuid,integer) to authenticated,service_role;

commit;
