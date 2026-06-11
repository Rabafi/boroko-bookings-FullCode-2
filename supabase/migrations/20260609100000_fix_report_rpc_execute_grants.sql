-- Fix missing execute grants on report summary RPCs after baseline migration
-- The baseline migration (20260526101632_baseline_20260526_remote_schema.sql) created these
-- functions but omitted the grant statements, causing "permission denied" errors in production.

revoke all on function public.get_revenue_report(uuid, date, date) from public;
grant execute on function public.get_revenue_report(uuid, date, date) to authenticated, service_role;

revoke all on function public.get_outlet_profit_loss_summary(uuid, date, date) from public;
grant execute on function public.get_outlet_profit_loss_summary(uuid, date, date) to authenticated, service_role;

revoke all on function public.get_profit_loss_summary(uuid, date, date) from public;
grant execute on function public.get_profit_loss_summary(uuid, date, date) to authenticated, service_role;

revoke all on function public.get_room_profitability_summary(uuid, date, date) from public;
grant execute on function public.get_room_profitability_summary(uuid, date, date) to authenticated, service_role;

revoke all on function public.get_supply_spend_summary(uuid, date, date) from public;
grant execute on function public.get_supply_spend_summary(uuid, date, date) to authenticated, service_role;
