-- Menu prices are commercial truth. A recipe draft is intentionally unavailable
-- until it has ingredients, but it must still have a real selling price before
-- it can become available at Till.
create or replace function public.enforce_restaurant_menu_positive_price()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.price, 0) <= 0 then
    raise exception 'Set a menu price greater than P0.00 before saving this item.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_restaurant_menu_positive_price on public.pos_menu_items;
create trigger trg_restaurant_menu_positive_price
before insert or update of price on public.pos_menu_items
for each row execute function public.enforce_restaurant_menu_positive_price();
