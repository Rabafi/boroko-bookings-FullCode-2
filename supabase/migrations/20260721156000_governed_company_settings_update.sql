-- Governed Command Central company settings edits. Local-only until deployed.
create or replace function public.admin_update_company_settings(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_expected timestamptz := nullif(btrim(coalesce(p_payload->>'expected_updated_at', '')), '')::timestamptz;
  v_claim jsonb;
  v_settings public.settings%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_audit_id uuid;
begin
  if v_operation_id is null or v_lodge_id is null or v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Company, operation ID, and a reason of at least 8 characters are required');
  end if;
  if jsonb_typeof(coalesce(p_payload->'updates', '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Company settings updates must be an object');
  end if;
  if (select count(*) from jsonb_object_keys(coalesce(p_payload->'updates', '{}'::jsonb)) key where key not in ('company_name', 'lodge_name', 'business_type', 'city', 'country', 'email', 'phone', 'setup_complete')) > 0 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Unsupported company settings field');
  end if;
  if p_payload->'updates' = '{}'::jsonb then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'At least one company setting is required');
  end if;

  v_claim := public.command_central_claim_operation(v_operation_id, 'company_settings.update', v_lodge_id, null, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'code', 'DUPLICATE_OPERATION', 'error', coalesce(v_claim->>'error', 'Could not claim company settings operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;

  select * into v_settings from public.settings where lodge_id = v_lodge_id for update;
  if not found then
    v_result := jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Company settings were not found');
    perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  if v_expected is not null and v_settings.updated_at is distinct from v_expected then
    v_result := jsonb_build_object('success', false, 'code', 'STALE_VERSION', 'error', 'Company settings changed; reload before retrying');
    perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  v_before := jsonb_build_object('company_name', v_settings.company_name, 'lodge_name', v_settings.lodge_name, 'business_type', v_settings.business_type, 'city', v_settings.city, 'country', v_settings.country, 'email', v_settings.email, 'phone', v_settings.phone, 'setup_complete', v_settings.setup_complete);

  update public.settings set
    company_name = case when p_payload->'updates' ? 'company_name' then nullif(p_payload->'updates'->>'company_name', '') else company_name end,
    lodge_name = case when p_payload->'updates' ? 'lodge_name' then nullif(p_payload->'updates'->>'lodge_name', '') else lodge_name end,
    business_type = case when p_payload->'updates' ? 'business_type' then nullif(p_payload->'updates'->>'business_type', '') else business_type end,
    city = case when p_payload->'updates' ? 'city' then nullif(p_payload->'updates'->>'city', '') else city end,
    country = case when p_payload->'updates' ? 'country' then nullif(p_payload->'updates'->>'country', '') else country end,
    email = case when p_payload->'updates' ? 'email' then nullif(p_payload->'updates'->>'email', '') else email end,
    phone = case when p_payload->'updates' ? 'phone' then nullif(p_payload->'updates'->>'phone', '') else phone end,
    setup_complete = case when p_payload->'updates' ? 'setup_complete' then (p_payload->'updates'->>'setup_complete')::boolean else setup_complete end,
    updated_at = now()
  where lodge_id = v_lodge_id;

  select jsonb_build_object('company_name', company_name, 'lodge_name', lodge_name, 'business_type', business_type, 'city', city, 'country', country, 'email', email, 'phone', phone, 'setup_complete', setup_complete) into v_after from public.settings where lodge_id = v_lodge_id;
  v_result := jsonb_build_object('success', true, 'operation_id', v_operation_id, 'lodge_id', v_lodge_id, 'before', v_before, 'after', v_after);
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'company_settings.updated', v_lodge_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, v_before, v_after)
  returning id into v_audit_id;
  return v_result || jsonb_build_object('audit_event_id', v_audit_id);
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A company settings value is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'code', 'MUTATION_FAILED', 'error', 'Company settings operation failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_update_company_settings(jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_company_settings(jsonb) to service_role;
notify pgrst, 'reload schema';
