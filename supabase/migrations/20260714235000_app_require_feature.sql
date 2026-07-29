-- ── Feature Entitlement Gate ────────────────────────────────────────────────
-- Server-side helper that combines lodge access, role check, and add-on
-- feature entitlement into a single guard for RPCs that belong to an
-- optional/paid feature module.
--
-- Usage in any SECURITY DEFINER RPC:
--   PERFORM public.app_require_feature(
--     p_lodge_id,
--     'staff_operations_workforce',        -- feature key in lodge_features
--     array['manager', 'admin', 'super_admin']
--   );

create or replace function public.app_is_service_role()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select current_setting('role', true) = 'service_role';
$$;

grant execute on function public.app_is_service_role() to authenticated;

create or replace function public.app_require_feature(
  p_lodge_id uuid,
  p_feature_key text,
  p_allowed_roles text[] default array['admin'::text]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text := lower(coalesce(public.app_current_role(), ''));
  v_entitlement jsonb;
  v_feature_enabled boolean;
begin
  -- 0. Service-role bypass (cron, webhooks, admin RPCs)
  if public.app_is_service_role() then
    return;
  end if;

  -- 1. Lodge access
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied for this lodge.'
      using errcode = '42501';
  end if;

  -- 2. Role check (skip when no roles required)
  if coalesce(array_length(p_allowed_roles, 1), 0) > 0
     and not (v_role = any(select lower(value) from unnest(p_allowed_roles) as value)) then
    raise exception 'This session is not allowed to perform that action.'
      using errcode = '42501';
  end if;

  -- 3. Feature entitlement (via the authoritative get_lodge_entitlement)
  v_entitlement := public.get_lodge_entitlement(p_lodge_id);
  v_feature_enabled := coalesce(
    (v_entitlement->'effective_features'->>p_feature_key)::boolean,
    false
  );
  if not v_feature_enabled then
    raise exception 'Feature "%" is not enabled for this lodge.', p_feature_key
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.app_require_feature(uuid, text, text[])
  from public, anon, authenticated;

-- ── Extend financial_audit_log action constraint for package workflows ────
-- The apply_venue_package_to_event RPC logs its idempotent application
-- through the canonical _claim_financial_operation / _record_financial_operation
-- pathway (financial_operation_idempotency table), so it no longer needs
-- 'apply_package' in the legacy audit-log constraint.
-- No ALTER needed -- we use the dedicated idempotency table instead.
