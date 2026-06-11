begin;

-- Desktop sessions use the Supabase anon key plus app-level lodge/user scoping,
-- so report read RPCs must be executable by anon as well as authenticated.
revoke all on function public.get_revenue_report(uuid, date, date) from public;
grant execute on function public.get_revenue_report(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_outlet_profit_loss_summary(uuid, date, date) from public;
grant execute on function public.get_outlet_profit_loss_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_profit_loss_summary(uuid, date, date) from public;
grant execute on function public.get_profit_loss_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_room_profitability_summary(uuid, date, date) from public;
grant execute on function public.get_room_profitability_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_supply_spend_summary(uuid, date, date) from public;
grant execute on function public.get_supply_spend_summary(uuid, date, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
