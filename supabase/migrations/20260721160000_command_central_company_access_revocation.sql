-- Complete reversible lifecycle enforcement.
-- Archive is a security boundary: revoke active sessions, disable user/PWA
-- access, suspend active licences and invalidate offline leases. Restore uses
-- snapshots captured in the same transaction so it does not guess prior state.

create table if not exists public.command_central_lifecycle_user_snapshots (
  lodge_id uuid not null,
  user_id uuid primary key,
  status text,
  pwa_enabled boolean,
  pwa_disabled_reason text,
  captured_at timestamptz not null default now()
);

create table if not exists public.command_central_lifecycle_license_snapshots (
  lodge_id uuid not null,
  license_id uuid primary key,
  is_active boolean,
  payment_status text,
  subscription_state text,
  offline_lease_days integer,
  captured_at timestamptz not null default now()
);

alter table public.command_central_lifecycle_user_snapshots enable row level security;
alter table public.command_central_lifecycle_license_snapshots enable row level security;
revoke all on public.command_central_lifecycle_user_snapshots, public.command_central_lifecycle_license_snapshots from public, anon, authenticated;

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
  v_user_count integer := 0;
  v_license_count integer := 0;
  v_session_count integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'Company lifecycle payload is required'); end if;
  if v_operation_id is null or v_lodge_id is null or v_action not in ('archive', 'restore') then return jsonb_build_object('success', false, 'error', 'A valid operation, company, and lifecycle action are required'); end if;
  if v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'A lifecycle reason of at least 8 characters is required'); end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'company_lifecycle.' || v_action, v_lodge_id, null, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim company lifecycle operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;

  select * into v_settings from public.settings where lodge_id = v_lodge_id for update;
  if not found then
    v_result := jsonb_build_object('success', false, 'error', 'Company settings were not found');
    perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  v_before := jsonb_build_object('deleted', coalesce(v_settings.deleted, false), 'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name, ''));
  if v_action = 'archive' and coalesce(v_settings.deleted, false) then
    v_result := jsonb_build_object('success', false, 'error', 'Company is already archived'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;
  if v_action = 'restore' and not coalesce(v_settings.deleted, false) then
    v_result := jsonb_build_object('success', false, 'error', 'Company is already active'); perform public.command_central_fail_operation(v_operation_id, v_result); return v_result;
  end if;

  if v_action = 'archive' then
    insert into public.command_central_lifecycle_user_snapshots(lodge_id, user_id, status, pwa_enabled, pwa_disabled_reason)
    select lodge_id, id, status, pwa_enabled, pwa_disabled_reason from public.users
    where lodge_id = v_lodge_id
    on conflict (user_id) do update set lodge_id = excluded.lodge_id, status = excluded.status, pwa_enabled = excluded.pwa_enabled, pwa_disabled_reason = excluded.pwa_disabled_reason, captured_at = now();
    get diagnostics v_user_count = row_count;

    insert into public.command_central_lifecycle_license_snapshots(lodge_id, license_id, is_active, payment_status, subscription_state, offline_lease_days)
    select lodge_id, id, is_active, payment_status, subscription_state, offline_lease_days from public.licenses
    where lodge_id = v_lodge_id and (coalesce(is_active, true) = true or lower(coalesce(subscription_state, payment_status, '')) in ('active', 'trial', 'free', 'grace_period', 'overdue'))
    on conflict (license_id) do update set lodge_id = excluded.lodge_id, is_active = excluded.is_active, payment_status = excluded.payment_status, subscription_state = excluded.subscription_state, offline_lease_days = excluded.offline_lease_days, captured_at = now();
    get diagnostics v_license_count = row_count;

    update public.app_sessions set revoked_at = now(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('revoked_by_company_lifecycle', true, 'revoked_reason', v_reason)
    where lodge_id = v_lodge_id and revoked_at is null;
    get diagnostics v_session_count = row_count;
    update public.users set status = 'inactive', pwa_enabled = false, pwa_disabled_reason = 'Company archived by Command Central.' where lodge_id = v_lodge_id;
    update public.licenses set is_active = false, payment_status = 'suspended', subscription_state = 'suspended', offline_lease_days = 0 where lodge_id = v_lodge_id;
    update public.settings set deleted = true, updated_at = now() where lodge_id = v_lodge_id;
  else
    update public.users u set status = coalesce(s.status, 'active'), pwa_enabled = coalesce(s.pwa_enabled, false), pwa_disabled_reason = s.pwa_disabled_reason
    from public.command_central_lifecycle_user_snapshots s where s.user_id = u.id and s.lodge_id = v_lodge_id;
    update public.licenses l set is_active = s.is_active, payment_status = s.payment_status, subscription_state = s.subscription_state, offline_lease_days = s.offline_lease_days
    from public.command_central_lifecycle_license_snapshots s where s.license_id = l.id and s.lodge_id = v_lodge_id;
    delete from public.command_central_lifecycle_user_snapshots where lodge_id = v_lodge_id;
    delete from public.command_central_lifecycle_license_snapshots where lodge_id = v_lodge_id;
    update public.settings set deleted = false, updated_at = now() where lodge_id = v_lodge_id;
  end if;

  insert into public.company_lifecycle_requests(lodge_id, action, status, reason, impact_preview, requested_by, approved_by, operation_id, approved_at, completed_at)
  values (v_lodge_id, v_action, 'completed', v_reason, v_before, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_id', '')::uuid, v_operation_id, now(), now());
  v_result := jsonb_build_object('success', true, 'lodge_id', v_lodge_id, 'action', v_action, 'deleted', v_action = 'archive', 'users_affected', v_user_count, 'licenses_affected', v_license_count, 'sessions_revoked', v_session_count, 'offline_access', case when v_action = 'archive' then 'revoked' else 'restored_from_snapshot' end);
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'company_' || v_action || 'd', v_lodge_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, v_before, v_result);
  return v_result;
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'error', 'One of the lifecycle identifiers is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if; return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', 'Company lifecycle operation failed');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if; return v_result;
end;
$$;

revoke all on function public.admin_apply_company_lifecycle(jsonb) from public, anon, authenticated;
grant execute on function public.admin_apply_company_lifecycle(jsonb) to service_role;
notify pgrst, 'reload schema';
