create or replace function public.get_restaurant_stock_location_balances(p_lodge_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'inventory_item_id', x.inventory_item_id, 'item_name', x.item_name, 'unit', x.unit,
      'stock_location_id', x.stock_location_id, 'stock_location_name', x.stock_location_name,
      'quantity', x.quantity, 'business_stock', x.business_stock, 'allocated_stock', x.allocated_stock,
      'unallocated_stock', greatest(x.business_stock - x.allocated_stock, 0), 'updated_at', x.updated_at
    ) order by x.item_name, x.stock_location_name)
    from (
      select ii.id as inventory_item_id, ii.name as item_name, ii.unit, l.id as stock_location_id, l.name as stock_location_name,
        coalesce(b.quantity, 0) as quantity, coalesce(ii.current_stock, 0) as business_stock,
        coalesce(sum(b.quantity) over (partition by ii.id), 0) as allocated_stock, b.updated_at
      from public.inventory_items ii
      cross join public.restaurant_stock_locations l
      left join public.restaurant_stock_location_balances b on b.inventory_item_id = ii.id and b.stock_location_id = l.id and b.lodge_id = p_lodge_id
      where ii.lodge_id = p_lodge_id and l.lodge_id = p_lodge_id and l.is_active
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_restaurant_stock_location_balances(uuid) from public;
grant execute on function public.get_restaurant_stock_location_balances(uuid) to authenticated, service_role;
