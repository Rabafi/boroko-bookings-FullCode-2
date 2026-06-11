-- Allow maintenance tickets to exist without a room (e.g. general lodge maintenance).
-- The create_maintenance_ticket RPC already omits room_id from the INSERT when not
-- provided, but the NOT NULL constraint was rejecting those rows.

alter table public.maintenance_tickets
  alter column room_id drop not null;
