-- Fix missing execute grants on public-facing booking RPCs for anonymous users
-- The baseline migration (20260526101632_baseline_20260526_remote_schema.sql) created these
-- functions but omitted the grant statements for the anon role, causing
-- "permission denied" errors for all public visitors.

revoke all on function public.create_online_booking(text, jsonb) from public;
grant execute on function public.create_online_booking(text, jsonb) to anon, authenticated;

revoke all on function public.get_available_rooms_summary(text, date, date) from public;
grant execute on function public.get_available_rooms_summary(text, date, date) to anon, authenticated;

revoke all on function public.get_lodge_public_profile_shell(text) from public;
grant execute on function public.get_lodge_public_profile_shell(text) to anon, authenticated;

revoke all on function public.get_lodge_public_media(text) from public;
grant execute on function public.get_lodge_public_media(text) to anon, authenticated;

revoke all on function public.get_public_room_media(text, uuid) from public;
grant execute on function public.get_public_room_media(text, uuid) to anon, authenticated;

-- Also grant the legacy fallback functions if they still exist for backwards compatibility
revoke all on function public.get_lodge_public_profile(text) from public;
grant execute on function public.get_lodge_public_profile(text) to anon, authenticated;

revoke all on function public.get_available_rooms(text, date, date) from public;
grant execute on function public.get_available_rooms(text, date, date) to anon, authenticated;
