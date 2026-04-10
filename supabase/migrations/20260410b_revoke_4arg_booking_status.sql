-- Revoke anon execute on the 4-arg update_booking_status signature
-- The 3-arg version was revoked in 20260410_codex_security_fixes.sql.
-- The 4-arg version (with p_expected_updated_at) was added in
-- 20260426_financial_integrity_followups.sql and was never explicitly revoked.

begin;

revoke execute on function public.update_booking_status(uuid, uuid, text, timestamptz)
  from anon;

commit;
