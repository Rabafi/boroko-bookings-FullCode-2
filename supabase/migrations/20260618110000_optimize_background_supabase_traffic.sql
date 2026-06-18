-- Reduce CPU and disk I/O from recurring background reads.
-- These indexes are intentionally narrow and match known app-wide polling paths.

create index if not exists bookings_lodge_online_pending_created_idx
  on public.bookings (lodge_id, created_at desc)
  where source = 'online' and status = 'pending';

create index if not exists bookings_lodge_checked_in_checkout_idx
  on public.bookings (lodge_id, check_out)
  where status = 'checked_in';

create index if not exists bookings_lodge_unpaid_payment_idx
  on public.bookings (lodge_id, payment_status)
  where status <> 'cancelled' and payment_status in ('unpaid', 'partial');

create index if not exists maintenance_tickets_lodge_open_created_idx
  on public.maintenance_tickets (lodge_id, created_at desc)
  where status = 'open';

create index if not exists rejected_online_bookings_lodge_maintenance_attempted_idx
  on public.rejected_online_bookings (lodge_id, attempted_at desc)
  where rejection_reason = 'maintenance';

create index if not exists support_tickets_lodge_updated_idx
  on public.support_tickets (lodge_id, coalesce(updated_at, created_at) desc, id desc);

create index if not exists support_tickets_urgent_open_idx
  on public.support_tickets (priority, created_at)
  where priority in ('Urgent', 'Critical') and status not in ('resolved', 'closed');

create index if not exists broadcasts_active_expires_idx
  on public.broadcasts (expires_at)
  where is_active = true;

create index if not exists inventory_items_lodge_category_name_idx
  on public.inventory_items (lodge_id, category, name);

create index if not exists expenses_lodge_date_idx
  on public.expenses (lodge_id, date desc);

create index if not exists pool_day_use_lodge_date_idx
  on public.pool_day_use (lodge_id, date desc);

create index if not exists conference_bookings_lodge_date_idx
  on public.conference_bookings (lodge_id, booking_date desc);
