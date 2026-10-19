-- Preserve the explicit anon-key desktop staff-session entry point from
-- 20260924000001. The capability/lodge/active-user checks stay inside the
-- SECURITY DEFINER RPC; this does not grant PUBLIC execution or any data table
-- privileges. A JWT-less anon caller still fails _restaurant_require_capability.
begin;

grant execute on function public.get_restaurant_budget_export_v3(uuid,integer,jsonb) to anon;

commit;
