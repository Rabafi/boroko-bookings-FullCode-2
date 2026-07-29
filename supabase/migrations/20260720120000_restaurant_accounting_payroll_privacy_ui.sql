-- Payroll privacy projection and immutable payment-export evidence. Operator grants remain revoked.

begin;

alter table public.restaurant_pay_periods add column if not exists approved_at timestamptz;

create or replace function public._restaurant_block_payroll_export_mutation()
returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Payroll payment exports are immutable evidence' using errcode='55000';end $$;
drop trigger if exists restaurant_payroll_payment_exports_immutable on public.restaurant_payroll_payment_exports;
create trigger restaurant_payroll_payment_exports_immutable before update or delete on public.restaurant_payroll_payment_exports for each row execute function public._restaurant_block_payroll_export_mutation();

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
 update public.restaurant_pay_periods set status='approved',approved_by=v_actor,approved_at=now()where id=p_pay_period_id;
 perform public.log_restaurant_financial_action(p_lodge_id,'payroll.approved','restaurant_pay_periods',p_pay_period_id,to_jsonb(v_p),jsonb_build_object('approved_by',v_actor,'approved_at',now(),'snapshot_hash',v_hash),null);
 return jsonb_build_object('success',true);
end $$;

create or replace function public.get_restaurant_payroll_workspace_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.payroll_view');
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name)order by u.name)from public.users u where u.lodge_id=p_lodge_id and coalesce(u.status,'active')='active'),'[]'::jsonb),
  'periods',coalesce((select jsonb_agg(to_jsonb(p)order by p.end_date desc,p.created_at desc)from public.restaurant_pay_periods p where p.lodge_id=p_lodge_id),'[]'::jsonb),
  'configurations',coalesce((select jsonb_agg(to_jsonb(c)order by c.effective_from desc)from public.restaurant_payroll_statutory_configurations c where c.lodge_id=p_lodge_id),'[]'::jsonb),
  'terms',coalesce((select jsonb_agg(to_jsonb(e)-'bank_account_number'-'bank_branch_code'||jsonb_build_object('has_bank_details',nullif(e.bank_account_number,'')is not null)order by e.staff_user_id,e.effective_from desc)from public.restaurant_payroll_employment_terms e where e.lodge_id=p_lodge_id),'[]'::jsonb),
  'time_inputs',coalesce((select jsonb_agg(to_jsonb(t)order by t.entered_at desc)from public.restaurant_payroll_time_inputs t where t.lodge_id=p_lodge_id),'[]'::jsonb),
  'gl_settings',coalesce((select to_jsonb(g)from public.restaurant_payroll_gl_settings g where g.lodge_id=p_lodge_id),'null'::jsonb)
 ));
end $$;

revoke all on function public._restaurant_block_payroll_export_mutation()from public,anon,authenticated;
revoke all on function public.approve_restaurant_payroll_v2(uuid,uuid)from public,anon,authenticated;
revoke all on function public.get_restaurant_payroll_workspace_v2(uuid)from public,anon,authenticated;
grant execute on function public._restaurant_block_payroll_export_mutation()to service_role;
grant execute on function public.approve_restaurant_payroll_v2(uuid,uuid)to service_role;
grant execute on function public.get_restaurant_payroll_workspace_v2(uuid)to service_role;

commit;

