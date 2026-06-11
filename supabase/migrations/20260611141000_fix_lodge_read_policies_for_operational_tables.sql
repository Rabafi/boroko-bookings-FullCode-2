begin;

-- These tables already have RLS enabled, but some live databases were missing
-- the lodge-scoped SELECT policies. Without these, a valid Boroko session sees
-- zero rows and the desktop/PWA tabs appear blank.

create policy supply_items_lodge_scope_select
  on public.supply_items
  for select
  using (public.app_lodge_access(lodge_id));

create policy supply_purchases_lodge_scope_select
  on public.supply_purchases
  for select
  using (public.app_lodge_access(lodge_id));

create policy room_supply_room_stock_lodge_scope_select
  on public.room_supply_room_stock
  for select
  using (public.app_lodge_access(lodge_id));

create policy room_supply_movements_lodge_scope_select
  on public.room_supply_movements
  for select
  using (public.app_lodge_access(lodge_id));

create policy room_supply_allocations_lodge_scope_select
  on public.room_supply_allocations
  for select
  using (public.app_lodge_access(lodge_id));

create policy supply_stocktakes_lodge_scope_select
  on public.supply_stocktakes
  for select
  using (public.app_lodge_access(lodge_id));

create policy supply_stocktake_lines_lodge_scope_select
  on public.supply_stocktake_lines
  for select
  using (public.app_lodge_access(lodge_id));

create policy room_supply_stocktakes_lodge_scope_select
  on public.room_supply_stocktakes
  for select
  using (public.app_lodge_access(lodge_id));

create policy room_supply_stocktake_lines_lodge_scope_select
  on public.room_supply_stocktake_lines
  for select
  using (public.app_lodge_access(lodge_id));

create policy inventory_purchases_lodge_scope_select
  on public.inventory_purchases
  for select
  using (public.app_lodge_access(lodge_id));

create policy outlets_lodge_scope_select
  on public.outlets
  for select
  using (public.app_lodge_access(lodge_id));

grant select on table
  public.supply_items,
  public.supply_purchases,
  public.room_supply_room_stock,
  public.room_supply_movements,
  public.room_supply_allocations,
  public.supply_stocktakes,
  public.supply_stocktake_lines,
  public.room_supply_stocktakes,
  public.room_supply_stocktake_lines,
  public.inventory_purchases,
  public.outlets
to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
