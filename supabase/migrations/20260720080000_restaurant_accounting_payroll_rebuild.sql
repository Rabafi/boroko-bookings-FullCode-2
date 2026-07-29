-- Restaurant Accounting privacy-scoped payroll rebuild. No operator grants restored.

begin;

create table if not exists public.restaurant_payroll_employment_terms(
 id uuid primary key default gen_random_uuid(),
 lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
 staff_user_id uuid not null references public.users(id) on delete restrict,
 effective_from date not null,
 effective_to date,
 pay_type text not null check(pay_type in('salary','hourly')),
 monthly_salary numeric(15,2) not null default 0 check(monthly_salary>=0),
 hourly_rate numeric(15,2) not null default 0 check(hourly_rate>=0),
 overtime_multiplier numeric(6,3) not null default 1.5 check(overtime_multiplier>=1),
 standard_monthly_hours numeric(8,2) not null default 173.33 check(standard_monthly_hours>0),
 payment_reference text,
 bank_account_name text,
 bank_account_number text,
 bank_branch_code text,
 created_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 unique(lodge_id,staff_user_id,effective_from),
 check(effective_to is null or effective_to>=effective_from),
 check((pay_type='salary' and monthly_salary>0)or(pay_type='hourly' and hourly_rate>0))
);
alter table public.restaurant_payroll_employment_terms enable row level security;
revoke all on table public.restaurant_payroll_employment_terms from public,anon,authenticated;
grant select,insert,update on table public.restaurant_payroll_employment_terms to service_role;

create table if not exists public.restaurant_payroll_statutory_configurations(
 id uuid primary key default gen_random_uuid(),
 lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
 jurisdiction_code text not null,
 rule_version text not null,
 effective_from date not null,
 effective_to date,
 tax_brackets jsonb not null,
 social_security_rate numeric(7,4) not null default 0,
 pension_rate numeric(7,4) not null default 0,
 health_amount numeric(15,2) not null default 0,
 currency text not null default 'BWP',
 configured_by uuid references public.users(id),
 configured_at timestamptz not null default now(),
 unique(lodge_id,jurisdiction_code,rule_version,effective_from),
 check(effective_to is null or effective_to>=effective_from)
);
alter table public.restaurant_payroll_statutory_configurations enable row level security;
revoke all on table public.restaurant_payroll_statutory_configurations from public,anon,authenticated;
grant select,insert on table public.restaurant_payroll_statutory_configurations to service_role;

create table if not exists public.restaurant_payroll_time_inputs(
 id uuid primary key default gen_random_uuid(),
 lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
 pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete restrict,
 staff_user_id uuid not null references public.users(id) on delete restrict,
 regular_hours numeric(8,2) not null default 0 check(regular_hours>=0),
 overtime_hours numeric(8,2) not null default 0 check(overtime_hours>=0),
 source_reference text not null,
 entered_by uuid references public.users(id),
 entered_at timestamptz not null default now(),
 approved_by uuid references public.users(id),
 approved_at timestamptz,
 unique(lodge_id,pay_period_id,staff_user_id)
);
alter table public.restaurant_payroll_time_inputs enable row level security;
revoke all on table public.restaurant_payroll_time_inputs from public,anon,authenticated;
grant select,insert,update on table public.restaurant_payroll_time_inputs to service_role;

create table if not exists public.restaurant_payroll_gl_settings(
 lodge_id uuid primary key references public.settings(lodge_id) on delete cascade,
 payroll_expense_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
 net_payable_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
 tax_payable_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
 deductions_payable_account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
 updated_by uuid references public.users(id),
 updated_at timestamptz not null default now()
);
alter table public.restaurant_payroll_gl_settings enable row level security;
revoke all on table public.restaurant_payroll_gl_settings from public,anon,authenticated;
grant select,insert,update on table public.restaurant_payroll_gl_settings to service_role;

create table if not exists public.restaurant_payroll_payment_exports(
 id uuid primary key default gen_random_uuid(),
 lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
 pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete restrict,
 export_payload jsonb not null,
 payload_hash text not null,
 exported_by uuid references public.users(id),
 exported_at timestamptz not null default now(),
 unique(lodge_id,pay_period_id,payload_hash)
);
alter table public.restaurant_payroll_payment_exports enable row level security;
revoke all on table public.restaurant_payroll_payment_exports from public,anon,authenticated;
grant select,insert on table public.restaurant_payroll_payment_exports to service_role;

