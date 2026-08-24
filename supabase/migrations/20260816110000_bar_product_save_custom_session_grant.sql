-- The desktop application uses the established application-session context
-- while its database client has the anon PostgREST role. The atomic Bar
-- product save was accidentally granted only to Supabase-authenticated users,
-- preventing an authorised Bar manager from creating a sellable item.
--
-- The function remains SECURITY DEFINER and checks the current application
-- session, lodge and manager role before it can write. This migration restores
-- the same client-role contract used by the compatible Bar pack operation.

begin;

revoke all on function public.save_bar_pos_product_with_packs(jsonb) from public, anon, authenticated;
grant execute on function public.save_bar_pos_product_with_packs(jsonb) to anon, authenticated, service_role;

commit;
