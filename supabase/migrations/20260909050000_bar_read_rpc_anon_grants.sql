-- Desktop data-plane calls run as the anon database role (anon key plus the
-- app-session header; lodge, outlet and actor checks live inside the
-- functions). The two Bar read RPCs below were granted to
-- authenticated/service_role only, so every Till readiness refresh and every
-- Stock aging read failed with `permission denied for function` while sibling
-- operational RPCs (granted to anon as well) kept working. This aligns both
-- reads with the established desktop-grant convention. Enforcement stays
-- server-side: get_pos_menu_stock_readiness requires a lodge role and
-- get_bar_stock_aging additionally scopes non-manager operators to their
-- assigned outlet.

begin;

grant execute on function public.get_pos_menu_stock_readiness(uuid) to anon;
grant execute on function public.get_bar_stock_aging(uuid, uuid) to anon;

commit;
