-- Fix: desktop/POS clients connect with the anon key (the custom session is
-- validated server-side inside each RPC), so the 20260909000000 migration's
-- revoke-from-anon + authenticated-only grant broke every anon-postgrest call
-- with "permission denied for function save_bar_product_with_stock".
-- Security posture is unchanged: the function itself enforces
-- app_require_lodge_role and app_require_pos_outlet_access server-side, which
-- matches the established anon,authenticated,service_role grant pattern used
-- by all other POS/catalog RPCs.
begin;

revoke all on function public.save_bar_product_with_stock(jsonb) from public, anon, authenticated;
grant execute on function public.save_bar_product_with_stock(jsonb) to anon, authenticated, service_role;

commit;
