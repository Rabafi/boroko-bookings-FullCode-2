-- Once receipt movements exist, the physical location is financial stock truth
-- and must be moved only through an auditable stock-location transfer.
create or replace function public.restaurant_lock_received_purchase_order_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'received' and old.stock_location_id is distinct from new.stock_location_id then
    raise exception 'A received purchase order location cannot be changed. Use a stock location transfer instead';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_lock_received_purchase_order_location on public.restaurant_purchase_orders;
create trigger restaurant_lock_received_purchase_order_location
  before update of stock_location_id on public.restaurant_purchase_orders
  for each row execute function public.restaurant_lock_received_purchase_order_location();
