-- The desktop uses the established application-session context while its
-- PostgREST client runs as anon. The certified POS report remains a
-- SECURITY DEFINER function that enforces the current app actor, lodge,
-- report capability, and outlet scope before delegating to the unscoped
-- implementation. Granting execution to anon restores that client contract;
-- it does not grant any table access or bypass the server checks.

begin;

revoke all on function public.get_pos_financial_report_export_v2(uuid, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.get_pos_financial_report_export_v2(uuid, date, date, uuid)
  to anon, authenticated, service_role;

commit;
