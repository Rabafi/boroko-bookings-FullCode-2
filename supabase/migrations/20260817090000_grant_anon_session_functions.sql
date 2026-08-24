-- 2026-08-17 — Grant session-resolution functions to the desktop's anon-role client.
--
-- The desktop and public-site surfaces authenticate with the anon key plus the
-- custom x-boroko-session header. PostgREST therefore executes every function
-- and RLS policy as the `anon` role.
--
-- 1. public.app_current_lodge_id(text) was never granted EXECUTE to any role.
--    RLS policies on event_booking_line_items, event_booking_resources,
--    event_booking_rooms, room_types, floor_sections, and venues call it
--    directly, so every read of those tables failed with
--    "permission denied for function app_current_lodge_id". This also broke
--    the desktop background cache refresh (event-line-items is in the batch),
--    leaving caches stale and the health panel reporting refresh retries.
--
-- 2. public.submit_authenticated_commercial_quote_request(jsonb) was granted
--    only to authenticated/service_role, but the desktop calls it as anon,
--    producing the same 42501 class of failure.

GRANT EXECUTE ON FUNCTION public.app_current_lodge_id(text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_authenticated_commercial_quote_request(jsonb) TO anon;