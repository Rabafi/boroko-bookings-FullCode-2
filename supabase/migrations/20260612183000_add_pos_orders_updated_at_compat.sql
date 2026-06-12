-- Keep POS order schema compatible with newer sync/reporting code while the app
-- continues to load history from created_at for older production databases.

alter table public.pos_orders
  add column if not exists updated_at timestamptz;

update public.pos_orders
   set updated_at = coalesce(completed_at, created_at, now())
 where updated_at is null;

alter table public.pos_orders
  alter column updated_at set default now(),
  alter column updated_at set not null;
