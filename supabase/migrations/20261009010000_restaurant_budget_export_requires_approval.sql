-- A matrix can be complete as data while still being an unapproved draft.
-- Keep export certification fail-closed until the saved version has a
-- distinct approver. This forward migration does not rewrite prior exports.
begin;

create or replace function public.get_restaurant_budget_export_v3(
  p_lodge_id uuid,
  p_year integer,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_read jsonb;
  v_data jsonb;
  v_filters jsonb;
  v_matrix_complete boolean;
  v_approval_complete boolean := false;
  v_complete boolean;
  v_reasons jsonb;
  v_version_id uuid;
  v_version_status text := 'unversioned';
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.export');
  v_filters:=coalesce(p_filters,'{}'::jsonb)||jsonb_build_object('year',p_year);

  if not public.restaurant_accounting_is_active(p_lodge_id) then
    return jsonb_build_object('success',true,'data',jsonb_build_object(
      'status','not_active','complete',false,'export_kind','budget','filters',v_filters,
      'watermark','ACCOUNTING NOT ACTIVE','completeness_reasons',jsonb_build_array(
        jsonb_build_object('code','ACCOUNTING_NOT_ACTIVE','message','Accounting is not active for this lodge.'))));
  end if;

  v_read:=public.get_restaurant_budget_export_v2(p_lodge_id,p_year);
  v_data:=coalesce(v_read->'data',v_read,'{}'::jsonb);
  v_matrix_complete:=coalesce((v_data->>'complete_matrix')::boolean,false);

  if coalesce(v_data->>'version_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_version_id:=(v_data->>'version_id')::uuid;
    select b.status,
           coalesce(b.status='approved' and b.approved_by is not null and b.approved_by<>b.created_by,false)
      into v_version_status,v_approval_complete
      from public.restaurant_budget_versions b
     where b.id=v_version_id and b.lodge_id=p_lodge_id and b.period_year=p_year;
    if not found then
      v_version_status:='missing';
      v_approval_complete:=false;
    end if;
  end if;

  v_complete:=v_matrix_complete and v_approval_complete;
  v_reasons:=(case when v_matrix_complete then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('code','BUDGET_MATRIX_INCOMPLETE','message','Complete the full active-account by 12-month budget matrix before exporting.')) end)
    ||(case when v_approval_complete then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('code','BUDGET_VERSION_APPROVAL_REQUIRED','message','A different authorized checker must approve the saved budget version before it can be exported as complete.')) end);

  v_data:=v_data||jsonb_build_object(
    'matrix_complete',v_matrix_complete,
    'approval_complete',v_approval_complete,
    'approval_status',v_version_status,
    'complete_matrix',v_complete,
    'completeness_reasons',v_reasons);

  return public._restaurant_record_accounting_export_v3(
    p_lodge_id,'budget',v_filters,v_data,v_complete,
    case when v_complete then 'CERTIFIED' else 'DRAFT / BUDGET APPROVAL REQUIRED' end,
    'unknown','not_applicable');
end
$$;

revoke all on function public.get_restaurant_budget_export_v3(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.get_restaurant_budget_export_v3(uuid,integer,jsonb) to authenticated,service_role;

commit;
