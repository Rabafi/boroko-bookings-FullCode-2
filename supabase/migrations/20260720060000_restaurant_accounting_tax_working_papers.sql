-- Restaurant Accounting tax working-paper rebuild. No statutory filing automation or operator grants.

begin;

create table if not exists public.restaurant_tax_configurations(
 id uuid primary key default gen_random_uuid(),
 lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
 jurisdiction_code text not null,
 rule_version text not null,
 effective_from date not null,
 effective_to date,
 output_tax_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
 input_tax_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
 configured_by uuid references public.users(id),
 configured_at timestamptz not null default now(),
 unique(lodge_id,jurisdiction_code,rule_version,effective_from),
 check(effective_to is null or effective_to>=effective_from)
);
alter table public.restaurant_tax_configurations enable row level security;
revoke all on table public.restaurant_tax_configurations from public,anon,authenticated;
grant select,insert,update on table public.restaurant_tax_configurations to service_role;

alter table public.restaurant_tax_returns
 add column if not exists configuration_id uuid references public.restaurant_tax_configurations(id) on delete restrict,
 add column if not exists jurisdiction_code text,
 add column if not exists rule_version text,
 add column if not exists source_snapshot jsonb,
 add column if not exists snapshot_hash text,
 add column if not exists prepared_by uuid references public.users(id),
 add column if not exists prepared_at timestamptz,
 add column if not exists approved_by uuid references public.users(id),
 add column if not exists approved_at timestamptz,
 add column if not exists filed_by uuid references public.users(id),
 add column if not exists filing_reference text;

alter table public.restaurant_tax_returns drop constraint if exists restaurant_tax_returns_status_check;
alter table public.restaurant_tax_returns add constraint restaurant_tax_returns_status_check
 check(status in('draft','reviewed','approved','filed'));

create or replace function public.set_restaurant_tax_configuration(
 p_lodge_id uuid,p_jurisdiction_code text,p_rule_version text,p_effective_from date,p_effective_to date,
 p_output_tax_account_id uuid,p_input_tax_account_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if nullif(btrim(p_jurisdiction_code),'') is null or nullif(btrim(p_rule_version),'') is null or p_effective_from is null then raise exception 'Jurisdiction, rule version and effective date are required' using errcode='22023';end if;
 if not exists(select 1 from public.restaurant_accounts where id=p_output_tax_account_id and lodge_id=p_lodge_id and is_active and account_type='liability') then raise exception 'Output tax account must be an active lodge liability' using errcode='23503';end if;
 if not exists(select 1 from public.restaurant_accounts where id=p_input_tax_account_id and lodge_id=p_lodge_id and is_active and account_type='asset') then raise exception 'Input tax account must be an active lodge asset' using errcode='23503';end if;
 insert into public.restaurant_tax_configurations(lodge_id,jurisdiction_code,rule_version,effective_from,effective_to,output_tax_account_id,input_tax_account_id,configured_by)
 values(p_lodge_id,upper(btrim(p_jurisdiction_code)),btrim(p_rule_version),p_effective_from,p_effective_to,p_output_tax_account_id,p_input_tax_account_id,v_actor)
 returning id into v_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id));
end $$;

create or replace function public.generate_restaurant_tax_working_paper(
 p_lodge_id uuid,p_period_start date,p_period_end date,p_configuration_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_cfg public.restaurant_tax_configurations%rowtype;v_existing public.restaurant_tax_returns%rowtype;v_snapshot jsonb;v_hash text;v_id uuid;v_output numeric;v_input numeric;v_sales numeric;v_purchases numeric;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if p_period_start is null or p_period_end<p_period_start then raise exception 'Valid tax period is required' using errcode='22023';end if;
 select * into v_cfg from public.restaurant_tax_configurations where id=p_configuration_id and lodge_id=p_lodge_id and effective_from<=p_period_start and (effective_to is null or effective_to>=p_period_end);
 if not found then raise exception 'Tax configuration is not effective for the full period' using errcode='23503';end if;
 select * into v_existing from public.restaurant_tax_returns where lodge_id=p_lodge_id and period_start=p_period_start and period_end=p_period_end for update;
 if found and v_existing.status<>'draft' then raise exception 'Reviewed, approved, or filed working papers are immutable' using errcode='55000';end if;

 select coalesce(sum(l.credit-l.debit),0) into v_output from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and l.account_id=v_cfg.output_tax_account_id;
 select coalesce(sum(l.debit-l.credit),0) into v_input from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and l.account_id=v_cfg.input_tax_account_id;
 select coalesce(sum(case when a.account_type='revenue' then l.credit-l.debit else 0 end),0) into v_sales from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and e.source_type in('pos_sale','pos_return');
 select coalesce(sum(case when a.account_type in('expense','asset') then l.debit-l.credit else 0 end),0) into v_purchases from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id=e.id join public.restaurant_accounts a on a.id=l.account_id and a.lodge_id=p_lodge_id where e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between p_period_start and p_period_end and e.source_type='ap_bill';

 v_snapshot:=jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'configuration_id',v_cfg.id,'jurisdiction_code',v_cfg.jurisdiction_code,'rule_version',v_cfg.rule_version,'output_tax_account_id',v_cfg.output_tax_account_id,'input_tax_account_id',v_cfg.input_tax_account_id,'sales_ex_tax',round(v_sales,2),'output_tax',round(v_output,2),'purchases_ex_tax',round(v_purchases,2),'input_tax',round(v_input,2),'net_tax_payable',round(v_output-v_input,2),'journal_count',(select count(*) from public.restaurant_journal_entries where lodge_id=p_lodge_id and is_posted and entry_date between p_period_start and p_period_end));
 v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
 insert into public.restaurant_tax_returns(lodge_id,period_start,period_end,tax_rate,total_sales_incl,total_sales_excl,total_tax_collected,total_purchases_incl,total_purchases_excl,total_input_tax,net_tax_payable,status,configuration_id,jurisdiction_code,rule_version,source_snapshot,snapshot_hash,prepared_by,prepared_at,updated_at)
 values(p_lodge_id,p_period_start,p_period_end,0,v_sales+v_output,v_sales,v_output,v_purchases+v_input,v_purchases,v_input,v_output-v_input,'draft',v_cfg.id,v_cfg.jurisdiction_code,v_cfg.rule_version,v_snapshot,v_hash,v_actor,now(),now())
 on conflict(lodge_id,period_start,period_end) do update set total_sales_incl=excluded.total_sales_incl,total_sales_excl=excluded.total_sales_excl,total_tax_collected=excluded.total_tax_collected,total_purchases_incl=excluded.total_purchases_incl,total_purchases_excl=excluded.total_purchases_excl,total_input_tax=excluded.total_input_tax,net_tax_payable=excluded.net_tax_payable,configuration_id=excluded.configuration_id,jurisdiction_code=excluded.jurisdiction_code,rule_version=excluded.rule_version,source_snapshot=excluded.source_snapshot,snapshot_hash=excluded.snapshot_hash,prepared_by=excluded.prepared_by,prepared_at=excluded.prepared_at,updated_at=now()
 returning id into v_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'tax_working_paper.generated','restaurant_tax_returns',v_id,null,v_snapshot,jsonb_build_object('snapshot_hash',v_hash));
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'snapshot_hash',v_hash,'working_paper_only',true));
end $$;

