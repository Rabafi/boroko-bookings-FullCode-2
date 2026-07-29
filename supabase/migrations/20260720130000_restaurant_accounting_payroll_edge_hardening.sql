-- Payroll calculation and ledger edge-case hardening. Operator grants remain revoked.

begin;

create or replace function public._restaurant_payroll_tax(p_gross numeric,p_brackets jsonb)
returns numeric language plpgsql immutable set search_path=public as $$
declare v_b jsonb;v_tax numeric:=0;v_from numeric;v_to numeric;v_rate numeric;v_expected numeric:=0;v_seen int:=0;v_open boolean:=false;
begin
 if jsonb_typeof(p_brackets)<>'array'or jsonb_array_length(p_brackets)=0 then raise exception 'Tax brackets must be a non-empty array' using errcode='22023';end if;
 for v_b in select value from jsonb_array_elements(p_brackets)loop
  v_seen:=v_seen+1;v_from:=coalesce((v_b->>'from')::numeric,0);v_to:=nullif(v_b->>'to','')::numeric;v_rate:=coalesce((v_b->>'rate')::numeric,-1);
  if v_open or v_from<>v_expected or v_from<0 or v_rate<0 or v_rate>100 or(v_to is not null and v_to<=v_from)then raise exception 'Tax brackets must be ordered, contiguous, non-overlapping, and use rates from 0 to 100' using errcode='22023';end if;
  v_tax:=v_tax+greatest(0,least(p_gross,coalesce(v_to,p_gross))-v_from)*v_rate/100;
  if v_to is null then v_open:=true;else v_expected:=v_to;end if;
 end loop;
 if not v_open then raise exception 'Final tax bracket must be open-ended' using errcode='22023';end if;
 return round(v_tax,2);
end $$;

create or replace function public._restaurant_guard_payroll_record_mutation()
returns trigger language plpgsql set search_path=public as $$
declare v_period public.restaurant_pay_periods%rowtype;v_terms public.restaurant_payroll_employment_terms%rowtype;v_period_id uuid;
begin
 v_period_id:=case when tg_op='DELETE'then old.pay_period_id else new.pay_period_id end;
 select * into v_period from public.restaurant_pay_periods where id=v_period_id;
 if not found or v_period.status<>'draft'then raise exception 'Calculated payroll records are immutable after calculation begins' using errcode='55000';end if;
 if tg_op='INSERT'then
  select * into v_terms from public.restaurant_payroll_employment_terms where id=new.employment_terms_id;
  if v_terms.pay_type='salary'and(v_period.start_date<>date_trunc('month',v_period.start_date)::date or v_period.end_date<>(date_trunc('month',v_period.start_date)+interval '1 month-1 day')::date)then raise exception 'Monthly salary payroll requires a complete calendar-month pay period' using errcode='23514';end if;
 end if;
 return case when tg_op='DELETE'then old else new end;
end $$;
drop trigger if exists restaurant_employee_pay_records_immutable on public.restaurant_employee_pay_records;
create trigger restaurant_employee_pay_records_immutable before insert or update or delete on public.restaurant_employee_pay_records for each row execute function public._restaurant_guard_payroll_record_mutation();

create or replace function public.set_restaurant_payroll_gl_settings(p_lodge_id uuid,p_payroll_expense_account_id uuid,p_net_payable_account_id uuid,p_tax_payable_account_id uuid,p_deductions_payable_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.payroll_manage');
 if not exists(select 1 from public.restaurant_accounts where id=p_payroll_expense_account_id and lodge_id=p_lodge_id and is_active and account_type='expense')then raise exception 'Payroll expense account must be an active lodge expense' using errcode='23503';end if;
 if exists(select 1 from unnest(array[p_net_payable_account_id,p_tax_payable_account_id,p_deductions_payable_account_id])x where not exists(select 1 from public.restaurant_accounts a where a.id=x and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability'))then raise exception 'Every payroll payable account must be an active lodge liability' using errcode='23503';end if;
 insert into public.restaurant_payroll_gl_settings(lodge_id,payroll_expense_account_id,net_payable_account_id,tax_payable_account_id,deductions_payable_account_id,updated_by,updated_at)values(p_lodge_id,p_payroll_expense_account_id,p_net_payable_account_id,p_tax_payable_account_id,p_deductions_payable_account_id,v_actor,now())
 on conflict(lodge_id)do update set payroll_expense_account_id=excluded.payroll_expense_account_id,net_payable_account_id=excluded.net_payable_account_id,tax_payable_account_id=excluded.tax_payable_account_id,deductions_payable_account_id=excluded.deductions_payable_account_id,updated_by=excluded.updated_by,updated_at=now()returning lodge_id into v_id;
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
 select encode(digest(string_agg(calculation_snapshot_hash,','order by staff_user_id),'sha256'),'hex'),round(sum(gross_pay),2),round(sum(paye_tax),2),round(sum(total_deductions-paye_tax),2),round(sum(net_pay),2)into v_hash,v_gross,v_tax,v_other,v_net from public.restaurant_employee_pay_records where pay_period_id=p_pay_period_id and lodge_id=p_lodge_id;
 if v_hash is null or v_hash is distinct from v_p.calculation_snapshot_hash then raise exception 'Payroll snapshot changed before ledger posting' using errcode='23514';end if;
 if round(v_gross,2)<>round(v_tax+v_other+v_net,2)then raise exception 'Payroll control totals do not balance' using errcode='23514';end if;
 v_lines:=jsonb_build_array(jsonb_build_object('account_id',v_s.payroll_expense_account_id,'debit',v_gross,'credit',0,'memo','Gross payroll expense'),jsonb_build_object('account_id',v_s.net_payable_account_id,'debit',0,'credit',v_net,'memo','Net payroll payable'));
 if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_s.tax_payable_account_id,'debit',0,'credit',v_tax,'memo','Payroll tax payable'));end if;
 if v_other>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_s.deductions_payable_account_id,'debit',0,'credit',v_other,'memo','Other payroll deductions payable'));end if;
 v_result:=public._restaurant_post_journal(p_lodge_id,v_p.end_date,'Payroll '||v_p.name,'payroll',p_pay_period_id,v_p.name,'payroll:'||p_pay_period_id,v_lines,v_actor,null);
 v_entry_id:=(v_result->'data'->>'entry_id')::uuid;
 update public.restaurant_pay_periods set journal_entry_id=coalesce(journal_entry_id,v_entry_id)where id=p_pay_period_id;
 return v_result||jsonb_build_object('payment_status','not_paid');
end $$;

revoke all on function public._restaurant_payroll_tax(numeric,jsonb)from public,anon,authenticated;
revoke all on function public._restaurant_guard_payroll_record_mutation()from public,anon,authenticated;
revoke all on function public.set_restaurant_payroll_gl_settings(uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated;
revoke all on function public.post_restaurant_payroll_to_gl_v2(uuid,uuid)from public,anon,authenticated;
grant execute on function public._restaurant_payroll_tax(numeric,jsonb)to service_role;
grant execute on function public._restaurant_guard_payroll_record_mutation()to service_role;
grant execute on function public.set_restaurant_payroll_gl_settings(uuid,uuid,uuid,uuid,uuid)to service_role;
grant execute on function public.post_restaurant_payroll_to_gl_v2(uuid,uuid)to service_role;

commit;

