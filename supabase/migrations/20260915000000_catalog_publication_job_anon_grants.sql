-- Fix: desktop/POS clients connect with the anon key (the custom session is
-- validated server-side inside each RPC), so the authenticated-only grants on
-- the catalog publication job functions break every Till publication sweep
-- with "permission denied for function claim_catalog_publication_job".
-- Pending publications pile up, new/edited products never reach outlet
-- snapshots, and the Till fails them at Pay with catalog_refresh_required.
-- Security posture is unchanged: all three functions are SECURITY DEFINER
-- with server-side app_require_lodge_role + app_require_pos_outlet_access
-- checks (see 20260909010000), matching the established
-- anon,authenticated,service_role grant pattern used by save_bar_product_with_stock
-- and both publish_pos_catalog_snapshot overloads. Grant-only file: no body,
-- signature, or RLS changes.
begin;

revoke all on function public.claim_catalog_publication_job(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_catalog_publication_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_catalog_publication_job(uuid, uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.claim_catalog_publication_job(uuid, uuid, integer) to anon, authenticated, service_role;
grant execute on function public.complete_catalog_publication_job(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.fail_catalog_publication_job(uuid, uuid, text, boolean) to anon, authenticated, service_role;

commit;
