-- Financial truth gate 9/9 continuation: retain the actual artifact path and
-- require a hash-linked detailed companion for summary PDFs.  This is a
-- forward migration because 20260807480000 may already exist in a target.

begin;

alter table public.restaurant_accounting_export_runs
  add column if not exists artifact_file_path text,
  add column if not exists detailed_companion_path text;

create or replace function public.record_accounting_export_artifact_v3(
  p_lodge_id uuid,
  p_export_id uuid,
  p_artifact_type text,
  p_file_hash text,
  p_byte_count bigint,
  p_artifact_file_path text default null,
  p_detailed_companion_path text default null,
  p_detailed_companion_hash text default null,
  p_artifact_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text;
  v_actor uuid := public.app_get_actor_user_id();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accounting artifact recording is service-role-only during no-ship' using errcode='42501';
  end if;
  if p_artifact_type not in ('json','csv','xlsx','pdf') then
    raise exception 'Unsupported Accounting artifact type' using errcode='22023';
  end if;
  v_status := case
    when nullif(p_artifact_error,'') is null
      and coalesce(p_byte_count,0) > 0
      and p_file_hash ~ '^[0-9a-fA-F]{64}$'
      and (p_artifact_type <> 'pdf' or (
        nullif(p_detailed_companion_path,'') is not null
        and p_detailed_companion_hash ~ '^[0-9a-fA-F]{64}$'
      ))
    then 'complete'
    else 'failed'
  end;
  update public.restaurant_accounting_export_runs
  set artifact_status=v_status,
      artifact_file_path=case when v_status='complete' then p_artifact_file_path else artifact_file_path end,
      file_hash=case when v_status='complete' then lower(p_file_hash) else null end,
      detailed_companion_path=case when v_status='complete' then p_detailed_companion_path else detailed_companion_path end,
      detailed_companion_hash=case when v_status='complete' then lower(p_detailed_companion_hash) else detailed_companion_hash end,
      artifact_error=case when v_status='failed' then coalesce(nullif(p_artifact_error,''),'Artifact output was not written and verified') else null end
  where id=p_export_id and lodge_id=p_lodge_id;
  if not found then
    raise exception 'Accounting export run not found' using errcode='P0002';
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'export_id',p_export_id,
    'artifact_status',v_status,
    'file_hash',case when v_status='complete' then lower(p_file_hash) else null end,
    'detailed_companion_path',case when v_status='complete' then p_detailed_companion_path else null end,
    'detailed_companion_hash',case when v_status='complete' then lower(p_detailed_companion_hash) else null end,
    'recorded_by',v_actor
  ));
end
$$;

revoke all on function public.record_accounting_export_artifact_v3(uuid,uuid,text,text,bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_accounting_export_artifact_v3(uuid,uuid,text,text,bigint,text,text,text,text) to service_role;

commit;
