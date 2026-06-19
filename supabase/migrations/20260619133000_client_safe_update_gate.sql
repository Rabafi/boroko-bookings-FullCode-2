-- Desktop clients need read-only access to the release rollout decision.
-- The RPC exposes release metadata only and performs no mutation.

begin;

revoke all on function public.app_check_update_availability(text, text) from public;
grant execute on function public.app_check_update_availability(text, text)
  to anon, authenticated, service_role;

commit;
