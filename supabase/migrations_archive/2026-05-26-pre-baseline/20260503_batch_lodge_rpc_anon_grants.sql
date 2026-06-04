begin;

revoke all on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) from public;
grant execute on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) to anon, authenticated, service_role;

revoke all on function public.update_booking_status(uuid, uuid, text, timestamptz) from public;
grant execute on function public.update_booking_status(uuid, uuid, text, timestamptz) to anon, authenticated, service_role;

revoke all on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamptz) from public;
grant execute on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamptz) to anon, authenticated, service_role;

revoke all on function public.delete_booking_charge(uuid, uuid, text, timestamptz) from public;
grant execute on function public.delete_booking_charge(uuid, uuid, text, timestamptz) to anon, authenticated, service_role;

revoke all on function public.verify_refund_approver_pin(uuid, text) from public;
grant execute on function public.verify_refund_approver_pin(uuid, text) to anon, authenticated, service_role;

revoke all on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text) from public;
grant execute on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text) to anon, authenticated, service_role;

revoke all on function public.get_refund_approval_log(uuid, uuid, int) from public;
grant execute on function public.get_refund_approval_log(uuid, uuid, int) to anon, authenticated, service_role;

revoke all on function public.record_financial_validation_run(uuid, text, uuid, jsonb) from public;
grant execute on function public.record_financial_validation_run(uuid, text, uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.get_financial_validation_runs(uuid, int) from public;
grant execute on function public.get_financial_validation_runs(uuid, int) to anon, authenticated, service_role;

revoke all on function public.get_financial_validation_alerts(uuid, int) from public;
grant execute on function public.get_financial_validation_alerts(uuid, int) to anon, authenticated, service_role;

revoke all on function public.get_manager_dashboard_snapshot(uuid, date) from public;
grant execute on function public.get_manager_dashboard_snapshot(uuid, date) to anon, authenticated, service_role;

revoke all on function public.get_reports_snapshot(uuid, date) from public;
grant execute on function public.get_reports_snapshot(uuid, date) to anon, authenticated, service_role;

revoke all on function public.get_night_audit_summary(uuid, date) from public;
grant execute on function public.get_night_audit_summary(uuid, date) to anon, authenticated, service_role;

revoke all on function public.get_revenue_report(uuid, date, date) from public;
grant execute on function public.get_revenue_report(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_profit_loss_summary(uuid, date, date) from public;
grant execute on function public.get_profit_loss_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_outlet_profit_loss_summary(uuid, date, date) from public;
grant execute on function public.get_outlet_profit_loss_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_room_profitability_summary(uuid, date, date) from public;
grant execute on function public.get_room_profitability_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_pos_sales_summary(uuid, date, date, text) from public;
grant execute on function public.get_pos_sales_summary(uuid, date, date, text) to anon, authenticated, service_role;

revoke all on function public.get_inventory_spend_summary(uuid, date, date, text) from public;
grant execute on function public.get_inventory_spend_summary(uuid, date, date, text) to anon, authenticated, service_role;

revoke all on function public.get_supply_spend_summary(uuid, date, date) from public;
grant execute on function public.get_supply_spend_summary(uuid, date, date) to anon, authenticated, service_role;

revoke all on function public.get_lodge_support_tickets(uuid, int) from public;
grant execute on function public.get_lodge_support_tickets(uuid, int) to anon, authenticated, service_role;

revoke all on function public.update_lodge_support_ticket(uuid, uuid, text, text) from public;
grant execute on function public.update_lodge_support_ticket(uuid, uuid, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