create or replace function public.review_restaurant_tax_working_paper(p_lodge_id uuid,p_return_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_r public.restaurant_tax_returns%rowtype;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 select * into v_r from public.restaurant_tax_returns where id=p_return_id and lodge_id=p_lodge_id for update;
 if not found or v_r.status<>'draft' or v_r.source_snapshot is null or v_r.snapshot_hash<>encode(digest(v_r.source_snapshot::text,'sha256'),'hex') then raise exception 'Valid draft working paper not found' using errcode='23514';end if;
 if v_r.prepared_by=v_actor then raise exception 'Working-paper preparer cannot review it' using errcode='42501';end if;
 update public.restaurant_tax_returns set status='reviewed',updated_at=now() where id=p_return_id;
 return jsonb_build_object('success',true);
end $$;

create or replace function public.approve_restaurant_tax_working_paper(p_lodge_id uuid,p_return_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_r public.restaurant_tax_returns%rowtype;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.tax_file');
 select * into v_r from public.restaurant_tax_returns where id=p_return_id and lodge_id=p_lodge_id for update;
 if not found or v_r.status<>'reviewed' or v_r.snapshot_hash<>encode(digest(v_r.source_snapshot::text,'sha256'),'hex') then raise exception 'Reviewed working paper not found or snapshot changed' using errcode='23514';end if;
 if v_r.prepared_by=v_actor then raise exception 'Working-paper preparer cannot approve it' using errcode='42501';end if;
 update public.restaurant_tax_returns set status='approved',approved_by=v_actor,approved_at=now(),updated_at=now() where id=p_return_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'tax_working_paper.approved','restaurant_tax_returns',p_return_id,to_jsonb(v_r),jsonb_build_object('approved_by',v_actor,'snapshot_hash',v_r.snapshot_hash),null);
 return jsonb_build_object('success',true);
end $$;

create or replace function public.record_restaurant_tax_filing(p_lodge_id uuid,p_return_id uuid,p_filing_reference text,p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_r public.restaurant_tax_returns%rowtype;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.tax_file');
 if nullif(btrim(p_filing_reference),'') is null then raise exception 'Authoritative filing reference is required' using errcode='22023';end if;
 select * into v_r from public.restaurant_tax_returns where id=p_return_id and lodge_id=p_lodge_id for update;
 if not found or v_r.status<>'approved' or v_r.approved_by is null or v_r.approved_at is null or v_r.snapshot_hash<>encode(digest(v_r.source_snapshot::text,'sha256'),'hex') then raise exception 'Approved immutable working paper is required before filing' using errcode='23514';end if;
 if v_r.approved_by=v_actor then raise exception 'Working-paper approver cannot record the filing' using errcode='42501';end if;
 update public.restaurant_tax_returns set status='filed',filed_by=v_actor,filed_at=now(),filing_reference=btrim(p_filing_reference),notes=nullif(btrim(p_notes),''),updated_at=now() where id=p_return_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'tax_filing.recorded','restaurant_tax_returns',p_return_id,to_jsonb(v_r),jsonb_build_object('filing_reference',btrim(p_filing_reference),'filed_by',v_actor),null);
 return jsonb_build_object('success',true);
end $$;

revoke all on function public.set_restaurant_tax_configuration(uuid,text,text,date,date,uuid,uuid) from public,anon,authenticated;
revoke all on function public.generate_restaurant_tax_working_paper(uuid,date,date,uuid) from public,anon,authenticated;
revoke all on function public.review_restaurant_tax_working_paper(uuid,uuid) from public,anon,authenticated;
revoke all on function public.approve_restaurant_tax_working_paper(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_restaurant_tax_filing(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_restaurant_tax_configuration(uuid,text,text,date,date,uuid,uuid) to service_role;
grant execute on function public.generate_restaurant_tax_working_paper(uuid,date,date,uuid) to service_role;
grant execute on function public.review_restaurant_tax_working_paper(uuid,uuid) to service_role;
grant execute on function public.approve_restaurant_tax_working_paper(uuid,uuid) to service_role;
grant execute on function public.record_restaurant_tax_filing(uuid,uuid,text,text) to service_role;

commit;
