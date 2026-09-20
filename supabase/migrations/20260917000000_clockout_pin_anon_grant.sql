-- Restore desktop clock-out permission dropped by 20260914010000.
--
-- 20260914010000 redefined clock_out_staff_with_attendance_pin and re-granted
-- EXECUTE to authenticated + service_role only, while the desktop connects
-- with the anon key (established pattern in 20260816190000: the restricted
-- application-session context is validated server-side inside the RPC).
-- Clock-in kept its anon grant (untouched since 20260816190000), so terminals
-- fail exactly at clock-out with "permission denied for function
-- clock_out_staff_with_attendance_pin".
--
-- Grant-only file: no body, signature, or RLS changes. Server-side checks
-- (app_require_restaurant_lodge, staff PIN validation, cash-up guard,
-- idempotency contract) are unchanged.
begin;

grant execute on function public.clock_out_staff_with_attendance_pin(jsonb)
  to anon, authenticated, service_role;

commit;
