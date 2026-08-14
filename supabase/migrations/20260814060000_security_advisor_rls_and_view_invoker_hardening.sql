-- Security-advisor hardening for the linked public schema.
--
-- These objects are internal sequence/audit/payroll/catalog tables or
-- lodge-scoped compatibility views. They must not be directly enumerable by
-- anon/authenticated clients. Authoritative RPCs remain the supported access
-- path and run as their controlled owner/service role.

-- Compatibility views must evaluate base-table RLS as the querying role. The
-- views keep their existing grants for authenticated application callers, but
-- cannot bypass lodge isolation or expose rows to anonymous callers.
alter view if exists public.users_safe
  set (security_invoker = true, security_barrier = true);
alter view if exists public.emergency_list
  set (security_invoker = true, security_barrier = true);
alter view if exists public.pos_outlets
  set (security_invoker = true, security_barrier = true);
alter view if exists public.menu_items
  set (security_invoker = true, security_barrier = true);
alter view if exists public.maintenance
  set (security_invoker = true, security_barrier = true);

-- Internal tables have no safe direct client contract. RLS is enabled with no
-- client policies; SECURITY DEFINER RPCs owned by postgres/service_role remain
-- able to read/write them. Explicitly revoke the default Supabase table grants
-- so PostgREST cannot expose them if a future policy or view is added by
-- mistake. Service-role access is retained for controlled operational jobs.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'notification_rules',
    'notification_events',
    'admin_manual_cleanup_backups',
    'customer_credit_receipt_sequences',
    'commercial_catalog_versions',
    'commercial_package_prices',
    'commercial_addon_prices',
    'commercial_package_entitlements',
    'pos_daily_order_sequences',
    'restaurant_payroll_expected_workers'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from anon, authenticated', v_table);
      execute format('grant all on table public.%I to service_role', v_table);
    end if;
  end loop;
end;
$$;