alter table public.restaurant_pay_periods
 add column if not exists statutory_configuration_id uuid references public.restaurant_payroll_statutory_configurations(id) on delete restrict,
 add column if not exists prepared_by uuid references public.users(id),
 add column if not exists prepared_at timestamptz,
 add column if not exists calculation_snapshot_hash text,
 add column if not exists journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
 add column if not exists payment_exported_at timestamptz;

alter table public.restaurant_employee_pay_records
 add column if not exists employment_terms_id uuid references public.restaurant_payroll_employment_terms(id) on delete restrict,
 add column if not exists time_input_id uuid references public.restaurant_payroll_time_inputs(id) on delete restrict,
 add column if not exists statutory_configuration_id uuid references public.restaurant_payroll_statutory_configurations(id) on delete restrict,
 add column if not exists calculation_snapshot jsonb,
 add column if not exists calculation_snapshot_hash text;

create or replace function public._restaurant_payroll_tax(p_gross numeric,p_brackets jsonb)
returns numeric language plpgsql immutable set search_path=public as $$
declare v_b jsonb;v_tax numeric:=0;v_from numeric;v_to numeric;v_rate numeric;
begin
 if jsonb_typeof(p_brackets)<>'array' then raise exception 'Tax brackets must be an array' using errcode='22023';end if;
 for v_b in select value from jsonb_array_elements(p_brackets) loop
  v_from:=coalesce((v_b->>'from')::numeric,0);v_to:=nullif(v_b->>'to','')::numeric;v_rate:=coalesce((v_b->>'rate')::numeric,-1);
  if v_from<0 or v_rate<0 or v_rate>100 or(v_to is not null and v_to<=v_from)then raise exception 'Invalid progressive tax bracket' using errcode='22023';end if;
  v_tax:=v_tax+greatest(0,least(p_gross,coalesce(v_to,p_gross))-v_from)*v_rate/100;
 end loop;
 return round(v_tax,2);
end $$;
revoke all on function public._restaurant_payroll_tax(numeric,jsonb) from public,anon,authenticated;

create or replace function public.set_restaurant_payroll_employment_terms(
 p_lodge_id uuid,p_staff_user_id uuid,p_effective_from date,p_effective_to date,p_pay_type text,
 p_monthly_salary numeric,p_hourly_rate numeric,p_overtime_multiplier numeric,p_standard_monthly_hours numeric,
 p_payment_reference text,p_bank_account_name text,p_bank_account_number text,p_bank_branch_code text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 if not exists(select 1 from public.users where id=p_staff_user_id and lodge_id=p_lodge_id and coalesce(status,'active')='active') then raise exception 'Active lodge employee not found' using errcode='23503';end if;
 if exists(select 1 from public.restaurant_payroll_employment_terms where lodge_id=p_lodge_id and staff_user_id=p_staff_user_id and daterange(effective_from,coalesce(effective_to,'infinity'::date),'[]')&&daterange(p_effective_from,coalesce(p_effective_to,'infinity'::date),'[]')) then raise exception 'Employment terms overlap an existing effective period' using errcode='23P01';end if;
 insert into public.restaurant_payroll_employment_terms(lodge_id,staff_user_id,effective_from,effective_to,pay_type,monthly_salary,hourly_rate,overtime_multiplier,standard_monthly_hours,payment_reference,bank_account_name,bank_account_number,bank_branch_code,created_by)
 values(p_lodge_id,p_staff_user_id,p_effective_from,p_effective_to,p_pay_type,coalesce(p_monthly_salary,0),coalesce(p_hourly_rate,0),coalesce(p_overtime_multiplier,1.5),coalesce(p_standard_monthly_hours,173.33),nullif(btrim(p_payment_reference),''),nullif(btrim(p_bank_account_name),''),nullif(btrim(p_bank_account_number),''),nullif(btrim(p_bank_branch_code),''),v_actor)returning id into v_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'payroll_terms.created','restaurant_payroll_employment_terms',v_id,null,jsonb_build_object('staff_user_id',p_staff_user_id,'effective_from',p_effective_from,'pay_type',p_pay_type),null);
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id));
end $$;

