-- 2026-08-18 — Restore anon EXECUTE for Bar POS functions the desktop calls.
--
-- The desktop application-session client runs as the anon role (anon key plus
-- the x-boroko-session header), so PostgREST executes its RPCs as `anon`.
-- The 20260814010000 hardening migration revoked anon from the tab write RPCs
-- and never granted the hardened tab read wrapper or owner digest, breaking
-- open-tab financial truth refresh, tab saves/transfers/merges/splits, and the
-- owner digest dashboard for the desktop (42501 "permission denied for
-- function"). Each function remains SECURITY DEFINER and enforces the app
-- session, lodge, role, and outlet checks server-side; granting EXECUTE to anon
-- restores the client contract without granting any table access.

begin;

-- Open-tab financial truth read. The wrapper enforces
-- app_require_pos_outlet_access (session, lodge, role, outlet) before
-- delegating to the unscoped implementation.
revoke all on function public.get_restaurant_pos_tabs_financial_truth(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_pos_tabs_financial_truth(uuid, uuid, text)
  to anon, authenticated, service_role;

-- Open-tab save/transfer/merge/split upsert. The body still validates the app
-- session, lodge, and outlet before writing.
revoke all on function public.upsert_pos_tab(jsonb) from public, anon;
grant execute on function public.upsert_pos_tab(jsonb) to anon, authenticated, service_role;

-- Tab status close/transfer. The wrapper enforces the lodge role and outlet
-- access and appends a before/after audit event in the same transaction.
revoke all on function public.update_pos_tab_status(uuid, text, text) from public, anon;
grant execute on function public.update_pos_tab_status(uuid, text, text)
  to anon, authenticated, service_role;

-- Owner digest dashboard read. The body enforces operational report access
-- through _restaurant_require_operational_report_access.
revoke all on function public.generate_owner_digest(uuid) from public, anon;
grant execute on function public.generate_owner_digest(uuid)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;