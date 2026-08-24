-- Desktop POS report exports run under the established application-session
-- context with the PostgREST anon role. The artifact writer is SECURITY
-- DEFINER, but remains tightly server-authorized: it validates the current
-- app actor's POS reporting access, locks the same-lodge report run, and
-- permits a non-service caller only when that actor created that POS report
-- run. Restore the execution grant without granting table access or opening
-- accounting-report artifact recording.

begin;

revoke all on function public.record_report_artifact_result(uuid, uuid, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.record_report_artifact_result(uuid, uuid, text, text, text, bigint, text)
  to anon, authenticated, service_role;

commit;