create or replace function public.set_restaurant_payroll_statutory_configuration(
 p_lodge_id uuid,p_jurisdiction_code text,p_rule_version text,p_effective_from date,p_effective_to date,
 p_tax_brackets jsonb,p_social_security_rate numeric,p_pension_rate numeric,p_health_amount numeric,p_currency text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 perform public._restaurant_payroll_tax(100000,p_tax_brackets);
 if nullif(btrim(p_jurisdiction_code),'') is null or nullif(btrim(p_rule_version),'') is null or p_effective_from is null or coalesce(p_social_security_rate,0)<0 or coalesce(p_pension_rate,0)<0 or coalesce(p_health_amount,0)<0 then raise exception 'Valid versioned statutory configuration is required' using errcode='22023';end if;
 insert into public.restaurant_payroll_statutory_configurations(lodge_id,jurisdiction_code,rule_version,effective_from,effective_to,tax_brackets,social_security_rate,pension_rate,health_amount,currency,configured_by)
 values(p_lodge_id,upper(btrim(p_jurisdiction_code)),btrim(p_rule_version),p_effective_from,p_effective_to,p_tax_brackets,p_social_security_rate,p_pension_rate,p_health_amount,upper(coalesce(nullif(btrim(p_currency),''),'BWP')),v_actor)returning id into v_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id));
end $$;

create or replace function public.create_restaurant_pay_period_v2(p_lodge_id uuid,p_name text,p_start_date date,p_end_date date,p_configuration_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 if nullif(btrim(p_name),'') is null or p_start_date is null or p_end_date<p_start_date or not exists(select 1 from public.restaurant_payroll_statutory_configurations where id=p_configuration_id and lodge_id=p_lodge_id and effective_from<=p_start_date and(effective_to is null or effective_to>=p_end_date))then raise exception 'Pay period requires a configuration effective for the full period' using errcode='23503';end if;
 if exists(select 1 from public.restaurant_pay_periods where lodge_id=p_lodge_id and daterange(start_date,end_date,'[]')&&daterange(p_start_date,p_end_date,'[]') and status<>'closed')then raise exception 'Pay period overlaps an existing open period' using errcode='23P01';end if;
 insert into public.restaurant_pay_periods(lodge_id,name,start_date,end_date,status,statutory_configuration_id)values(p_lodge_id,btrim(p_name),p_start_date,p_end_date,'draft',p_configuration_id)returning id into v_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id));
end $$;

create or replace function public.set_restaurant_payroll_time_input(p_lodge_id uuid,p_pay_period_id uuid,p_staff_user_id uuid,p_regular_hours numeric,p_overtime_hours numeric,p_source_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 if coalesce(p_regular_hours,0)<0 or coalesce(p_overtime_hours,0)<0 or nullif(btrim(p_source_reference),'') is null or not exists(select 1 from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id and status='draft')then raise exception 'Draft period, separate non-negative regular/overtime hours, and source reference are required' using errcode='22023';end if;
 insert into public.restaurant_payroll_time_inputs(lodge_id,pay_period_id,staff_user_id,regular_hours,overtime_hours,source_reference,entered_by)
 values(p_lodge_id,p_pay_period_id,p_staff_user_id,round(p_regular_hours,2),round(p_overtime_hours,2),btrim(p_source_reference),v_actor)
 on conflict(lodge_id,pay_period_id,staff_user_id)do update set regular_hours=excluded.regular_hours,overtime_hours=excluded.overtime_hours,source_reference=excluded.source_reference,entered_by=excluded.entered_by,entered_at=now(),approved_by=null,approved_at=null returning id into v_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id));
end $$;

