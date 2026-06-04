begin;

revoke all privileges on table public.users from anon, authenticated;
grant select on table public.users to anon, authenticated;

revoke all privileges on table public.settings from anon, authenticated;
grant select, insert, update on table public.settings to anon, authenticated;

revoke all privileges on table public.rooms from anon, authenticated;
grant select on table public.rooms to anon, authenticated;

revoke all privileges on table public.customers from anon, authenticated;
grant select on table public.customers to anon, authenticated;

revoke all privileges on table public.bookings from anon, authenticated;
grant select on table public.bookings to anon, authenticated;

revoke all privileges on table public.payments from anon, authenticated;
grant select on table public.payments to anon, authenticated;

revoke all privileges on table public.invoices from anon, authenticated;
grant select on table public.invoices to anon, authenticated;

revoke all privileges on table public.booking_charges from anon, authenticated;
grant select on table public.booking_charges to anon, authenticated;

revoke all privileges on table public.quotations from anon, authenticated;
grant select on table public.quotations to anon, authenticated;

revoke all privileges on table public.expenses from anon, authenticated;
grant select on table public.expenses to anon, authenticated;

revoke all privileges on table public.maintenance_tickets from anon, authenticated;
grant select on table public.maintenance_tickets to anon, authenticated;

revoke all privileges on table public.lodge_features from anon, authenticated;
grant select on table public.lodge_features to anon, authenticated;

revoke all privileges on table public.inventory_items from anon, authenticated;
grant select on table public.inventory_items to anon, authenticated;

revoke all privileges on table public.conference_bookings from anon, authenticated;
grant select on table public.conference_bookings to anon, authenticated;

revoke all privileges on table public.pool_day_use from anon, authenticated;
grant select on table public.pool_day_use to anon, authenticated;

revoke all privileges on table public.pos_orders from anon, authenticated;
grant select on table public.pos_orders to anon, authenticated;

revoke all privileges on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to anon, authenticated;

revoke all on function public.create_user(jsonb) from public;
grant execute on function public.create_user(jsonb) to anon, authenticated, service_role;

revoke all on function public.update_user_profile(uuid, uuid, jsonb) from public;
grant execute on function public.update_user_profile(uuid, uuid, jsonb) to anon, authenticated, service_role;

revoke all on function public.set_user_password(uuid, uuid, text) from public;
grant execute on function public.set_user_password(uuid, uuid, text) to anon, authenticated, service_role;

revoke all on function public.set_user_pwa_access(uuid, uuid, boolean, text, text, uuid) from public;
grant execute on function public.set_user_pwa_access(uuid, uuid, boolean, text, text, uuid) to anon, authenticated, service_role;

revoke all on function public.delete_user(uuid, uuid) from public;
grant execute on function public.delete_user(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
