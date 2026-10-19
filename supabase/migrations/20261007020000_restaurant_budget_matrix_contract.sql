-- ACC-04: restore a typed, range-checked budget matrix and template response.
-- Keep the existing maker/checker save/approval RPCs and their privileges.
begin;

create or replace function public.get_restaurant_budget_matrix_v2(p_lodge_id uuid,p_year integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_version public.restaurant_budget_versions%rowtype;
  v_rows jsonb;
  v_templates jsonb;
  v_expected integer;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Budget year must be between 2000 and 2100' using errcode='22023';
  end if;

  select count(*) into v_expected
    from public.restaurant_accounts a
   where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense');

  select * into v_version
    from public.restaurant_budget_versions
   where lodge_id=p_lodge_id and period_year=p_year
   order by case status when 'approved' then 0 when 'submitted' then 1 else 2 end,created_at desc
   limit 1;

  if v_version.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,
      'version_id',v_version.id,'version_status',v_version.status,
      'months',coalesce((select jsonb_object_agg(l.period_month,l.amount)
        from public.restaurant_budget_version_lines l
        where l.version_id=v_version.id and l.account_id=a.id),'{}'::jsonb)
    ) order by a.code,a.id),'[]'::jsonb)
      into v_rows
      from public.restaurant_accounts a
     where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense');
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,
      'months',coalesce((select jsonb_object_agg(b.period_month,b.budget_amount)
        from public.restaurant_budgets b
        where b.lodge_id=p_lodge_id and b.account_id=a.id and b.period_year=p_year),'{}'::jsonb)
    ) order by a.code,a.id),'[]'::jsonb)
      into v_rows
      from public.restaurant_accounts a
     where a.lodge_id=p_lodge_id and a.is_active and a.account_type in('revenue','expense');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'name',t.name,'description',t.description,
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'account_id',l.account_id,'account_name',l.account_name,'monthly_amount',l.monthly_amount
    ) order by l.account_name,l.id)
      from public.restaurant_budget_template_lines l
     where l.template_id=t.id),'[]'::jsonb)
  ) order by t.name,t.id),'[]'::jsonb)
    into v_templates
    from public.restaurant_budget_templates t
   where t.lodge_id=p_lodge_id and t.is_active;

  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'matrix',coalesce(v_rows,'[]'::jsonb),
    'templates',coalesce(v_templates,'[]'::jsonb),
    'version_id',v_version.id,
    'version_status',v_version.status,
    'complete',jsonb_array_length(coalesce(v_rows,'[]'::jsonb))=v_expected
  ));
end
$$;

revoke all on function public.get_restaurant_budget_matrix_v2(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_restaurant_budget_matrix_v2(uuid,integer) to authenticated,service_role;

commit;