create or replace function public.approve_restaurant_payroll_time_input(p_lodge_id uuid,p_time_input_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_t public.restaurant_payroll_time_inputs%rowtype;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 select * into v_t from public.restaurant_payroll_time_inputs where id=p_time_input_id and lodge_id=p_lodge_id for update;
 if not found or v_t.approved_at is not null then raise exception 'Unapproved time input not found' using errcode='22023';end if;
 if v_t.entered_by=v_actor then raise exception 'Time-input maker cannot approve the same input' using errcode='42501';end if;
 update public.restaurant_payroll_time_inputs set approved_by=v_actor,approved_at=now()where id=p_time_input_id;
 return jsonb_build_object('success',true);
end $$;

create or replace function public.calculate_restaurant_payroll_v2(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_p public.restaurant_pay_periods%rowtype;v_cfg public.restaurant_payroll_statutory_configurations%rowtype;v_row record;v_base numeric;v_ot numeric;v_gross numeric;v_tax numeric;v_social numeric;v_pension numeric;v_health numeric;v_ded numeric;v_net numeric;v_snap jsonb;v_hash text;v_count int:=0;v_period_hash text;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 select * into v_p from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
 if not found or v_p.status<>'draft'then raise exception 'Draft pay period not found' using errcode='22023';end if;
 select * into v_cfg from public.restaurant_payroll_statutory_configurations where id=v_p.statutory_configuration_id and lodge_id=p_lodge_id;
 delete from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 for v_row in select t.*,e.id terms_id,e.pay_type,e.monthly_salary,e.hourly_rate,e.overtime_multiplier,e.standard_monthly_hours,u.name staff_name from public.restaurant_payroll_time_inputs t join public.restaurant_payroll_employment_terms e on e.staff_user_id=t.staff_user_id and e.lodge_id=p_lodge_id and e.effective_from<=v_p.start_date and(e.effective_to is null or e.effective_to>=v_p.end_date)join public.users u on u.id=t.staff_user_id and u.lodge_id=p_lodge_id where t.pay_period_id=p_pay_period_id and t.lodge_id=p_lodge_id and t.approved_at is not null loop
  v_base:=case when v_row.pay_type='salary'then v_row.monthly_salary else round(v_row.regular_hours*v_row.hourly_rate,2)end;
  v_ot:=round(v_row.overtime_hours*case when v_row.pay_type='salary'then v_row.monthly_salary/v_row.standard_monthly_hours else v_row.hourly_rate end*v_row.overtime_multiplier,2);
  v_gross:=v_base+v_ot;v_tax:=public._restaurant_payroll_tax(v_gross,v_cfg.tax_brackets);v_social:=round(v_gross*v_cfg.social_security_rate/100,2);v_pension:=round(v_gross*v_cfg.pension_rate/100,2);v_health:=v_cfg.health_amount;v_ded:=v_tax+v_social+v_pension+v_health;v_net:=v_gross-v_ded;
  if v_net<0 then raise exception 'Payroll deductions exceed gross pay for employee %',v_row.staff_user_id using errcode='23514';end if;
  v_snap:=jsonb_build_object('terms_id',v_row.terms_id,'time_input_id',v_row.id,'configuration_id',v_cfg.id,'regular_hours',v_row.regular_hours,'overtime_hours',v_row.overtime_hours,'base_pay',v_base,'overtime_pay',v_ot,'gross_pay',v_gross,'paye_tax',v_tax,'social_security',v_social,'pension',v_pension,'health',v_health,'net_pay',v_net,'rule_version',v_cfg.rule_version);v_hash:=encode(digest(v_snap::text,'sha256'),'hex');
  insert into public.restaurant_employee_pay_records(lodge_id,staff_user_id,staff_name,pay_period_id,base_salary,hourly_rate,hours_worked,overtime_hours,overtime_rate,gross_pay,paye_tax,social_security,pension_contribution,health_insurance,total_deductions,net_pay,employment_terms_id,time_input_id,statutory_configuration_id,calculation_snapshot,calculation_snapshot_hash)
  values(p_lodge_id,v_row.staff_user_id,v_row.staff_name,p_pay_period_id,v_base,v_row.hourly_rate,v_row.regular_hours,v_row.overtime_hours,v_row.overtime_multiplier,v_gross,v_tax,v_social,v_pension,v_health,v_ded,v_net,v_row.terms_id,v_row.id,v_cfg.id,v_snap,v_hash);v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'No approved payroll time inputs with effective employment terms' using errcode='23514';end if;
 select encode(digest(string_agg(calculation_snapshot_hash,','order by staff_user_id),'sha256'),'hex')into v_period_hash from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 update public.restaurant_pay_periods set status='processing',processed_at=now(),prepared_by=v_actor,prepared_at=now(),calculation_snapshot_hash=v_period_hash where id=p_pay_period_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('records',v_count,'snapshot_hash',v_period_hash));
end $$;

create or replace function public.approve_restaurant_payroll_v2(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_p public.restaurant_pay_periods%rowtype;v_hash text;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 select * into v_p from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
 if not found or v_p.status<>'processing'then raise exception 'Calculated payroll not found' using errcode='22023';end if;
 if v_p.prepared_by=v_actor then raise exception 'Payroll preparer cannot approve the same run' using errcode='42501';end if;
 select encode(digest(string_agg(calculation_snapshot_hash,','order by staff_user_id),'sha256'),'hex')into v_hash from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 if v_hash is distinct from v_p.calculation_snapshot_hash then raise exception 'Payroll calculation snapshot changed before approval' using errcode='23514';end if;
 update public.restaurant_pay_periods set status='approved',approved_by=v_actor where id=p_pay_period_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'payroll.approved','restaurant_pay_periods',p_pay_period_id,to_jsonb(v_p),jsonb_build_object('approved_by',v_actor,'snapshot_hash',v_hash),null);
 return jsonb_build_object('success',true);
end $$;

create or replace function public.export_restaurant_payroll_payments(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_p public.restaurant_pay_periods%rowtype;v_payload jsonb;v_hash text;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 select * into v_p from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
 if not found or v_p.status<>'approved'then raise exception 'Approved payroll is required for payment export' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('staff_user_id',r.staff_user_id,'staff_name',r.staff_name,'amount',r.net_pay,'currency',c.currency,'payment_reference',e.payment_reference,'bank_account_name',e.bank_account_name,'bank_account_number',e.bank_account_number,'bank_branch_code',e.bank_branch_code)order by r.staff_user_id)into v_payload from public.restaurant_employee_pay_records r join public.restaurant_payroll_employment_terms e on e.id=r.employment_terms_id join public.restaurant_payroll_statutory_configurations c on c.id=r.statutory_configuration_id where r.pay_period_id=p_pay_period_id and r.lodge_id=p_lodge_id;
 if exists(select 1 from jsonb_array_elements(v_payload)x where nullif(x->>'bank_account_number','')is null)then raise exception 'Every employee requires bank details before export' using errcode='23514';end if;
 v_hash:=encode(digest(v_payload::text,'sha256'),'hex');
 insert into public.restaurant_payroll_payment_exports(lodge_id,pay_period_id,export_payload,payload_hash,exported_by)values(p_lodge_id,p_pay_period_id,v_payload,v_hash,v_actor)on conflict(lodge_id,pay_period_id,payload_hash)do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.restaurant_payroll_payment_exports where lodge_id=p_lodge_id and pay_period_id=p_pay_period_id and payload_hash=v_hash;end if;
 update public.restaurant_pay_periods set payment_exported_at=coalesce(payment_exported_at,now())where id=p_pay_period_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'payload_hash',v_hash,'payments',v_payload,'status','exported_not_paid'));
