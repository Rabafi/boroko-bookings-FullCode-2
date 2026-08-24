-- The desktop application uses the restricted application-session context
-- through PostgREST's anon role. Attendance-PIN clock-in/out still enforce
-- the current application actor, lodge scope, staff PIN and their existing
-- server-side idempotency contracts; this only makes those protected RPCs
-- callable by the established desktop session.

begin;

revoke all on function public.clock_in_staff_with_attendance_pin(jsonb) from public;
revoke all on function public.clock_out_staff_with_attendance_pin(jsonb) from public;

grant execute on function public.clock_in_staff_with_attendance_pin(jsonb)
  to anon, authenticated, service_role;
grant execute on function public.clock_out_staff_with_attendance_pin(jsonb)
  to anon, authenticated, service_role;

commit;
