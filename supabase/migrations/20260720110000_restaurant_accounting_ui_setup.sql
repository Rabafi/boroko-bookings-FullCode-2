-- Accounting presentation/setup helpers required by restored operator pages. Grants remain service-role only.

begin;

create or replace function public.set_restaurant_account_cash_flow_classification(p_lodge_id uuid,p_account_id uuid,p_classification text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_before public.restaurant_accounts%rowtype;v_after public.restaurant_accounts%rowtype;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if p_classification not in('cash','operating','investing','financing')then raise exception 'Invalid cash-flow classification' using errcode='22023';end if;
 select * into v_before from public.restaurant_accounts where id=p_account_id and lodge_id=p_lodge_id and is_active for update;
 if not found then raise exception 'Active lodge account not found' using errcode='23503';end if;
 if p_classification='cash' and v_before.account_type<>'asset'then raise exception 'Only asset accounts can be classified as cash' using errcode='22023';end if;
 update public.restaurant_accounts set cash_flow_classification=p_classification,updated_at=now()where id=p_account_id returning * into v_after;
 perform public.log_restaurant_financial_action(p_lodge_id,'account.cash_flow_classified','restaurant_accounts',p_account_id,to_jsonb(v_before),to_jsonb(v_after),null);
 return jsonb_build_object('success',true,'data',to_jsonb(v_after));
end $$;

create or replace function public.get_restaurant_budget_workspace_v2(p_lodge_id uuid,p_year integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 if p_year not between 2000 and 2100 then raise exception 'Valid budget year required' using errcode='22023';end if;
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'matrix',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'months',coalesce((select jsonb_object_agg(b.period_month,b.budget_amount)from public.restaurant_budgets b where b.lodge_id=p_lodge_id and b.account_id=a.id and b.period_year=p_year),'{}'::jsonb))order by a.code)from public.restaurant_accounts a where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense')),'[]'::jsonb),
  'templates',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('account_id',l.account_id,'account_name',l.account_name,'default_amount',l.monthly_amount)order by l.account_name)from public.restaurant_budget_template_lines l where l.template_id=t.id),'[]'::jsonb))order by t.name)from public.restaurant_budget_templates t where t.lodge_id=p_lodge_id),'[]'::jsonb)
 ));
end $$;

revoke all on function public.set_restaurant_account_cash_flow_classification(uuid,uuid,text)from public,anon,authenticated;
revoke all on function public.get_restaurant_budget_workspace_v2(uuid,integer)from public,anon,authenticated;
grant execute on function public.set_restaurant_account_cash_flow_classification(uuid,uuid,text)to service_role;
grant execute on function public.get_restaurant_budget_workspace_v2(uuid,integer)to service_role;

commit;