end $$;

create or replace function public.get_restaurant_payroll_records_v2(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.payroll_view');
 return jsonb_build_object('success',true,'data',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'staff_user_id',r.staff_user_id,'staff_name',r.staff_name,'regular_hours',r.hours_worked,'overtime_hours',r.overtime_hours,'gross_pay',r.gross_pay,'total_deductions',r.total_deductions,'net_pay',r.net_pay,'snapshot_hash',r.calculation_snapshot_hash)order by r.staff_name)from public.restaurant_employee_pay_records r where r.lodge_id=p_lodge_id and r.pay_period_id=p_pay_period_id),'[]'::jsonb));
end $$;

create or replace function public.set_restaurant_payroll_gl_settings(p_lodge_id uuid,p_payroll_expense_account_id uuid,p_net_payable_account_id uuid,p_tax_payable_account_id uuid,p_deductions_payable_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 if exists(select 1 from unnest(array[p_payroll_expense_account_id,p_net_payable_account_id,p_tax_payable_account_id,p_deductions_payable_account_id])x where not exists(select 1 from public.restaurant_accounts a where a.id=x and a.lodge_id=p_lodge_id and a.is_active))then raise exception 'Every payroll GL account must be active and belong to the lodge' using errcode='23503';end if;
 insert into public.restaurant_payroll_gl_settings(lodge_id,payroll_expense_account_id,net_payable_account_id,tax_payable_account_id,deductions_payable_account_id,updated_by,updated_at)values(p_lodge_id,p_payroll_expense_account_id,p_net_payable_account_id,p_tax_payable_account_id,p_deductions_payable_account_id,v_actor,now())
 on conflict(lodge_id)do update set payroll_expense_account_id=excluded.payroll_expense_account_id,net_payable_account_id=excluded.net_payable_account_id,tax_payable_account_id=excluded.tax_payable_account_id,deductions_payable_account_id=excluded.deductions_payable_account_id,updated_by=excluded.updated_by,updated_at=now() returning lodge_id into v_id;
 return jsonb_build_object('success',true,'data',jsonb_build_object('lodge_id',v_id));
end $$;

create or replace function public.post_restaurant_payroll_to_gl_v2(p_lodge_id uuid,p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_p public.restaurant_pay_periods%rowtype;v_s public.restaurant_payroll_gl_settings%rowtype;v_hash text;v_gross numeric;v_tax numeric;v_other numeric;v_net numeric;v_lines jsonb;v_result jsonb;v_entry_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 select * into v_p from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
 if not found or v_p.status<>'approved'then raise exception 'Approved payroll is required for ledger posting' using errcode='22023';end if;
 select * into v_s from public.restaurant_payroll_gl_settings where lodge_id=p_lodge_id;
 if not found then raise exception 'Payroll GL settings are required' using errcode='23514';end if;
 select encode(digest(string_agg(calculation_snapshot_hash,','order by staff_user_id),'sha256'),'hex'),round(sum(gross_pay),2),round(sum(paye_tax),2),round(sum(total_deductions-paye_tax),2),round(sum(net_pay),2)
 into v_hash,v_gross,v_tax,v_other,v_net from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 if v_hash is null or v_hash is distinct from v_p.calculation_snapshot_hash then raise exception 'Payroll snapshot changed before ledger posting' using errcode='23514';end if;
 if round(v_gross,2)<>round(v_tax+v_other+v_net,2)then raise exception 'Payroll control totals do not balance' using errcode='23514';end if;
 v_lines:=jsonb_build_array(
  jsonb_build_object('account_id',v_s.payroll_expense_account_id,'debit',v_gross,'credit',0,'memo','Gross payroll expense'),
  jsonb_build_object('account_id',v_s.net_payable_account_id,'debit',0,'credit',v_net,'memo','Net payroll payable'),
  jsonb_build_object('account_id',v_s.tax_payable_account_id,'debit',0,'credit',v_tax,'memo','Payroll tax payable'),
  jsonb_build_object('account_id',v_s.deductions_payable_account_id,'debit',0,'credit',v_other,'memo','Other payroll deductions payable')
 );
 v_result:=public._restaurant_post_journal(p_lodge_id,v_p.end_date,'Payroll '||v_p.name,'payroll',p_pay_period_id,v_p.name,'payroll:'||p_pay_period_id,v_lines,v_actor,null);
 v_entry_id:=(v_result->'data'->>'entry_id')::uuid;
 update public.restaurant_pay_periods set journal_entry_id=coalesce(journal_entry_id,v_entry_id)where id=p_pay_period_id;
 return v_result||jsonb_build_object('payment_status','not_paid');
end $$;

do $$declare r record;begin for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('set_restaurant_payroll_employment_terms','set_restaurant_payroll_statutory_configuration','create_restaurant_pay_period_v2','set_restaurant_payroll_time_input','approve_restaurant_payroll_time_input','calculate_restaurant_payroll_v2','approve_restaurant_payroll_v2','export_restaurant_payroll_payments','set_restaurant_payroll_gl_settings','post_restaurant_payroll_to_gl_v2','get_restaurant_payroll_records_v2')loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);execute format('grant execute on function %s to service_role',r.sig);end loop;end $$;

commit;
