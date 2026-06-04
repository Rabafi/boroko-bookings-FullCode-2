begin;

revoke truncate, references, trigger on table public.users from anon, authenticated;
revoke truncate, references, trigger on table public.settings from anon, authenticated;
revoke truncate, references, trigger on table public.rooms from anon, authenticated;
revoke truncate, references, trigger on table public.customers from anon, authenticated;
revoke truncate, references, trigger on table public.bookings from anon, authenticated;
revoke truncate, references, trigger on table public.payments from anon, authenticated;
revoke truncate, references, trigger on table public.invoices from anon, authenticated;
revoke truncate, references, trigger on table public.quotations from anon, authenticated;
revoke truncate, references, trigger on table public.booking_charges from anon, authenticated;
revoke truncate, references, trigger on table public.room_rate_overrides from anon, authenticated;
revoke truncate, references, trigger on table public.expenses from anon, authenticated;
revoke truncate, references, trigger on table public.maintenance_tickets from anon, authenticated;
revoke truncate, references, trigger on table public.pos_menu_items from anon, authenticated;
revoke truncate, references, trigger on table public.pos_orders from anon, authenticated;
revoke truncate, references, trigger on table public.inventory_items from anon, authenticated;
revoke truncate, references, trigger on table public.inventory_purchases from anon, authenticated;
revoke truncate, references, trigger on table public.supply_items from anon, authenticated;
revoke truncate, references, trigger on table public.supply_purchases from anon, authenticated;
revoke truncate, references, trigger on table public.room_supply_allocations from anon, authenticated;
revoke truncate, references, trigger on table public.conference_bookings from anon, authenticated;
revoke truncate, references, trigger on table public.pool_day_use from anon, authenticated;

commit;
