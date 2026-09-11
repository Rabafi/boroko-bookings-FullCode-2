-- Forward-only repair for the commercial user-capacity remediation RPC.
-- public.users has no updated_at column; account status/PWA changes are
-- already captured by the governed operation and Command Central audit event.

create or replace function public.admin_apply_commercial_user_remediation(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_package_key text := lower(btrim(coalesce(p_payload->>'target_package_key', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_actor_id uuid := nullif(btrim(coalesce(p_payload->>'actor_id', '')), '')::uuid;
  v_actor_email text := nullif(btrim(coalesce(p_payload->>'actor_email', '')), '');
  v_fresh_auth_at timestamptz := nullif(btrim(coalesce(p_payload->>'fresh_auth_at', '')), '')::timestamptz;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_catalog public.commercial_catalog_versions%rowtype;
  v_package public.commercial_package_prices%rowtype;
  v_limit integer;
  v_active_count integer;
  v_valid_keep_count integer;
  v_admin_count integer;
  v_unsafe_count integer;
  v_claim jsonb;
  v_before jsonb;
  v_preview jsonb;
  v_result jsonb;
  v_suspended integer := 0;
  v_revoked_sessions integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'User remediation payload is required');
  end if;
  if v_operation_id is null or v_lodge_id is null or v_product <> 'lodge-camp' or v_package_key = '' then
    return jsonb_build_object('success', false, 'error', 'A valid operation, Lodge property, and target package are required');
  end if;
  if v_reason is null or length(v_reason) < 8 then
    return jsonb_build_object('success', false, 'error', 'A remediation reason of at least 8 characters is required');
  end if;
  if jsonb_typeof(coalesce(p_payload->'keep_user_ids', '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'keep_user_ids must be an array');
  end if;

  perform public._command_central_require_fresh_master_admin(v_actor_id, v_actor_email, v_fresh_auth_at);
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into v_keep_ids
    from jsonb_array_elements_text(coalesce(p_payload->'keep_user_ids', '[]'::jsonb));
  if cardinality(v_keep_ids) <> cardinality(array(select distinct unnest(v_keep_ids))) then
    return jsonb_build_object('success', false, 'error', 'Each retained user may be selected only once');
  end if;

  select *
    into v_catalog
    from public.commercial_catalog_versions
   where is_active = true
   order by effective_at desc, created_at desc
   limit 1;
  select *
    into v_package
    from public.commercial_package_prices
   where catalog_version_id = v_catalog.id
     and product_id = v_product
     and commercial_package_key = v_package_key;
  if not found then
    return jsonb_build_object('success', false, 'error', 'The target package is not in the active Lodge catalogue');
  end if;

  v_limit := nullif(public._commercial_target_limits(v_lodge_id, v_product, v_package.internal_plan)->>'users', '')::integer;
  if v_limit is null then
    return jsonb_build_object('success', false, 'error', 'The target package does not require user-capacity remediation');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('commercial-user-remediation:' || v_lodge_id::text, 0));
  perform 1 from public.users where lodge_id = v_lodge_id for update;
  select count(*)
    into v_active_count
    from public.users
   where lodge_id = v_lodge_id
     and lower(coalesce(status, 'active')) = 'active';
  if v_active_count <= v_limit then
    return jsonb_build_object('success', true, 'status', 'already_within_limit', 'active_users', v_active_count, 'limit', v_limit);
  end if;
  if cardinality(v_keep_ids) <> v_limit then
    return jsonb_build_object('success', false, 'error', format('Select exactly %s active account(s) to retain', v_limit));
  end if;

  select count(*)
    into v_valid_keep_count
    from public.users
   where lodge_id = v_lodge_id
     and id = any(v_keep_ids)
     and lower(coalesce(status, 'active')) = 'active';
  if v_valid_keep_count <> cardinality(v_keep_ids) then
    return jsonb_build_object('success', false, 'error', 'Every retained account must be an active user of this property');
  end if;

  if lower(coalesce(v_package.internal_plan, '')) in ('starter', 'basic') then
    select count(*) filter (where lower(coalesce(role, '')) = 'admin'),
           count(*) filter (
             where lower(coalesce(role, '')) not in ('admin', 'receptionist', 'operations')
                or coalesce(capability_overrides, '{}'::jsonb) <> '{}'::jsonb
                or cardinality(coalesce(allowed_outlet_ids, '{}'::uuid[])) > 0
           )
      into v_admin_count, v_unsafe_count
      from public.users
     where lodge_id = v_lodge_id
       and id = any(v_keep_ids);
    if v_admin_count <> 1 then
      return jsonb_build_object('success', false, 'error', 'Starter requires exactly one retained Admin owner account');
    end if;
    if v_unsafe_count > 0 then
      return jsonb_build_object('success', false, 'error', 'Retained Starter accounts must use the Admin, Receptionist, or Operations templates without custom permission or outlet exceptions');
    end if;
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('id', id, 'role', role, 'status', status, 'pwa_enabled', pwa_enabled) order by id),
           '[]'::jsonb
         )
    into v_before
    from public.users
   where lodge_id = v_lodge_id
     and lower(coalesce(status, 'active')) = 'active';

  v_claim := public.command_central_claim_operation(
    v_operation_id,
    'commercial_subscription.user_remediation',
    v_lodge_id,
    v_product,
    md5(p_payload::text),
    v_reason,
    v_actor_id,
    v_actor_email
  );
  if coalesce((v_claim->>'ok')::boolean, false) = false then
    return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim user remediation operation'));
  end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then
    return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous remediation has no result'));
  end if;

  update public.users
     set status = 'suspended',
         pwa_enabled = false,
         pwa_disabled_reason = 'Suspended during approved package-capacity remediation'
   where lodge_id = v_lodge_id
     and lower(coalesce(status, 'active')) = 'active'
     and not (id = any(v_keep_ids));
  get diagnostics v_suspended = row_count;

  update public.app_sessions
     set revoked_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'commercial_user_remediation', true,
           'reason', v_reason
         )
   where lodge_id = v_lodge_id
     and user_id <> all(v_keep_ids)
     and revoked_at is null;
  get diagnostics v_revoked_sessions = row_count;

  v_preview := public.get_commercial_transition_preview(v_lodge_id, v_product, v_package_key, current_date);
  v_result := jsonb_build_object(
    'success', true,
    'status', 'remediated',
    'suspended_users', v_suspended,
    'revoked_sessions', v_revoked_sessions,
    'retained_user_ids', to_jsonb(v_keep_ids),
    'transition_preview', v_preview,
    'data_deleted', false
  );
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(
    operation_id,
    event_type,
    target_lodge_id,
    product_id,
    actor_id,
    actor_email,
    reason,
    before_state,
    after_state
  )
  values (
    v_operation_id,
    'commercial_subscription_user_remediated',
    v_lodge_id,
    v_product,
    v_actor_id,
    lower(v_actor_email),
    v_reason,
    jsonb_build_object('users', v_before),
    v_result
  );
  return v_result;
exception when invalid_text_representation or datetime_field_overflow then
  v_result := jsonb_build_object('success', false, 'error', 'One of the remediation identifiers or dates is invalid');
  if v_operation_id is not null then
    perform public.command_central_fail_operation(v_operation_id, v_result);
  end if;
  return v_result;
when others then
  v_result := jsonb_build_object(
    'success', false,
    'error', case when sqlstate = '42501' then sqlerrm else 'Commercial user remediation failed' end
  );
  if v_operation_id is not null then
    perform public.command_central_fail_operation(v_operation_id, v_result);
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_apply_commercial_user_remediation(jsonb) from public, anon, authenticated;
grant execute on function public.admin_apply_commercial_user_remediation(jsonb) to service_role;
