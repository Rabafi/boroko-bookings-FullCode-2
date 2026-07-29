-- Governed reversible company lifecycle for Command Central.
-- Archive/restore are deliberate, idempotent control-plane operations. This
-- migration intentionally does not implement irreversible deletion/anonymizing.

create or replace function public.admin_apply_company_lifecycle(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_action text := lower(btrim(coalesce(p_payload->>'action', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_claim jsonb;
  v_settings public.settings%rowtype;
  v_before jsonb;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'Company lifecycle payload is required');
  end if;
  if v_operation_id is null or v_lodge_id is null or v_action not in ('archive', 'restore') then
    return jsonb_build_object('success', false, 'error', 'A valid operation, company, and lifecycle action are required');
  end if;
  if v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'error', 'A lifecycle reason of at least 8 characters is required');
  end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'company_lifecycle.' || v_action, v_lodge_id, null, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim company lifecycle operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;

  select * into v_settings from public.settings where lodge_id = v_lodge_id for update;
  if not found then
    v_result := jsonb_build_object('success', false, 'error', 'Company settings were not found');
    perform public.command_central_fail_operation(v_operation_id, v_result);
    return v_result;
  end if;
  v_before := jsonb_build_object('deleted', coalesce(v_settings.deleted, false), 'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name, ''));
  if v_action = 'archive' and coalesce(v_settings.deleted, false) then
    v_result := jsonb_build_object('success', false, 'error', 'Company is already archived'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  if v_action = 'restore' and not coalesce(v_settings.deleted, false) then
    v_result := jsonb_build_object('success', false, 'error', 'Company is already active'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;

  update public.settings set deleted = (v_action = 'archive'), updated_at = now() where lodge_id = v_lodge_id;
  insert into public.company_lifecycle_requests(lodge_id, action, status, reason, impact_preview, requested_by, approved_by, operation_id, approved_at, completed_at)
  values (v_lodge_id, v_action, 'completed', v_reason, v_before, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_id', '')::uuid, v_operation_id, now(), now());
  v_result := jsonb_build_object('success', true, 'lodge_id', v_lodge_id, 'action', v_action, 'deleted', v_action = 'archive');
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'company_' || v_action || 'd', v_lodge_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, v_before, v_result);
  return v_result;
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'error', 'One of the lifecycle identifiers is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', 'Company lifecycle operation failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_apply_company_lifecycle(jsonb) from public, anon, authenticated;
grant execute on function public.admin_apply_company_lifecycle(jsonb) to service_role;

notify pgrst, 'reload schema';
